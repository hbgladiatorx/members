// End-to-end walk-through of the app in a real browser at phone size, with two users.
// Usage: API on :4000, web build served on :8081, then: node e2e/walkthrough.mjs ./screenshots
import { chromium } from 'playwright';

const WEB = 'http://localhost:8081';
const API = 'http://localhost:4000';
const OUT = process.argv[2] ?? '.';
const stamp = Date.now();
const errors = [];

const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function newUser(name) {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`));
  return page;
}
const shot = (page, file) => page.screenshot({ path: `${OUT}/${file}.png` });
const step = (s) => console.log('•', s);

async function register(page, name, email) {
  await page.goto(WEB);
  await page.getByRole('tab', { name: 'Create account' }).click();
  const boxes = page.getByRole('textbox');
  await boxes.nth(0).fill(name);
  await boxes.nth(1).fill(email);
  await boxes.nth(2).fill('correct horse battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Join with code').waitFor();
}

async function compose(page, buttonName, fields, submit) {
  await page.getByRole('button', { name: new RegExp(`^\\W*${buttonName}$`) }).click();
  const boxes = page.getByRole('textbox');
  await boxes.first().waitFor();
  for (const [i, v] of fields.entries()) if (v) await boxes.nth(i).fill(v);
  await page.getByRole('button', { name: submit }).click();
}

// ── Teacher sets up the class ──
const t = await newUser('teacher');
await t.goto(WEB);
await t.getByText('Mainstay Classes').waitFor();
await shot(t, '01-sign-in');
step('sign-in screen renders');

await register(t, 'Shaykh Hasan', `hasan${stamp}@example.org`);
await shot(t, '02-no-classes');
step('teacher registered');

await t.getByRole('button', { name: 'New class' }).click();
await t.getByPlaceholder('e.g. Introduction to Fiqh').fill('Introduction to Fiqh');
await t.getByRole('button', { name: 'Create class' }).click();
await t.getByText('Join code').waitFor();
const code = (await t.locator('text=/^[A-HJ-NP-Z2-9]{7}$/').first().textContent()).trim();
step(`class created, join code ${code}`);

await compose(t, 'Post', ['Welcome to the class', 'Salaam everyone. We meet Tuesdays at 7pm. Bring a notebook.'], 'Post announcement');
await t.getByText('Welcome to the class').waitFor();
await compose(t, 'Add', ['Week 1: Taharah (purity)', 'Read chapter 1. Types of water and their rulings.', '2026-10-06'], 'Save item');
await t.getByText('Week 1: Taharah (purity)').waitFor();
await compose(t, 'Add', ['Week 2: Wudu and ghusl', 'Conditions and invalidators.', '2026-10-13'], 'Save item');
await t.getByText('Week 2: Wudu and ghusl').waitFor();
await t.getByText('Week 1: Taharah (purity)').click();
await t.getByText('Read chapter 1.', { exact: false }).waitFor();
await shot(t, '03-class-overview-teacher');
step('announcement + syllabus posted');

// ── Students join ──
const s = await newUser('student');
await register(s, 'Zainab Ali', `zainab${stamp}@example.org`);
await s.getByRole('button', { name: 'Join with code' }).click();
await s.getByPlaceholder('e.g. K7PQ2MX').fill(code.toLowerCase());
await s.getByRole('button', { name: 'Join class' }).click();
await s.getByText('Welcome to the class').waitFor();
if (await s.getByText('Join code').count()) throw new Error('student can see join code');
await shot(s, '04-class-overview-student');
step('student joined by code; join code hidden from student');

// A third member via the API, for a livelier chat.
const third = await (await fetch(`${API}/auth/register`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `musa${stamp}@example.org`, password: 'correct horse battery', displayName: 'Musa Karim' }),
})).json();
const auth = { 'content-type': 'application/json', authorization: `Bearer ${third.accessToken}` };
const joined = await (await fetch(`${API}/classes/join`, { method: 'POST', headers: auth, body: JSON.stringify({ code }) })).json();
const channelId = joined.class.channelId;

// ── Q&A ──
await s.getByRole('tab', { name: 'Q&A' }).click();
await compose(s, 'Ask', ['Does touching a translation of the Quran require wudu?', 'I have an English translation with the Arabic on the facing page.'], 'Post question');
await s.getByText('0 answers').waitFor();
const questionUrl = s.url();
step('student asked a question');

await t.goto(questionUrl);
await t.getByPlaceholder('Share what you know…').fill('The translation alone does not require wudu. Where the Arabic text is printed, avoid touching the Arabic words themselves without wudu. Check your marja’s risalah for the precise ruling.');
await t.getByRole('button', { name: 'Post answer' }).click();
await t.getByText('1 answer').waitFor();
step('teacher answered');

await s.reload();
await s.getByText('Accept this answer').click();
await s.getByText('Accepted answer').waitFor();
await s.getByLabel('Upvote').nth(1).click();
await s.waitForFunction(() => document.body.innerText.includes('Accepted answer') && /\n1\n/.test(document.body.innerText), null, { timeout: 5000 });
await shot(s, '05-question-answered');
step('student accepted + upvoted');

// ── Discussions ──
await s.goBack();
await s.getByRole('tab', { name: 'Discuss' }).click();
await compose(s, 'Start a discussion', ['Reflections on week 1', 'What surprised you most about the rulings on water?'], 'Start discussion');
await s.getByText('Be the first to reply.').waitFor();
const topicUrl = s.url();
await t.goto(topicUrl);
await t.getByPlaceholder('Add to the discussion…').fill('Good question. Notice how many categories depend on quantity (kurr).');
await t.getByRole('button', { name: 'Reply' }).last().click();
await t.getByText('1 reply').waitFor();
await t.getByRole('button', { name: /Pin$/ }).click();
await t.getByText('Pinned').first().waitFor();
await s.reload();
await s.getByText('Reply', { exact: true }).first().click();
await s.getByText('Replying to Shaykh Hasan').waitFor();
await s.getByPlaceholder('Add to the discussion…').fill('That distinction was new to me, jazakallah.');
await s.getByRole('button', { name: 'Reply' }).last().click();
await s.getByText('2 replies').waitFor();
await shot(s, '06-discussion-thread');
step('threaded discussion with pin works');

// ── Live chat ──
await t.goto(`${WEB}/chat/${channelId}?name=${encodeURIComponent('Introduction to Fiqh')}`);
await s.goto(`${WEB}/chat/${channelId}?name=${encodeURIComponent('Introduction to Fiqh')}`);
await t.getByPlaceholder('Message').waitFor();
await s.getByPlaceholder('Message').waitFor();
await t.waitForTimeout(800); // sockets connect

await fetch(`${API}/channels/${channelId}/messages`, { method: 'POST', headers: auth, body: JSON.stringify({ body: 'Assalamu alaikum! Is class still at 7 tonight?' }) });
await s.getByText('Is class still at 7 tonight?').waitFor({ timeout: 5000 });
step('message from REST arrived live');

await t.getByPlaceholder('Message').fill('Wa alaikum salaam, yes. 7pm, same room.');
await t.keyboard.press('Enter');
await s.getByText('Wa alaikum salaam, yes. 7pm, same room.').waitFor({ timeout: 5000 });
await s.getByPlaceholder('Message').fill('Thank you! I will bring the notes from week 1.');
await s.getByLabel('Send').click();
await t.getByText('I will bring the notes from week 1.').waitFor({ timeout: 5000 });
await t.waitForTimeout(300);
await shot(s, '07-chat-student');
await shot(t, '08-chat-teacher');
step('two-way live chat works (enter-to-send + send button)');

// ── DM from member list + chats tab with unread ──
await fetch(`${API}/dm`, { method: 'POST', headers: auth, body: JSON.stringify({ userId: (await (await fetch(`${API}/classes/${joined.class.id}/members`, { headers: auth })).json()).members.find((m) => m.displayName === 'Zainab Ali').id }) })
  .then((r) => r.json())
  .then((dm) => fetch(`${API}/channels/${dm.channelId}/messages`, { method: 'POST', headers: auth, body: JSON.stringify({ body: 'Can I borrow your notes from week 1?' }) }));
await s.goto(`${WEB}/chats`);
await s.getByText('Can I borrow your notes from week 1?').waitFor();
await s.waitForTimeout(300);
await shot(s, '09-chats-list');
step('chats list shows DM with unread');

await t.goto(`${WEB}/members/${joined.class.id}?role=instructor`);
await t.getByText('Zainab Ali').click();
await t.getByText('Make assistant').waitFor();
await shot(t, '10-members-instructor');
step('instructor member tools visible');

await t.goto(WEB);
await t.getByText('3 members').waitFor();
await shot(t, '11-classes-list');

// Desktop width check for the web version.
const d = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const dp = await d.newPage();
await dp.goto(WEB);
await dp.getByText('Mainstay Classes').waitFor();
await dp.screenshot({ path: `${OUT}/12-desktop-sign-in.png` });

await browser.close();
console.log(errors.length ? `\nPAGE ERRORS:\n${errors.join('\n')}` : '\nNo page errors.');
