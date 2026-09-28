-- Member profiles and privacy settings.
ALTER TABLE users
  ADD COLUMN bio        text   NOT NULL DEFAULT '' CHECK (length(bio) <= 500),
  ADD COLUMN city       text   NOT NULL DEFAULT '' CHECK (length(city) <= 80),
  ADD COLUMN languages  text[] NOT NULL DEFAULT '{}' CHECK (cardinality(languages) <= 10),
  ADD COLUMN help_with  text   NOT NULL DEFAULT '' CHECK (length(help_with) <= 200),
  -- Privacy: email is hidden from classmates unless the member opts in.
  ADD COLUMN show_email boolean NOT NULL DEFAULT false,
  -- Privacy: classmates may start DMs unless the member opts out (class staff always can).
  ADD COLUMN allow_dms  boolean NOT NULL DEFAULT true,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
