import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, register, setup, teardown } from './helpers.js';

let app: FastifyInstance;
type U = Awaited<ReturnType<typeof register>>;
let teacher: U, ta: U, alice: U, bob: U, outsider: U;
let classId: string, joinCode: string, classChannelId: string;

beforeAll(async () => {
  app = await setup();
  teacher = await register(app, 'Teacher');
  ta = await register(app, 'Assistant');
  alice = await register(app, 'Alice');
  bob = await register(app, 'Bob');
  outsider = await register(app, 'Outsider');
});
afterAll(() => teardown(app));

describe('auth', () => {
  it('rejects duplicate email, weak password, bad login', async () => {
    const anon = client(app);
    expect((await anon.post('/auth/register', { email: teacher.email, password: 'long enough pw', displayName: 'X' })).status).toBe(409);
    expect((await anon.post('/auth/register', { email: 'x@example.org', password: 'short', displayName: 'X' })).status).toBe(400);
    expect((await anon.post('/auth/login', { email: teacher.email, password: 'wrong password' })).status).toBe(401);
    expect((await anon.post('/auth/login', { email: 'nobody@example.org', password: 'whatever pw' })).status).toBe(401);
  });

  it('logs in case-insensitively and returns me', async () => {
    const res = await client(app).post('/auth/login', { email: teacher.email.toUpperCase(), password: 'correct horse battery' });
    expect(res.status).toBe(200);
    const me = await client(app, res.body.accessToken).get('/me');
    expect(me.body.user.displayName).toBe('Teacher');
  });

  it('allows every method the clients use in CORS preflight', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/topics/00000000-0000-0000-0000-000000000000',
      headers: { origin: 'http://localhost:8081', 'access-control-request-method': 'PATCH' },
    });
    expect(res.statusCode).toBe(204);
    const allowed = String(res.headers['access-control-allow-methods']);
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) expect(allowed).toContain(m);
  });

  it('requires a token', async () => {
    expect((await client(app).get('/classes')).status).toBe(401);
    expect((await client(app, 'garbage').get('/classes')).status).toBe(401);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const u = await register(app, 'Rotator');
    const anon = client(app);
    const r1 = await anon.post('/auth/refresh', { refreshToken: u.refresh });
    expect(r1.status).toBe(200);
    // Reusing the old token = theft signal → whole family revoked, including the new one.
    expect((await anon.post('/auth/refresh', { refreshToken: u.refresh })).status).toBe(401);
    expect((await anon.post('/auth/refresh', { refreshToken: r1.body.refreshToken })).status).toBe(401);
  });
});

describe('classes & enrollment', () => {
  it('creates a class; creator is instructor and sees join code', async () => {
    const res = await teacher.api.post('/classes', { title: 'Introduction to Fiqh', description: 'Weekly class' });
    expect(res.status).toBe(201);
    expect(res.body.class.role).toBe('instructor');
    expect(res.body.class.joinCode).toMatch(/^[A-Z2-9]{7}$/);
    classId = res.body.class.id;
    joinCode = res.body.class.joinCode;
    classChannelId = res.body.class.channelId;
    expect(classChannelId).toBeTruthy();
  });

  it('students join by code (case-insensitive) and do not see the code', async () => {
    const res = await alice.api.post('/classes/join', { code: joinCode.toLowerCase() });
    expect(res.status).toBe(200);
    expect(res.body.class.role).toBe('student');
    expect(res.body.class.joinCode).toBeUndefined();
    await bob.api.post('/classes/join', { code: joinCode });
    await ta.api.post('/classes/join', { code: joinCode });
    const again = await alice.api.post('/classes/join', { code: joinCode });
    expect(again.body.alreadyMember).toBe(true);
  });

  it('hides classes from non-members (404, not 403)', async () => {
    expect((await outsider.api.get(`/classes/${classId}`)).status).toBe(404);
    expect((await outsider.api.post('/classes/join', { code: 'ZZZZZZZ' })).status).toBe(404);
  });

  it('only instructors change roles; role history is kept', async () => {
    expect((await alice.api.patch(`/classes/${classId}/members/${ta.id}`, { role: 'assistant' })).status).toBe(403);
    expect((await teacher.api.patch(`/classes/${classId}/members/${ta.id}`, { role: 'assistant' })).status).toBe(200);
    const members = await alice.api.get(`/classes/${classId}/members`);
    expect(members.body.members.map((m: any) => [m.displayName, m.role])).toEqual([
      ['Teacher', 'instructor'],
      ['Assistant', 'assistant'],
      ['Alice', 'student'],
      ['Bob', 'student'],
    ]);
  });

  it('cannot remove or demote the last instructor', async () => {
    const res = await teacher.api.patch(`/classes/${classId}/members/${teacher.id}`, { role: 'student' });
    expect(res.status).toBe(409);
    expect((await teacher.api.del(`/classes/${classId}/members/${teacher.id}`)).status).toBe(409);
  });

  it('closing enrollment and rotating the code blocks new joins', async () => {
    await teacher.api.patch(`/classes/${classId}`, { joinOpen: false });
    expect((await outsider.api.post('/classes/join', { code: joinCode })).status).toBe(403);
    await teacher.api.patch(`/classes/${classId}`, { joinOpen: true });
    const rotated = await teacher.api.post(`/classes/${classId}/join-code/rotate`);
    expect(rotated.body.joinCode).not.toBe(joinCode);
    expect((await outsider.api.post('/classes/join', { code: joinCode })).status).toBe(404);
    joinCode = rotated.body.joinCode;
  });

  it('lists my classes', async () => {
    const res = await alice.api.get('/classes');
    expect(res.body.classes).toHaveLength(1);
    expect(res.body.classes[0].memberCount).toBe(4);
  });
});

