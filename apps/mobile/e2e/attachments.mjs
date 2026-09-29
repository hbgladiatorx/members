// Browser walk-through of resources on postings and the date picker: a teacher writes a syllabus
// item, picks its date from the calendar, attaches a PDF and a link, and posts; a student opens
// the PDF; the teacher adds a file to an existing announcement.
// Usage: API on :4000, web build served on :8081, then: node e2e/attachments.mjs ./screenshots
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

const PDF_PATH = join(tmpdir(), `week1-${stamp}.pdf`);
writeFileSync(PDF_PATH, '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const DOCX_PATH = join(tmpdir(), `worksheet-${stamp}.docx`);
writeFileSync(DOCX_PATH, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 1)]));

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

// ── Setup ──
const teacher = await apiUser('Ustadha Maryam', `maryam${stamp}@example.org`);
const student = await apiUser('Yusuf Ahmed', `yusuf${stamp}@example.org`);
const TITLE = `Tafsir · ${stamp % 100000}`;
const cls = (await teacher.post('/classes', { title: TITLE })).class;
await student.post('/classes/join', { code: cls.joinCode });
await teacher.post(`/classes/${cls.id}/announcements`, { title: 'Welcome to the class' });

// ── Teacher: new syllabus item with a date, a PDF and a link ──
const t = await signIn(teacher.email, 'teacher');
await t.getByText(TITLE).click();
await t.getByText('Syllabus').waitFor();
await t.getByRole('button', { name: /Add$/ }).click();
await t.getByPlaceholder('e.g. Week 3: The rulings of prayer').fill('Week 1: Surah Al-Fatiha');
// Date: open the calendar, go to next month, pick the 15th.
await t.getByRole('button', { name: /^Date \(optional\): not set/ }).click();
await t.getByLabel('Next month').click();
const next = new Date(); next.setDate(1); next.setMonth(next.getMonth() + 1);
const want = new Date(Date.UTC(next.getFullYear(), next.getMonth(), 15)).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
await t.waitForTimeout(400); // let the calendar finish fading in
await shot(t, '90-calendar');
await t.getByRole('button', { name: want, exact: true }).click();
await t.getByRole('button', { name: `Date (optional): ${want}` }).waitFor();
step(`date picked from the calendar: ${want}`);
// Attach a PDF (the picker opens the browser's file chooser) and a link.
const [chooser] = await Promise.all([t.waitForEvent('filechooser'), t.getByRole('button', { name: 'Add file' }).click()]);
await chooser.setFiles(PDF_PATH);
await t.getByText(`week1-${stamp}.pdf`, { exact: true }).first().waitFor();
await t.getByRole('button', { name: 'Add link' }).first().click();
// A local address, so the test doesn't depend on the internet.
await t.getByPlaceholder('https://…').fill(`${WEB}/?resource=fatiha`);
await t.getByPlaceholder('e.g. Lecture recording').fill('Al-Fatiha on Quran.com');
await t.getByRole('button', { name: 'Add link' }).last().click();
await t.getByText('Al-Fatiha on Quran.com', { exact: true }).first().waitFor();
await shot(t, '91-compose-attachments');
await t.getByRole('button', { name: 'Save item' }).click();
await t.getByText('Week 1: Surah Al-Fatiha').waitFor();
step('syllabus item posted with a PDF and a link');

// ── Teacher: attach a file to an existing announcement ──
await t.getByText('Attach').first().click();
const [chooser2] = await Promise.all([t.waitForEvent('filechooser'), t.getByRole('button', { name: 'Add file' }).first().click()]);
await chooser2.setFiles(DOCX_PATH);
await t.getByText(`worksheet-${stamp}.docx`, { exact: true }).first().waitFor();
step('file attached to an existing announcement');

// ── Student: sees the date and attachments, opens the PDF ──
const s = await signIn(student.email, 'student');
await s.getByText(TITLE).click();
await s.getByText('Week 1: Surah Al-Fatiha').click();
await s.getByText(`week1-${stamp}.pdf`, { exact: true }).first().waitFor();
await s.getByText('Al-Fatiha on Quran.com', { exact: true }).first().waitFor();
if (await s.getByRole('button', { name: 'Add file' }).count()) throw new Error('students should not see Add file');
await shot(s, '92-student-attachments');
const [popup] = await Promise.all([s.waitForEvent('popup'), s.getByLabel(`Open week1-${stamp}.pdf`).click()]);
await popup.waitForURL(/\/api\/files\//);
const resp = await popup.context().request.get(popup.url());
if (resp.status() !== 200 || resp.headers()['content-type'] !== 'application/pdf') throw new Error(`PDF did not open: ${resp.status()} ${resp.headers()['content-type']}`);
step('student opens the PDF through a signed link');
const [linkPopup] = await Promise.all([s.waitForEvent('popup'), s.getByLabel('Open Al-Fatiha on Quran.com').click()]);
await linkPopup.waitForURL(/resource=fatiha/, { timeout: 10_000 }).catch(() => {});
const linkUrl = linkPopup.url();
if (!/resource=fatiha/.test(linkUrl)) throw new Error(`link opened ${linkUrl}`);
step('student opens the link');

await browser.close();
console.log(errors.length ? `\nPAGE ERRORS:\n${errors.join('\n')}` : '\nNo page errors.');
