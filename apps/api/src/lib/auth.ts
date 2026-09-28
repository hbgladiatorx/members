import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { one, pool, type Queryable } from './db.js';
import { unauthorized } from './errors.js';

export interface AuthUser {
  id: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

export const hashPassword = (pw: string) => hash(pw); // argon2id defaults
export const verifyPassword = (stored: string, pw: string) => verify(stored, pw).catch(() => false);

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function signAccessToken(app: FastifyInstance, userId: string) {
  return app.jwt.sign({ sub: userId }, { expiresIn: config.ACCESS_TOKEN_TTL });
}

/** Issue a new refresh token in a (new or existing) session family. */
export async function issueRefreshToken(
  userId: string,
  familyId: string = randomUUID(),
  userAgent: string | null = null,
  client: Queryable = pool,
) {
  const token = randomBytes(32).toString('base64url');
  await client.query(
    `INSERT INTO sessions (user_id, family_id, token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval)`,
    [userId, familyId, sha256(token), userAgent, String(config.REFRESH_TOKEN_DAYS)],
  );
  return token;
}

/**
 * Rotate a refresh token. If a token that was already rotated is presented again,
 * assume it was stolen and revoke the whole family (forces re-login everywhere
 * that session spread to).
 */
export async function rotateRefreshToken(token: string, userAgent: string | null) {
  const row = await one<{ id: string; user_id: string; family_id: string; revoked_at: string | null; expired: boolean }>(
    `SELECT id, user_id, family_id, revoked_at, expires_at < now() AS expired
       FROM sessions WHERE token_hash = $1`,
    [sha256(token)],
  );
  if (!row) throw unauthorized('Invalid refresh token');

  if (row.revoked_at) {
    await pool.query('UPDATE sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [
      row.family_id,
    ]);
    throw unauthorized('Session revoked, please sign in again');
  }
  if (row.expired) throw unauthorized('Session expired, please sign in again');

  await pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [row.id]);
  const next = await issueRefreshToken(row.user_id, row.family_id, userAgent);
  return { userId: row.user_id, refreshToken: next };
}

export async function revokeRefreshToken(token: string) {
  await pool.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
    sha256(token),
  ]);
}

/** Route guard: verifies the bearer token and returns the caller's user id. */
export async function requireUser(req: FastifyRequest): Promise<string> {
  try {
    await req.jwtVerify();
  } catch {
    throw unauthorized();
  }
  return req.user.sub;
}
