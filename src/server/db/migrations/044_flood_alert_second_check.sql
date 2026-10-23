-- A flood warning shows red only once it has a second check.
--
-- A warning raised on one signal (the duty officer confirming a one-signal draft, or setting the level by hand)
-- still goes out, but residents see it as an unconfirmed warning (amber) until a second check backs it: a second,
-- independent signal agreeing, or a second staff member confirming. Danger is always shown as danger.

ALTER TABLE flood_alerts ADD COLUMN raised_by uuid REFERENCES users (id);
ALTER TABLE flood_alerts ADD COLUMN confirmed_at timestamptz;
ALTER TABLE flood_alerts ADD COLUMN confirmed_by uuid REFERENCES users (id);
ALTER TABLE flood_alerts ADD COLUMN confirmed_how text CHECK (confirmed_how IN ('SIGNALS', 'STAFF'));

-- Alerts so far: danger, and warnings two signals agreed on, count as confirmed. A one-signal warning still open stays amber.
UPDATE flood_alerts a SET confirmed_at = a.started_at, confirmed_how = 'SIGNALS'
 WHERE a.level = 'DANGER'
    OR EXISTS (SELECT 1 FROM flood_messages m WHERE m.zone_id = a.zone_id AND m.kind = 'ALERT' AND m.status = 'SENT'
                AND m.sent_at = a.started_at AND m.decision IN ('TWO_SIGNALS', 'ESCALATED'));
UPDATE flood_alerts a SET raised_by = m.decided_by
  FROM flood_messages m
 WHERE m.zone_id = a.zone_id AND m.kind = 'ALERT' AND m.status = 'SENT' AND m.sent_at = a.started_at AND m.decided_by IS NOT NULL;
