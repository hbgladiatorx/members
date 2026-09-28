import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  hashPassword,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  verifyPassword,
} from '../lib/auth.js';
import { one } from '../lib/db.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { parse, text } from '../lib/validate.js';

const registerBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, 'must be at least 10 characters').max(200),
  displayName: text(1, 80),
});
const loginBody = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });
const refreshBody = z.object({ refreshToken: z.string().min(20).max(200) });

// Used to equalise timing when the email does not exist (prevents account enumeration by timing).
const DUMMY_HASH = hashPassword('not-a-real-password-used-for-timing');

export default async function authRoutes(app: FastifyInstance) {
  // Tighter rate limit for credential endpoints.
  const limited = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/auth/register', limited, async (req, reply) => {
    const body = parse(registerBody, req.body);
    const exists = await one('SELECT 1 FROM users WHERE email = $1', [body.email]);
    if (exists) throw conflict('An account with this email already exists', 'email_taken');

    const user = await one<{ id: string; email: string; display_name: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3)
       RETURNING id, email, display_name`,
      [body.email, body.displayName, await hashPassword(body.password)],
    );
    const refreshToken = await issueRefreshToken(user!.id, undefined, req.headers['user-agent'] ?? null);
    reply.code(201);
    return { user: toUser(user!), accessToken: signAccessToken(app, user!.id), refreshToken };
  });

  app.post('/auth/login', limited, async (req) => {
    const body = parse(loginBody, req.body);
    const user = await one<{ id: string; email: string; display_name: string; avatar_url: string | null; password_hash: string; is_admin: boolean; must_change_password: boolean }>(
      `SELECT id, email, display_name, avatar_url, password_hash, must_change_password,
              EXISTS (SELECT 1 FROM site_roles s WHERE s.user_id = users.id AND s.role = 'admin' AND s.valid_to IS NULL) AS is_admin
         FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [body.email],
    );
    const ok = user
      ? await verifyPassword(user.password_hash, body.password)
      : (await verifyPassword(await DUMMY_HASH, body.password), false);
    if (!user || !ok) throw unauthorized('Email or password is incorrect');

    const refreshToken = await issueRefreshToken(user.id, undefined, req.headers['user-agent'] ?? null);
    return { user: toUser(user), accessToken: signAccessToken(app, user.id), refreshToken };
  });

  app.post('/auth/refresh', limited, async (req) => {
    const { refreshToken } = parse(refreshBody, req.body);
    const rotated = await rotateRefreshToken(refreshToken, req.headers['user-agent'] ?? null);
    return { accessToken: signAccessToken(app, rotated.userId), refreshToken: rotated.refreshToken };
  });

  app.post('/auth/logout', async (req, reply) => {
    const { refreshToken } = parse(refreshBody, req.body);
    await revokeRefreshToken(refreshToken);
    reply.code(204);
  });
  // GET /me and profile editing live in routes/profiles.ts
}

function toUser(u: { id: string; email: string; display_name: string; avatar_url?: string | null; is_admin?: boolean; must_change_password?: boolean }) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    avatarUrl: u.avatar_url ?? null,
    isAdmin: !!u.is_admin,
    mustChangePassword: !!u.must_change_password,
  };
}
