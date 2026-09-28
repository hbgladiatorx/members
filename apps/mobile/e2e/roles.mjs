// Browser walk-through of roles: a teacher, a student, an observer (read-only) and
// an administrator who is in no class but can act as teacher everywhere.
// Usage: API on :4000, web build on :8081, and DATABASE_URL set for the API's admin
// command (it makes the first administrator), then: node e2e/roles.mjs ./screenshots
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
  const call = (method) => (p, b) => fetch(`${API}${p}`, { method, headers: h, body: JSON.stringify(b ?? {}) }).then((x) => x.json());
  const get = (p) => fetch(`${API}${p}`, { headers: h }).then((x) => x.json());
  return { id: r.user.id, email, get, post: call('POST'), patch: call('PATCH') };
}
async function signIn(email, label) {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  // 403s the observer is expected to get are not page errors.
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${label} console: ${m.text()}`));
  await page.goto(WEB);
  const boxes = page.getByRole('textbox');
  await boxes.nth(0).fill(email);
  await boxes.nth(1).fill(PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Join with code').waitFor();
  return page;
}
const shot = (page, f) => page.screenshot({ path: `${OUT}/${f}.png` });
const absent = async (page, text) => {
  if (await page.getByText(text, { exact: true }).count()) throw new Error(`"${text}" should not be shown`);
};

// ── Setup ──
const teacher = await apiUser('Ustadha Maryam', `maryam${stamp}@example.org`);
const student = await apiUser('Yusuf Ahmed', `yusuf${stamp}@example.org`);
const observer = await apiUser('Parent Observer', `parent${stamp}@example.org`);
const admin = await apiUser('Site Admin', `admin${stamp}@example.org`);
execFileSync('npm', ['run', '-s', 'admin', '--', 'grant', admin.email], { cwd: process.env.API_DIR ?? join(HERE, '../../api'), stdio: 'inherit' });

// Unique per run: administrators see every class, including ones from earlier runs.
const TITLE = `Arabic Level 1 · ${stamp % 100000}`;
const cls = (await teacher.post('/classes', { title: TITLE })).class;
await student.post('/classes/join', { code: cls.joinCode });
await observer.post('/classes/join', { code: cls.joinCode });
await teacher.patch(`/classes/${cls.id}/members/${observer.id}`, { role: 'observer' });
await teacher.post(`/classes/${cls.id}/announcements`, { title: 'Bring your notebooks', pinned: true });
await teacher.post(`/classes/${cls.id}/syllabus`, { title: 'Week 1: The alphabet', published: true });
const q = (await student.post(`/classes/${cls.id}/questions`, { title: 'How many letters are there?' })).question;
await teacher.post(`/questions/${q.id}/answers`, { body: 'Twenty-eight.' });
await student.post(`/channels/${cls.channelId}/messages`, { body: 'Salaam everyone' });
step('teacher, student, observer and administrator set up');

// ── Observer: reads everything, can't take part ──
const o = await signIn(observer.email, 'observer');
await o.getByText('Observer').first().waitFor();
await shot(o, '30-observer-classes');
await o.getByText(TITLE).click();
await o.getByText('You’re observing this class').waitFor();
await o.getByText('Bring your notebooks').waitFor();
await o.getByText('Week 1: The alphabet').waitFor();
await shot(o, '31-observer-class');
await o.getByText('Q&A').click();
await o.getByText('How many letters are there?').waitFor();
await absent(o, 'Ask');
await o.getByText('How many letters are there?').click();
await o.getByText('Twenty-eight.').waitFor();
await absent(o, 'Post answer');
await shot(o, '32-observer-question');
step('observer reads the class and Q&A, with no ask/answer controls');

await o.goto(`${WEB}/chat/${cls.channelId}`);
await o.getByText('Salaam everyone').waitFor();
await o.getByText('You can read this chat but not post').waitFor();
if (await o.getByPlaceholder('Message').count()) throw new Error('observer should have no message box');
await shot(o, '33-observer-chat');
step('observer reads the class chat, composer replaced with read-only note');

// ── Teacher sees the new role names and the observer option ──
const t = await signIn(teacher.email, 'teacher');
await t.goto(`${WEB}/members/${cls.id}?role=instructor`);
await t.getByText('Parent Observer').waitFor();
await t.getByText('Teacher', { exact: true }).first().waitFor();
await t.getByLabel('Actions for Yusuf Ahmed').click();
await t.getByText('Make Teacher Assistant').waitFor();
await t.getByText('Make Observer').waitFor();
await shot(t, '34-teacher-members');
step('teacher sees Teacher / Observer labels and can make someone an observer');

// ── Administrator: every class, teacher powers, manages admins ──
const a = await signIn(admin.email, 'admin');
await a.getByText(TITLE).waitFor();
await a.getByText('Administrator').first().waitFor();
await shot(a, '35-admin-classes');
await a.getByText(TITLE).click();
await a.getByText('Join code').waitFor(); // staff-only
await a.getByText('Post', { exact: true }).waitFor(); // can post announcements
step('administrator sees a class they are not in, with teacher controls');

await a.goto(`${WEB}/profile`);
await a.getByText('Manage people').click();
await a.getByPlaceholder('Search by name or email').fill(teacher.email);
await a.getByText(teacher.email).waitFor();
await a.getByLabel('Ustadha Maryam is an administrator').click();
await a.getByText('Administrator', { exact: true }).waitFor();
await shot(a, '36-admin-manage');
await a.getByPlaceholder('Search by name or email').fill(admin.email);
await a.getByText('Site Admin (you)').waitFor();
if (!(await teacher.get('/me')).user.isAdmin) throw new Error('teacher should now be an administrator');
step('administrator makes the teacher an administrator too');

await browser.close();
console.log(errors.length ? `\nPAGE ERRORS:\n${errors.join('\n')}` : '\nNo page errors.');
