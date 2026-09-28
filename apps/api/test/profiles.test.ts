import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { register, setup, teardown } from './helpers.js';

let app: FastifyInstance;
type U = Awaited<ReturnType<typeof register>>;
let teacher: U, alice: U, bob: U, stranger: U;
let classA: string, classB: string;

/** Multipart upload helper (app.inject has no FormData support for files). */
async function upload(token: string, data: Buffer, filename = 'photo.jpg', type = 'image/jpeg') {
  const boundary = '----test' + Math.random().toString(16).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: 'POST',
    url: '/me/avatar',
    payload: body,
    headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
}

beforeAll(async () => {
  app = await setup();
  teacher = await register(app, 'Teacher');
  alice = await register(app, 'Alice');
  bob = await register(app, 'Bob');
  stranger = await register(app, 'Stranger');
  const a = (await teacher.api.post('/classes', { title: 'Fiqh 101' })).body.class;
  const b = (await teacher.api.post('/classes', { title: 'Arabic 101' })).body.class;
  classA = a.id;
  classB = b.id;
  await alice.api.post('/classes/join', { code: a.joinCode });
  await alice.api.post('/classes/join', { code: b.joinCode });
  await bob.api.post('/classes/join', { code: a.joinCode });
});
afterAll(() => teardown(app));

describe('editing your profile', () => {
  it('saves fields and returns private settings only to you', async () => {
    const res = await alice.api.patch('/me', {
      displayName: 'Alice Hussain',
      bio: 'Engineer, second year of hawza evening classes.',
      city: 'Dearborn',
      languages: ['English', 'Arabic', 'arabic'],
      helpWith: 'Arabic grammar',
    });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      displayName: 'Alice Hussain',
      city: 'Dearborn',
      languages: ['English', 'Arabic'], // de-duplicated
      showEmail: false,
      allowDms: true,
    });
    expect((await alice.api.get('/me')).body.user.helpWith).toBe('Arabic grammar');
  });

  it('rejects unknown fields and over-long values', async () => {
    expect((await alice.api.patch('/me', { email: 'x@example.org' })).status).toBe(400);
    expect((await alice.api.patch('/me', { bio: 'x'.repeat(501) })).status).toBe(400);
    expect((await alice.api.patch('/me', { displayName: '   ' })).status).toBe(400);
  });
});

describe('viewing profiles', () => {
  it('classmates see the profile but not the email by default', async () => {
    const p = (await bob.api.get(`/users/${alice.id}/profile`)).body.profile;
    expect(p).toMatchObject({ displayName: 'Alice Hussain', city: 'Dearborn', email: null, canMessage: true, isSelf: false });
  });

  it('only shows classes you share, not the member’s other classes', async () => {
    const p = (await bob.api.get(`/users/${alice.id}/profile`)).body.profile;
    expect(p.sharedClasses.map((c: any) => c.title)).toEqual(['Fiqh 101']);
    const t = (await teacher.api.get(`/users/${alice.id}/profile`)).body.profile;
    expect(t.sharedClasses.map((c: any) => c.title).sort()).toEqual(['Arabic 101', 'Fiqh 101']);
    expect(t.sharedClasses[0].viewerRole).toBe('instructor');
  });

  it('strangers get 404, as if the account did not exist', async () => {
    expect((await stranger.api.get(`/users/${alice.id}/profile`)).status).toBe(404);
    expect((await stranger.api.get(`/users/00000000-0000-0000-0000-000000000000/profile`)).status).toBe(404);
  });

  it('shows email when the member opts in; you always see your own', async () => {
    expect((await alice.api.get(`/users/${alice.id}/profile`)).body.profile).toMatchObject({ isSelf: true, email: alice.email, showEmail: false });
    expect((await bob.api.get(`/users/${alice.id}/profile`)).body.profile.showEmail).toBeUndefined();
    await alice.api.patch('/me', { showEmail: true });
    expect((await bob.api.get(`/users/${alice.id}/profile`)).body.profile.email).toBe(alice.email);
    await alice.api.patch('/me', { showEmail: false });
  });

  it('counts activity only inside shared classes', async () => {
    // Alice asks in both classes; Bob answers in class A and Alice accepts.
    const qA = (await alice.api.post(`/classes/${classA}/questions`, { title: 'Question in Fiqh' })).body.question;
    await alice.api.post(`/classes/${classB}/questions`, { title: 'Question in Arabic' });
    const withAnswer = await bob.api.post(`/questions/${qA.id}/answers`, { body: 'An answer' });
    await alice.api.post(`/questions/${qA.id}/accept`, { answerId: withAnswer.body.question.answers[0].id });
    await bob.api.post(`/classes/${classA}/topics`, { title: 'A topic' });

    const aliceAsSeenByBob = (await bob.api.get(`/users/${alice.id}/profile`)).body.profile.stats;
    expect(aliceAsSeenByBob.questionsAsked).toBe(1); // the Arabic 101 question is not visible to Bob
    const aliceAsSeenByTeacher = (await teacher.api.get(`/users/${alice.id}/profile`)).body.profile.stats;
    expect(aliceAsSeenByTeacher.questionsAsked).toBe(2);
    const bobStats = (await alice.api.get(`/users/${bob.id}/profile`)).body.profile.stats;
    expect(bobStats).toEqual({ questionsAsked: 0, answersGiven: 1, answersAccepted: 1, topicsStarted: 1 });
  });

  it('removed members disappear from each other’s view', async () => {
    const extra = await register(app, 'Leaver');
    const code = (await teacher.api.get(`/classes/${classA}`)).body.class.joinCode;
    await extra.api.post('/classes/join', { code });
    expect((await bob.api.get(`/users/${extra.id}/profile`)).status).toBe(200);
    await extra.api.del(`/classes/${classA}/members/${extra.id}`);
    expect((await bob.api.get(`/users/${extra.id}/profile`)).status).toBe(404);
  });
});

