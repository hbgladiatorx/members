/** Syllabus items and announcements — the instructor's "information for the class". */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isStaff, MEMBERS, requireClassRole, STAFF } from '../lib/access.js';
import { requireUser } from '../lib/auth.js';
import { audit, one, query } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { idParam, parse, text } from '../lib/validate.js';
import { emitToChannel } from '../realtime/hub.js';
import { attachmentsFor } from '../services/attachments.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const syllabusBody = z.object({
  title: text(1, 200),
  body: z.string().max(50_000).default(''),
  dueOn: dateStr.nullish(),
  published: z.boolean().default(false),
  position: z.number().int().min(0).max(100_000).optional(),
});
const syllabusPatch = syllabusBody.partial();
const reorderBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });
const announcementBody = z.object({ title: text(1, 200), body: z.string().max(20_000).default(''), pinned: z.boolean().default(false) });
const announcementPatch = announcementBody.partial();

const SYL_COLS = `id, class_id AS "classId", position, title, body, due_on AS "dueOn", published,
  created_at AS "createdAt", updated_at AS "updatedAt"`;
const ANN_COLS = `a.id, a.class_id AS "classId", a.title, a.body, a.pinned, a.created_at AS "createdAt",
  json_build_object('id', u.id, 'displayName', u.display_name, 'avatarUrl', u.avatar_url) AS author`;

export default async function contentRoutes(app: FastifyInstance) {
  // ── Syllabus ──
  app.get('/classes/:id/syllabus', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const role = await requireClassRole(id, userId, MEMBERS);
    const items = await query(
      `SELECT ${SYL_COLS} FROM syllabus_items
        WHERE class_id = $1 AND deleted_at IS NULL AND (published OR $2)
        ORDER BY position, created_at`,
      [id, isStaff(role)],
    );
    const files = await attachmentsFor('syllabus_item', items.map((i) => i.id));
    return { items: items.map((i) => ({ ...i, attachments: files.get(i.id) ?? [] })) };
  });

  app.post('/classes/:id/syllabus', async (req, reply) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    await requireClassRole(id, userId, STAFF);
    const b = parse(syllabusBody, req.body);
    const item = await one(
      `INSERT INTO syllabus_items (class_id, position, title, body, due_on, published, created_by)
       VALUES ($1, COALESCE($2, (SELECT COALESCE(max(position) + 1, 0) FROM syllabus_items WHERE class_id = $1)),
               $3, $4, $5, $6, $7)
       RETURNING ${SYL_COLS}`,
      [id, b.position ?? null, b.title, b.body, b.dueOn ?? null, b.published, userId],
    );
    reply.code(201);
    return { item };
  });

  app.patch('/syllabus/:id', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const existing = await one('SELECT class_id FROM syllabus_items WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!existing) throw notFound('Syllabus item');
    await requireClassRole(existing.class_id, userId, STAFF);
    const b = parse(syllabusPatch, req.body);
    const item = await one(
      `UPDATE syllabus_items SET
         title = COALESCE($2, title), body = COALESCE($3, body),
         due_on = CASE WHEN $4::boolean THEN $5::date ELSE due_on END,
         published = COALESCE($6, published), position = COALESCE($7, position),
         updated_at = now()
       WHERE id = $1 RETURNING ${SYL_COLS}`,
      [id, b.title ?? null, b.body ?? null, b.dueOn !== undefined, b.dueOn ?? null, b.published ?? null, b.position ?? null],
    );
    return { item };
  });

  /** Set the full order of a class's syllabus in one call (drag-and-drop in the UI). */
  app.put('/classes/:id/syllabus/order', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    await requireClassRole(id, userId, STAFF);
    const { ids } = parse(reorderBody, req.body);
    await query(
      `UPDATE syllabus_items s SET position = o.ord - 1, updated_at = now()
         FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, ord)
        WHERE s.id = o.id AND s.class_id = $1`,
      [id, ids],
    );
    return { ok: true };
  });

  app.delete('/syllabus/:id', async (req, reply) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const existing = await one('SELECT class_id FROM syllabus_items WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!existing) throw notFound('Syllabus item');
    await requireClassRole(existing.class_id, userId, STAFF);
    await query('UPDATE syllabus_items SET deleted_at = now() WHERE id = $1', [id]);
    await audit(userId, 'syllabus.delete', 'syllabus_item', id);
    reply.code(204);
  });

  // ── Announcements ──
  app.get('/classes/:id/announcements', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    await requireClassRole(id, userId, MEMBERS);
    const announcements = await query(
      `SELECT ${ANN_COLS} FROM announcements a JOIN users u ON u.id = a.author_id
        WHERE a.class_id = $1 AND a.deleted_at IS NULL
        ORDER BY a.pinned DESC, a.created_at DESC LIMIT 100`,
      [id],
    );
    const files = await attachmentsFor('announcement', announcements.map((a) => a.id));
    return { announcements: announcements.map((a) => ({ ...a, attachments: files.get(a.id) ?? [] })) };
  });

  app.post('/classes/:id/announcements', async (req, reply) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    await requireClassRole(id, userId, STAFF);
    const b = parse(announcementBody, req.body);
    const created = await one(
      `INSERT INTO announcements (class_id, author_id, title, body, pinned) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [id, userId, b.title, b.body, b.pinned],
    );
    const announcement = await one(
      `SELECT ${ANN_COLS} FROM announcements a JOIN users u ON u.id = a.author_id WHERE a.id = $1`,
      [created.id],
    );
    // Live-notify everyone in the class chat room. Push notifications arrive in phase 3.
    const ch = await one(`SELECT id FROM channels WHERE class_id = $1 AND kind = 'class'`, [id]);
    if (ch) emitToChannel(ch.id, 'announcement:new', announcement);
    reply.code(201);
    return { announcement };
  });

  app.patch('/announcements/:id', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const existing = await one('SELECT class_id FROM announcements WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!existing) throw notFound('Announcement');
    await requireClassRole(existing.class_id, userId, STAFF);
    const b = parse(announcementPatch, req.body);
    await query(
      `UPDATE announcements SET title = COALESCE($2, title), body = COALESCE($3, body), pinned = COALESCE($4, pinned)
        WHERE id = $1`,
      [id, b.title ?? null, b.body ?? null, b.pinned ?? null],
    );
    const announcement = await one(
      `SELECT ${ANN_COLS} FROM announcements a JOIN users u ON u.id = a.author_id WHERE a.id = $1`,
      [id],
    );
    return { announcement };
  });

  app.delete('/announcements/:id', async (req, reply) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const existing = await one('SELECT class_id FROM announcements WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!existing) throw notFound('Announcement');
    await requireClassRole(existing.class_id, userId, STAFF);
    await query('UPDATE announcements SET deleted_at = now() WHERE id = $1', [id]);
    await audit(userId, 'announcement.delete', 'announcement', id);
    reply.code(204);
  });
}
