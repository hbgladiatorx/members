/** Site administration: find people and grant or revoke the administrator role. Admins only. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../lib/access.js';
import { requireUser } from '../lib/auth.js';
import { audit, one, query, tx } from '../lib/db.js';
import { conflict, notFound } from '../lib/errors.js';
import { idParam, parse } from '../lib/validate.js';

const searchQuery = z.object({ q: z.string().trim().max(200).optional() });
const adminBody = z.object({ admin: z.boolean() });

const ADMIN_FLAG = `EXISTS (SELECT 1 FROM site_roles s WHERE s.user_id = u.id AND s.role = 'admin' AND s.valid_to IS NULL)`;

export default async function adminRoutes(app: FastifyInstance) {
  /** Everyone with an account (administrators first), optionally filtered by name or email. */
  app.get('/admin/users', async (req) => {
    const userId = await requireUser(req);
    await requireAdmin(userId);
    const { q } = parse(searchQuery, req.query);
    const users = await query(
      `SELECT u.id, u.display_name AS "displayName", u.email, u.avatar_url AS "avatarUrl",
              u.created_at AS "createdAt", ${ADMIN_FLAG} AS "isAdmin"
         FROM users u
        WHERE u.deleted_at IS NULL
          AND ($1::text IS NULL OR u.display_name ILIKE '%' || $1 || '%' OR u.email::text ILIKE '%' || $1 || '%')
        ORDER BY ${ADMIN_FLAG} DESC, u.display_name
        LIMIT 100`,
      [q ? q.replace(/[\\%_]/g, (c) => '\\' + c) : null],
    );
    return { users };
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
