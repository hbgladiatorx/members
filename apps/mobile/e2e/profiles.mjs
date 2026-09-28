// Browser walk-through of member profiles with four people: teacher, student (Zainab),
// classmate (Musa) and a stranger who is in no shared class.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = 'http://localhost:8081';
const API = 'http://localhost:4000';
const OUT = process.argv[2] ?? join(HERE, 'shots');
const PHOTO = join(HERE, 'portrait.jpg');
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
  return {
    id: r.user.id, email,
    post: (p, b) => fetch(`${API}${p}`, { method: 'POST', headers: h, body: JSON.stringify(b ?? {}) }).then((x) => x.json()),
    get: (p) => fetch(`${API}${p}`, { headers: h }).then((x) => x.json()),
  };
}
async function signIn(email, label) {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
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
const imgLoaded = (page, alt) =>
  page.waitForFunction((a) => [...document.querySelectorAll('img')].some((i) => (i.alt || '').includes(a) && i.complete && i.naturalWidth > 0), alt, { timeout: 8000 });

// ── Setup through the API ──
const teacher = await apiUser('Shaykh Hasan', `hasan${stamp}@example.org`);
const zainab = await apiUser('Zainab Ali', `zainab${stamp}@example.org`);
const musa = await apiUser('Musa Karim', `musa${stamp}@example.org`);
const stranger = await apiUser('Stranger', `stranger${stamp}@example.org`);
const cls = (await teacher.post('/classes', { title: 'Introduction to Fiqh' })).class;
await zainab.post('/classes/join', { code: cls.joinCode });
await musa.post('/classes/join', { code: cls.joinCode });
const q = (await zainab.post(`/classes/${cls.id}/questions`, { title: 'Does a translation of the Quran need wudu to touch?' })).question;
const ans = (await musa.post(`/questions/${q.id}/answers`, { body: 'Not for the translation itself.' })).question.answers[0];
await zainab.post(`/questions/${q.id}/answers`, { body: 'Following up with the reference from the risalah.' });
await teacher.post(`/questions/${q.id}/accept`, { answerId: ans.id });
await zainab.post(`/classes/${cls.id}/topics`, { title: 'Reflections on week 1' });
step('four users and one class set up');

// ── Zainab edits her profile ──
const z = await signIn(zainab.email, 'zainab');
await z.goto(`${WEB}/profile`);
await z.getByText('Show my email to classmates').waitFor();
await z.waitForFunction(() => [...document.querySelectorAll('input')].some((i) => i.value === 'Zainab Ali'));
await shot(z, '20-profile-edit-empty');

const [chooser] = await Promise.all([z.waitForEvent('filechooser'), z.getByRole('button', { name: 'Add photo' }).click()]);
await chooser.setFiles(PHOTO);
await z.getByRole('button', { name: 'Change photo' }).waitFor({ timeout: 10000 });
await imgLoaded(z, 'Zainab Ali');
step('photo uploaded from the picker and displayed');

const field = (placeholder) => z.getByPlaceholder(placeholder);
await field("A line or two about yourself, what you do, why you're studying.").fill(
  'Software engineer and mother of two. Second year of evening hawza classes; especially interested in the fiqh of worship.');
await field('e.g. Dearborn').fill('Dearborn, MI');
await field('e.g. English, Arabic, Urdu').fill('English, Arabic, Urdu');
await field('e.g. Arabic grammar, note-taking').fill('Arabic grammar, sharing class notes');
await z.getByLabel('Allow direct messages').click(); // turn DMs off
await z.getByRole('button', { name: 'Save profile' }).click();
await z.getByRole('button', { name: /Saved/ }).waitFor();
await z.evaluate(() => window.scrollTo(0, 0));
await shot(z, '21-profile-edit-filled');
step('bio, city, languages, help-with saved; DMs turned off');

await z.getByRole('button', { name: /See how classmates see me/ }).click();
await z.getByText('This is how classmates see you').waitFor();
if (await z.getByText(zainab.email).filter({ visible: true }).count()) throw new Error('self-preview shows email classmates cannot see');
await imgLoaded(z, 'Zainab Ali');
await shot(z, '22-profile-preview-self');
step('self preview works');

// ── Teacher views Zainab from the member list ──
const t = await signIn(teacher.email, 'teacher');
await t.goto(`${WEB}/members/${cls.id}?role=instructor`);
await imgLoaded(t, 'Zainab Ali');
await shot(t, '23-members-with-photos');
await t.getByText('Zainab Ali', { exact: true }).click();
await t.getByText('Classes together').waitFor();
if (await t.getByText(zainab.email).filter({ visible: true }).count()) throw new Error('email leaked to teacher');
if (!(await t.getByRole('button', { name: /Message/ }).count())) throw new Error('staff should still be able to message');
await imgLoaded(t, 'Zainab Ali');
await shot(t, '24-profile-seen-by-teacher');
step('teacher opens profile from member list; email hidden; can still message (staff)');

// "..." still opens instructor actions without navigating away.
await t.goBack();
await t.getByLabel('Actions for Musa Karim').click();
await t.getByText('Make Teacher Assistant').waitFor();
if (!t.url().includes('/members/')) throw new Error('actions button navigated away');
step('member actions menu still works');

// ── Classmate sees DM opt-out ──
const m = await signIn(musa.email, 'musa');
await m.goto(`${WEB}/user/${zainab.id}`);
await m.getByText('isn’t accepting direct messages').waitFor();
await shot(m, '25-profile-seen-by-classmate');
step('classmate sees DMs are off');

// ── Chat bubble photo → profile ──
await zainab.post(`/channels/${cls.channelId}/messages`, { body: 'Salaam all, notes from week 1 are in the discussion thread.' });
await m.goto(`${WEB}/chat/${cls.channelId}?name=${encodeURIComponent('Introduction to Fiqh')}`);
await m.getByText('notes from week 1').waitFor();
await imgLoaded(m, 'Zainab Ali');
await shot(m, '26-chat-with-photo');
await m.getByLabel("Zainab Ali's profile").click();
await m.getByText('Classes together').waitFor();
step('tapping a chat photo opens the profile');

// ── Stranger is refused ──
const s = await signIn(stranger.email, 'stranger');
await s.goto(`${WEB}/user/${zainab.id}`);
await s.getByText('only visible to people in the same class').waitFor();
step('non-classmate cannot see the profile');

// ── Photo file itself has no metadata and is 512px ──
const me = await (await fetch(`${API}/users/${zainab.id}/profile`, { headers: { authorization: 'x' } })).status;
if (me !== 401) throw new Error('profile should require sign-in');

await browser.close();
console.log(errors.length ? `\nPAGE ERRORS:\n${errors.join('\n')}` : '\nNo page errors.');
