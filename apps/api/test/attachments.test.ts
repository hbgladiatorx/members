import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, register, setup, teardown } from './helpers.js';

let app: FastifyInstance;
type U = Awaited<ReturnType<typeof register>>;
let teacher: U, student: U, observer: U, outsider: U;
let classId: string, announcementId: string, syllabusId: string;

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

async function upload(token: string, targetKind: string, targetId: string, data: Buffer, filename: string) {
  const boundary = '----t' + Math.random().toString(16).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: 'POST',
    url: `/attachments/file?targetKind=${targetKind}&targetId=${targetId}`,
    payload: body,
    headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
}

/** Follow a signed link as a browser would: no token, just the URL. */
async function fetchSigned(url: string) {
  const path = new URL(url).pathname + new URL(url).search;
  return app.inject({ method: 'GET', url: path });
}

beforeAll(async () => {
  app = await setup();
  teacher = await register(app, 'Teacher');
  student = await register(app, 'Student');
  observer = await register(app, 'Observer');
  outsider = await register(app, 'Outsider');
  const cls = (await teacher.api.post('/classes', { title: 'Tafsir' })).body.class;
  classId = cls.id;
  await student.api.post('/classes/join', { code: cls.joinCode });
  await observer.api.post('/classes/join', { code: cls.joinCode });
  await teacher.api.patch(`/classes/${classId}/members/${observer.id}`, { role: 'observer' });
  announcementId = (await teacher.api.post(`/classes/${classId}/announcements`, { title: 'Reading for week 1' })).body.announcement.id;
  syllabusId = (await teacher.api.post(`/classes/${classId}/syllabus`, { title: 'Week 1', published: true })).body.item.id;
});
afterAll(() => teardown(app));

