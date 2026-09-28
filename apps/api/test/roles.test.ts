import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/lib/db.js';
import { client, register, setup, teardown } from './helpers.js';

let app: FastifyInstance;
type U = Awaited<ReturnType<typeof register>>;
let admin: U, teacher: U, student: U, observer: U, outsider: U;
let classId: string, channelId: string, questionId: string, answerId: string, topicId: string, postId: string, messageId: string;

beforeAll(async () => {
  app = await setup();
  admin = await register(app, 'Admin');
  teacher = await register(app, 'Teacher');
  student = await register(app, 'Student');
  observer = await register(app, 'Observer');
  outsider = await register(app, 'Outsider');
  // The first administrator is granted on the server (npm run admin -- grant <email>).
  await pool.query(`INSERT INTO site_roles (user_id, role) VALUES ($1, 'admin')`, [admin.id]);

  const cls = (await teacher.api.post('/classes', { title: 'Tajweed' })).body.class;
  classId = cls.id;
  channelId = cls.channelId;
  await student.api.post('/classes/join', { code: cls.joinCode });
  await observer.api.post('/classes/join', { code: cls.joinCode });
  expect((await teacher.api.patch(`/classes/${classId}/members/${observer.id}`, { role: 'observer' })).status).toBe(200);

  await teacher.api.post(`/classes/${classId}/announcements`, { title: 'Welcome' });
  await teacher.api.post(`/classes/${classId}/syllabus`, { title: 'Week 1', published: true });
  await teacher.api.post(`/classes/${classId}/syllabus`, { title: 'Draft week', published: false });
  const q = (await student.api.post(`/classes/${classId}/questions`, { title: 'What is idgham?' })).body.question;
  questionId = q.id;
  answerId = (await teacher.api.post(`/questions/${questionId}/answers`, { body: 'Merging.' })).body.question.answers[0].id;
  const t = (await student.api.post(`/classes/${classId}/topics`, { title: 'Practice partners' })).body.topic;
  topicId = t.id;
  postId = (await student.api.post(`/topics/${topicId}/posts`, { body: 'Anyone free Tuesday?' })).body.topic.posts[0].id;
  messageId = (await student.api.post(`/channels/${channelId}/messages`, { body: 'Salaam all' })).body.message.id;
});
afterAll(() => teardown(app));

describe('observer', () => {
  it('shows as an observer and does not see the join code', async () => {
    const res = await observer.api.get(`/classes/${classId}`);
    expect(res.status).toBe(200);
    expect(res.body.class.role).toBe('observer');
    expect(res.body.class.joinCode).toBeUndefined();
    const list = await observer.api.get('/classes');
    expect(list.body.classes.map((c: any) => c.role)).toEqual(['observer']);
  });

  it('can read everything a student can', async () => {
    const reads = [
      `/classes/${classId}/members`,
      `/classes/${classId}/announcements`,
      `/classes/${classId}/questions`,
      `/questions/${questionId}`,
      `/classes/${classId}/topics`,
      `/topics/${topicId}`,
      `/channels/${channelId}/messages`,
    ];
    for (const url of reads) expect((await observer.api.get(url)).status, url).toBe(200);
    expect((await observer.api.get(`/channels/${channelId}/messages`)).body.canPost).toBe(false);
    expect((await student.api.get(`/channels/${channelId}/messages`)).body.canPost).toBe(true);
    const syl = await observer.api.get(`/classes/${classId}/syllabus`);
    expect(syl.body.items.map((i: any) => i.title)).toEqual(['Week 1']); // no drafts, like a student
    const chats = await observer.api.get('/channels');
    expect(chats.body.channels.map((c: any) => c.id)).toContain(channelId);
    expect((await observer.api.post(`/channels/${channelId}/read`, { seq: 1 })).status).toBe(200);
  });

  it('cannot take part anywhere', async () => {
    const writes: [string, string, unknown?][] = [
      ['post', `/classes/${classId}/questions`, { title: 'Can I ask?' }],
      ['post', `/questions/${questionId}/answers`, { body: 'An answer' }],
      ['put', `/questions/${questionId}/vote`, { value: 1 }],
      ['put', `/answers/${answerId}/vote`, { value: 1 }],
      ['post', `/questions/${questionId}/accept`, { answerId }],
      ['post', `/classes/${classId}/topics`, { title: 'My topic' }],
      ['post', `/topics/${topicId}/posts`, { body: 'Me too' }],
      ['patch', `/topics/${topicId}`, { pinned: true }],
      ['post', `/channels/${channelId}/messages`, { body: 'Hello' }],
      ['post', `/classes/${classId}/announcements`, { title: 'Nope' }],
      ['post', `/classes/${classId}/syllabus`, { title: 'Nope' }],
      ['post', `/classes/${classId}/channels`, { name: 'Group' }],
      ['del', `/messages/${messageId}`],
      ['del', `/posts/${postId}`],
      ['del', `/questions/${questionId}`],
    ];
    for (const [method, url, body] of writes) {
      const res = await (observer.api as any)[method](url, body);
      expect(res.status, `${method} ${url}`).toBe(403);
    }
    const res = await observer.api.post(`/classes/${classId}/questions`, { title: 'Can I ask?' });
    expect(res.body.error.code).toBe('observer');
  });

  it('cannot send or receive new direct messages through the class', async () => {
    expect((await observer.api.post('/dm', { userId: student.id })).status).toBe(403);
    expect((await student.api.post('/dm', { userId: observer.id })).status).toBe(403);
    const profile = await student.api.get(`/users/${observer.id}/profile`);
    expect(profile.status).toBe(200); // classmates can still see who is observing
    expect(profile.body.profile.canMessage).toBe(false);
  });

  it('takes part again once switched back to student, and stops when made observer again', async () => {
    await teacher.api.patch(`/classes/${classId}/members/${observer.id}`, { role: 'student' });
    expect((await observer.api.post(`/channels/${channelId}/messages`, { body: 'Back again' })).status).toBe(201);
    await teacher.api.patch(`/classes/${classId}/members/${observer.id}`, { role: 'observer' });
    expect((await observer.api.post(`/channels/${channelId}/messages`, { body: 'Still here?' })).status).toBe(403);
  });

  it('can leave the class', async () => {
    const extra = await register(app, 'Parent');
    const code = (await teacher.api.get(`/classes/${classId}`)).body.class.joinCode;
    await extra.api.post('/classes/join', { code });
    await teacher.api.patch(`/classes/${classId}/members/${extra.id}`, { role: 'observer' });
    expect((await extra.api.del(`/classes/${classId}/members/${extra.id}`)).status).toBe(204);
    expect((await extra.api.get(`/classes/${classId}`)).status).toBe(404);
  });
});

