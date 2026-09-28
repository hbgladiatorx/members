# Mainstay Classes

A members app for classes: join codes, syllabus, announcements, live group chat and DMs, Q&A, and threaded discussions. One codebase runs on iPhone, Android and the web.

- `apps/api`: the server (Node, Fastify, PostgreSQL, Socket.IO)
- `apps/mobile`: the app (Expo / React Native, runs on iOS, Android and web)
- `CLAUDE.md`: architecture, data model, permissions and the phase plan. Read it before making changes.

## Run it on your computer

You need Node 22 and Docker Desktop.

```bash
# 1. Database
docker run -d --name classes-db -p 5432:5432 \
  -e POSTGRES_DB=classes -e POSTGRES_PASSWORD=devpass postgres:16

# 2. API
cd apps/api
cp .env.example .env
#   set DATABASE_URL=postgres://postgres:devpass@localhost:5432/classes
#   set JWT_SECRET to a long random string (the command is in the file)
npm install
npm run dev            # http://localhost:4000, migrations run automatically

# 3. App (new terminal)
cd apps/mobile
npm install
npx expo start         # press w for web, or scan the QR code with Expo Go on your phone
```

**Testing on your phone:** the phone must be able to reach the API, so set your computer's local network IP first. For example:
`EXPO_PUBLIC_API_URL=http://192.168.1.20:4000 npx expo start`

## Tests

```bash
cd apps/api
createdb classes_test          # or: docker exec classes-db createdb -U postgres classes_test
DATABASE_URL=postgres://postgres:devpass@localhost:5432/classes_test npm test
```

There are 46 integration tests. They run against a real Postgres and cover auth and token rotation, enrollment and roles, the syllabus and announcements, Q&A, discussions, chat permissions, live Socket.IO delivery, and member profiles (privacy rules, DM opt-out, photo upload and metadata stripping).

`apps/mobile/e2e/walkthrough.mjs` drives the web build in a real browser with two users: a teacher and a student. `apps/mobile/e2e/profiles.mjs` does the same for member profiles, with four users.

## Deploy (single server)

1. Point two DNS names at a Lightsail instance, for example `api.classes.example.org` and `classes.example.org`.
2. `cp .env.example .env`, fill in the secrets, then `docker compose up -d --build`.
3. Install `deploy/nginx.conf` and run `certbot --nginx`.
4. For the web app: `cd apps/mobile && EXPO_PUBLIC_API_URL=https://api.classes.example.org npm run export:web`, then copy `dist/` to `/var/www/classes`.
5. For the store apps: `npx eas-cli@latest build --platform all`, then `eas submit`. Start the Apple and Google developer accounts now, because review takes time.
