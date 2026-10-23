-- Sign-in timeouts (decided 2026-10-23): signed out after 15 minutes without activity for township staff, admins
-- and HQ, 30 minutes for everyone else, never for guards and guardhouse staff during their shift, and after 12 hours
-- at most for everyone.
--
-- last_seen_at changes with any request, including screens that refresh themselves every few seconds, so it cannot
-- tell whether a person is there. last_active_at changes only when they act: sign in, tap, type or scroll.

ALTER TABLE sessions ADD COLUMN last_active_at timestamptz;
UPDATE sessions SET last_active_at = last_seen_at;
ALTER TABLE sessions ALTER COLUMN last_active_at SET NOT NULL;
ALTER TABLE sessions ALTER COLUMN last_active_at SET DEFAULT now();

-- Sign-ins made under the old 7-day rule end 12 hours after they began.
UPDATE sessions SET expires_at = created_at + interval '12 hours' WHERE expires_at > created_at + interval '12 hours';
