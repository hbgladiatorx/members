/**
 * Every permission decision in the app lives here. Routes call these helpers;
 * they never re-implement role logic inline.
 *
 * Roles:
 * - Administrator (site-wide): acts as an instructor in every class.
 * - Instructor ("Teacher"), assistant ("Teacher Assistant"), student: per class.
 * - Observer (per class): reads everything a student can, but takes no part.
 */
import { one, type Queryable, pool } from './db.js';
import { forbidden, notFound } from './errors.js';

export type ClassRole = 'instructor' | 'assistant' | 'student' | 'observer';
export const STAFF: ClassRole[] = ['instructor', 'assistant'];
/** Everyone who takes part: may post, answer, vote and chat. */
export const PARTICIPANTS: ClassRole[] = ['instructor', 'assistant', 'student'];
/** Everyone who may read the class, observers included. Pass this explicitly on read-only routes. */
export const MEMBERS: ClassRole[] = [...PARTICIPANTS, 'observer'];

const ADMIN_SQL = `EXISTS (SELECT 1 FROM site_roles s WHERE s.user_id = $1 AND s.role = 'admin' AND s.valid_to IS NULL)`;

export async function isAdmin(userId: string, client: Queryable = pool): Promise<boolean> {
  const row = await one<{ admin: boolean }>(`SELECT ${ADMIN_SQL} AS admin`, [userId], client);
  return !!row?.admin;
}

export async function requireAdmin(userId: string, client: Queryable = pool) {
  if (!(await isAdmin(userId, client))) throw forbidden('Only administrators can do that');
}

/** The user's effective role in a class. Administrators are instructors everywhere. */
export async function activeRole(
  classId: string,
  userId: string,
  client: Queryable = pool,
): Promise<ClassRole | null> {
  const row = await one<{ role: ClassRole | null }>(
    `SELECT CASE WHEN ${ADMIN_SQL} THEN 'instructor' ELSE e.role END AS role
       FROM classes c
       LEFT JOIN enrollments e ON e.class_id = c.id AND e.user_id = $1 AND e.valid_to IS NULL
      WHERE c.id = $2`,
    [userId, classId],
    client,
  );
  return row?.role ?? null;
}

/**
 * Throws 404 if the user is not in the class (don't reveal that the class exists),
 * 403 if they are in it but lack one of the allowed roles.
 * The default lets participants through but not observers, so a route has to opt in
 * (with MEMBERS) to be readable by observers.
 */
export async function requireClassRole(
  classId: string,
  userId: string,
  allowed: ClassRole[] = PARTICIPANTS,
  client: Queryable = pool,
): Promise<ClassRole> {
  const role = await activeRole(classId, userId, client);
  if (!role) throw notFound('Class');
  if (!allowed.includes(role)) {
    throw role === 'observer' ? forbidden('Observers can view this class but not take part', 'observer') : forbidden();
  }
  return role;
}

export const isStaff = (role: ClassRole | null) => !!role && STAFF.includes(role);

export interface ChannelRow {
  id: string;
  kind: 'class' | 'group' | 'dm';
  class_id: string | null;
  name: string | null;
  archived_at: string | null;
}

/**
 * Can this user read the channel (and, with `write`, post in it)? Returns the channel or throws.
 * Observers can read class and group chats but not write. Administrators can open any
 * class or group chat; direct messages stay private to the two people in them.
 */
export async function requireChannelAccess(
  channelId: string,
  userId: string,
  opts: { write?: boolean } = {},
  client: Queryable = pool,
): Promise<ChannelRow> {
  const ch = await one<ChannelRow>(
    'SELECT id, kind, class_id, name, archived_at FROM channels WHERE id = $1',
    [channelId],
    client,
  );
  if (!ch) throw notFound('Channel');

  if (ch.kind !== 'class') {
    const member = await one(
      'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2 AND left_at IS NULL',
      [channelId, userId],
      client,
    );
    const adminInGroup = !member && ch.kind === 'group' && (await isAdmin(userId, client));
    if (!member && !adminInGroup) throw notFound('Channel');
  }
  if (ch.kind === 'dm') return ch;

  // Class and group chats also require still being in the class.
  const role = await activeRole(ch.class_id!, userId, client);
  if (!role) throw notFound('Channel');
  if (opts.write && role === 'observer') throw forbidden('Observers can read this chat but not post in it', 'observer');
  return ch;
}

/**
 * Two users may DM only while they share an active class in which both take part
 * (observers don't). Administrators may message anyone.
 */
export async function shareActiveClass(a: string, b: string): Promise<boolean> {
  if (await isAdmin(a)) return !!(await one('SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL', [b]));
  const row = await one(
    `SELECT 1 FROM enrollments x
       JOIN enrollments y ON y.class_id = x.class_id AND y.valid_to IS NULL AND y.role <> 'observer'
       JOIN classes c ON c.id = x.class_id AND c.archived_at IS NULL
      WHERE x.user_id = $1 AND y.user_id = $2 AND x.valid_to IS NULL AND x.role <> 'observer'
      LIMIT 1`,
    [a, b],
  );
  return !!row;
}

/**
 * May `fromId` start a new DM with `toId`, given the recipient's privacy setting?
 * Class staff and administrators can message members who turned DMs off.
 */
export async function dmAllowed(fromId: string, toId: string): Promise<boolean> {
  const row = await one(
    `SELECT u.allow_dms OR ${ADMIN_SQL} OR EXISTS (
        SELECT 1 FROM enrollments me JOIN enrollments them ON them.class_id = me.class_id AND them.user_id = $2 AND them.valid_to IS NULL
         WHERE me.user_id = $1 AND me.valid_to IS NULL AND me.role IN ('instructor','assistant')
      ) AS ok
       FROM users u WHERE u.id = $2`,
    [fromId, toId],
  );
  return !!row?.ok;
}
