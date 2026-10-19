-- Komuniti moderation. Reports are now kept after a decision instead of being
-- deleted, so staff can see a post's history and a resident's record. Only
-- OPEN reports count towards hiding a post.
--
--   OPEN       waiting for staff
--   UPHELD     staff removed the post
--   DISMISSED  staff looked and kept the post
--
-- Township admins and HQ can also stop a resident from posting or responding
-- in Komuniti for a while. Lifting a suspension deletes the row; the audit
-- trail keeps the history.

ALTER TABLE post_flags
  ADD COLUMN category text NOT NULL DEFAULT 'OTHER' CHECK (category IN ('SCAM', 'UNSAFE', 'OFFENSIVE', 'SPAM', 'OTHER')),
  ADD COLUMN status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'UPHELD', 'DISMISSED')),
  ADD COLUMN reviewed_by uuid REFERENCES users (id),
  ADD COLUMN reviewed_at timestamptz,
  ALTER COLUMN reason DROP NOT NULL;
CREATE INDEX post_flags_open_idx ON post_flags (post_id) WHERE status = 'OPEN';

ALTER TABLE posts
  ADD COLUMN moderated_by uuid REFERENCES users (id),
  ADD COLUMN moderated_at timestamptz,
  ADD COLUMN moderation_note text;

CREATE TABLE komuniti_suspensions (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  township_id uuid NOT NULL REFERENCES townships (id),
  until timestamptz NOT NULL,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
