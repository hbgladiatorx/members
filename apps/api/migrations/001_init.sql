-- Mainstay Classes — initial schema
-- Conventions: UUID ids, timestamptz everywhere, soft deletes (deleted_at),
-- time-bounded roles (valid_from / valid_to). Nothing user-facing is hard-deleted.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── People & sessions ──────────────────────────────────────────────
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  password_hash text NOT NULL,
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id),
  family_id    uuid NOT NULL,              -- all rotations of one login share a family
  token_hash   text NOT NULL UNIQUE,       -- sha256 of the refresh token
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX sessions_family_idx ON sessions(family_id);

-- ── Classes & enrollment ───────────────────────────────────────────
CREATE TABLE classes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  description  text NOT NULL DEFAULT '',
  join_code    text NOT NULL UNIQUE,
  join_open    boolean NOT NULL DEFAULT true,
  starts_on    date,
  ends_on      date,
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz
);

CREATE TYPE class_role AS ENUM ('instructor', 'assistant', 'student');

CREATE TABLE enrollments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    uuid NOT NULL REFERENCES classes(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  role        class_role NOT NULL,
  valid_from  timestamptz NOT NULL DEFAULT now(),
  valid_to    timestamptz,
  ended_by    uuid REFERENCES users(id)
);
-- At most one *active* enrollment per person per class.
CREATE UNIQUE INDEX enrollments_active_uq ON enrollments(class_id, user_id) WHERE valid_to IS NULL;
CREATE INDEX enrollments_user_idx ON enrollments(user_id) WHERE valid_to IS NULL;

-- ── Class information ──────────────────────────────────────────────
CREATE TABLE syllabus_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    uuid NOT NULL REFERENCES classes(id),
  position    integer NOT NULL DEFAULT 0,
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body        text NOT NULL DEFAULT '',          -- markdown
  due_on      date,
  published   boolean NOT NULL DEFAULT false,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX syllabus_class_idx ON syllabus_items(class_id, position) WHERE deleted_at IS NULL;

CREATE TABLE announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    uuid NOT NULL REFERENCES classes(id),
  author_id   uuid NOT NULL REFERENCES users(id),
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body        text NOT NULL DEFAULT '',
  pinned      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX announcements_class_idx ON announcements(class_id, created_at DESC) WHERE deleted_at IS NULL;

-- ── Chat ───────────────────────────────────────────────────────────
CREATE TYPE channel_kind AS ENUM ('class', 'group', 'dm');

CREATE TABLE channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        channel_kind NOT NULL,
  class_id    uuid REFERENCES classes(id),       -- null only for DMs
  name        text,
  dm_key      text UNIQUE,                       -- "<smaller uuid>:<larger uuid>" for DMs
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK (kind = 'dm' OR class_id IS NOT NULL),
  CHECK (kind <> 'dm' OR dm_key IS NOT NULL)
);
CREATE UNIQUE INDEX channels_one_class_channel ON channels(class_id) WHERE kind = 'class';

-- Explicit membership for 'group' and 'dm'. 'class' access comes from enrollments.
CREATE TABLE channel_members (
  channel_id  uuid NOT NULL REFERENCES channels(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  joined_at   timestamptz NOT NULL DEFAULT now(),
  left_at     timestamptz,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX channel_members_user_idx ON channel_members(user_id) WHERE left_at IS NULL;

CREATE TABLE messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq         bigint GENERATED ALWAYS AS IDENTITY UNIQUE,   -- stable ordering + cursor
  channel_id  uuid NOT NULL REFERENCES channels(id),
  author_id   uuid NOT NULL REFERENCES users(id),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  reply_to_id uuid REFERENCES messages(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz,
  deleted_at  timestamptz
);
CREATE INDEX messages_channel_seq_idx ON messages(channel_id, seq DESC);

CREATE TABLE channel_reads (
  channel_id    uuid NOT NULL REFERENCES channels(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  last_read_seq bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id)
);

-- ── Q&A ────────────────────────────────────────────────────────────
CREATE TABLE questions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id           uuid NOT NULL REFERENCES classes(id),
  author_id          uuid NOT NULL REFERENCES users(id),
  title              text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  body               text NOT NULL DEFAULT '',
  accepted_answer_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE INDEX questions_class_idx ON questions(class_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE answers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES questions(id),
  author_id   uuid NOT NULL REFERENCES users(id),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX answers_question_idx ON answers(question_id) WHERE deleted_at IS NULL;

ALTER TABLE questions
  ADD CONSTRAINT questions_accepted_fk FOREIGN KEY (accepted_answer_id) REFERENCES answers(id);

CREATE TYPE vote_target AS ENUM ('question', 'answer');

CREATE TABLE votes (
  user_id     uuid NOT NULL REFERENCES users(id),
  target_kind vote_target NOT NULL,
  target_id   uuid NOT NULL,
  value       smallint NOT NULL CHECK (value IN (-1, 1)),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_kind, target_id)
);
CREATE INDEX votes_target_idx ON votes(target_kind, target_id);

-- ── Discussions ────────────────────────────────────────────────────
CREATE TABLE topics (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id         uuid NOT NULL REFERENCES classes(id),
  author_id        uuid NOT NULL REFERENCES users(id),
  title            text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  body             text NOT NULL DEFAULT '',
  pinned           boolean NOT NULL DEFAULT false,
  locked           boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE INDEX topics_class_idx ON topics(class_id, pinned DESC, last_activity_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE posts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id    uuid NOT NULL REFERENCES topics(id),
  parent_id   uuid REFERENCES posts(id),
  author_id   uuid NOT NULL REFERENCES users(id),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz,
  deleted_at  timestamptz
);
CREATE INDEX posts_topic_idx ON posts(topic_id, created_at);

-- ── Audit ──────────────────────────────────────────────────────────
CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id   uuid REFERENCES users(id),
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  uuid,
  data       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_log(entity, entity_id);
