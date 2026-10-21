-- Gerak (township loops) gets its own notification category, beside Kitar (stored as RECYCLING).
-- Residents are told when they complete a loop; older notifications that point at Gerak move into it.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notification_category_check;
ALTER TABLE notifications ADD CONSTRAINT notification_category_check CHECK
  (category IN ('PARCELS', 'SERVICES', 'COMMUNITY', 'REWARDS', 'REPORTS', 'RECYCLING', 'GERAK', 'ALERTS', 'ACCOUNT'));
UPDATE notifications SET category = 'GERAK' WHERE link LIKE '/app/gerak%';
