import { buildApp } from './app.js';
import { config } from './config.js';
import { pool } from './lib/db.js';
import { migrate } from './migrate.js';

const app = await buildApp();

// Apply pending migrations on boot so a fresh deploy is one command.
await migrate((msg) => app.log.info(msg));

await app.listen({ port: config.PORT, host: config.HOST });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
