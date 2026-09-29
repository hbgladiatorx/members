/**
 * Attachment lists and signed file links, shared by the attachment routes and every route that
 * returns postings (chat, Q&A, discussions, announcements, syllabus). See routes/attachments.ts.
 */
import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { query } from '../lib/db.js';

export const TARGET_KINDS = ['announcement', 'syllabus_item', 'message', 'question', 'answer', 'topic', 'post'] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

// Image previews are shown inline, so their signed links last longer than a download link.
const PREVIEW_TTL_SECONDS = 60 * 60;

export const sign = (id: string, exp: number) => createHmac('sha256', config.JWT_SECRET).update(`attachment:${id}:${exp}`).digest('hex');

export const signedUrl = (id: string, ttl: number) => {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  return `${config.PUBLIC_URL}/files/${id}?exp=${exp}&sig=${sign(id, exp)}`;
};

export const ATT_COLS = `a.id, a.target_id AS "targetId", a.kind, a.title,
  CASE WHEN a.kind = 'link' THEN a.url END AS url,
  a.content_type AS "contentType", a.size_bytes AS "sizeBytes", a.created_at AS "createdAt", a.created_by AS "createdBy"`;

/**
 * Attachments for a set of postings of one kind, grouped by posting id. Callers have already checked
 * that the reader can see these postings. Images carry a signed `previewUrl` so they can be shown inline.
 */
export async function attachmentsFor(kind: TargetKind, ids: string[]) {
  const byTarget = new Map<string, Record<string, unknown>[]>();
  if (!ids.length) return byTarget;
  const rows = await query(
    `SELECT ${ATT_COLS} FROM attachments a
      WHERE a.target_kind = $1 AND a.target_id = ANY($2::uuid[]) AND a.deleted_at IS NULL
      ORDER BY a.created_at`,
    [kind, ids],
  );
  for (const r of rows) {
    const withPreview = String(r.contentType ?? '').startsWith('image/') ? { ...r, previewUrl: signedUrl(r.id, PREVIEW_TTL_SECONDS) } : r;
    byTarget.set(r.targetId, [...(byTarget.get(r.targetId) ?? []), withPreview]);
  }
  return byTarget;
}

/** Add `attachments` to each item (by its `id`). */
export async function withAttachments<T extends { id: string }>(kind: TargetKind, items: T[]) {
  const files = await attachmentsFor(kind, items.map((i) => i.id));
  return items.map((i) => ({ ...i, attachments: files.get(i.id) ?? [] }));
}