describe('attachments on postings', () => {
  let pdfId: string;

  it('teachers attach a PDF; it shows on the posting for everyone in the class', async () => {
    const res = await upload(teacher.token, 'announcement', announcementId, PDF, 'Surah Al-Fatiha notes.pdf');
    expect(res.status).toBe(201);
    expect(res.body.attachment).toMatchObject({ kind: 'file', title: 'Surah Al-Fatiha notes.pdf', contentType: 'application/pdf', sizeBytes: PDF.length });
    expect(res.body.attachment.url).toBeNull(); // files have no public address
    pdfId = res.body.attachment.id;

    for (const u of [student, observer]) {
      const list = await u.api.get(`/classes/${classId}/announcements`);
      expect(list.body.announcements[0].attachments.map((a: any) => a.id)).toEqual([pdfId]);
    }
  });

  it('opens through a signed link that works without a token, for students and observers', async () => {
    for (const u of [student, observer]) {
      const open = await u.api.get(`/attachments/${pdfId}/open`);
      expect(open.status).toBe(200);
      expect(open.body.url).toMatch(/\/files\/[0-9a-f-]+\?exp=\d+&sig=[0-9a-f]{64}$/);
      const file = await fetchSigned(open.body.url);
      expect(file.statusCode).toBe(200);
      expect(file.headers['content-type']).toBe('application/pdf');
      expect(String(file.headers['content-disposition'])).toMatch(/^inline;/);
      expect(file.headers['x-content-type-options']).toBe('nosniff');
      expect(file.rawPayload.equals(PDF)).toBe(true);
    }
  });

  it('keeps files away from people outside the class and from tampered or expired links', async () => {
    expect((await outsider.api.get(`/attachments/${pdfId}/open`)).status).toBe(404);
    const good = new URL((await student.api.get(`/attachments/${pdfId}/open`)).body.url);
    const exp = Number(good.searchParams.get('exp'));
    // Tampered: a later expiry with the old signature.
    expect((await app.inject({ method: 'GET', url: `/files/${pdfId}?exp=${exp + 3600}&sig=${good.searchParams.get('sig')}` })).statusCode).toBe(404);
    // Signature for another file.
    expect((await app.inject({ method: 'GET', url: `/files/00000000-0000-0000-0000-000000000000${good.search}` })).statusCode).toBe(404);
    // Validly signed but expired.
    const past = Math.floor(Date.now() / 1000) - 10;
    const sig = createHmac('sha256', process.env.JWT_SECRET!).update(`attachment:${pdfId}:${past}`).digest('hex');
    const expired = await app.inject({ method: 'GET', url: `/files/${pdfId}?exp=${past}&sig=${sig}` });
    expect(expired.statusCode).toBe(410);
  });

  it('only teachers and assistants can attach or remove', async () => {
    expect((await upload(student.token, 'announcement', announcementId, PDF, 'x.pdf')).status).toBe(403);
    expect((await upload(observer.token, 'announcement', announcementId, PDF, 'x.pdf')).status).toBe(403);
    expect((await upload(outsider.token, 'announcement', announcementId, PDF, 'x.pdf')).status).toBe(404);
    expect((await student.api.post('/attachments/link', { targetKind: 'announcement', targetId: announcementId, url: 'https://example.org' })).status).toBe(403);
    expect((await student.api.del(`/attachments/${pdfId}`)).status).toBe(403);
  });

  it('accepts Office documents, images and text by content; refuses programs, HTML and disguises', async () => {
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40, 1)]);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 2)]);
    const ok: [Buffer, string, string][] = [
      [docx, 'Worksheet.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      [png, 'diagram.png', 'image/png'],
      [Buffer.from('Week 1 reading list\n- Al-Fatiha\n'), 'reading.txt', 'text/plain; charset=utf-8'],
    ];
    for (const [data, name, type] of ok) {
      const r = await upload(teacher.token, 'syllabus_item', syllabusId, data, name);
      expect(r.status, name).toBe(201);
      expect(r.body.attachment.contentType).toBe(type);
    }
    const bad: [Buffer, string][] = [
      [Buffer.from('MZ\x90\x00program'), 'setup.exe'],
      [Buffer.from('MZ\x90\x00program'), 'notes.pdf'], // a program renamed to .pdf
      [Buffer.from('<html><script>alert(1)</script></html>'), 'page.html'],
      [Buffer.from('<script>alert(1)</script>'), 'notes.txt'], // HTML disguised as text
      [docx, 'archive.zip'], // a zip that isn't an Office file
      [Buffer.alloc(0), 'empty.pdf'],
    ];
    for (const [data, name] of bad) {
      const r = await upload(teacher.token, 'syllabus_item', syllabusId, data, name);
      expect(r.status, name).toBe(400);
    }
    const items = (await student.api.get(`/classes/${classId}/syllabus`)).body.items;
    expect(items[0].attachments).toHaveLength(3);
  });

  it('downloads Office files rather than opening them in the browser', async () => {
    const att = (await student.api.get(`/classes/${classId}/syllabus`)).body.items[0].attachments.find((a: any) => a.title === 'Worksheet.docx');
    const file = await fetchSigned((await student.api.get(`/attachments/${att.id}/open`)).body.url);
    expect(String(file.headers['content-disposition'])).toMatch(/^attachment; filename="Worksheet.docx"/);
  });

  it('refuses files over 25 MB', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(25 * 1024 * 1024 + 10)]);
    const r = await upload(teacher.token, 'announcement', announcementId, big, 'huge.pdf');
    expect(r.status).toBe(413);
  });

  it('attaches links: http(s) only, titled by site when no title is given', async () => {
    const r = await teacher.api.post('/attachments/link', { targetKind: 'syllabus_item', targetId: syllabusId, url: 'https://www.example.org/quran/1' });
    expect(r.status).toBe(201);
    expect(r.body.attachment).toMatchObject({ kind: 'link', title: 'example.org', url: 'https://www.example.org/quran/1' });
    const named = await teacher.api.post('/attachments/link', { targetKind: 'syllabus_item', targetId: syllabusId, url: 'http://example.com', title: 'Tafsir video' });
    expect(named.body.attachment.title).toBe('Tafsir video');
    for (const url of ['javascript:alert(1)', 'ftp://example.org/file', 'not a url', 'data:text/html,hi']) {
      expect((await teacher.api.post('/attachments/link', { targetKind: 'syllabus_item', targetId: syllabusId, url })).status, url).toBe(400);
    }
    const open = await observer.api.get(`/attachments/${r.body.attachment.id}/open`);
    expect(open.body.url).toBe('https://www.example.org/quran/1');
  });

  it('removing an attachment, or deleting its posting, takes it away', async () => {
    const opened = (await student.api.get(`/attachments/${pdfId}/open`)).body.url;
    expect((await teacher.api.del(`/attachments/${pdfId}`)).status).toBe(204);
    expect((await student.api.get(`/attachments/${pdfId}/open`)).status).toBe(404);
    expect((await fetchSigned(opened)).statusCode).toBe(404); // even a link handed out earlier

    const again = await upload(teacher.token, 'announcement', announcementId, PDF, 'again.pdf');
    const link = (await student.api.get(`/attachments/${again.body.attachment.id}/open`)).body.url;
    await teacher.api.del(`/announcements/${announcementId}`);
    expect((await fetchSigned(link)).statusCode).toBe(404);
    expect((await student.api.get(`/attachments/${again.body.attachment.id}/open`)).status).toBe(404);
  });
});

