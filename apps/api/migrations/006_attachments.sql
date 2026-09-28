-- Resources attached to postings: uploaded files (PDF, Office documents, images, text) and links.
-- Class-private: files are served only through short-lived signed links (see routes/attachments.ts).
CREATE TYPE attachment_target AS ENUM ('announcement', 'syllabus_item');
CREATE TYPE attachment_kind AS ENUM ('file', 'link');

CREATE TABLE attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id      uuid NOT NULL REFERENCES classes(id),
  target_kind   attachment_target NOT NULL,
  target_id     uuid NOT NULL,
  kind          attachment_kind NOT NULL,
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  url           text CHECK (url IS NULL OR length(url) <= 2000),   -- links
  storage_key   text,                                              -- files
  content_type  text,
  size_bytes    integer,
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CHECK ((kind = 'link' AND url IS NOT NULL AND storage_key IS NULL)
      OR (kind = 'file' AND storage_key IS NOT NULL AND url IS NULL))
);
CREATE INDEX attachments_target_idx ON attachments(target_kind, target_id) WHERE deleted_at IS NULL;