describe('direct-message setting', () => {
  it('turning DMs off blocks classmates but not class staff', async () => {
    await alice.api.patch('/me', { allowDms: false });
    expect((await bob.api.get(`/users/${alice.id}/profile`)).body.profile.canMessage).toBe(false);
    const blocked = await bob.api.post('/dm', { userId: alice.id });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('dms_off');
    expect((await teacher.api.get(`/users/${alice.id}/profile`)).body.profile.canMessage).toBe(true);
    expect((await teacher.api.post('/dm', { userId: alice.id })).status).toBe(200);
    await alice.api.patch('/me', { allowDms: true });
    expect((await bob.api.post('/dm', { userId: alice.id })).status).toBe(200);
  });
});

describe('profile photos', () => {
  it('accepts a photo, resizes to 512px WebP and strips location metadata', async () => {
    const jpeg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#0F5C4F' } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Make: 'TestCam', Copyright: 'secret' }, GPS: { GPSLatitudeRef: 'N' } } } as any)
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeTruthy(); // the input really has EXIF

    const res = await upload(alice.token, jpeg);
    expect(res.status).toBe(200);
    const url: string = res.body.user.avatarUrl;
    expect(url).toMatch(/\/uploads\/avatars\/[a-f0-9]{32}\.webp$/);

    const file = await app.inject({ method: 'GET', url: new URL(url).pathname });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/webp');
    const meta = await sharp(file.rawPayload).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 512, 512]);
    expect(meta.exif).toBeUndefined();

    // Visible to classmates, and on chat messages.
    expect((await bob.api.get(`/users/${alice.id}/profile`)).body.profile.avatarUrl).toBe(url);
    const members = (await bob.api.get(`/classes/${classA}/members`)).body.members;
    expect(members.find((m: any) => m.id === alice.id).avatarUrl).toBe(url);
  });

  it('replacing a photo deletes the old file', async () => {
    const first = (await alice.api.get('/me')).body.user.avatarUrl;
    const png = await sharp({ create: { width: 300, height: 300, channels: 4, background: '#B8893B' } }).png().toBuffer();
    const res = await upload(alice.token, png, 'x.png', 'image/png');
    expect(res.body.user.avatarUrl).not.toBe(first);
    expect((await app.inject({ method: 'GET', url: new URL(first).pathname })).statusCode).toBe(404);
  });

  it('rejects files that are not images, even if they claim to be', async () => {
    const fake = await upload(alice.token, Buffer.from('<script>alert(1)</script>'), 'evil.jpg', 'image/jpeg');
    expect(fake.status).toBe(400);
    expect(fake.body.error.code).toBe('invalid_image');
  });

  it('rejects files over 8 MB', async () => {
    const big = Buffer.alloc(9 * 1024 * 1024, 1);
    expect((await upload(alice.token, big)).status).toBe(413);
  });

  it('removes the photo', async () => {
    const before = (await alice.api.get('/me')).body.user.avatarUrl;
    const res = await alice.api.del('/me/avatar');
    expect(res.body.user.avatarUrl).toBeNull();
    expect((await app.inject({ method: 'GET', url: new URL(before).pathname })).statusCode).toBe(404);
  });

  it('refuses path tricks on the file route', async () => {
    for (const u of ['/uploads/../package.json', '/uploads/avatars/..%2F..%2Fpackage.json', '/uploads/avatars/notahex.webp']) {
      expect((await app.inject({ method: 'GET', url: u })).statusCode).toBe(404);
    }
  });

  it('requires sign-in to upload', async () => {
    expect((await upload('bad-token', Buffer.from('x'))).status).toBe(401);
  });
});
