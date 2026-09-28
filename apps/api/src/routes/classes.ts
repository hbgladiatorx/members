import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireClassRole } from '../lib/access.js';
import { requireUser } from '../lib/auth.js';
import { audit, one, query, tx } from '../lib/db.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { idParam, parse, text, uuid } from '../lib/validate.js';
import { joinUsersToChannel, removeUserFromChannel } from '../realtime/hub.js';

// No 0/O/1/I/L to keep codes readable when read aloud or typed on a phone.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newJoinCode = () => Array.from({ length: 7 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const createBody = z.object({
  title: text(1, 160),
  description: z.string().max(5000).default(''),
  startsOn: dateStr.nullish(),
  endsOn: dateStr.nullish(),
});
const updateBody = createBody.partial().extend({ joinOpen: z.boolean().optional(), archived: z.boolean().optional() });
const joinBody = z.object({ code: z.string().trim().toUpperCase().min(4).max(12) });
const memberParams = z.object({ id: uuid, userId: uuid });
const roleBody = z.object({ role: z.enum(['instructor', 'assistant', 'student']) });

const CLASS_COLS = `c.id, c.title, c.description, c.starts_on AS "startsOn", c.ends_on AS "endsOn",
  c.join_open AS "joinOpen", c.created_at AS "createdAt", c.archived_at AS "archivedAt"`;

