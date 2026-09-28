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
- **Mobile + web client**: Expo (React Native) in `apps/mobile` — one codebase for iOS, Android and web.
- **Hosting**: one AWS Lightsail instance, Docker Compose (api, postgres, redis) behind Nginx with TLS. No Kubernetes, no microservices.

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
| `users` | People. Email is unique (case-insensitive). |
| `sessions` | Refresh tokens (hashed), rotation and revocation. |
| `classes` | A class. Has a rotating `join_code`. |
| `enrollments` | user × class × role (`instructor`, `assistant`, `student`), time-bounded. |
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

## Permissions

| Action | Instructor | Assistant | Student |
|---|---|---|---|
| Edit class, rotate join code, change roles, remove members | ✓ | | |
| Create/edit syllabus, post announcements, create group channels | ✓ | ✓ | |
| See draft syllabus items | ✓ | ✓ | |
| Pin/lock topics, delete anyone's content | ✓ | ✓ | |
| Chat, ask/answer, vote, start topics, reply | ✓ | ✓ | ✓ |
| Accept an answer | ✓ | ✓ | question author |
| DM another member | ✓ | ✓ | ✓ (must share an active class) |

Every check happens server-side in `src/lib/access.ts`. The client only hides buttons.

## API conventions

- JSON over HTTPS, `Authorization: Bearer <access token>`.
- Errors: `{ "error": { "code": "not_found", "message": "..." } }` with matching HTTP status.
- Cursor pagination on chat: `GET /channels/:id/messages?before=<messageId>&limit=50`.
- Socket.IO: connect with `auth: { token }`. Client events: `message:send` (with ack), `typing`, `read`. Server events: `message:new`, `message:updated`, `message:deleted`, `typing`.

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

1. **Foundation** ✅ schema, auth, classes, enrollment, syllabus, announcements, Q&A, discussions, chat REST + Socket.IO, 30 integration tests.
2. **Client** ✅ Expo app: sign in, class list, join/create, class home (syllabus, announcements), class chat, DMs, groups, Q&A, discussions, members/roles. Verified end-to-end in a browser with two users.
3. **Notifications**: Expo push tokens, notification outbox table + BullMQ worker; email for announcements.
4. **Media**: attachments (S3 presigned uploads) for chat, syllabus, and posts.
5. **Admin & polish**: search, moderation queue, Arabic/RTL UI, invite by email, export.
6. **Deploy**: Docker Compose on Lightsail, Nginx + TLS, backups, app store submission (start store accounts and review in parallel with phase 2).

## Mainstay alignment (for later merge)

- `users` maps to a Party; `enrollments` are Role rows (time-bounded, soft-ended).
- IDs are UUIDs so records can be copied into the Mainstay database without collisions.
- No module writes into another module's tables except through service functions.
