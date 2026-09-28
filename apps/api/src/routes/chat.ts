import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireChannelAccess, requireClassRole, shareActiveClass, STAFF } from '../lib/access.js';
import { requireUser } from '../lib/auth.js';
import { one, query, tx } from '../lib/db.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { idParam, parse, text, uuid } from '../lib/validate.js';
import { joinUsersToChannel, emitToUser } from '../realtime/hub.js';
import {
  accessibleChannelIds,
  deleteMessage,
  editMessage,
  markRead,
  MESSAGE_COLS,
  sendMessage,
} from '../services/chat.js';

const historyQuery = z.object({
  before: z.coerce.number().int().positive().optional(), // message seq
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const sendBody = z.object({ body: z.string().min(1).max(4000), replyToId: uuid.nullish() });
const editBody = z.object({ body: z.string().min(1).max(4000) });
const readBody = z.object({ seq: z.number().int().nonnegative() });
const groupBody = z.object({ name: text(1, 80), memberIds: z.array(uuid).max(500).default([]) });
const membersBody = z.object({ add: z.array(uuid).max(500).default([]), remove: z.array(uuid).max(500).default([]) });
const dmBody = z.object({ userId: uuid });

export default async function chatRoutes(app: FastifyInstance) {
  /** All my chats with last message and unread count, most recent activity first. */
  app.get('/channels', async (req) => {
    const userId = await requireUser(req);
    const ids = await accessibleChannelIds(userId);
    if (!ids.length) return { channels: [] };
    const channels = await query(
      `SELECT c.id, c.kind, c.class_id AS "classId", cl.title AS "classTitle", c.archived_at AS "archivedAt",
              CASE WHEN c.kind = 'dm' THEN other.display_name ELSE c.name END AS name,
              CASE WHEN c.kind = 'dm' THEN other.id END AS "otherUserId",
              last.body AS "lastBody", last.created_at AS "lastAt", last.author_name AS "lastAuthor",
              (SELECT count(*)::int FROM messages m
                WHERE m.channel_id = c.id AND m.deleted_at IS NULL AND m.author_id <> $1
                  AND m.seq > COALESCE(r.last_read_seq, 0)) AS unread
         FROM channels c
         LEFT JOIN classes cl ON cl.id = c.class_id
         LEFT JOIN channel_reads r ON r.channel_id = c.id AND r.user_id = $1
         LEFT JOIN LATERAL (
           SELECT u.id, u.display_name FROM channel_members cm JOIN users u ON u.id = cm.user_id
            WHERE c.kind = 'dm' AND cm.channel_id = c.id AND cm.user_id <> $1 LIMIT 1
         ) other ON true
         LEFT JOIN LATERAL (
           SELECT CASE WHEN m.deleted_at IS NULL THEN left(m.body, 140) ELSE '' END AS body,
                  m.created_at, u.display_name AS author_name
             FROM messages m JOIN users u ON u.id = m.author_id
            WHERE m.channel_id = c.id ORDER BY m.seq DESC LIMIT 1
         ) last ON true
        WHERE c.id = ANY($2::uuid[])
        ORDER BY COALESCE(last.created_at, c.created_at) DESC`,
      [userId, ids],
    );
    return { channels };
  });

  /** Create a sub-group inside a class (e.g. "Tuesday cohort", "TA team"). Staff only. */
  app.post('/classes/:id/channels', async (req, reply) => {
    const userId = await requireUser(req);
    const { id: classId } = parse(idParam, req.params);
    await requireClassRole(classId, userId, STAFF);
    const b = parse(groupBody, req.body);
    const memberIds = [...new Set([userId, ...b.memberIds])];

    const channelId = await tx(async (db) => {
      const enrolled = await query(
        'SELECT user_id FROM enrollments WHERE class_id = $1 AND valid_to IS NULL AND user_id = ANY($2::uuid[])',
        [classId, memberIds],
        db,
      );
      if (enrolled.length !== memberIds.length) throw badRequest('Every member must be enrolled in the class');
      const ch = await one(
        `INSERT INTO channels (kind, class_id, name, created_by) VALUES ('group',$1,$2,$3) RETURNING id`,
        [classId, b.name, userId],
        db,
      );
      await db.query(
        'INSERT INTO channel_members (channel_id, user_id) SELECT $1, unnest($2::uuid[])',
        [ch.id, memberIds],
      );
      return ch.id as string;
    });

    joinUsersToChannel(memberIds, channelId);
    for (const m of memberIds) emitToUser(m, 'channel:added', { channelId });
    reply.code(201);
    return { channel: { id: channelId, kind: 'group', classId, name: b.name } };
  });

  /** Add or remove people in a group channel. Staff only. */
  app.patch('/channels/:id/members', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const ch = await requireChannelAccess(id, userId);
    if (ch.kind !== 'group') throw badRequest('Only group chats have editable membership');
    await requireClassRole(ch.class_id!, userId, STAFF);
    const b = parse(membersBody, req.body);

    await tx(async (db) => {
      if (b.add.length) {
        const enrolled = await query(
          'SELECT user_id FROM enrollments WHERE class_id = $1 AND valid_to IS NULL AND user_id = ANY($2::uuid[])',
          [ch.class_id, b.add],
          db,
        );
        if (enrolled.length !== new Set(b.add).size) throw badRequest('Every member must be enrolled in the class');
        await db.query(
          `INSERT INTO channel_members (channel_id, user_id) SELECT $1, unnest($2::uuid[])
           ON CONFLICT (channel_id, user_id) DO UPDATE SET left_at = NULL, joined_at = now()`,
          [id, b.add],
        );
      }
      if (b.remove.length) {
        await db.query(
          'UPDATE channel_members SET left_at = now() WHERE channel_id = $1 AND user_id = ANY($2::uuid[]) AND left_at IS NULL',
          [id, b.remove],
        );
      }
    });
    joinUsersToChannel(b.add, id);
    for (const m of b.add) emitToUser(m, 'channel:added', { channelId: id });
    return { ok: true };
  });

  /** Open (or reuse) a direct message with someone you share a class with. */
  app.post('/dm', async (req) => {
    const userId = await requireUser(req);
    const { userId: otherId } = parse(dmBody, req.body);
    if (otherId === userId) throw badRequest('You cannot message yourself');
    if (!(await shareActiveClass(userId, otherId))) throw forbidden('You can only message people in your classes');

    const dmKey = [userId, otherId].sort().join(':');
    const channelId = await tx(async (db) => {
      const existing = await one('SELECT id FROM channels WHERE dm_key = $1', [dmKey], db);
      if (existing) {
        // Re-open for either side that may have left.
        await db.query('UPDATE channel_members SET left_at = NULL WHERE channel_id = $1', [existing.id]);
        return existing.id as string;
      }
      const ch = await one(
        `INSERT INTO channels (kind, dm_key, created_by) VALUES ('dm',$1,$2)
         ON CONFLICT (dm_key) DO UPDATE SET dm_key = EXCLUDED.dm_key RETURNING id`,
        [dmKey, userId],
        db,
      );
      await db.query(
        `INSERT INTO channel_members (channel_id, user_id) VALUES ($1,$2), ($1,$3) ON CONFLICT DO NOTHING`,
        [ch.id, userId, otherId],
      );
      return ch.id as string;
    });
    joinUsersToChannel([userId, otherId], channelId);
    return { channelId };
  });

  /** Message history, newest first. Page backwards with ?before=<seq>. */
  app.get('/channels/:id/messages', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    await requireChannelAccess(id, userId);
    const q = parse(historyQuery, req.query);
    const messages = await query(
      `SELECT ${MESSAGE_COLS} FROM messages m JOIN users u ON u.id = m.author_id
        WHERE m.channel_id = $1 AND ($2::bigint IS NULL OR m.seq < $2)
        ORDER BY m.seq DESC LIMIT $3`,
      [id, q.before ?? null, q.limit],
    );
    return { messages, hasMore: messages.length === q.limit };
  });

  app.post('/channels/:id/messages', async (req, reply) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const b = parse(sendBody, req.body);
    reply.code(201);
    return { message: await sendMessage(userId, id, b.body, b.replyToId) };
  });

  app.patch('/messages/:id', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const { body } = parse(editBody, req.body);
    return { message: await editMessage(userId, id, body) };
  });

  app.delete('/messages/:id', async (req, reply) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    await deleteMessage(userId, id);
    reply.code(204);
  });

  app.post('/channels/:id/read', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    await requireChannelAccess(id, userId);
    const { seq } = parse(readBody, req.body);
    await markRead(userId, id, seq);
    return { ok: true };
  });
}