export default async function classRoutes(app: FastifyInstance) {
  /** Create a class. The creator becomes its instructor, and the whole-class chat is created. */
  app.post('/classes', async (req, reply) => {
    const userId = await requireUser(req);
    const body = parse(createBody, req.body);

    const created = await tx(async (db) => {
      const cls = await one(
        `INSERT INTO classes (title, description, starts_on, ends_on, join_code, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [body.title, body.description, body.startsOn ?? null, body.endsOn ?? null, newJoinCode(), userId],
        db,
      );
      await db.query(`INSERT INTO enrollments (class_id, user_id, role) VALUES ($1,$2,'instructor')`, [cls.id, userId]);
      const ch = await one(
        `INSERT INTO channels (kind, class_id, name, created_by) VALUES ('class',$1,$2,$3) RETURNING id`,
        [cls.id, body.title, userId],
        db,
      );
      await audit(userId, 'class.create', 'class', cls.id, {}, db);
      return { classId: cls.id as string, channelId: ch.id as string };
    });

    joinUsersToChannel([userId], created.channelId);
    reply.code(201);
    return { class: await loadClass(created.classId, userId) };
  });

  /** Classes I'm currently enrolled in, with my role. */
  app.get('/classes', async (req) => {
    const userId = await requireUser(req);
    const rows = await query(
      `SELECT ${CLASS_COLS}, e.role,
              (SELECT count(*)::int FROM enrollments m WHERE m.class_id = c.id AND m.valid_to IS NULL) AS "memberCount"
         FROM enrollments e JOIN classes c ON c.id = e.class_id
        WHERE e.user_id = $1 AND e.valid_to IS NULL
        ORDER BY c.archived_at NULLS FIRST, c.created_at DESC`,
      [userId],
    );
    return { classes: rows };
  });

  app.get('/classes/:id', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    await requireClassRole(id, userId);
    return { class: await loadClass(id, userId) };
  });

  app.patch('/classes/:id', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    await requireClassRole(id, userId, ['instructor']);
    const b = parse(updateBody, req.body);

    await one(
      `UPDATE classes SET
         title       = COALESCE($2, title),
         description = COALESCE($3, description),
         starts_on   = CASE WHEN $4::boolean THEN $5::date ELSE starts_on END,
         ends_on     = CASE WHEN $6::boolean THEN $7::date ELSE ends_on END,
         join_open   = COALESCE($8, join_open),
         archived_at = CASE WHEN $9::boolean IS NULL THEN archived_at
                            WHEN $9 THEN COALESCE(archived_at, now()) ELSE NULL END
       WHERE id = $1`,
      [
        id,
        b.title ?? null,
        b.description ?? null,
        b.startsOn !== undefined,
        b.startsOn ?? null,
        b.endsOn !== undefined,
        b.endsOn ?? null,
        b.joinOpen ?? null,
        b.archived ?? null,
      ],
    );
    if (b.title) await query(`UPDATE channels SET name = $2 WHERE class_id = $1 AND kind = 'class'`, [id, b.title]);
    await audit(userId, 'class.update', 'class', id, b);
    return { class: await loadClass(id, userId) };
  });

  app.post('/classes/:id/join-code/rotate', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    await requireClassRole(id, userId, ['instructor']);
    const row = await one('UPDATE classes SET join_code = $2 WHERE id = $1 RETURNING join_code', [id, newJoinCode()]);
    await audit(userId, 'class.rotate_code', 'class', id);
    return { joinCode: row.join_code };
  });

  /** Join a class with its code. Always joins as a student. */
  app.post('/classes/join', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const userId = await requireUser(req);
    const { code } = parse(joinBody, req.body);
    const cls = await one<{ id: string; join_open: boolean; archived_at: string | null }>(
      'SELECT id, join_open, archived_at FROM classes WHERE join_code = $1',
      [code],
    );
    if (!cls || cls.archived_at) throw notFound('Class for that code');
    if (!cls.join_open) throw forbidden('This class is not accepting new members right now');

    const inserted = await one(
      `INSERT INTO enrollments (class_id, user_id, role) VALUES ($1,$2,'student')
       ON CONFLICT (class_id, user_id) WHERE valid_to IS NULL DO NOTHING RETURNING id`,
      [cls.id, userId],
    );
    if (inserted) {
      await audit(userId, 'class.join', 'class', cls.id);
      const ch = await one(`SELECT id FROM channels WHERE class_id = $1 AND kind = 'class'`, [cls.id]);
      if (ch) joinUsersToChannel([userId], ch.id);
    }
    return { class: await loadClass(cls.id, userId), alreadyMember: !inserted };
  });

  app.get('/classes/:id/members', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    await requireClassRole(id, userId);
    const members = await query(
      `SELECT u.id, u.display_name AS "displayName", u.avatar_url AS "avatarUrl", e.role, e.valid_from AS "joinedAt"
         FROM enrollments e JOIN users u ON u.id = e.user_id
        WHERE e.class_id = $1 AND e.valid_to IS NULL
        ORDER BY array_position(ARRAY['instructor','assistant','student']::class_role[], e.role), u.display_name`,
      [id],
    );
    return { members };
  });

  /**
   * Change a member's role. Roles are time-bounded: the old enrollment is closed
   * and a new one opened, so history of who held which role is preserved.
   */
  app.patch('/classes/:id/members/:userId', async (req) => {
    const actorId = await requireUser(req);
    const { id, userId } = parse(memberParams, req.params);
    const { role } = parse(roleBody, req.body);
    await requireClassRole(id, actorId, ['instructor']);

    await tx(async (db) => {
      const current = await one(
        'SELECT id, role FROM enrollments WHERE class_id = $1 AND user_id = $2 AND valid_to IS NULL FOR UPDATE',
        [id, userId],
        db,
      );
      if (!current) throw notFound('Member');
      if (current.role === role) return;
      if (current.role === 'instructor') await assertNotLastInstructor(id, db);
      await db.query('UPDATE enrollments SET valid_to = now(), ended_by = $2 WHERE id = $1', [current.id, actorId]);
      await db.query('INSERT INTO enrollments (class_id, user_id, role) VALUES ($1,$2,$3)', [id, userId, role]);
      await audit(actorId, 'member.role', 'class', id, { userId, from: current.role, to: role }, db);
    });
    return { ok: true };
  });

  /** Remove a member (instructor), or leave the class yourself. */
  app.delete('/classes/:id/members/:userId', async (req, reply) => {
    const actorId = await requireUser(req);
    const { id, userId } = parse(memberParams, req.params);
    if (actorId !== userId) await requireClassRole(id, actorId, ['instructor']);

    await tx(async (db) => {
      const current = await one(
        'SELECT id, role FROM enrollments WHERE class_id = $1 AND user_id = $2 AND valid_to IS NULL FOR UPDATE',
        [id, userId],
        db,
      );
      if (!current) throw notFound('Member');
      if (current.role === 'instructor') await assertNotLastInstructor(id, db);
      await db.query('UPDATE enrollments SET valid_to = now(), ended_by = $2 WHERE id = $1', [current.id, actorId]);
      // Leave this class's group channels too.
      await db.query(
        `UPDATE channel_members SET left_at = now()
          WHERE user_id = $1 AND left_at IS NULL
            AND channel_id IN (SELECT id FROM channels WHERE class_id = $2)`,
        [userId, id],
      );
      await audit(actorId, actorId === userId ? 'member.leave' : 'member.remove', 'class', id, { userId }, db);
    });

    const chans = await query('SELECT id FROM channels WHERE class_id = $1', [id]);
    for (const c of chans) removeUserFromChannel(userId, c.id);
    reply.code(204);
  });
}

async function assertNotLastInstructor(classId: string, db: Parameters<typeof query>[2]) {
  const r = await one(
    `SELECT count(*)::int AS n FROM enrollments WHERE class_id = $1 AND role = 'instructor' AND valid_to IS NULL`,
    [classId],
    db,
  );
  if (r.n <= 1) throw conflict('A class must keep at least one instructor', 'last_instructor');
}

/** Class detail. The join code is only shown to staff. */
async function loadClass(classId: string, userId: string) {
  const row = await one(
    `SELECT ${CLASS_COLS}, c.join_code AS "joinCode", e.role,
            (SELECT id FROM channels ch WHERE ch.class_id = c.id AND ch.kind = 'class') AS "channelId",
            (SELECT count(*)::int FROM enrollments m WHERE m.class_id = c.id AND m.valid_to IS NULL) AS "memberCount"
       FROM classes c
       JOIN enrollments e ON e.class_id = c.id AND e.user_id = $2 AND e.valid_to IS NULL
      WHERE c.id = $1`,
    [classId, userId],
  );
  if (!row) throw notFound('Class');
  if (row.role === 'student') delete row.joinCode;
  return row;
}

