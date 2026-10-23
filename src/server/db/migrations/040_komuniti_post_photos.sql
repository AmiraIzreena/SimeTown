-- Komuniti posts may carry one optional photo (events, help requests, items to
-- give or lend). The photo lives in uploads like a Lapor photo. ON DELETE SET NULL
-- lets account deletion remove a resident's uploads without touching their posts.
-- Nullable, so existing posts need no backfill.

ALTER TABLE posts ADD COLUMN photo_id uuid REFERENCES uploads (id) ON DELETE SET NULL;
