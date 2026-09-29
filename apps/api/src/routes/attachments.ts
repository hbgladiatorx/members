/**
 * Files (PDF, Office documents, images, plain text) and links on any posting: chat messages and DMs,
 * questions and answers, discussion topics and replies, announcements and syllabus items.
 *
 * Who may attach: teachers and assistants on announcements and syllabus items; the author on
 * everything else. Who may open: anyone who can read the posting (for a DM, only its two people).
 * Who may remove: whoever attached it, or class staff.
 *
 * Files are class-private. They are never served from a public URL: opening one returns a signed
 * link that works for 5 minutes (GET /files/:id?exp&sig). Uploads are identified by their content,
 * not their name, and anything that isn't one of the allowed types is refused.
 */
import { timingSafeEqual } from 'node:crypto';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { activeRole, isStaff, MEMBERS, PARTICIPANTS, requireChannelAccess, requireClassRole, STAFF } from '../lib/access.js';
import { requireUser } from '../lib/auth.js';
import { config } from '../config.js';
import { audit, one, query } from '../lib/db.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { emitToChannel } from '../realtime/hub.js';
import { loadMessage } from '../services/chat.js';
import { attachmentsFor, sign, signedUrl, TARGET_KINDS, type TargetKind } from '../services/attachments.js';
import { storage } from '../lib/storage.js';
import { idParam, parse, uuid } from '../lib/validate.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const LINK_TTL_SECONDS = 5 * 60;

