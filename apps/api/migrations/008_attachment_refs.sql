-- Attachments placed inside the text of a posting. The writer's app gives each attachment a short
-- reference when it queues it and writes ![title](attachment:<ref>) where it goes in the text;
-- the reference is only looked up among that posting's own attachments.
ALTER TABLE attachments ADD COLUMN ref text CHECK (ref ~ '^[A-Za-z0-9_-]{1,32}$');
CREATE UNIQUE INDEX attachments_ref_uniq ON attachments (target_kind, target_id, ref)
  WHERE ref IS NOT NULL AND deleted_at IS NULL;