describe('syllabus & announcements', () => {
  let draftId: string;
  it('staff create items; students only see published ones', async () => {
    const a = await teacher.api.post(`/classes/${classId}/syllabus`, { title: 'Week 1: Purity', published: true, dueOn: '2026-10-05' });
    expect(a.status).toBe(201);
    expect(a.body.item.dueOn).toBe('2026-10-05');
    const b = await ta.api.post(`/classes/${classId}/syllabus`, { title: 'Week 2: Prayer (draft)' });
    draftId = b.body.item.id;
    expect((await alice.api.post(`/classes/${classId}/syllabus`, { title: 'Nope' })).status).toBe(403);

    expect((await alice.api.get(`/classes/${classId}/syllabus`)).body.items).toHaveLength(1);
    expect((await teacher.api.get(`/classes/${classId}/syllabus`)).body.items).toHaveLength(2);
  });

  it('publishing and reordering', async () => {
    await teacher.api.patch(`/syllabus/${draftId}`, { published: true });
    const items = (await alice.api.get(`/classes/${classId}/syllabus`)).body.items;
    expect(items.map((i: any) => i.title)).toEqual(['Week 1: Purity', 'Week 2: Prayer (draft)']);
    await teacher.api.put(`/classes/${classId}/syllabus/order`, { ids: [items[1].id, items[0].id] });
    const reordered = (await alice.api.get(`/classes/${classId}/syllabus`)).body.items;
    expect(reordered[0].id).toBe(items[1].id);
  });

  it('announcements: staff post, pinned first, students read-only', async () => {
    await teacher.api.post(`/classes/${classId}/announcements`, { title: 'Welcome', body: 'Salaam all' });
    await teacher.api.post(`/classes/${classId}/announcements`, { title: 'Room change', pinned: true });
    expect((await bob.api.post(`/classes/${classId}/announcements`, { title: 'Hi' })).status).toBe(403);
    const list = (await bob.api.get(`/classes/${classId}/announcements`)).body.announcements;
    expect(list.map((a: any) => a.title)).toEqual(['Room change', 'Welcome']);
    expect(list[0].author.displayName).toBe('Teacher');
  });
});

