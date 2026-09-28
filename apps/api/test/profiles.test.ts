import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, register, setup, teardown } from './helpers.js';

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

describe('changing your email', () => {
  it('needs the current password and a free address', async () => {
    const u = await register(app, 'Mover');
    expect((await u.api.put('/me/email', { email: 'new@example.org', password: 'wrong password' })).status).toBe(403);
    const taken = await u.api.put('/me/email', { email: alice.email.toUpperCase(), password: 'correct horse battery' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('email_taken');
    expect((await u.api.put('/me/email', { email: 'not-an-email', password: 'correct horse battery' })).status).toBe(400);
  });

  it('changes the sign-in email, stored in lower case', async () => {
    const u = await register(app, 'Mover2');
    const res = await u.api.put('/me/email', { email: '  New.Address@Example.ORG ', password: 'correct horse battery' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('new.address@example.org');
    const anon = client(app);
    expect((await anon.post('/auth/login', { email: u.email, password: 'correct horse battery' })).status).toBe(401);
    expect((await anon.post('/auth/login', { email: 'NEW.address@example.org', password: 'correct horse battery' })).status).toBe(200);
  });
});

describe('location: city, country and postal code', () => {
  it('lists countries without South Africa, North Korea, Israel, Greenland or Chile', async () => {
    const res = await client(app).get('/countries'); // public: the profile form loads it
    expect(res.status).toBe(200);
    const codes = res.body.countries.map((c: { code: string }) => c.code);
    const names = res.body.countries.map((c: { name: string }) => c.name);
    for (const gone of ['ZA', 'KP', 'IL', 'GL', 'CL']) expect(codes).not.toContain(gone);
    for (const gone of ['South Africa', 'North Korea', 'Israel', 'Greenland', 'Chile']) expect(names).not.toContain(gone);
    expect(codes).toEqual(expect.arrayContaining(['US', 'GB', 'PS', 'SA', 'EG', 'PK', 'CA']));
    expect(codes.length).toBe(245);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...names].sort((a, b) => a.localeCompare(b, 'en'))).toEqual(names);
  });

  it('saves city, country and postal code; refuses countries not on the list', async () => {
    const res = await alice.api.patch('/me', { city: 'Dearborn', country: 'us', postalCode: ' 48126 ' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ city: 'Dearborn', country: 'US', postalCode: '48126' });
    for (const bad of ['ZA', 'IL', 'KP', 'GL', 'CL', 'XX', 'USA']) {
      expect((await alice.api.patch('/me', { country: bad })).status, bad).toBe(400);
    }
    expect((await alice.api.patch('/me', { postalCode: 'x'.repeat(21) })).status).toBe(400);
    // Clearing works.
    expect((await alice.api.patch('/me', { country: '' })).body.user.country).toBe('');
    await alice.api.patch('/me', { country: 'US' });
  });

  it('shows city and country to classmates, but the postal code only to the member', async () => {
    const seen = await bob.api.get(`/users/${alice.id}/profile`);
    expect(seen.body.profile).toMatchObject({ city: 'Dearborn', country: 'US', countryName: 'United States', postalCode: null });
    const own = await alice.api.get(`/users/${alice.id}/profile`);
    expect(own.body.profile.postalCode).toBe('48126');
  });
});