const target = z.object({ targetKind: z.enum(TARGET_KINDS), targetId: uuid });
/** Optional short reference, for an attachment placed in the posting's text as ![title](attachment:<ref>). */
const ref = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).optional();
const fileQuery = target.extend({ ref });
const linkBody = target.extend({
  ref,
  url: z
    .string()
    .trim()
    .max(2000)
    .url()
    .refine((u) => /^https?:\/\//i.test(u), 'must start with http:// or https://'),
  title: z.string().trim().max(200).optional(),
});
const fileParams = z.object({ id: uuid });
const signedQuery = z.object({ exp: z.coerce.number().int(), sig: z.string().regex(/^[a-f0-9]{64}$/) });

// ── File types we accept, identified by content ──
interface FileType {
  ext: string;
  contentType: string;
  inline: boolean; // open in the browser rather than download
}
const TYPES: Record<string, FileType> = {
  pdf: { ext: 'pdf', contentType: 'application/pdf', inline: true },
  png: { ext: 'png', contentType: 'image/png', inline: true },
  jpg: { ext: 'jpg', contentType: 'image/jpeg', inline: true },
  gif: { ext: 'gif', contentType: 'image/gif', inline: true },
  webp: { ext: 'webp', contentType: 'image/webp', inline: true },
  docx: { ext: 'docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', inline: false },
  pptx: { ext: 'pptx', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', inline: false },
  xlsx: { ext: 'xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', inline: false },
  doc: { ext: 'doc', contentType: 'application/msword', inline: false },
  ppt: { ext: 'ppt', contentType: 'application/vnd.ms-powerpoint', inline: false },
  xls: { ext: 'xls', contentType: 'application/vnd.ms-excel', inline: false },
  txt: { ext: 'txt', contentType: 'text/plain; charset=utf-8', inline: false },
  csv: { ext: 'csv', contentType: 'text/csv; charset=utf-8', inline: false },
  md: { ext: 'md', contentType: 'text/markdown; charset=utf-8', inline: false },
};

const starts = (b: Buffer, ...bytes: number[]) => bytes.every((v, i) => b[i] === v);

/** The file's type from its first bytes (and, for containers, its extension), or null if not allowed. */
export function detectFileType(data: Buffer, filename: string): FileType | null {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  if (data.subarray(0, 5).toString('latin1') === '%PDF-') return TYPES.pdf!;
  if (starts(data, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return TYPES.png!;
  if (starts(data, 0xff, 0xd8, 0xff)) return TYPES.jpg!;
  if (data.subarray(0, 6).toString('latin1').match(/^GIF8[79]a$/)) return TYPES.gif!;
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return TYPES.webp!;
  // Office Open XML files are zip archives; the extension says which kind.
  if (starts(data, 0x50, 0x4b, 0x03, 0x04) && ['docx', 'pptx', 'xlsx'].includes(ext)) return TYPES[ext]!;
  // Older Office files share the OLE compound-file header.
  if (starts(data, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1) && ['doc', 'ppt', 'xls'].includes(ext)) return TYPES[ext]!;
  // Plain text: valid UTF-8, no NUL bytes, and no HTML (it would be served from our own origin).
  if (['txt', 'csv', 'md'].includes(ext) && !data.includes(0)) {
    const s = data.toString('utf8');
    if (!s.includes('�') && !/<\s*(script|html|iframe|svg)/i.test(s)) return TYPES[ext]!;
  }
  return null;
}


interface Posting {
  classId: string | null; // null for DMs
  channelId: string | null; // chat messages
  authorId: string;
}

// Where each kind of posting lives, its class and its author. Deleted postings (or ones whose
// question/topic was deleted) count as missing.
const POSTING_SQL: Record<TargetKind, string> = {
  announcement: `SELECT class_id, NULL::uuid AS channel_id, author_id FROM announcements WHERE id = $1 AND deleted_at IS NULL`,
  syllabus_item: `SELECT class_id, NULL::uuid AS channel_id, created_by AS author_id FROM syllabus_items WHERE id = $1 AND deleted_at IS NULL`,
  message: `SELECT c.class_id, m.channel_id, m.author_id FROM messages m JOIN channels c ON c.id = m.channel_id WHERE m.id = $1 AND m.deleted_at IS NULL`,
  question: `SELECT class_id, NULL::uuid AS channel_id, author_id FROM questions WHERE id = $1 AND deleted_at IS NULL`,
  answer: `SELECT q.class_id, NULL::uuid AS channel_id, a.author_id FROM answers a JOIN questions q ON q.id = a.question_id
            WHERE a.id = $1 AND a.deleted_at IS NULL AND q.deleted_at IS NULL`,
  topic: `SELECT class_id, NULL::uuid AS channel_id, author_id FROM topics WHERE id = $1 AND deleted_at IS NULL`,
  post: `SELECT t.class_id, NULL::uuid AS channel_id, p.author_id FROM posts p JOIN topics t ON t.id = p.topic_id
          WHERE p.id = $1 AND p.deleted_at IS NULL AND t.deleted_at IS NULL`,
};

async function posting(kind: TargetKind, id: string): Promise<Posting> {
  const row = await one<{ class_id: string | null; channel_id: string | null; author_id: string }>(POSTING_SQL[kind], [id]);
  if (!row) throw notFound('Posting');
  return { classId: row.class_id, channelId: row.channel_id, authorId: row.author_id };
}

/** May this user see the posting (and so open its attachments)? Throws 404/403 if not. */
async function requireRead(p: Posting, userId: string) {
  if (p.channelId) await requireChannelAccess(p.channelId, userId);
  else await requireClassRole(p.classId!, userId, MEMBERS);
}

/** May this user attach to the posting? Staff on class information; the author (still taking part) on the rest. */
async function requireAttach(kind: TargetKind, p: Posting, userId: string) {
  if (kind === 'announcement' || kind === 'syllabus_item') {
    await requireClassRole(p.classId!, userId, STAFF);
    return;
  }
  if (p.channelId) await requireChannelAccess(p.channelId, userId, { write: true });
  else await requireClassRole(p.classId!, userId, PARTICIPANTS);
  if (p.authorId !== userId) throw forbidden('You can only attach files to your own posts');
}

/** After a chat message gains or loses an attachment, update everyone watching that chat. */
async function refreshMessage(kind: TargetKind, id: string, p: Posting) {
  if (kind === 'message' && p.channelId) emitToChannel(p.channelId, 'message:updated', await loadMessage(id));
}





/** One attachment as the lists show it (with a preview link for images). */
/** Insert an attachment row; a reference already used on the same posting is a conflict. */
async function insertAttachment(sql: string, params: unknown[]) {
  try {
    return (await one<{ id: string }>(sql, params))!;
  } catch (err: any) {
    if (err.code === '23505') throw conflict('That posting already has an attachment with this reference', 'ref_taken');
    throw err;
  }
}

async function oneAttachment(id: string) {
  const r = await one<{ target_kind: TargetKind; target_id: string }>('SELECT target_kind, target_id FROM attachments WHERE id = $1', [id]);
  const all = await attachmentsFor(r!.target_kind, [r!.target_id]);
  return all.get(r!.target_id)!.find((a) => a.id === id);
}

export default async function attachmentRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0 } });

  /** Attach a link to a posting. */
  app.post('/attachments/link', async (req, reply) => {
    const userId = await requireUser(req);
    const b = parse(linkBody, req.body);
    const p = await posting(b.targetKind, b.targetId);
    await requireAttach(b.targetKind, p, userId);
    const title = b.title || new URL(b.url).hostname.replace(/^www\./, '');
    const att = await insertAttachment(
      `INSERT INTO attachments (class_id, target_kind, target_id, kind, title, url, created_by, ref)
       VALUES ($1, $2, $3, 'link', $4, $5, $6, $7) RETURNING id`,
      [p.classId, b.targetKind, b.targetId, title.slice(0, 200), b.url, userId, b.ref ?? null],
    );
    await refreshMessage(b.targetKind, b.targetId, p);
    reply.code(201);
    return { attachment: await oneAttachment(att.id) };
  });

  /** Upload a file: POST /attachments/file?targetKind=announcement&targetId=<id>, multipart field "file". */
  app.post('/attachments/file', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const userId = await requireUser(req);
    const t = parse(fileQuery, req.query);
    const p = await posting(t.targetKind, t.targetId);
    await requireAttach(t.targetKind, p, userId);
    if (!req.isMultipart()) throw badRequest('Send the file as multipart/form-data in a field named "file"');

    const file = await req.file();
    if (!file) throw badRequest('No file received');
    let data: Buffer;
    try {
      data = await file.toBuffer();
    } catch {
      throw new HttpError(413, 'too_large', 'Files must be 25 MB or smaller');
    }
    if (!data.length) throw badRequest('That file is empty');
    const type = detectFileType(data, file.filename);
    if (!type) {
      throw badRequest('That kind of file can’t be attached. Use a PDF, Word, PowerPoint, Excel, image or text file.', 'unsupported_file');
    }

    const key = await storage.put('files', type.ext, data);
    const title = (file.filename || `file.${type.ext}`).replace(/[\u0000-\u001f]/g, '').slice(0, 200) || `file.${type.ext}`;
    const att = await insertAttachment(
      `INSERT INTO attachments (class_id, target_kind, target_id, kind, title, storage_key, content_type, size_bytes, created_by, ref)
       VALUES ($1, $2, $3, 'file', $4, $5, $6, $7, $8, $9) RETURNING id`,
      [p.classId, t.targetKind, t.targetId, title, key, type.contentType, data.length, userId, t.ref ?? null],
    ).catch(async (e) => {
      await storage.remove(key).catch(() => {});
      throw e;
    });
    await refreshMessage(t.targetKind, t.targetId, p);
    reply.code(201);
    return { attachment: await oneAttachment(att.id) };
  });

  /** Open an attachment: a link's address, or a signed 5-minute link to the file. Anyone who can read the posting. */
  app.get('/attachments/:id/open', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const a = await one<{ kind: string; url: string | null; target_kind: TargetKind; target_id: string }>(
      'SELECT kind, url, target_kind, target_id FROM attachments WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    if (!a) throw notFound('Attachment');
    await requireRead(await posting(a.target_kind, a.target_id), userId);
    if (a.kind === 'link') return { url: a.url };
    return { url: signedUrl(id, LINK_TTL_SECONDS), expiresInSeconds: LINK_TTL_SECONDS };
  });

  /** Serve a file through a signed link. No bearer token (browsers open these directly). */
  app.get('/files/:id', async (req, reply) => {
    const { id } = parse(fileParams, req.params);
    const q = parse(signedQuery, req.query);
    const expected = Buffer.from(sign(id, q.exp), 'hex');
    const given = Buffer.from(q.sig, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw notFound('File');
    if (q.exp < Math.floor(Date.now() / 1000)) throw new HttpError(410, 'link_expired', 'This link has expired. Open the file again from the class.');

    const a = await one<{ storage_key: string; content_type: string; title: string; target_kind: TargetKind; target_id: string }>(
      `SELECT storage_key, content_type, title, target_kind, target_id FROM attachments
        WHERE id = $1 AND kind = 'file' AND deleted_at IS NULL`,
      [id],
    );
    if (!a) throw notFound('File');
    await posting(a.target_kind, a.target_id); // the posting must still exist
    const data = await storage.get(a.storage_key);
    if (!data) throw notFound('File');

    const type = Object.values(TYPES).find((t) => t.contentType === a.content_type);
    const inline = !!type?.inline;
    const safeName = a.title.replace(/["\\\r\n]/g, '_');
    reply
      .header('content-type', a.content_type)
      .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(a.title)}`)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, max-age=300')
      .header('referrer-policy', 'no-referrer');
    // Images get a locked-down page; PDFs are left alone so the browser's viewer works.
    if (a.content_type.startsWith('image/')) reply.header('content-security-policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    return data;
  });

  /** Remove an attachment: whoever attached it, or staff of the class it's in. */
  app.delete('/attachments/:id', async (req, reply) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const a = await one<{ class_id: string | null; created_by: string; target_kind: TargetKind; target_id: string }>(
      'SELECT class_id, created_by, target_kind, target_id FROM attachments WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    if (!a) throw notFound('Attachment');
    const p = await posting(a.target_kind, a.target_id).catch(() => null);
    if (p) await requireRead(p, userId);
    const staff = a.class_id ? isStaff(await activeRole(a.class_id, userId)) : false;
    if (a.created_by !== userId && !staff) throw forbidden('Only the person who attached it, or class staff, can remove it');
    await query('UPDATE attachments SET deleted_at = now() WHERE id = $1', [id]);
    await audit(userId, 'attachment.delete', 'attachment', id);
    if (p) await refreshMessage(a.target_kind, a.target_id, p);
    reply.code(204);
  });
}