describe('Q&A', () => {
  let qid: string;
  it('ask, answer, vote, accept', async () => {
    const q = await alice.api.post(`/classes/${classId}/questions`, { title: 'Is wudu needed for touching a translation?', body: 'Details…' });
    expect(q.status).toBe(201);
    qid = q.body.question.id;

    await bob.api.post(`/questions/${qid}/answers`, { body: 'I think not' });
    const withTa = await ta.api.post(`/questions/${qid}/answers`, { body: 'The ruling differs by marja; here is the detail…' });
    const taAnswer = withTa.body.question.answers.find((a: any) => a.author.role === 'assistant');

    // Can't vote on your own content; others can.
    expect((await alice.api.put(`/questions/${qid}/vote`, { value: 1 })).status).toBe(400);
    expect((await bob.api.put(`/questions/${qid}/vote`, { value: 1 })).body.score).toBe(1);
    expect((await alice.api.put(`/answers/${taAnswer.id}/vote`, { value: 1 })).body.score).toBe(1);

    // Bob can't accept on Alice's question; Alice can.
    expect((await bob.api.post(`/questions/${qid}/accept`, { answerId: taAnswer.id })).status).toBe(403);
    const accepted = await alice.api.post(`/questions/${qid}/accept`, { answerId: taAnswer.id });
    expect(accepted.body.question.acceptedAnswerId).toBe(taAnswer.id);
    expect(accepted.body.question.answers[0].accepted).toBe(true);
    expect(accepted.body.question.answers[0].myVote).toBe(1);
  });

  it('filters: unanswered and mine', async () => {
    await bob.api.post(`/classes/${classId}/questions`, { title: 'When is the midterm?' });
    const un = (await teacher.api.get(`/classes/${classId}/questions?filter=unanswered`)).body.questions;
    expect(un.map((q: any) => q.title)).toEqual(['When is the midterm?']);
    const mine = (await alice.api.get(`/classes/${classId}/questions?filter=mine`)).body.questions;
    expect(mine).toHaveLength(1);
    expect(mine[0].resolved).toBe(true);
    const search = (await alice.api.get(`/classes/${classId}/questions?q=midterm`)).body.questions;
    expect(search).toHaveLength(1);
  });

  it('outsiders cannot read questions', async () => {
    expect((await outsider.api.get(`/questions/${qid}`)).status).toBe(404);
  });
});

describe('discussions', () => {
  let topicId: string;
  it('start a topic, reply, nested reply', async () => {
    const t = await bob.api.post(`/classes/${classId}/topics`, { title: 'Reflections on week 1', body: 'What stood out?' });
    topicId = t.body.topic.id;
    const r1 = await alice.api.post(`/topics/${topicId}/posts`, { body: 'The part on intention' });
    const parentId = r1.body.topic.posts[0].id;
    const r2 = await bob.api.post(`/topics/${topicId}/posts`, { body: 'Agreed', parentId });
    expect(r2.body.topic.posts).toHaveLength(2);
    expect(r2.body.topic.posts[1].parentId).toBe(parentId);
  });

  it('only staff pin and lock; locked topics refuse student replies', async () => {
    expect((await bob.api.patch(`/topics/${topicId}`, { pinned: true })).status).toBe(403);
    await ta.api.patch(`/topics/${topicId}`, { pinned: true, locked: true });
    expect((await alice.api.post(`/topics/${topicId}/posts`, { body: 'late' })).status).toBe(403);
    expect((await teacher.api.post(`/topics/${topicId}/posts`, { body: 'Closing this thread' })).status).toBe(201);
    const list = (await alice.api.get(`/classes/${classId}/topics`)).body.topics;
    expect(list[0]).toMatchObject({ pinned: true, locked: true, replyCount: 3 });
  });

  it('deleted replies keep their slot but hide content', async () => {
    const topic = (await alice.api.get(`/topics/${topicId}`)).body.topic;
    const alicePost = topic.posts[0];
    expect((await bob.api.del(`/posts/${alicePost.id}`)).status).toBe(403);
    expect((await teacher.api.del(`/posts/${alicePost.id}`)).status).toBe(204);
    const after = (await alice.api.get(`/topics/${topicId}`)).body.topic.posts[0];
    expect(after).toMatchObject({ deleted: true, body: '', author: null });
  });
});

