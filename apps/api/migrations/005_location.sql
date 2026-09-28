-- Where a member is: country (ISO 3166-1 alpha-2 code, chosen from GET /countries) and postal code.
-- City already exists (002_profiles). Postal code is private: only the member and administrators see it.
ALTER TABLE users
  ADD COLUMN country     text NOT NULL DEFAULT '' CHECK (country = '' OR country ~ '^[A-Z]{2}$'),
  ADD COLUMN postal_code text NOT NULL DEFAULT '' CHECK (length(postal_code) <= 20);
