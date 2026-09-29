-- Attachments on every kind of posting, not just announcements and syllabus items.
ALTER TYPE attachment_target ADD VALUE IF NOT EXISTS 'message';
ALTER TYPE attachment_target ADD VALUE IF NOT EXISTS 'question';
ALTER TYPE attachment_target ADD VALUE IF NOT EXISTS 'answer';
ALTER TYPE attachment_target ADD VALUE IF NOT EXISTS 'topic';
ALTER TYPE attachment_target ADD VALUE IF NOT EXISTS 'post';
-- Direct messages don't belong to a class.
ALTER TABLE attachments ALTER COLUMN class_id DROP NOT NULL;
