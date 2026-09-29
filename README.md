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

There are 87 integration tests. They run against a real Postgres and cover auth and token rotation, enrollment and roles, the syllabus and announcements, Q&A, discussions, chat permissions, live Socket.IO delivery, member profiles (privacy rules, DM opt-out, photo upload and metadata stripping), and roles (observers are read-only everywhere, administrators act as teachers in every class).

`apps/mobile/e2e/walkthrough.mjs` drives the web build in a real browser with two users: a teacher and a student. `apps/mobile/e2e/profiles.mjs` does the same for member profiles, with four users. `apps/mobile/e2e/attachments.mjs` covers the date picker and files and links on postings. `apps/mobile/e2e/attachments-everywhere.mjs` covers photos, files and links in chat, Q&A and discussions. `apps/mobile/e2e/add-user.mjs` covers an administrator adding a person and resetting their password. `apps/mobile/e2e/roles.mjs` covers roles: an observer, a teacher and an administrator (it needs `DATABASE_URL` set, because it makes the administrator with the server command).

## Deploy: members.cimcha.com (single server)

The web app and the API share one domain: the app at `https://members.cimcha.com`, the API under `/api` (live chat at `/api/socket.io/`, photos at `/api/uploads/`). See `deploy/nginx.conf`.

**One-time server setup** (Ubuntu, e.g. an AWS Lightsail instance with a static IP):

1. In DNS, point an `A` record for `members.cimcha.com` at the server's IP. Open ports 80 and 443 in the firewall.
2. Install the tools:
   ```bash
   curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER   # log out and back in
   sudo apt-get install -y nginx certbot python3-certbot-nginx rsync git
   ```
3. Get the code and set the secrets:
   ```bash
   git clone https://github.com/hbgladiatorx/members.git && cd members
   cp .env.example .env
   # fill in POSTGRES_PASSWORD and JWT_SECRET (the command to generate one is in the file)
   ```
4. `CERT_EMAIL=you@example.org ./deploy/deploy.sh`. On the first run it also gets the Let's Encrypt certificate. It writes the Nginx config itself every run, so don't run `certbot --nginx` (that edits the config and can cause a redirect loop).

**First administrator:** sign up in the app, then on the server run
`docker compose exec api npm run admin -- grant you@example.org`. After that, administrators add people, reset passwords and choose other administrators from Profile → Manage people.

**Updates:** `git pull && ./deploy/deploy.sh`. The database and photos live in Docker volumes and are kept; include both in backups.

**Store apps:** build with `EXPO_PUBLIC_API_URL=https://members.cimcha.com/api npx eas-cli@latest build --platform all`, then `eas submit`. Start the Apple and Google developer accounts now, because review takes time.
