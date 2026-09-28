/**
 * Every permission decision in the app lives here. Routes call these helpers;
 * they never re-implement role logic inline.
 */
import { one, type Queryable, pool } from './db.js';
import { forbidden, notFound } from './errors.js';

export type ClassRole = 'instructor' | 'assistant' | 'student';
export const STAFF: ClassRole[] = ['instructor', 'assistant'];

export async function activeRole(
  classId: string,
  userId: string,
  client: Queryable = pool,
): Promise<ClassRole | null> {
  const row = await one<{ role: ClassRole }>(
    `SELECT e.role FROM enrollments e
       JOIN classes c ON c.id = e.class_id
      WHERE e.class_id = $1 AND e.user_id = $2 AND e.valid_to IS NULL`,
    [classId, userId],
    client,
  );
  return row?.role ?? null;
}

/**
 * Throws 404 if the user is not in the class (don't reveal that the class exists),
 * 403 if they are in it but lack one of the allowed roles.
 */
export async function requireClassRole(
  classId: string,
  userId: string,
  allowed: ClassRole[] = ['instructor', 'assistant', 'student'],
  client: Queryable = pool,
): Promise<ClassRole> {
  const role = await activeRole(classId, userId, client);
  if (!role) throw notFound('Class');
  if (!allowed.includes(role)) throw forbidden();
  return role;
}

export const isStaff = (role: ClassRole) => STAFF.includes(role);

export interface ChannelRow {
  id: string;
  kind: 'class' | 'group' | 'dm';
  class_id: string | null;
  name: string | null;
  archived_at: string | null;
}

/** Can this user read and post in the channel? Returns the channel or throws 404. */
export async function requireChannelAccess(
  channelId: string,
  userId: string,
  client: Queryable = pool,
): Promise<ChannelRow> {
  const ch = await one<ChannelRow>(
    'SELECT id, kind, class_id, name, archived_at FROM channels WHERE id = $1',
    [channelId],
    client,
  );
  if (!ch) throw notFound('Channel');

  if (ch.kind === 'class') {
    if (!(await activeRole(ch.class_id!, userId, client))) throw notFound('Channel');
    return ch;
  }

  const member = await one(
    'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2 AND left_at IS NULL',
    [channelId, userId],
    client,
  );
  if (!member) throw notFound('Channel');

  // Group channels also require still being in the class.
  if (ch.kind === 'group' && !(await activeRole(ch.class_id!, userId, client))) {
    throw notFound('Channel');
  }
  return ch;
}

/** Two users may DM only while they share at least one active class. */
export async function shareActiveClass(a: string, b: string): Promise<boolean> {
  const row = await one(
    `SELECT 1 FROM enrollments x
       JOIN enrollments y ON y.class_id = x.class_id AND y.valid_to IS NULL
       JOIN classes c ON c.id = x.class_id AND c.archived_at IS NULL
      WHERE x.user_id = $1 AND y.user_id = $2 AND x.valid_to IS NULL
      LIMIT 1`,
    [a, b],
  );
  return !!row;
}
