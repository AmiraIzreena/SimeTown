ALTER TABLE notifications ADD COLUMN category text NOT NULL DEFAULT 'ACCOUNT';
ALTER TABLE notifications ADD COLUMN dismissed_at timestamptz;
ALTER TABLE notifications ADD CONSTRAINT notification_category_check CHECK
  (category IN ('PARCELS','SERVICES','COMMUNITY','REWARDS','REPORTS','RECYCLING','ALERTS','ACCOUNT'));
UPDATE notifications SET category = CASE
  WHEN link ~ 'parcels|lockers|courier|operations' THEN 'PARCELS'
  WHEN link ~ 'home-services|bookings|services' THEN 'SERVICES'
  WHEN link ~ 'wallet|sales|finance|statements' THEN 'REWARDS'
  WHEN link ~ 'lapor|reports|incidents|requests|assistant' THEN 'REPORTS'
  WHEN link ~ 'jiran|kongsi|moderation' THEN 'COMMUNITY'
  WHEN link ~ 'kitar|recycling' THEN 'RECYCLING'
  WHEN link ~ 'banjir|alerts' THEN 'ALERTS'
  ELSE 'ACCOUNT' END;
-- Preserve existing deduplication while allowing one event to reach every recipient.
UPDATE notifications SET dedupe_key = dedupe_key || ':recipient:' || user_id WHERE dedupe_key IS NOT NULL;
CREATE INDEX notifications_inbox_idx ON notifications (user_id, id DESC) WHERE dismissed_at IS NULL;
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL AND dismissed_at IS NULL;