describe('attachments on messages, DMs, Q&A and discussions', () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
  let other: U;
  let channelId: string;

  beforeAll(async () => {
    other = await register(app, 'Classmate');
    const code = (await teacher.api.get(`/classes/${classId}`)).body.class.joinCode;
    await other.api.post('/classes/join', { code });
    channelId = (await teacher.api.get(`/classes/${classId}`)).body.class.channelId;
  });

  it('authors attach images, files and links to their own chat messages; everyone in the chat sees them', async () => {
    const msg = (await student.api.post(`/channels/${channelId}/messages`, { body: 'Here are my notes' })).body.message;
    expect(msg.attachments).toEqual([]);
    const img = await upload(student.token, 'message', msg.id, PNG, 'board.png');
    expect(img.status).toBe(201);
    expect(img.body.attachment.previewUrl).toMatch(/\/files\/.+\?exp=\d+&sig=/);
    expect((await student.api.post('/attachments/link', { targetKind: 'message', targetId: msg.id, url: 'https://example.org/notes' })).status).toBe(201);

    const history = (await observer.api.get(`/channels/${channelId}/messages`)).body.messages;
    const seen = history.find((m: any) => m.id === msg.id);
    expect(seen.attachments.map((a: any) => a.kind)).toEqual(['file', 'link']);
    // The inline preview is a working signed link.
    const preview = await fetchSigned(seen.attachments[0].previewUrl);
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toBe('image/png');
  });

  it('nobody attaches to someone else’s message, and observers can’t attach at all', async () => {
    const msg = (await student.api.post(`/channels/${channelId}/messages`, { body: 'mine' })).body.message;
    expect((await upload(other.token, 'message', msg.id, PDF, 'x.pdf')).status).toBe(403);
    expect((await teacher.api.post('/attachments/link', { targetKind: 'message', targetId: msg.id, url: 'https://example.org' })).status).toBe(403);
    // An observer can't post, so has nothing of their own; and can't attach to others'.
    expect((await upload(observer.token, 'message', msg.id, PDF, 'x.pdf')).status).toBe(403);
  });

  it('DM files are only for the two people in the DM', async () => {
    const dm = (await student.api.post('/dm', { userId: teacher.id })).body.channelId;
    const msg = (await student.api.post(`/channels/${dm}/messages`, { body: 'Private question' })).body.message;
    const f = await upload(student.token, 'message', msg.id, PDF, 'private.pdf');
    expect(f.status).toBe(201);
    expect((await teacher.api.get(`/attachments/${f.body.attachment.id}/open`)).status).toBe(200);
    expect((await other.api.get(`/attachments/${f.body.attachment.id}/open`)).status).toBe(404);
    expect((await outsider.api.get(`/attachments/${f.body.attachment.id}/open`)).status).toBe(404);
  });

  it('questions and answers carry attachments from their authors', async () => {
    const q = (await student.api.post(`/classes/${classId}/questions`, { title: 'Which tafsir should I read?' })).body.question;
    expect((await upload(student.token, 'question', q.id, PNG, 'page.png')).status).toBe(201);
    const posted = await other.api.post(`/questions/${q.id}/answers`, { body: 'Try this one' });
    expect(posted.body.answerId).toBeTruthy();
    expect((await other.api.post('/attachments/link', { targetKind: 'answer', targetId: posted.body.answerId, url: 'https://example.org/tafsir' })).status).toBe(201);
    expect((await student.api.post('/attachments/link', { targetKind: 'answer', targetId: posted.body.answerId, url: 'https://example.org' })).status).toBe(403);

    const full = (await observer.api.get(`/questions/${q.id}`)).body.question;
    expect(full.attachments.map((a: any) => a.title)).toEqual(['page.png']);
    expect(full.answers[0].attachments.map((a: any) => a.title)).toEqual(['example.org']);
  });

  it('discussion topics and replies carry attachments from their authors', async () => {
    const t = (await student.api.post(`/classes/${classId}/topics`, { title: 'Study group notes' })).body.topic;
    expect((await upload(student.token, 'topic', t.id, PDF, 'notes.pdf')).status).toBe(201);
    const reply = await other.api.post(`/topics/${t.id}/posts`, { body: 'Mine too' });
    expect(reply.body.postId).toBeTruthy();
    expect((await upload(other.token, 'post', reply.body.postId, PNG, 'mine.png')).status).toBe(201);
    expect((await upload(student.token, 'post', reply.body.postId, PNG, 'not-mine.png')).status).toBe(403);

    const full = (await teacher.api.get(`/topics/${t.id}`)).body.topic;
    expect(full.attachments.map((a: any) => a.title)).toEqual(['notes.pdf']);
    expect(full.posts[0].attachments.map((a: any) => a.title)).toEqual(['mine.png']);
  });

  it('the uploader or class staff can remove an attachment; other students can’t', async () => {
    const msg = (await student.api.post(`/channels/${channelId}/messages`, { body: 'two files' })).body.message;
    const a = (await upload(student.token, 'message', msg.id, PDF, 'a.pdf')).body.attachment;
    const b = (await upload(student.token, 'message', msg.id, PDF, 'b.pdf')).body.attachment;
    expect((await other.api.del(`/attachments/${a.id}`)).status).toBe(403);
    expect((await student.api.del(`/attachments/${a.id}`)).status).toBe(204);
    expect((await teacher.api.del(`/attachments/${b.id}`)).status).toBe(204); // moderation
  });

  it('deleting a message takes its files with it', async () => {
    const msg = (await student.api.post(`/channels/${channelId}/messages`, { body: 'oops' })).body.message;
    const a = (await upload(student.token, 'message', msg.id, PDF, 'oops.pdf')).body.attachment;
    const link = (await other.api.get(`/attachments/${a.id}/open`)).body.url;
    expect((await student.api.del(`/messages/${msg.id}`)).status).toBe(204);
    expect((await other.api.get(`/attachments/${a.id}/open`)).status).toBe(404);
    expect((await fetchSigned(link)).statusCode).toBe(404);
  });
});
