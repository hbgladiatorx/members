import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/lib/db.js';
import { client, register, setup, teardown } from './helpers.js';

let app: FastifyInstance;
type U = Awaited<ReturnType<typeof register>>;
let admin: U, teacher: U;
let classId: string;

const login = (email: string, password: string) => client(app).post('/auth/login', { email, password });

beforeAll(async () => {
  app = await setup();
  admin = await register(app, 'Admin');
  teacher = await register(app, 'Teacher');
  await pool.query(`INSERT INTO site_roles (user_id, role) VALUES ($1, 'admin')`, [admin.id]);
  classId = (await teacher.api.post('/classes', { title: 'Seerah' })).body.class.id;
});
afterAll(() => teardown(app));

describe('adding people (administrators)', () => {
  it('only administrators can add people or reset passwords', async () => {
    expect((await teacher.api.post('/admin/users', { displayName: 'X', email: 'x@example.org' })).status).toBe(403);
    expect((await teacher.api.post(`/admin/users/${admin.id}/reset-password`)).status).toBe(403);
  });

  it('creates an account with a temporary password, straight into a class with a role', async () => {
    const res = await admin.api.post('/admin/users', {
      displayName: 'Khadija Noor',
      email: '  Khadija@Example.org ',
      classId,
      role: 'assistant',
    });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.addedToClass).toBe(true);
    expect(res.body.user.email).toBe('khadija@example.org');
    const temp = res.body.temporaryPassword as string;
    expect(temp).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);

    // Only a hash is stored.
    const row = await pool.query('SELECT password_hash FROM users WHERE email = $1', ['khadija@example.org']);
    expect(row.rows[0].password_hash).not.toContain(temp);

    // Signs in with it, is told to change it, and is already an assistant in the class.
    const signedIn = await login('khadija@example.org', temp);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user.mustChangePassword).toBe(true);
    const k = client(app, signedIn.body.accessToken);
    expect((await k.get(`/classes/${classId}`)).body.class.role).toBe('assistant');
    expect((await k.get('/me')).body.user.mustChangePassword).toBe(true);

    // Choosing a new password clears the flag; the temporary one stops working.
    expect((await k.put('/me/password', { currentPassword: 'wrong one!!', newPassword: 'my own password 1' })).status).toBe(403);
    expect((await k.put('/me/password', { currentPassword: temp, newPassword: 'short' })).status).toBe(400);
    expect((await k.put('/me/password', { currentPassword: temp, newPassword: temp })).status).toBe(400);
    const changed = await k.put('/me/password', { currentPassword: temp, newPassword: 'my own password 1' });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
    expect((await login('khadija@example.org', temp)).status).toBe(401);
    expect((await login('khadija@example.org', 'my own password 1')).status).toBe(200);
  });

  it('can add someone as an administrator with no class', async () => {
    const res = await admin.api.post('/admin/users', { displayName: 'Office', email: 'office@example.org', admin: true });
    expect(res.status).toBe(201);
    const s = await login('office@example.org', res.body.temporaryPassword);
    expect(s.body.user.isAdmin).toBe(true);
  });

  it('adds an existing account to a class instead of creating a second one', async () => {
    const existing = await register(app, 'Existing');
    const res = await admin.api.post('/admin/users', { displayName: 'ignored', email: existing.email.toUpperCase(), classId, role: 'observer' });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.temporaryPassword).toBeNull();
    expect(res.body.addedToClass).toBe(true);
    expect((await existing.api.get(`/classes/${classId}`)).body.class.role).toBe('observer');
    // Their name and password are untouched.
    expect((await existing.api.get('/me')).body.user.displayName).toBe('Existing');
    expect((await login(existing.email, 'correct horse battery')).status).toBe(200);

    // Again: already in the class.
    const again = await admin.api.post('/admin/users', { displayName: 'x', email: existing.email, classId });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_member');
    // No class chosen: the email is simply taken.
    const taken = await admin.api.post('/admin/users', { displayName: 'x', email: existing.email });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('email_taken');
  });

  it('rejects a class that does not exist', async () => {
    const res = await admin.api.post('/admin/users', {
      displayName: 'Nobody',
      email: 'nobody@example.org',
      classId: '00000000-0000-0000-0000-000000000000',
    });
    expect(res.status).toBe(404);
    // Nothing was created.
    expect((await pool.query('SELECT 1 FROM users WHERE email = $1', ['nobody@example.org'])).rowCount).toBe(0);
  });

  it('two admins adding the same email at once make one account', async () => {
    const [a, b] = await Promise.all([
      admin.api.post('/admin/users', { displayName: 'Twin', email: 'twin@example.org', classId }),
      admin.api.post('/admin/users', { displayName: 'Twin', email: 'twin@example.org', classId }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await pool.query('SELECT 1 FROM users WHERE email = $1', ['twin@example.org'])).rowCount).toBe(1);
  });

  it('resets a password: new temporary one, signed out everywhere, must change it', async () => {
    const u = await register(app, 'Forgetful');
    const res = await admin.api.post(`/admin/users/${u.id}/reset-password`);
    expect(res.status).toBe(200);
    const temp = res.body.temporaryPassword;
    expect((await client(app).post('/auth/refresh', { refreshToken: u.refresh })).status).toBe(401);
    expect((await login(u.email, 'correct horse battery')).status).toBe(401);
    const s = await login(u.email, temp);
    expect(s.status).toBe(200);
    expect(s.body.user.mustChangePassword).toBe(true);
    // Not on yourself: use Profile → Change password.
    expect((await admin.api.post(`/admin/users/${admin.id}/reset-password`)).status).toBe(400);
  });

  it('shows who still has a temporary password in the admin list', async () => {
    const list = await admin.api.get('/admin/users?q=twin');
    expect(list.body.users[0].mustChangePassword).toBe(true);
  });
});
