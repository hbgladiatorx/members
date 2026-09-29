// Browser walk-through: photos, files and links on chat messages, questions, answers and discussion
// replies, placed inside the text where the cursor was, each posting showing a day and time. Usage: API on :4000, web build on :8081, then:
//   node e2e/attachments-everywhere.mjs ./screenshots
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
// A day and time as the app prints it, e.g. "Tue, Sep 29, 12:46 AM" or "Tue 29 Sep, 00:46".
const STAMP = /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^\n]{3,20}\d{1,2}:\d{2}/;

// A real (tiny) PNG, so the browser can draw it.
const PNG_PATH = join(tmpdir(), `board-${stamp}.png`);
writeFileSync(PNG_PATH, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mNk+M9QzwAEjDAGNzYAAB2/A/9mRqxuAAAAAElFTkSuQmCC', 'base64'));
const PDF_PATH = join(tmpdir(), `notes-${stamp}.pdf`);
writeFileSync(PDF_PATH, '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function apiUser(name, email) {
  const r = await (await fetch(`${API}/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW, displayName: name }),
  })).json();
  const h = { 'content-type': 'application/json', authorization: `Bearer ${r.accessToken}` };
  return { email, post: (p, b) => fetch(`${API}${p}`, { method: 'POST', headers: h, body: JSON.stringify(b ?? {}) }).then((x) => x.json()) };
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
  await page.getByText('Join with code').first().waitFor();
  return page;
}
const shot = (p, f) => p.screenshot({ path: `${OUT}/${f}.png` });
const pick = async (page, button, path) => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button.click()]);
  await chooser.setFiles(path);
};
/** Is `first` (text) before `second` (an image's alt, or text) on the page? */
const inOrder = (page, first, second) =>
  page.evaluate(([a, b]) => {
    const find = (t) =>
      [...document.querySelectorAll('img')].find((i) => i.alt === t) ??
      [...document.querySelectorAll('div, span')].reverse().find((e) => e.childElementCount === 0 && e.textContent?.trim() === t);
    const x = find(a), y = find(b);
    return !!x && !!y && !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
  }, [first, second]);
const imageLoaded = (page, alt) =>
  page.waitForFunction((a) => [...document.querySelectorAll('img')].some((i) => i.alt === a && i.complete && i.naturalWidth > 0), alt, { timeout: 10_000 });

// ── Setup ──
const teacher = await apiUser('Ustadha Maryam', `maryam${stamp}@example.org`);
const student = await apiUser('Yusuf Ahmed', `yusuf${stamp}@example.org`);
const TITLE = `Seerah · ${stamp % 100000}`;
const cls = (await teacher.post('/classes', { title: TITLE })).class;
await student.post('/classes/join', { code: cls.joinCode });
const topic = (await teacher.post(`/classes/${cls.id}/topics`, { title: 'Share your study notes' })).topic;

// ── Student: a photo in the middle of a chat message ──
const s = await signIn(student.email, 'student');
await s.goto(`${WEB}/chat/${cls.channelId}`);
const box = s.getByPlaceholder('Message');
await box.waitFor();
await box.fill('Here is the board from today:');
await s.getByRole('button', { name: 'Attach a photo, file or link' }).click();
await pick(s, s.getByRole('button', { name: 'Add photo' }), PNG_PATH);
await s.getByText(`board-${stamp}.png`, { exact: true }).first().waitFor(); // queued
if (!(await box.inputValue()).includes(`[📷 board-${stamp}.png]`)) throw new Error('photo was not placed in the message');
await imageLoaded(s, `board-${stamp}.png`); // shown in the preview before sending
await shot(s, '109-chat-preview');
await box.press('End');
await box.pressSequentially('Any questions?');
await s.getByRole('button', { name: 'Send' }).click();
await s.getByLabel('Preview').waitFor({ state: 'detached' }); // sent; now the message itself
await imageLoaded(s, `board-${stamp}.png`);
if (!(await inOrder(s, 'Here is the board from today:', `board-${stamp}.png`)) || !(await inOrder(s, `board-${stamp}.png`, 'Any questions?'))) {
  throw new Error('the photo should sit between the two lines of the message');
}
if (!STAMP.test(await s.locator('body').innerText())) throw new Error('chat message has no day and time');
await shot(s, '110-chat-photo');
step('student puts a photo in the middle of a chat message; it shows there, with a day and time');

// ── Teacher sees it live ──
const t = await signIn(teacher.email, 'teacher');
await t.goto(`${WEB}/chat/${cls.channelId}`);
await imageLoaded(t, `board-${stamp}.png`);
if (!(await inOrder(t, `board-${stamp}.png`, 'Any questions?'))) throw new Error('teacher should see the photo inside the message');
step('teacher sees the photo inside the message');

// ── Student: a question with a PDF ──
await s.goto(`${WEB}/class/${cls.id}`);
await s.getByText('Q&A').click();
await s.getByRole('button', { name: /Ask$/ }).click();
await s.getByPlaceholder('What would you like to know?').fill('Where can I read about the Hijrah?');
await s.getByLabel('Details (optional)').fill('My class notes so far:');
await pick(s, s.getByRole('button', { name: 'Add file' }), PDF_PATH);
await s.getByText(`notes-${stamp}.pdf`, { exact: true }).first().waitFor();
await s.getByLabel('Details (optional)').pressSequentially('What should I read next?');
await s.getByRole('button', { name: 'Post question' }).click();
await s.getByText('Where can I read about the Hijrah?').waitFor();
await s.getByLabel(`Open notes-${stamp}.pdf`).waitFor();
if (!(await inOrder(s, 'My class notes so far:', `notes-${stamp}.pdf`)) || !(await inOrder(s, `notes-${stamp}.pdf`, 'What should I read next?'))) {
  throw new Error('the PDF should sit inside the question text');
}
step('student asks a question with a PDF placed in the text');

// ── Teacher: answers with a link ──
await t.goto(`${WEB}/class/${cls.id}`);
await t.getByText('Q&A').click();
await t.getByText('Where can I read about the Hijrah?').click();
await t.getByLabel('Your answer').fill('Start with **chapter 12** of the Sealed Nectar.');
await t.getByRole('button', { name: 'Add link' }).click();
await t.getByPlaceholder('https://…').fill(`${WEB}/?resource=sealed-nectar`);
await t.getByPlaceholder('e.g. Lecture recording').fill('The Sealed Nectar, ch. 12');
await t.getByRole('button', { name: 'Add link' }).last().click();
if (!(await t.getByLabel('Your answer').inputValue()).includes('[🔗 The Sealed Nectar, ch. 12]')) throw new Error('link was not placed in the answer');
await t.getByLabel('Preview').getByText('The Sealed Nectar, ch. 12').waitFor();
await t.getByRole('button', { name: 'Post answer' }).click();
await t.getByText(/^1 answer$/i).waitFor();
await t.getByLabel('Open The Sealed Nectar, ch. 12').waitFor();
const qText = await t.locator('body').innerText();
if ((qText.match(new RegExp(STAMP, 'g')) ?? []).length < 2) throw new Error('question and answer should both show a day and time');
await shot(t, '111-answer-link');
step('teacher answers with a link; question and answer both show a day and time');

// ── Student: replies in a discussion with a photo ──
await s.goto(`${WEB}/topic/${topic.id}`);
await s.getByPlaceholder('Add to the discussion…').fill('My notes from _week 1_');
await pick(s, s.getByRole('button', { name: 'Add photo' }), PNG_PATH);
await s.getByText(`board-${stamp}.png`, { exact: true }).first().waitFor();
await s.getByPlaceholder('Add to the discussion…').pressSequentially('Page two is the summary.');
await imageLoaded(s, `board-${stamp}.png`); // in the preview
await shot(s, '112a-reply-preview');
await s.getByRole('button', { name: 'Reply' }).last().click();
await s.getByLabel('Preview').waitFor({ state: 'detached' });
await imageLoaded(s, `board-${stamp}.png`);
if (!(await inOrder(s, `board-${stamp}.png`, 'Page two is the summary.'))) throw new Error('the photo should sit inside the reply');
await shot(s, '112-reply-photo');
step('student replies in a discussion with a photo placed in the text');

await browser.close();
console.log(errors.length ? `\nPAGE ERRORS:\n${errors.join('\n')}` : '\nNo page errors.');
