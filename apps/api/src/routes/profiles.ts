/**
 * Member profiles.
 *
 * Privacy rules (enforced here, not in the app):
 * - You can only see the profile of someone who shares an active class with you.
 * - Email is hidden from classmates unless the member turns on "show email".
 * - Shared classes and activity counts only cover classes you are both in,
 *   so a profile never reveals someone's other classes.
 * - Photos are re-encoded server-side, which strips EXIF data such as GPS location.
 * - Administrators can see every member's profile, including their email.
 */
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { dmAllowed, isAdmin, shareActiveClass } from '../lib/access.js';
import { requireUser, verifyPassword } from '../lib/auth.js';
import { audit, one, query } from '../lib/db.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { isValidKey, keyFromUrl, storage } from '../lib/storage.js';
import { idParam, parse, text } from '../lib/validate.js';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const AVATAR_PX = 512;

const patchBody = z
  .object({
    displayName: text(1, 80),
    bio: z.string().trim().max(500),
    city: z.string().trim().max(80),
    languages: z.array(text(1, 40)).max(10),
    helpWith: z.string().trim().max(200),
    showEmail: z.boolean(),
    allowDms: z.boolean(),
  })
  .partial()
  .strict();

const emailBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

const SELF_COLS = `id, email, display_name AS "displayName", avatar_url AS "avatarUrl", bio, city, languages,
  help_with AS "helpWith", show_email AS "showEmail", allow_dms AS "allowDms",
  EXISTS (SELECT 1 FROM site_roles s WHERE s.user_id = users.id AND s.role = 'admin' AND s.valid_to IS NULL) AS "isAdmin"`;

