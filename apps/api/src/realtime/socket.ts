import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { config } from '../config.js';
import { requireChannelAccess } from '../lib/access.js';
import { HttpError } from '../lib/errors.js';
import { accessibleChannelIds, markRead, sendMessage } from '../services/chat.js';
import { setIo } from './hub.js';

type Ack = (res: { ok: true; data?: unknown } | { ok: false; error: { code: string; message: string } }) => void;

export async function attachSocket(app: FastifyInstance) {
  const io = new Server(app.server, {
    cors: { origin: corsOrigins() },
    path: '/socket.io',
  });

  // Scale-out: with Redis, broadcasts reach sockets connected to any API process.
  if (config.REDIS_URL) {
    const { createClient } = await import('redis');
    const { createAdapter } = await import('@socket.io/redis-adapter');
    const pub = createClient({ url: config.REDIS_URL });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
    app.addHook('onClose', async () => {
      await Promise.allSettled([pub.quit(), sub.quit()]);
    });
  }

  // Authenticate every connection with the same JWT as the REST API.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string') return next(new Error('unauthorized'));
    try {
      const payload = app.jwt.verify<{ sub: string }>(token);
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const userId: string = socket.data.userId;
    socket.join(`user:${userId}`);
    try {
      const ids = await accessibleChannelIds(userId);
      socket.join(ids.map((id) => `ch:${id}`));
      socket.emit('ready', { channelIds: ids });
    } catch (err) {
      app.log.error(err, 'socket join failed');
      socket.disconnect(true);
      return;
    }

    socket.on('message:send', async (payload: unknown, ack?: Ack) => {
      const p = payload as { channelId?: string; body?: string; replyToId?: string | null };
      await respond(ack, async () => {
        if (typeof p?.channelId !== 'string' || typeof p?.body !== 'string') {
          throw new HttpError(400, 'bad_request', 'channelId and body are required');
        }
        return sendMessage(userId, p.channelId, p.body, p.replyToId ?? null);
      });
    });

    socket.on('typing', async (payload: unknown) => {
      const channelId = (payload as { channelId?: string })?.channelId;
      if (typeof channelId !== 'string' || !socket.rooms.has(`ch:${channelId}`)) return;
      // Observers read along silently.
      const canWrite = await requireChannelAccess(channelId, userId, { write: true }).then(() => true, () => false);
      if (!canWrite) return;
      socket.to(`ch:${channelId}`).emit('typing', { channelId, userId });
    });

    socket.on('read', async (payload: unknown, ack?: Ack) => {
      const p = payload as { channelId?: string; seq?: number };
      await respond(ack, async () => {
        if (typeof p?.channelId !== 'string' || typeof p?.seq !== 'number') {
          throw new HttpError(400, 'bad_request', 'channelId and seq are required');
        }
        await requireChannelAccess(p.channelId, userId);
        await markRead(userId, p.channelId, p.seq);
      });
    });
  });

  async function respond(ack: Ack | undefined, fn: () => Promise<unknown>) {
    try {
      const data = await fn();
      ack?.({ ok: true, data });
    } catch (err) {
      if (err instanceof HttpError) ack?.({ ok: false, error: { code: err.code, message: err.message } });
      else {
        app.log.error(err);
        ack?.({ ok: false, error: { code: 'internal', message: 'Something went wrong' } });
      }
    }
  }

  setIo(io);
  app.addHook('onClose', async () => {
    setIo(null);
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });
  return io;
}

export function corsOrigins(): string[] | string {
  return config.CORS_ORIGIN === '*' ? '*' : config.CORS_ORIGIN.split(',').map((s) => s.trim());
}
