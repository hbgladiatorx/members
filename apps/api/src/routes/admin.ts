/**
 * Site administration, for administrators only: find people, add people (with a temporary
 * password, optionally straight into a class), reset passwords, and grant or revoke the
 * administrator role.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../lib/access.js';
import { hashPassword, requireUser, temporaryPassword } from '../lib/auth.js';
import { audit, one, query, tx } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { idParam, parse, text, uuid } from '../lib/validate.js';
import { joinUsersToChannel } from '../realtime/hub.js';

const searchQuery = z.object({ q: z.string().trim().max(200).optional() });
const adminBody = z.object({ admin: z.boolean() });
const addUserBody = z.object({
  displayName: text(1, 80),
  email: z.string().trim().toLowerCase().email().max(254),
  classId: uuid.nullish(),
  role: z.enum(['instructor', 'assistant', 'student', 'observer']).default('student'),
  admin: z.boolean().default(false),
});

const ADMIN_FLAG = `EXISTS (SELECT 1 FROM site_roles s WHERE s.user_id = u.id AND s.role = 'admin' AND s.valid_to IS NULL)`;

export default async function adminRoutes(app: FastifyInstance) {
  /** Everyone with an account (administrators first), optionally filtered by name or email. */
  app.get('/admin/users', async (req) => {
    const userId = await requireUser(req);
    await requireAdmin(userId);
    const { q } = parse(searchQuery, req.query);
    const users = await query(
      `SELECT u.id, u.display_name AS "displayName", u.email, u.avatar_url AS "avatarUrl",
              u.created_at AS "createdAt", ${ADMIN_FLAG} AS "isAdmin",
              u.must_change_password AS "mustChangePassword"
         FROM users u
        WHERE u.deleted_at IS NULL
          AND ($1::text IS NULL OR u.display_name ILIKE '%' || $1 || '%' OR u.email::text ILIKE '%' || $1 || '%')
        ORDER BY ${ADMIN_FLAG} DESC, u.display_name
        LIMIT 100`,
      [q ? q.replace(/[\\%_]/g, (c) => '\\' + c) : null],
    );
    return { users };
  });

  /**
   * Add a person. A new account gets a temporary password (returned once, for the admin to pass on)
   * and must choose its own at first sign-in. If the email already has an account, that person is
   * added to the chosen class (and/or made an administrator) instead; nothing about the account changes.
   */
  app.post('/admin/users', async (req, reply) => {
    const actorId = await requireUser(req);
    await requireAdmin(actorId);
    const b = parse(addUserBody, req.body);

    const result = await tx(async (db) => {
      // Serialise adds of the same email so two admins can't create it twice at once.
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [b.email]);
      if (b.classId) {
        const cls = await one('SELECT archived_at FROM classes WHERE id = $1', [b.classId], db);
        if (!cls) throw notFound('Class');
        if (cls.archived_at) throw badRequest('That class is archived', 'class_archived');
      }

      let user = await one<{ id: string; displayName: string; email: string }>(
        `SELECT id, display_name AS "displayName", email FROM users WHERE email = $1 AND deleted_at IS NULL`,
        [b.email],
        db,
      );
      let password: string | null = null;
      if (user) {
        if (!b.classId && !b.admin) {
          throw conflict('An account with this email already exists. Choose a class to add them to it.', 'email_taken');
        }
      } else {
        password = temporaryPassword();
        user = await one(
          `INSERT INTO users (email, display_name, password_hash, must_change_password) VALUES ($1, $2, $3, true)
           RETURNING id, display_name AS "displayName", email`,
          [b.email, b.displayName, await hashPassword(password)],
          db,
        );
        await audit(actorId, 'admin.create_user', 'user', user!.id, {}, db);
      }

      let enrolled = false;
      if (b.classId) {
        const inserted = await one(
          `INSERT INTO enrollments (class_id, user_id, role) VALUES ($1, $2, $3)
           ON CONFLICT (class_id, user_id) WHERE valid_to IS NULL DO NOTHING RETURNING id`,
          [b.classId, user!.id, b.role],
          db,
        );
        if (!inserted && !password && !b.admin) {
          throw conflict('They are already in this class. Change their role from the class’s Members list.', 'already_member');
        }
        if (inserted) await audit(actorId, 'member.add', 'class', b.classId, { userId: user!.id, role: b.role }, db);
        enrolled = !!inserted;
      }
      if (b.admin) {
        const granted = await one(
          `INSERT INTO site_roles (user_id, role, granted_by) VALUES ($1, 'admin', $2)
           ON CONFLICT (user_id, role) WHERE valid_to IS NULL DO NOTHING RETURNING id`,
          [user!.id, actorId],
          db,
        );
        if (granted) await audit(actorId, 'admin.grant', 'user', user!.id, {}, db);
      }
      return { user: user!, password, enrolled };
    });

    if (result.enrolled && b.classId) {
      const ch = await one(`SELECT id FROM channels WHERE class_id = $1 AND kind = 'class'`, [b.classId]);
      if (ch) joinUsersToChannel([result.user.id], ch.id);
    }
    reply.code(result.password ? 201 : 200);
    return {
      user: result.user,
      created: !!result.password,
      // Shown once to the administrator; only its hash is stored.
      temporaryPassword: result.password,
      addedToClass: result.enrolled,
    };
  });

  /** Give someone a new temporary password (they choose their own at next sign-in) and sign them out everywhere. */
  app.post('/admin/users/:id/reset-password', async (req) => {
    const actorId = await requireUser(req);
    await requireAdmin(actorId);
    const { id } = parse(idParam, req.params);
    if (id === actorId) throw badRequest('Change your own password from Profile → Account', 'self');
    const password = temporaryPassword();
    await tx(async (db) => {
      const u = await one(
        `UPDATE users SET password_hash = $2, must_change_password = true, updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [id, await hashPassword(password)],
        db,
      );
      if (!u) throw notFound('User');
      await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
      await audit(actorId, 'admin.reset_password', 'user', id, {}, db);
    });
    return { temporaryPassword: password };
  });

  /** Make someone an administrator, or end their administrator role. The last admin cannot be removed. */
  app.put('/admin/users/:id/admin', async (req) => {
    const actorId = await requireUser(req);
    await requireAdmin(actorId);
    const { id } = parse(idParam, req.params);
    const { admin } = parse(adminBody, req.body);
    await tx(async (db) => {
      if (!(await one('SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL', [id], db))) throw notFound('User');
      // Serialise changes so two admins can't remove each other at the same moment.
      await db.query(`LOCK TABLE site_roles IN SHARE ROW EXCLUSIVE MODE`);
      if (admin) {
        const added = await one(
          `INSERT INTO site_roles (user_id, role, granted_by) VALUES ($1, 'admin', $2)
           ON CONFLICT (user_id, role) WHERE valid_to IS NULL DO NOTHING RETURNING id`,
          [id, actorId],
          db,
        );
        if (added) await audit(actorId, 'admin.grant', 'user', id, {}, db);
      } else {
        const others = await one(
          `SELECT count(*)::int AS n FROM site_roles WHERE role = 'admin' AND valid_to IS NULL AND user_id <> $1`,
          [id],
          db,
        );
        if (others.n === 0) throw conflict('There must always be at least one administrator', 'last_admin');
        const ended = await one(
          `UPDATE site_roles SET valid_to = now(), ended_by = $2
            WHERE user_id = $1 AND role = 'admin' AND valid_to IS NULL RETURNING id`,
          [id, actorId],
          db,
        );
        if (ended) await audit(actorId, 'admin.revoke', 'user', id, {}, db);
      }
    });
    return { ok: true };
  });
}
