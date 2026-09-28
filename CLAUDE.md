# Mainstay Classes — build spec

A members app for running classes: enrollment, syllabus and announcements,
group chat and DMs, Q&A, and threaded discussions. Web + iOS + Android.

This file is the source of truth for anyone (human or AI) building on this repo.
Read it before changing architecture.

## Decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Chat privacy | TLS in transit + encrypted disk at rest. **Not** end-to-end. | Instructors need moderation, search, and full history for late joiners. E2E DMs can be added later by reusing the Cimcha/libsignal work, without changing the schema of class spaces. |
| Placement | Standalone app, own database | Ships now. Modeled so it can fold into the Mainstay Platform later (see "Mainstay alignment"). |
| V1 scope | Classes & syllabus, announcements, group chat + DMs, Q&A, discussions | All four were requested for launch. |

## Stack

- **API**: Node 22, TypeScript, Fastify 5, Zod validation, `pg` with hand-written SQL (no ORM).
- **Real-time**: Socket.IO on the same process. Redis adapter switched on when `REDIS_URL` is set, so more than one API process can run behind Nginx.
- **Database**: PostgreSQL 16. Plain SQL migrations in `apps/api/migrations`, applied in order by `npm run migrate`.
- **Auth**: email + password (argon2id). Short-lived JWT access token (15 min) + rotating refresh token stored hashed in `sessions`.
- **Mobile + web client**: Expo (React Native) in `apps/mobile` — one codebase for iOS, Android and web. The bottom bar (Classes / Chats / Profile) is `components/BottomNav.tsx`, drawn by `app/_layout.tsx` under every signed-in screen; the Tabs navigator's own bar is off.
- **Hosting**: one AWS Lightsail instance, Docker Compose (api, postgres, redis) behind Nginx with TLS. No Kubernetes, no microservices.

## Brand (The Mainstay Foundation, Brand Guidelines v2.0, 2021)

The app follows the foundation's brand guide. Tokens live in `apps/mobile/src/lib/theme.ts`; use them, never raw colours.

- **Colours.** Primary: Blue `#226188`, Dark Grey `#6D6E71`, Light Grey `#C7C8CA`. Secondary: Red `#D15046`, Beige `#DAC6B5`, Light Blue `#5E90AA`. In the app: blue for primary actions, links and your own chat bubbles; dark grey for secondary text; red for unread badges and pins (darkened to `#B8433A` for error text so it stays readable); beige (lightened) for highlighted cards and the Teacher badge.
- **Font.** Open Sans (Regular, SemiBold, Bold), loaded in `app/_layout.tsx`. Use `Text` from `src/components/Text.tsx`, not React Native's, so `fontWeight` maps to the right Open Sans face on iOS and Android. The guide's headline face (Go Bold) isn't licensed for apps, so headlines use Open Sans Bold.
- **Logo.** `apps/mobile/assets/logo-horizontal.png`, `logo-stacked.png` and `logo-mark.png` (the round icon), shown through the `Logo` component. Keep the aspect ratio; minimum widths are about 84 px horizontal, 52 px stacked, 30 px icon. Leave clear space around it. Don't stretch, tilt, outline or recolour it, don't add a tagline to it, and don't show the word mark without the icon. App icons (`icon.png`, the Android adaptive icon set, favicon, splash) are all made from the round mark. The guide itself and full-resolution logo files (cut from its vector artwork) are in `docs/brand/`.

## Repo layout

```
apps/api        Fastify API + Socket.IO + migrations + integration tests
apps/mobile     Expo app (iOS / Android / web)
docker-compose.yml
```

## Data model

Roles are **data**, not tables, and are **time-bounded**: an enrollment has
`valid_from` / `valid_to`. Removing someone sets `valid_to`; nothing is hard-deleted.
Content rows use `deleted_at` (soft delete).

