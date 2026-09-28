-- Roles: observers in a class, and site-wide administrators.

-- Observers can read a class like a student but cannot post, answer, vote or chat.
ALTER TYPE class_role ADD VALUE IF NOT EXISTS 'observer';

-- Site-wide roles, time-bounded like enrollments: revoking sets valid_to.
-- An administrator acts as an instructor in every class and manages other admins.
CREATE TYPE site_role AS ENUM ('admin');

CREATE TABLE site_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  role        site_role NOT NULL,
  valid_from  timestamptz NOT NULL DEFAULT now(),
  valid_to    timestamptz,
  granted_by  uuid REFERENCES users(id),   -- null when granted from the server command line
  ended_by    uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX site_roles_active_uq ON site_roles(user_id, role) WHERE valid_to IS NULL;
