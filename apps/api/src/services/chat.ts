/**
 * Chat logic shared by the REST routes and the Socket.IO handlers,
 * so both paths enforce the same rules.
 */
import { activeRole, isAdmin, isStaff, requireChannelAccess } from '../lib/access.js';
import { one, query } from '../lib/db.js';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
import { emitToChannel } from '../realtime/hub.js';

export const MESSAGE_COLS = `m.id, m.seq, m.channel_id AS "channelId", m.reply_to_id AS "replyToId",
  m.created_at AS "createdAt", m.edited_at AS "editedAt", m.deleted_at IS NOT NULL AS deleted,
  CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body,
  json_build_object('id', u.id, 'displayName', u.display_name, 'avatarUrl', u.avatar_url) AS author`;

// Simple per-user flood control: at most 20 messages per 10 seconds, per API process.
const WINDOW_MS = 10_000;
const MAX_IN_WINDOW = 20;
const recent = new Map<string, number[]>();

function checkFlood(userId: string) {
  const now = Date.now();
  const stamps = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (stamps.length >= MAX_IN_WINDOW) throw new HttpError(429, 'slow_down', 'You are sending messages too quickly');
  stamps.push(now);
  recent.set(userId, stamps);
}

export async function sendMessage(userId: string, channelId: string, body: string, replyToId?: string | null) {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 4000) throw badRequest('Message must be 1–4000 characters');
  const ch = await requireChannelAccess(channelId, userId, { write: true });
  if (ch.archived_at) throw forbidden('This chat is archived');
  checkFlood(userId);

  if (replyToId) {
    const target = await one('SELECT 1 FROM messages WHERE id = $1 AND channel_id = $2', [replyToId, channelId]);
    if (!target) throw badRequest('Reply target is not in this chat');
  }

  const inserted = await one(
    'INSERT INTO messages (channel_id, author_id, body, reply_to_id) VALUES ($1,$2,$3,$4) RETURNING id, seq',
    [channelId, userId, trimmed, replyToId ?? null],
  );
  // Sending implies you've read everything up to your own message.
  await markRead(userId, channelId, inserted.seq);
  const message = await loadMessage(inserted.id);
  emitToChannel(channelId, 'message:new', message);
  return message;
}

export async function editMessage(userId: string, messageId: string, body: string) {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 4000) throw badRequest('Message must be 1–4000 characters');
  const m = await one('SELECT channel_id, author_id FROM messages WHERE id = $1 AND deleted_at IS NULL', [messageId]);
  if (!m) throw notFound('Message');
  await requireChannelAccess(m.channel_id, userId, { write: true });
  if (m.author_id !== userId) throw forbidden('You can only edit your own messages');
  await query('UPDATE messages SET body = $2, edited_at = now() WHERE id = $1', [messageId, trimmed]);
  const message = await loadMessage(messageId);
  emitToChannel(m.channel_id, 'message:updated', message);
  return message;
}

/** Authors can delete their own messages; class staff (and admins) can delete any message in class channels. */
export async function deleteMessage(userId: string, messageId: string) {
  const m = await one(
    `SELECT m.channel_id, m.author_id, c.class_id FROM messages m JOIN channels c ON c.id = m.channel_id
      WHERE m.id = $1 AND m.deleted_at IS NULL`,
    [messageId],
  );
  if (!m) throw notFound('Message');
  await requireChannelAccess(m.channel_id, userId, { write: true });
  if (m.author_id !== userId) {
    const staff = m.class_id ? isStaff(await activeRole(m.class_id, userId)) : false;
    if (!staff) throw forbidden('You can only delete your own messages');
    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ($1,'message.moderate','message',$2,'{}')`,
      [userId, messageId],
    );
  }
  await query('UPDATE messages SET deleted_at = now() WHERE id = $1', [messageId]);
  emitToChannel(m.channel_id, 'message:deleted', { id: messageId, channelId: m.channel_id });
}

export async function markRead(userId: string, channelId: string, seq: number) {
  await query(
    `INSERT INTO channel_reads (channel_id, user_id, last_read_seq) VALUES ($1,$2,$3)
     ON CONFLICT (channel_id, user_id) DO UPDATE SET last_read_seq = GREATEST(channel_reads.last_read_seq, EXCLUDED.last_read_seq)`,
    [channelId, userId, seq],
  );
}

export async function loadMessage(id: string) {
  return one(`SELECT ${MESSAGE_COLS} FROM messages m JOIN users u ON u.id = m.author_id WHERE m.id = $1`, [id]);
}

/** Ids of every channel the user can currently access (used to join socket rooms on connect). */
export async function accessibleChannelIds(userId: string): Promise<string[]> {
  if (await isAdmin(userId)) {
    // Every class and group chat, plus the admin's own DMs.
    const rows = await query<{ id: string }>(
      `SELECT id FROM channels WHERE kind <> 'dm'
       UNION
       SELECT c.id FROM channels c
         JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1 AND cm.left_at IS NULL
        WHERE c.kind = 'dm'`,
      [userId],
    );
    return rows.map((r) => r.id);
  }
  const rows = await query<{ id: string }>(
    `SELECT c.id FROM channels c
       JOIN enrollments e ON e.class_id = c.class_id AND e.user_id = $1 AND e.valid_to IS NULL
      WHERE c.kind = 'class'
     UNION
     SELECT c.id FROM channels c
       JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1 AND cm.left_at IS NULL
      WHERE c.kind = 'dm'
         OR EXISTS (SELECT 1 FROM enrollments e WHERE e.class_id = c.class_id AND e.user_id = $1 AND e.valid_to IS NULL)`,
    [userId],
  );
  return rows.map((r) => r.id);
}