| Table | Purpose |
|---|---|
| `users` | People. Email is unique (case-insensitive). Profile: photo, bio, city, country (ISO code), postal code, languages, "can help with". Privacy: `show_email` (default off), `allow_dms` (default on). `must_change_password` is set on accounts an administrator created or reset. |
| `sessions` | Refresh tokens (hashed), rotation and revocation. |
| `classes` | A class. Has a rotating `join_code`. |
| `enrollments` | user × class × role (`instructor`, `assistant`, `student`, `observer`), time-bounded. |
| `site_roles` | Site-wide roles (`admin`), time-bounded like enrollments. Revoking sets `valid_to`. |
| `syllabus_items` | Ordered syllabus entries, markdown body, draft/published. |
| `announcements` | Instructor posts to the class, can be pinned. |
| `channels` | `class` (whole-class group, access derived from enrollment), `group` (explicit members inside a class), `dm` (two people who share a class). |
| `channel_members` | Explicit membership for `group` and `dm` channels. |
| `channel_reads` | Per-user read marker for unread counts. |
| `messages` | Chat messages, optional reply-to, edit + soft delete. |
| `questions`, `answers` | Q&A. One accepted answer per question. |
| `votes` | Up/down votes on questions and answers (one per user per target). |
| `topics`, `posts` | Threaded discussions. Topics can be pinned/locked. Posts can reply to posts. |
| `audit_log` | Who did what, for moderation and admin actions. |

## Roles and permissions

Five roles. The app shows the names on the left; the API and database use the names in brackets.

- **Administrator** (`site_roles.role = 'admin'`, site-wide): can do everything. Acts as a Teacher in every class (even without being enrolled), sees every class, can view any profile and message anyone, and grants or revokes the administrator role. There is always at least one. The first is made on the server: `npm run admin -- grant <email>` (in production `docker compose exec api npm run admin -- grant <email>`). Administrators do **not** get access to other people's direct messages.
  Administrators manage people from Profile → Manage people: **Add user** (name, email, optional class and role,
  optional administrator) creates the account with a temporary password shown once to pass on; if the email already
  has an account, that person is added to the class instead. **Reset password** gives a new temporary password and
  signs the person out everywhere. Someone with a temporary password must choose their own before using the app.
- **Teacher** (`instructor`): administers a class.
- **Teacher Assistant** (`assistant`): helps administer a class.
- **Student** (`student`): takes part in the class. Joining with a code always makes you a student.
- **Observer** (`observer`): sees what a student sees but cannot do anything else. A Teacher sets it from the Members list.

| Action | Teacher | Assistant | Student | Observer |
|---|---|---|---|---|
| Edit class, rotate join code, change roles, remove members | ✓ | | | |
| Create/edit syllabus, post announcements, create group channels | ✓ | ✓ | | |
| See draft syllabus items, see the join code | ✓ | ✓ | | |
| Pin/lock topics, delete anyone's content | ✓ | ✓ | | |
| Read syllabus, announcements, Q&A, discussions, class chat, members | ✓ | ✓ | ✓ | ✓ |
| Chat, ask/answer, vote, start topics, reply | ✓ | ✓ | ✓ | |
| Accept an answer | ✓ | ✓ | question author | |
| DM another member | ✓ | ✓ | ✓ (must share an active class, and the member allows DMs) | (never; nor can others DM an observer through that class) |
| View a member's profile | ✓ | ✓ | ✓ (must share an active class) | ✓ (must share an active class) |
| Leave the class | ✓ (not the last teacher) | ✓ | ✓ | ✓ |

Every check happens server-side in `src/lib/access.ts`. The client only hides buttons.
`requireClassRole` lets participants through by default and **not** observers: a route must pass
`MEMBERS` explicitly to be readable by observers, so a forgotten route fails closed.

## API conventions

