/** Forum-style discussions: topics with threaded replies. Staff can pin and lock. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isStaff, MEMBERS, requireClassRole } from '../lib/access.js';
import { requireUser } from '../lib/auth.js';
import { audit, one, query, tx } from '../lib/db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { idParam, parse, text } from '../lib/validate.js';
import { withAttachments } from '../services/attachments.js';

const topicBody = z.object({ title: text(3, 200), body: z.string().max(20_000).default('') });
const topicPatch = z.object({
  title: text(3, 200).optional(),
  body: z.string().max(20_000).optional(),
  pinned: z.boolean().optional(),
  locked: z.boolean().optional(),
});
const postBody = z.object({ body: text(1, 10_000), parentId: z.string().uuid().nullish() });
const postPatch = z.object({ body: text(1, 10_000) });

const AUTHOR = `json_build_object('id', u.id, 'displayName', u.display_name, 'avatarUrl', u.avatar_url)`;

export default async function discussionRoutes(app: FastifyInstance) {
  app.get('/classes/:id/topics', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    await requireClassRole(id, userId, MEMBERS);
    const topics = await query(
      `SELECT t.id, t.title, left(t.body, 280) AS excerpt, t.pinned, t.locked,
              t.created_at AS "createdAt", t.last_activity_at AS "lastActivityAt", ${AUTHOR} AS author,
              (SELECT count(*)::int FROM posts p WHERE p.topic_id = t.id AND p.deleted_at IS NULL) AS "replyCount"
         FROM topics t JOIN users u ON u.id = t.author_id
        WHERE t.class_id = $1 AND t.deleted_at IS NULL
        ORDER BY t.pinned DESC, t.last_activity_at DESC LIMIT 200`,
      [id],
    );
    return { topics };
  });

  app.post('/classes/:id/topics', async (req, reply) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    await requireClassRole(id, userId);
    const b = parse(topicBody, req.body);
    const t = await one('INSERT INTO topics (class_id, author_id, title, body) VALUES ($1,$2,$3,$4) RETURNING id', [
      id,
      userId,
      b.title,
      b.body,
    ]);
    reply.code(201);
    return { topic: await loadTopic(t.id) };
  });

  /** Topic with all replies as a flat list; clients nest by parentId. */
  app.get('/topics/:id', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const t = await topicMeta(id);
    await requireClassRole(t.class_id, userId, MEMBERS);
    return { topic: await loadTopic(id) };
  });

  app.patch('/topics/:id', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const t = await topicMeta(id);
    const role = await requireClassRole(t.class_id, userId);
    const b = parse(topicPatch, req.body);

    const moderating = b.pinned !== undefined || b.locked !== undefined;
    const editing = b.title !== undefined || b.body !== undefined;
    if (moderating && !isStaff(role)) throw forbidden('Only class staff can pin or lock topics');
    if (editing && t.author_id !== userId && !isStaff(role)) throw forbidden();

    await query(
      `UPDATE topics SET title = COALESCE($2, title), body = COALESCE($3, body),
              pinned = COALESCE($4, pinned), locked = COALESCE($5, locked)
        WHERE id = $1`,
      [id, b.title ?? null, b.body ?? null, b.pinned ?? null, b.locked ?? null],
    );
    if (moderating) await audit(userId, 'topic.moderate', 'topic', id, { pinned: b.pinned, locked: b.locked });
    return { topic: await loadTopic(id) };
  });

  app.delete('/topics/:id', async (req, reply) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const t = await topicMeta(id);
    const role = await requireClassRole(t.class_id, userId);
    if (t.author_id !== userId && !isStaff(role)) throw forbidden();
    await query('UPDATE topics SET deleted_at = now() WHERE id = $1', [id]);
    await audit(userId, 'topic.delete', 'topic', id);
    reply.code(204);
  });

  app.post('/topics/:id/posts', async (req, reply) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const t = await topicMeta(id);
    const role = await requireClassRole(t.class_id, userId);
    if (t.locked && !isStaff(role)) throw forbidden('This topic is locked');
    const b = parse(postBody, req.body);

    const postId = await tx(async (db) => {
      if (b.parentId) {
        const parent = await one('SELECT 1 FROM posts WHERE id = $1 AND topic_id = $2', [b.parentId, id], db);
        if (!parent) throw badRequest('Reply target is not in this topic');
      }
      const created = await one('INSERT INTO posts (topic_id, parent_id, author_id, body) VALUES ($1,$2,$3,$4) RETURNING id', [
        id,
        b.parentId ?? null,
        userId,
        b.body,
      ], db);
      await db.query('UPDATE topics SET last_activity_at = now() WHERE id = $1', [id]);
      return created.id as string;
    });
    reply.code(201);
    // postId lets the app attach files to the new reply.
    return { topic: await loadTopic(id), postId };
  });

  app.patch('/posts/:id', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const p = await postMeta(id);
    await requireClassRole(p.class_id, userId);
    if (p.author_id !== userId) throw forbidden('You can only edit your own replies');
    const { body } = parse(postPatch, req.body);
    await query('UPDATE posts SET body = $2, edited_at = now() WHERE id = $1', [id, body]);
    return { topic: await loadTopic(p.topic_id) };
  });

  /** Soft delete. The row stays so replies beneath it keep their place; the body is hidden. */
  app.delete('/posts/:id', async (req, reply) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const p = await postMeta(id);
    const role = await requireClassRole(p.class_id, userId);
    if (p.author_id !== userId && !isStaff(role)) throw forbidden();
    await query('UPDATE posts SET deleted_at = now() WHERE id = $1', [id]);
    await audit(userId, 'post.delete', 'post', id);
    reply.code(204);
  });
}

async function topicMeta(id: string) {
  const t = await one<{ class_id: string; author_id: string; locked: boolean }>(
    'SELECT class_id, author_id, locked FROM topics WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  if (!t) throw notFound('Topic');
  return t;
}

async function postMeta(id: string) {
  const p = await one<{ class_id: string; author_id: string; topic_id: string }>(
    `SELECT t.class_id, p.author_id, p.topic_id FROM posts p JOIN topics t ON t.id = p.topic_id
      WHERE p.id = $1 AND p.deleted_at IS NULL AND t.deleted_at IS NULL`,
    [id],
  );
  if (!p) throw notFound('Reply');
  return p;
}

async function loadTopic(id: string) {
  const topic = await one(
    `SELECT t.id, t.class_id AS "classId", t.title, t.body, t.pinned, t.locked,
            t.created_at AS "createdAt", t.last_activity_at AS "lastActivityAt", ${AUTHOR} AS author
       FROM topics t JOIN users u ON u.id = t.author_id WHERE t.id = $1`,
    [id],
  );
  topic.posts = await query(
    `SELECT p.id, p.parent_id AS "parentId", p.created_at AS "createdAt", p.edited_at AS "editedAt",
            p.deleted_at IS NOT NULL AS deleted,
            CASE WHEN p.deleted_at IS NULL THEN p.body ELSE '' END AS body,
            CASE WHEN p.deleted_at IS NULL THEN ${AUTHOR} END AS author
       FROM posts p JOIN users u ON u.id = p.author_id
      WHERE p.topic_id = $1 ORDER BY p.created_at`,
    [id],
  );
  topic.posts = await withAttachments('post', topic.posts);
  topic.attachments = (await withAttachments('topic', [{ id: topic.id }]))[0]!.attachments;
  return topic;
}
