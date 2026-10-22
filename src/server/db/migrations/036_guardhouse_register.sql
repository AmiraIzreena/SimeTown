-- One guardhouse, one set of rules.
--
-- Parcels a courier leaves straight at the guardhouse (the guard's shelf) now follow the same rules as smart
-- locker parcels that could not go into a home's door: overdue after the collection period, a reminder once a
-- week from then, the guard asked to call after the call period, notes, and never sent back by themselves (only
-- when the household or the courier asks). Every action is kept in the parcel's history, so the guardhouse
-- register can show when a parcel arrived, how long it waited and what was done.

ALTER TABLE parcels
  ADD COLUMN overdue_at timestamptz,
  ADD COLUMN last_reminder_at timestamptz,
  ADD COLUMN call_requested_at timestamptz,
  ADD COLUMN returned_reason text CHECK (returned_reason IS NULL OR length(returned_reason) BETWEEN 3 AND 300);

-- A shelf parcel's history: what happened, when, and who did it.
CREATE TABLE guard_parcel_events (
  id bigserial PRIMARY KEY,
  parcel_id uuid NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('LOGGED', 'REMINDER', 'OVERDUE', 'CALL_REQUESTED', 'NOTE', 'COLLECTED', 'RETURNED', 'PROBLEM')),
  body text CHECK (body IS NULL OR length(body) <= 500),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  at timestamptz NOT NULL
);
CREATE INDEX guard_parcel_events_parcel_idx ON guard_parcel_events (parcel_id, at);

-- Register filters: what is waiting, and what arrived when.
CREATE INDEX parcels_township_status_idx ON parcels (township_id, status, logged_at DESC);

-- The history of parcels already logged, from what their rows record.
INSERT INTO guard_parcel_events (parcel_id, kind, body, actor_id, at)
SELECT id, 'LOGGED', 'Logged at the guardhouse on shelf ' || shelf, logged_by, logged_at FROM parcels;
INSERT INTO guard_parcel_events (parcel_id, kind, body, actor_id, at)
SELECT id, 'REMINDER', 'Reminder sent to the household', NULL, reminded_at FROM parcels WHERE reminded_at IS NOT NULL;
INSERT INTO guard_parcel_events (parcel_id, kind, body, actor_id, at)
SELECT id, 'COLLECTED', CASE WHEN collected_by_name IS NULL THEN 'Handed over against the collection code' ELSE 'Handed over against the collection code to ' || collected_by_name END,
       handed_over_by, collected_at
  FROM parcels WHERE status = 'COLLECTED';
INSERT INTO guard_parcel_events (parcel_id, kind, body, actor_id, at)
SELECT id, 'RETURNED', 'Returned to the courier', handed_over_by, collected_at FROM parcels WHERE status = 'RETURNED' AND collected_at IS NOT NULL;
INSERT INTO guard_parcel_events (parcel_id, kind, body, actor_id, at)
SELECT id, 'PROBLEM', 'The household said this parcel never reached them', NULL, problem_at FROM parcels WHERE problem_at IS NOT NULL;

UPDATE parcels SET last_reminder_at = reminded_at WHERE reminded_at IS NOT NULL;
