/**
 * Manage administrators from the server, e.g. to create the first one.
 *
 *   npm run admin -- grant you@example.org
 *   npm run admin -- revoke someone@example.org
 *   npm run admin -- list
 *
 * In production: docker compose exec api npm run admin -- grant you@example.org
 * The person must already have an account (sign up in the app first).
 */
import { audit, one, pool, query } from './lib/db.js';
import { migrate } from './migrate.js';

async function main() {
  const [cmd, email] = process.argv.slice(2);
  await migrate(() => {});

  if (cmd === 'list') {
    const rows = await query<{ email: string; display_name: string }>(
      `SELECT u.email, u.display_name FROM site_roles s JOIN users u ON u.id = s.user_id
        WHERE s.role = 'admin' AND s.valid_to IS NULL ORDER BY u.display_name`,
    );
    if (!rows.length) console.log('No administrators yet.');
    for (const r of rows) console.log(`${r.display_name} <${r.email}>`);
    return;
  }

  if ((cmd !== 'grant' && cmd !== 'revoke') || !email) {
    console.error('Usage: npm run admin -- grant|revoke <email>   or   npm run admin -- list');
    process.exitCode = 1;
    return;
  }

  const user = await one<{ id: string; display_name: string }>(
    'SELECT id, display_name FROM users WHERE email = $1 AND deleted_at IS NULL',
    [email.trim().toLowerCase()],
  );
  if (!user) {
    console.error(`No account with the email ${email}. Sign up in the app first, then run this again.`);
    process.exitCode = 1;
    return;
  }

  if (cmd === 'grant') {
    const added = await one(
      `INSERT INTO site_roles (user_id, role) VALUES ($1, 'admin')
       ON CONFLICT (user_id, role) WHERE valid_to IS NULL DO NOTHING RETURNING id`,
      [user.id],
    );
    if (added) await audit(null, 'admin.grant', 'user', user.id, { via: 'cli' });
    console.log(added ? `${user.display_name} is now an administrator.` : `${user.display_name} was already an administrator.`);
  } else {
    const ended = await one(
      `UPDATE site_roles SET valid_to = now() WHERE user_id = $1 AND role = 'admin' AND valid_to IS NULL RETURNING id`,
      [user.id],
    );
    if (ended) await audit(null, 'admin.revoke', 'user', user.id, { via: 'cli' });
    console.log(ended ? `${user.display_name} is no longer an administrator.` : `${user.display_name} was not an administrator.`);
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
