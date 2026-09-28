import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { config } from './config.js';
import { pool } from './lib/db.js';
import { HttpError } from './lib/errors.js';
import { attachSocket, corsOrigins } from './realtime/socket.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import classRoutes from './routes/classes.js';
import contentRoutes from './routes/content.js';
import discussionRoutes from './routes/discussions.js';
import profileRoutes from './routes/profiles.js';
import qaRoutes from './routes/qa.js';

export async function buildApp() {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.NODE_ENV === 'production' ? 'info' : 'debug' },
    trustProxy: true, // behind Nginx
    bodyLimit: 1_000_000,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: corsOrigins(),
    credentials: false,
    // The default only allows GET/HEAD/POST; the API also uses PUT/PATCH/DELETE.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(rateLimit, {
    global: true,
    max: config.NODE_ENV === 'test' ? 10_000 : 300,
    timeWindow: '1 minute',
  });
  await app.register(jwt, { secret: config.JWT_SECRET });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (err.statusCode === 429) {
      return reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many requests, slow down' } });
    }
    if (err.validation || err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || err.statusCode === 400) {
      return reply.code(400).send({ error: { code: 'bad_request', message: err.message } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong' } });
  });

  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });

  await app.register(authRoutes);
  await app.register(profileRoutes);
  await app.register(classRoutes);
  await app.register(contentRoutes);
  await app.register(qaRoutes);
  await app.register(discussionRoutes);
  await app.register(chatRoutes);
  await app.register(adminRoutes);

  await attachSocket(app);
  return app;
}