describe('administrator', () => {
  it('is flagged on sign-in and on /me', async () => {
    const login = await client(app).post('/auth/login', { email: admin.email, password: 'correct horse battery' });
    expect(login.body.user.isAdmin).toBe(true);
    expect((await admin.api.get('/me')).body.user.isAdmin).toBe(true);
    expect((await teacher.api.get('/me')).body.user.isAdmin).toBe(false);
  });

  it('sees every class and acts as its teacher without being enrolled', async () => {
    const list = await admin.api.get('/classes');
    const c = list.body.classes.find((x: any) => x.id === classId);
    expect(c.role).toBe('instructor');
    const detail = await admin.api.get(`/classes/${classId}`);
    expect(detail.body.class.joinCode).toBeTruthy();
    expect((await admin.api.get(`/classes/${classId}/syllabus`)).body.items).toHaveLength(2); // drafts too
    expect((await admin.api.post(`/classes/${classId}/announcements`, { title: 'From the office' })).status).toBe(201);
    expect((await admin.api.patch(`/classes/${classId}/members/${student.id}`, { role: 'assistant' })).status).toBe(200);
    expect((await admin.api.patch(`/classes/${classId}/members/${student.id}`, { role: 'student' })).status).toBe(200);
    expect((await admin.api.post(`/channels/${channelId}/messages`, { body: 'Checking in' })).status).toBe(201);
    expect((await admin.api.del(`/messages/${messageId}`)).status).toBe(204); // moderation
    const group = await admin.api.post(`/classes/${classId}/channels`, { name: 'Staff room', memberIds: [teacher.id] });
    expect(group.status).toBe(201);
    expect((await admin.api.get('/channels')).body.channels.map((x: any) => x.id)).toEqual(
      expect.arrayContaining([channelId, group.body.channel.id]),
    );
  });

  it('can see any profile, with email, and message anyone', async () => {
    const p = await admin.api.get(`/users/${outsider.id}/profile`);
    expect(p.status).toBe(200);
    expect(p.body.profile.email).toBe(outsider.email);
    expect(p.body.profile.canMessage).toBe(true);
    await outsider.api.patch('/me', { allowDms: false });
    expect((await admin.api.post('/dm', { userId: outsider.id })).status).toBe(200);
  });

  it('cannot read other people’s direct messages', async () => {
    const dm = (await teacher.api.post('/dm', { userId: student.id })).body.channelId;
    await teacher.api.post(`/channels/${dm}/messages`, { body: 'Private note' });
    expect((await admin.api.get(`/channels/${dm}/messages`)).status).toBe(404);
  });

  it('manages other administrators; the last one cannot be removed', async () => {
    expect((await teacher.api.get('/admin/users')).status).toBe(403);
    expect((await teacher.api.put(`/admin/users/${student.id}/admin`, { admin: true })).status).toBe(403);

    const users = await admin.api.get('/admin/users?q=teach');
    expect(users.body.users.map((u: any) => u.id)).toContain(teacher.id);

    expect((await admin.api.put(`/admin/users/${admin.id}/admin`, { admin: false })).status).toBe(409);
    expect((await admin.api.put(`/admin/users/${teacher.id}/admin`, { admin: true })).status).toBe(200);
    expect((await teacher.api.get('/admin/users')).status).toBe(200);
    expect((await teacher.api.put(`/admin/users/${admin.id}/admin`, { admin: false })).status).toBe(200);
    expect((await admin.api.get('/admin/users')).status).toBe(403);
    // Role history is kept, not deleted.
    const rows = await pool.query(`SELECT count(*)::int AS n FROM site_roles WHERE user_id = $1`, [admin.id]);
    expect(rows.rows[0].n).toBe(1);
  });
});

describe('outsiders are unaffected', () => {
  it('still cannot see the class', async () => {
    expect((await outsider.api.get(`/classes/${classId}`)).status).toBe(404);
    expect((await outsider.api.get(`/classes/${classId}/questions`)).status).toBe(404);
  });
});
