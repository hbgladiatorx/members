-- Accounts an administrator creates get a temporary password, and must choose
-- their own the first time they sign in. Also set after an admin password reset.
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