describe('chat', () => {
  let groupId: string;
  it('class channel: members post and page history', async () => {
    for (let i = 1; i <= 5; i++) {
      const res = await alice.api.post(`/channels/${classChannelId}/messages`, { body: `msg ${i}` });
      expect(res.status).toBe(201);
    }
    const page1 = await bob.api.get(`/channels/${classChannelId}/messages?limit=3`);
    expect(page1.body.messages.map((m: any) => m.body)).toEqual(['msg 5', 'msg 4', 'msg 3']);
    expect(page1.body.hasMore).toBe(true);
    const before = page1.body.messages[2].seq;
    const page2 = await bob.api.get(`/channels/${classChannelId}/messages?limit=3&before=${before}`);
    expect(page2.body.messages.map((m: any) => m.body)).toEqual(['msg 2', 'msg 1']);
    expect((await outsider.api.get(`/channels/${classChannelId}/messages`)).status).toBe(404);
  });

  it('unread counts and read markers', async () => {
    let chans = (await bob.api.get('/channels')).body.channels;
    const cls = chans.find((c: any) => c.id === classChannelId);
    expect(cls.unread).toBe(5);
    expect(cls.lastBody).toBe('msg 5');
    const latest = (await bob.api.get(`/channels/${classChannelId}/messages?limit=1`)).body.messages[0];
    await bob.api.post(`/channels/${classChannelId}/read`, { seq: latest.seq });
    chans = (await bob.api.get('/channels')).body.channels;
    expect(chans.find((c: any) => c.id === classChannelId).unread).toBe(0);
  });

  it('group channels: staff create, only members see them', async () => {
    expect((await alice.api.post(`/classes/${classId}/channels`, { name: 'Study group' })).status).toBe(403);
    expect((await teacher.api.post(`/classes/${classId}/channels`, { name: 'Bad', memberIds: [outsider.id] })).status).toBe(400);
    const g = await teacher.api.post(`/classes/${classId}/channels`, { name: 'Tuesday cohort', memberIds: [alice.id] });
    groupId = g.body.channel.id;
    expect((await alice.api.post(`/channels/${groupId}/messages`, { body: 'hi cohort' })).status).toBe(201);
    expect((await bob.api.get(`/channels/${groupId}/messages`)).status).toBe(404);
    await teacher.api.patch(`/channels/${groupId}/members`, { add: [bob.id] });
    expect((await bob.api.get(`/channels/${groupId}/messages`)).status).toBe(200);
  });

  it('DMs only between people who share a class; reused on second open', async () => {
    expect((await alice.api.post('/dm', { userId: outsider.id })).status).toBe(403);
    const dm1 = await alice.api.post('/dm', { userId: bob.id });
    const dm2 = await bob.api.post('/dm', { userId: alice.id });
    expect(dm1.body.channelId).toBe(dm2.body.channelId);
    await alice.api.post(`/channels/${dm1.body.channelId}/messages`, { body: 'salaam Bob' });
    expect((await teacher.api.get(`/channels/${dm1.body.channelId}/messages`)).status).toBe(404);
    const bobChans = (await bob.api.get('/channels')).body.channels;
    const dm = bobChans.find((c: any) => c.kind === 'dm');
    expect(dm).toMatchObject({ name: 'Alice', unread: 1, lastBody: 'salaam Bob' });
  });

  it('edit own, moderate others, cannot edit others', async () => {
    const sent = await bob.api.post(`/channels/${classChannelId}/messages`, { body: 'tpyo' });
    const id = sent.body.message.id;
    expect((await alice.api.patch(`/messages/${id}`, { body: 'hijack' })).status).toBe(403);
    expect((await bob.api.patch(`/messages/${id}`, { body: 'typo' })).body.message).toMatchObject({ body: 'typo' });
    expect((await alice.api.del(`/messages/${id}`)).status).toBe(403);
    expect((await ta.api.del(`/messages/${id}`)).status).toBe(204);
    const latest = (await alice.api.get(`/channels/${classChannelId}/messages?limit=1`)).body.messages[0];
    expect(latest).toMatchObject({ deleted: true, body: '' });
  });

  it('removed students lose access to class and group chats immediately', async () => {
    expect((await teacher.api.del(`/classes/${classId}/members/${bob.id}`)).status).toBe(204);
    expect((await bob.api.get(`/channels/${classChannelId}/messages`)).status).toBe(404);
    expect((await bob.api.get(`/channels/${groupId}/messages`)).status).toBe(404);
    expect((await bob.api.get(`/classes/${classId}`)).status).toBe(404);
    // They can rejoin with the code as a fresh student enrollment.
    expect((await bob.api.post('/classes/join', { code: joinCode })).status).toBe(200);
    expect((await bob.api.get(`/channels/${classChannelId}/messages`)).status).toBe(200);
    // Group membership is not silently restored.
    expect((await bob.api.get(`/channels/${groupId}/messages`)).status).toBe(404);
  });

  it('validates input', async () => {
    expect((await alice.api.post(`/channels/${classChannelId}/messages`, { body: '   ' })).status).toBe(400);
    expect((await alice.api.post(`/channels/not-a-uuid/messages`, { body: 'x' })).status).toBe(400);
    expect((await alice.api.post(`/channels/${classChannelId}/messages`, { body: 'x'.repeat(4001) })).status).toBe(400);
  });
});
