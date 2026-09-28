// Browser walk-through of an administrator adding a person: the new account gets a temporary
// password, signs in, must choose their own password, and lands in the class with the chosen role.
// Then the admin resets their password. Usage: API on :4000, web build on :8081, and DATABASE_URL
// set for the API's admin command, then: node e2e/add-user.mjs ./screenshots
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = 'http://localhost:8081';
const API = 'http://localhost:4000';
const OUT = process.argv[2] ?? join(HERE, 'shots');
const stamp = Date.now();
const PW = 'correct horse battery';
const errors = [];
const step = (s) => console.log('•', s);

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function apiUser(name, email) {
  const r = await (await fetch(`${API}/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW, displayName: name }),
  })).json();
  const h = { 'content-type': 'application/json', authorization: `Bearer ${r.accessToken}` };
  return { id: r.user.id, email, post: (p, b) => fetch(`${API}${p}`, { method: 'POST', headers: h, body: JSON.stringify(b ?? {}) }).then((x) => x.json()) };
}
async function page(label) {
  const ctx = await browser.newContext({ ...phone, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${label} console: ${m.text()}`));
  return p;
}
async function signIn(p, email, password) {
  await p.goto(WEB);
  const boxes = p.getByRole('textbox');
  await boxes.nth(0).fill(email);
  await boxes.nth(1).fill(password);
  await p.getByRole('button', { name: 'Sign in' }).click();
}
const shot = (p, f) => p.screenshot({ path: `${OUT}/${f}.png` });

// ── Setup: an administrator and a class ──
const admin = await apiUser('Site Admin', `admin${stamp}@example.org`);
execFileSync('npm', ['run', '-s', 'admin', '--', 'grant', admin.email], { cwd: process.env.API_DIR ?? join(HERE, '../../api'), stdio: 'inherit' });
const TITLE = `Fiqh of Fasting · ${stamp % 100000}`;
await admin.post('/classes', { title: TITLE });
const NEW_EMAIL = `khadija${stamp}@example.org`;

// ── Admin adds Khadija as a Teacher Assistant ──
const a = await page('admin');
await signIn(a, admin.email, PW);
await a.getByText('Join with code').waitFor();
await a.goto(`${WEB}/profile`);
await a.getByText('Manage people').click();
await a.getByText('Add user').first().click();
await a.getByPlaceholder('e.g. Khadija Noor').fill('Khadija Noor');
await a.getByPlaceholder('They sign in with this').fill(NEW_EMAIL);
await a.getByText(TITLE).click();
await a.getByText('Teacher Assistant').click();
await shot(a, '50-add-user-form');
await a.getByRole('button', { name: 'Add user' }).click();
await a.getByText(`Khadija Noor was added as Teacher Assistant in ${TITLE}.`).waitFor();
const temp = (await a.getByLabel(/^Temporary password /).innerText()).trim();
if (!/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/.test(temp)) throw new Error(`unexpected temporary password: ${temp}`);
await a.getByText('Copy sign-in message').click();
await a.getByText('Copied').waitFor();
const copied = await a.evaluate(() => navigator.clipboard.readText());
if (!copied.includes(temp) || !copied.includes(NEW_EMAIL) || !copied.includes(WEB)) throw new Error(`copied message is missing details:\n${copied}`);
await shot(a, '51-add-user-done');
step('administrator adds a person to a class and copies their sign-in message');

// ── Khadija signs in with the temporary password and must choose her own ──
const k = await page('khadija');
await signIn(k, NEW_EMAIL, temp);
await k.getByText('Choose your password').waitFor();
await shot(k, '52-choose-password');
await k.getByLabel('Temporary password').fill(temp);
await k.getByLabel('New password', { exact: true }).fill('my own password 1');
await k.getByLabel('New password again').fill('my own password 2');
await k.getByText('The two new passwords don’t match.').first().waitFor();
await k.getByLabel('New password again').fill('my own password 1');
await k.getByRole('button', { name: 'Save password' }).click();
await k.getByText('Join with code').waitFor();
await k.getByText(TITLE).waitFor();
await k.getByText('Teacher Assistant').first().waitFor();
await shot(k, '53-new-user-classes');
step('new person is made to choose a password, then sees their class as Teacher Assistant');

// ── Admin resets her password; the old one stops working ──
await a.goto(`${WEB}/admin`);
await a.getByPlaceholder('Search by name or email').fill(NEW_EMAIL);
await a.getByText(NEW_EMAIL).waitFor();
await a.getByText('Reset password').click();
await a.getByText('Reset', { exact: true }).click();
await a.getByText('New temporary password for Khadija Noor').waitFor();
const temp2 = (await a.getByLabel(/^Temporary password /).innerText()).trim();
await a.getByText('Temporary password', { exact: true }).first().waitFor();
await shot(a, '54-reset-password');
const oldLogin = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: NEW_EMAIL, password: 'my own password 1' }) });
if (oldLogin.status !== 401) throw new Error('old password should stop working after a reset');
const k2 = await page('khadija-again');
await signIn(k2, NEW_EMAIL, temp2);
await k2.getByText('Choose your password').waitFor();
step('administrator resets the password; she must choose a new one again');

// ── Someone who can't choose a password now can still sign out ──
await k2.getByRole('button', { name: 'Sign out' }).click();
await k2.getByRole('button', { name: 'Sign in' }).waitFor();
step('forced password screen offers sign out');

await browser.close();
console.log(errors.length ? `\nPAGE ERRORS:\n${errors.join('\n')}` : '\nNo page errors.');
