import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { pool } from '../src/lib/db.js';
import { migrate } from '../src/migrate.js';

export async function setup() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(() => {});
  const app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  return app;
}

export async function teardown(app: FastifyInstance) {
  await app.close();
  await pool.end();
}

export function port(app: FastifyInstance) {
  const addr = app.server.address();
  return typeof addr === 'object' && addr ? addr.port : 0;
}

/** Small typed HTTP client bound to a user token. */
export function client(app: FastifyInstance, token?: string) {
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await app.inject({
      method: method as any,
      url,
      payload: body as any,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const json = res.body ? JSON.parse(res.body) : undefined;
    return { status: res.statusCode, body: json };
  };
  return {
    get: (u: string) => call('GET', u),
    post: (u: string, b?: unknown) => call('POST', u, b ?? {}),
    put: (u: string, b?: unknown) => call('PUT', u, b ?? {}),
    patch: (u: string, b?: unknown) => call('PATCH', u, b ?? {}),
    del: (u: string) => call('DELETE', u),
  };
}

let n = 0;
export async function register(app: FastifyInstance, name: string) {
  n += 1;
  const res = await client(app).post('/auth/register', {
    email: `${name.toLowerCase()}${n}@example.org`,
    password: 'correct horse battery',
    displayName: name,
  });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  return {
    id: res.body.user.id as string,
    email: res.body.user.email as string,
    token: res.body.accessToken as string,
    refresh: res.body.refreshToken as string,
    api: client(app, res.body.accessToken),
  };
}
