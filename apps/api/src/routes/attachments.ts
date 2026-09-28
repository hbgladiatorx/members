/**
 * Resources on postings: files (PDF, Office documents, images, plain text) and links, attached to
 * announcements and syllabus items. Teachers and assistants add and remove them; everyone in the
 * class (observers included) can open them.
 *
 * Files are class-private. They are never served from a public URL: opening one returns a signed
 * link that works for 5 minutes (GET /files/:id?exp&sig). Uploads are identified by their content,
 * not their name, and anything that isn't one of the allowed types is refused.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MEMBERS, requireClassRole, STAFF } from '../lib/access.js';
import { requireUser } from '../lib/auth.js';
import { config } from '../config.js';
import { audit, one, query } from '../lib/db.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { storage } from '../lib/storage.js';
import { idParam, parse, uuid } from '../lib/validate.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const LINK_TTL_SECONDS = 5 * 60;

export type TargetKind = 'announcement' | 'syllabus_item';
const target = z.object({ targetKind: z.enum(['announcement', 'syllabus_item']), targetId: uuid });
const linkBody = target.extend({
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

const sign = (id: string, exp: number) => createHmac('sha256', config.JWT_SECRET).update(`attachment:${id}:${exp}`).digest('hex');

/** Which class a posting belongs to; 404 if it doesn't exist or was deleted. */
async function targetClass(kind: TargetKind, id: string): Promise<string> {
  const table = kind === 'announcement' ? 'announcements' : 'syllabus_items';
  const row = await one<{ class_id: string }>(`SELECT class_id FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!row) throw notFound(kind === 'announcement' ? 'Announcement' : 'Syllabus item');
  return row.class_id;
}

const ATT_COLS = `a.id, a.target_id AS "targetId", a.kind, a.title,
  CASE WHEN a.kind = 'link' THEN a.url END AS url,
  a.content_type AS "contentType", a.size_bytes AS "sizeBytes", a.created_at AS "createdAt"`;

/** Attachments for a set of postings, grouped by posting id (used by the announcement and syllabus lists). */
export async function attachmentsFor(kind: TargetKind, ids: string[]) {
  const byTarget = new Map<string, unknown[]>();
  if (!ids.length) return byTarget;
  const rows = await query(
    `SELECT ${ATT_COLS} FROM attachments a
      WHERE a.target_kind = $1 AND a.target_id = ANY($2::uuid[]) AND a.deleted_at IS NULL
      ORDER BY a.created_at`,
    [kind, ids],
  );
  for (const r of rows) byTarget.set(r.targetId, [...(byTarget.get(r.targetId) ?? []), r]);
  return byTarget;
}

export default async function attachmentRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0 } });

  /** Attach a link. Teachers and assistants only. */
  app.post('/attachments/link', async (req, reply) => {
    const userId = await requireUser(req);
    const b = parse(linkBody, req.body);
    const classId = await targetClass(b.targetKind, b.targetId);
    await requireClassRole(classId, userId, STAFF);
    const title = b.title || new URL(b.url).hostname.replace(/^www\./, '');
    const att = await one(
      `INSERT INTO attachments (class_id, target_kind, target_id, kind, title, url, created_by)
       VALUES ($1, $2, $3, 'link', $4, $5, $6) RETURNING id`,
      [classId, b.targetKind, b.targetId, title.slice(0, 200), b.url, userId],
    );
    reply.code(201);
    return { attachment: await one(`SELECT ${ATT_COLS} FROM attachments a WHERE a.id = $1`, [att.id]) };
  });

  /** Upload a file: POST /attachments/file?targetKind=announcement&targetId=<id>, multipart field "file". */
  app.post('/attachments/file', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const userId = await requireUser(req);
    const t = parse(target, req.query);
    const classId = await targetClass(t.targetKind, t.targetId);
    await requireClassRole(classId, userId, STAFF);
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
    const att = await one(
      `INSERT INTO attachments (class_id, target_kind, target_id, kind, title, storage_key, content_type, size_bytes, created_by)
       VALUES ($1, $2, $3, 'file', $4, $5, $6, $7, $8) RETURNING id`,
      [classId, t.targetKind, t.targetId, title, key, type.contentType, data.length, userId],
    );
    reply.code(201);
    return { attachment: await one(`SELECT ${ATT_COLS} FROM attachments a WHERE a.id = $1`, [att.id]) };
  });

  /** Open an attachment: a link's address, or a signed 5-minute link to the file. Anyone in the class. */
  app.get('/attachments/:id/open', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const a = await one<{ kind: string; url: string | null; target_kind: TargetKind; target_id: string }>(
      'SELECT kind, url, target_kind, target_id FROM attachments WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    if (!a) throw notFound('Attachment');
    const classId = await targetClass(a.target_kind, a.target_id);
    await requireClassRole(classId, userId, MEMBERS);
    if (a.kind === 'link') return { url: a.url };
    const exp = Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS;
    return { url: `${config.PUBLIC_URL}/files/${id}?exp=${exp}&sig=${sign(id, exp)}`, expiresInSeconds: LINK_TTL_SECONDS };
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
    await targetClass(a.target_kind, a.target_id); // the posting must still exist
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

  /** Remove an attachment. Teachers and assistants only. */
  app.delete('/attachments/:id', async (req, reply) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const a = await one<{ class_id: string }>('SELECT class_id FROM attachments WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!a) throw notFound('Attachment');
    await requireClassRole(a.class_id, userId, STAFF);
    await query('UPDATE attachments SET deleted_at = now() WHERE id = $1', [id]);
    await audit(userId, 'attachment.delete', 'attachment', id);
    reply.code(204);
  });
}