- JSON over HTTPS, `Authorization: Bearer <access token>`.
- Errors: `{ "error": { "code": "not_found", "message": "..." } }` with matching HTTP status.
- Cursor pagination on chat: `GET /channels/:id/messages?before=<messageId>&limit=50`.
- Socket.IO: connect with `auth: { token }`. Client events: `message:send` (with ack), `typing`, `read`. Server events: `message:new`, `message:updated`, `message:deleted`, `typing`.

## Member profiles & privacy

- A profile is visible only to people who share an active class with that member; everyone else gets 404, as if the account didn't exist.
- "Classes together" and activity counts (questions, answers, accepted answers, discussions) cover only classes both people are in, so a profile never reveals someone's other classes.
- Email is hidden from classmates unless the member turns on "show email".
- Location: city (free text), country (picked from `GET /countries`, the single source for the list; the server refuses anything else) and postal code. City and country show on the profile; the postal code is private to the member and administrators. The country list is ISO 3166-1 plus Kosovo, **excluding South Africa, North Korea, Israel, Greenland and Chile** (`apps/api/src/lib/countries.ts`).
- A member can turn off direct messages from classmates; class staff can still message them.
- A member can change their sign-in email (`PUT /me/email`) and password (`PUT /me/password`) from Profile → Account. Both need their current password; an email another account uses is refused.
- Photos: uploaded to `POST /me/avatar` (8 MB max), decoded by content (a renamed non-image is rejected), re-encoded to a 512×512 WebP, which strips EXIF data including GPS location. The old file is deleted on replace.
- Storage: `src/lib/storage.ts` has a local-disk driver (Docker volume `uploads`, include it in backups). It sits behind an interface so an S3 driver can be dropped in later. Photo URLs are random 128-bit names served publicly (needed for `<img>` tags); treat a profile photo as visible to anyone who has its link.

## Security baseline

- argon2id password hashing; refresh tokens stored as SHA-256 hashes; reuse of a revoked refresh token revokes the session family.
- Rate limiting on auth routes.
- All input validated with Zod; all SQL parameterised.
- Helmet-equivalent headers, CORS restricted by `CORS_ORIGIN`.
- Secrets only via environment variables (`.env.example` lists them).
- Nightly `pg_dump` to S3 (deployment phase).
- Known v1 trade-off: on the **web** build the refresh token lives in localStorage (mobile uses the device keychain). Move web to an httpOnly cookie before a public web launch.
- Socket connections authenticate at connect time; a socket stays open after its access token expires until it reconnects. Removal from a class takes effect immediately regardless (rooms are left server-side).

## Phases

1. **Foundation** ✅ schema, auth, classes, enrollment, syllabus, announcements, Q&A, discussions, chat REST + Socket.IO, 30 integration tests (46 with profiles).
2. **Client** ✅ Expo app: sign in, class list, join/create, class home (syllabus, announcements), class chat, DMs, groups, Q&A, discussions, members/roles. Verified end-to-end in a browser with two users.
2b. **Member profiles** ✅ photo upload, bio/details, privacy settings, member profile page linked from members, chat, Q&A and discussions. 46 API tests; browser walk-through with four users.
2c. **Roles** ✅ Administrator (site-wide) and Observer (read-only, per class) added; Teacher / Teacher Assistant names in the app. 71 API tests (with email/password change, adding people and location); browser walk-throughs `e2e/roles.mjs` and `e2e/add-user.mjs`.
3. **Notifications**: Expo push tokens, notification outbox table + BullMQ worker; email for announcements.
4. **Media**: attachments for chat, syllabus, and posts (reuse `storage.ts`; profile photos already use it).
5. **Admin & polish**: search, moderation queue, Arabic/RTL UI, invite by email, export.
6. **Deploy**: Docker Compose on Lightsail, Nginx + TLS, backups, app store submission (start store accounts and review in parallel with phase 2).

## Mainstay alignment (for later merge)

- `users` maps to a Party; `enrollments` and `site_roles` are Role rows (time-bounded, soft-ended).
- IDs are UUIDs so records can be copied into the Mainstay database without collisions.
- No module writes into another module's tables except through service functions.