export default async function profileRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 } });

  /** Your own full profile, including private settings. */
  app.get('/me', async (req) => {
    const userId = await requireUser(req);
    const user = await one(`SELECT ${SELF_COLS} FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId]);
    if (!user) throw notFound('User');
    return { user };
  });

  app.patch('/me', async (req) => {
    const userId = await requireUser(req);
    const b = parse(patchBody, req.body);
    // De-duplicate languages case-insensitively, keeping the first spelling.
    const languages = b.languages
      ? b.languages.filter((l, i, all) => all.findIndex((x) => x.toLowerCase() === l.toLowerCase()) === i)
      : null;
    const user = await one(
      `UPDATE users SET
         display_name = COALESCE($2, display_name), bio = COALESCE($3, bio), city = COALESCE($4, city),
         languages = COALESCE($5, languages), help_with = COALESCE($6, help_with),
         show_email = COALESCE($7, show_email), allow_dms = COALESCE($8, allow_dms), updated_at = now()
       WHERE id = $1 RETURNING ${SELF_COLS}`,
      [userId, b.displayName ?? null, b.bio ?? null, b.city ?? null, languages, b.helpWith ?? null, b.showEmail ?? null, b.allowDms ?? null],
    );
    return { user };
  });

  /** Change your sign-in email. Needs your current password, so a borrowed session can't take over the account. */
  app.put('/me/email', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const userId = await requireUser(req);
    const b = parse(emailBody, req.body);
    const current = await one<{ email: string; password_hash: string }>(
      'SELECT email, password_hash FROM users WHERE id = $1 AND deleted_at IS NULL',
      [userId],
    );
    if (!current) throw notFound('User');
    // 403 rather than 401: the app treats 401 as "signed out".
    if (!(await verifyPassword(current.password_hash, b.password))) throw forbidden('Your password is incorrect', 'wrong_password');
    if (current.email.toLowerCase() === b.email) return { user: await one(`SELECT ${SELF_COLS} FROM users WHERE id = $1`, [userId]) };

    const taken = await one('SELECT 1 FROM users WHERE email = $1 AND id <> $2', [b.email, userId]);
    if (taken) throw conflict('Another account already uses that email', 'email_taken');
    let user;
    try {
      user = await one(`UPDATE users SET email = $2, updated_at = now() WHERE id = $1 RETURNING ${SELF_COLS}`, [userId, b.email]);
    } catch (err: any) {
      if (err.code === '23505') throw conflict('Another account already uses that email', 'email_taken');
      throw err;
    }
    await audit(userId, 'user.email_change', 'user', userId, { from: current.email, to: b.email });
    return { user };
  });

  /** Upload a profile photo (JPEG, PNG, WebP or HEIC). Stored as a 512×512 WebP with metadata removed. */
  app.post('/me/avatar', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const userId = await requireUser(req);
    if (!req.isMultipart()) throw badRequest('Send the photo as multipart/form-data in a field named "file"');

    const file = await req.file();
    if (!file) throw badRequest('No file received');
    let input: Buffer;
    try {
      input = await file.toBuffer();
    } catch {
      throw new HttpError(413, 'too_large', 'Photo must be 8 MB or smaller');
    }

    let output: Buffer;
    try {
      // Decoding by content (not by filename or declared type) rejects anything that isn't really an image.
      const img = sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 });
      const meta = await img.metadata();
      if (!meta.format || !['jpeg', 'png', 'webp', 'heif', 'gif'].includes(meta.format)) throw new Error('format');
      output = await img
        .rotate() // apply EXIF orientation before metadata is dropped
        .resize(AVATAR_PX, AVATAR_PX, { fit: 'cover', position: 'attention' })
        .webp({ quality: 82 })
        .toBuffer(); // sharp drops EXIF/GPS unless asked to keep it
    } catch {
      throw badRequest('That file is not a supported image. Use a JPEG, PNG or WebP photo.', 'invalid_image');
    }

    const key = await storage.put('avatars', 'webp', output);
    const prev = await one('SELECT avatar_url FROM users WHERE id = $1', [userId]);
    const user = await one(`UPDATE users SET avatar_url = $2, updated_at = now() WHERE id = $1 RETURNING ${SELF_COLS}`, [
      userId,
      storage.publicUrl(key),
    ]);
    const oldKey = keyFromUrl(prev?.avatar_url ?? null);
    if (oldKey) await storage.remove(oldKey);
    return { user };
  });

  app.delete('/me/avatar', async (req) => {
    const userId = await requireUser(req);
    const prev = await one('SELECT avatar_url FROM users WHERE id = $1', [userId]);
    const user = await one(`UPDATE users SET avatar_url = NULL, updated_at = now() WHERE id = $1 RETURNING ${SELF_COLS}`, [userId]);
    const oldKey = keyFromUrl(prev?.avatar_url ?? null);
    if (oldKey) await storage.remove(oldKey);
    return { user };
  });

  /** Serve uploaded files. Keys are random 128-bit names, so they're safe to cache forever. */
  app.get('/uploads/*', async (req, reply) => {
    const key = (req.params as { '*': string })['*'];
    if (!isValidKey(key)) throw notFound('File');
    const data = await storage.get(key);
    if (!data) throw notFound('File');
    reply
      .header('content-type', key.endsWith('.webp') ? 'image/webp' : 'application/octet-stream')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('cross-origin-resource-policy', 'cross-origin');
    return data;
  });

  /** Someone's profile, as seen by the caller. */
  app.get('/users/:id/profile', async (req) => {
    const viewerId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const self = id === viewerId;
    const admin = !self && (await isAdmin(viewerId));

    // Classes both people are active in (for yourself: all your classes; for an administrator: all of theirs).
    const shared = await query<{ id: string; title: string; role: string; viewerRole: string }>(
      `SELECT c.id, c.title, them.role, CASE WHEN $3 THEN 'instructor' ELSE me.role END AS "viewerRole"
         FROM enrollments them
         LEFT JOIN enrollments me ON me.class_id = them.class_id AND me.user_id = $2 AND me.valid_to IS NULL
         JOIN classes c ON c.id = them.class_id
        WHERE them.user_id = $1 AND them.valid_to IS NULL AND (me.id IS NOT NULL OR $3)
        ORDER BY c.archived_at NULLS FIRST, c.title`,
      [id, viewerId, admin],
    );
    if (!self && !admin && shared.length === 0) throw notFound('Member'); // don't confirm the account exists

    const u = await one(
      `SELECT id, email, display_name AS "displayName", avatar_url AS "avatarUrl", bio, city, languages,
              help_with AS "helpWith", show_email AS "showEmail", allow_dms AS "allowDms", created_at AS "memberSince"
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!u) throw notFound('Member');

    const classIds = shared.map((c) => c.id);
    const stats = await one(
      `SELECT
         (SELECT count(*)::int FROM questions q
           WHERE q.author_id = $1 AND q.deleted_at IS NULL AND q.class_id = ANY($2::uuid[])) AS "questionsAsked",
         (SELECT count(*)::int FROM answers a JOIN questions q ON q.id = a.question_id
           WHERE a.author_id = $1 AND a.deleted_at IS NULL AND q.deleted_at IS NULL AND q.class_id = ANY($2::uuid[])) AS "answersGiven",
         (SELECT count(*)::int FROM answers a JOIN questions q ON q.accepted_answer_id = a.id
           WHERE a.author_id = $1 AND a.deleted_at IS NULL AND q.deleted_at IS NULL AND q.class_id = ANY($2::uuid[])) AS "answersAccepted",
         (SELECT count(*)::int FROM topics t
           WHERE t.author_id = $1 AND t.deleted_at IS NULL AND t.class_id = ANY($2::uuid[])) AS "topicsStarted"`,
      [id, classIds],
    );

    const canMessage = !self && (await shareActiveClass(viewerId, id)) && (await dmAllowed(viewerId, id));
    return {
      profile: {
        id: u.id,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        bio: u.bio,
        city: u.city,
        languages: u.languages,
        helpWith: u.helpWith,
        email: self || admin || u.showEmail ? u.email : null,
        // Only on your own profile: lets the preview hide what classmates can't see.
        ...(self ? { showEmail: u.showEmail } : {}),
        memberSince: u.memberSince,
        isSelf: self,
        canMessage,
        sharedClasses: shared.map((c) => ({ id: c.id, title: c.title, role: c.role, viewerRole: c.viewerRole })),
        stats,
      },
    };
  });
}
