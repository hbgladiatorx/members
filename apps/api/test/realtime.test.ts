import type { FastifyInstance } from 'fastify';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { port, register, setup, teardown } from './helpers.js';

let app: FastifyInstance;
const sockets: Socket[] = [];

beforeAll(async () => {
  app = await setup();
});
afterAll(async () => {
  sockets.forEach((s) => s.close());
  await teardown(app);
});

function open(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(`http://127.0.0.1:${port(app)}`, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    s.on('ready', () => resolve(s));
    s.on('connect_error', reject);
  });
}

const next = <T = any>(s: Socket, event: string, ms = 3000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    s.once(event, (p: T) => {
      clearTimeout(t);
      resolve(p);
    });
  });

const emitAck = (s: Socket, event: string, payload: unknown) =>
  new Promise<any>((resolve) => s.emit(event, payload, resolve));

describe('realtime', () => {
  it('rejects connections without a valid token', async () => {
    await expect(open('nope')).rejects.toThrow('unauthorized');
  });

  it('delivers messages, typing, announcements and new channels live', async () => {
    const teacher = await register(app, 'Teacher');
    const student = await register(app, 'Student');
    const outsider = await register(app, 'Outsider');
    const cls = (await teacher.api.post('/classes', { title: 'Live class' })).body.class;
    await student.api.post('/classes/join', { code: cls.joinCode });

    const [ts, ss, os] = await Promise.all([open(teacher.token), open(student.token), open(outsider.token)]);

    // Message over socket reaches the other member with an ack to the sender.
    const got = next(ss, 'message:new');
    let outsiderGot = false;
    os.on('message:new', () => (outsiderGot = true));
    const ack = await emitAck(ts, 'message:send', { channelId: cls.channelId, body: 'Class starts in 5' });
    expect(ack.ok).toBe(true);
    expect((await got).body).toBe('Class starts in 5');

    // A message sent over REST is also broadcast.
    const viaRest = next(ts, 'message:new');
    await student.api.post(`/channels/${cls.channelId}/messages`, { body: 'On my way' });
    expect((await viaRest).author.displayName).toBe('Student');

    // Typing indicator goes to others, not the sender.
    const typing = next(ts, 'typing');
    ss.emit('typing', { channelId: cls.channelId });
    expect(await typing).toEqual({ channelId: cls.channelId, userId: student.id });

    // Announcements push live.
    const ann = next(ss, 'announcement:new');
    await teacher.api.post(`/classes/${cls.id}/announcements`, { title: 'Bring notebooks' });
    expect((await ann).title).toBe('Bring notebooks');

    // Outsider cannot post into the class channel and never saw anything.
    const denied = await emitAck(os, 'message:send', { channelId: cls.channelId, body: 'let me in' });
    expect(denied).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(outsiderGot).toBe(false);

    // A newly created group joins live sockets without reconnecting.
    const added = next(ss, 'channel:added');
    const g = (await teacher.api.post(`/classes/${cls.id}/channels`, { name: 'Study group', memberIds: [student.id] })).body.channel;
    expect((await added).channelId).toBe(g.id);
    const inGroup = next(ss, 'message:new');
    await emitAck(ts, 'message:send', { channelId: g.id, body: 'group hello' });
    expect((await inGroup).body).toBe('group hello');

    // Removal drops the student from rooms immediately.
    await teacher.api.del(`/classes/${cls.id}/members/${student.id}`);
    let leaked = false;
    ss.on('message:new', () => (leaked = true));
    await emitAck(ts, 'message:send', { channelId: cls.channelId, body: 'after removal' });
    await new Promise((r) => setTimeout(r, 300));
    expect(leaked).toBe(false);
  });
});
