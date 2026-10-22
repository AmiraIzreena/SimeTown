-- Private locker doors and the guardhouse parcel counter.
--
-- Every home has its own door in the locker bank that serves its precinct, so a parcel waiting in it blocks
-- nobody and never has to be moved: there is no collection deadline and no move to storage. A parcel that cannot
-- go into the home's door (too big, the door already holds one, the door is out of use) goes to the parcel
-- counter at the guardhouse, which keeps opening hours. A parcel at the counter is never sent back by itself:
-- after the collection period it is overdue, the household is reminded once a week, the guard is asked to call,
-- and the days it waited are kept in its history. No fees are charged.

-- --- Doors that belong to a home ----------------------------------------------------------------
ALTER TABLE locker_compartments ADD COLUMN IF NOT EXISTS home_id uuid REFERENCES homes (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS locker_compartments_home_idx ON locker_compartments (home_id) WHERE home_id IS NOT NULL;

-- The precincts a locker bank serves. A home's first parcel claims a free door only at its own precinct's bank.
ALTER TABLE locker_stations ADD COLUMN IF NOT EXISTS precincts text[] NOT NULL DEFAULT '{}';
UPDATE locker_stations SET precincts = ARRAY['Elmina Valley 1', 'Elmina Valley 2', 'Elmina Valley 3']
 WHERE name = 'Elmina Valley Locker A' AND precincts = '{}';
UPDATE locker_stations SET precincts = ARRAY['Elmina Gardens'] WHERE name = 'Elmina Gardens Locker B' AND precincts = '{}';

-- A home's door is at least medium.
UPDATE locker_compartments SET size = 'M', width_mm = 420, height_mm = 220, depth_mm = 500 WHERE size = 'S';

-- --- The parcel counter keeps opening hours ----------------------------------------------------
ALTER TABLE overflow_locations ADD COLUMN IF NOT EXISTS open_from_hour smallint NOT NULL DEFAULT 8 CHECK (open_from_hour BETWEEN 0 AND 23);
ALTER TABLE overflow_locations ADD COLUMN IF NOT EXISTS open_to_hour smallint NOT NULL DEFAULT 22 CHECK (open_to_hour BETWEEN 1 AND 24);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'overflow_locations_hours_order') THEN
    ALTER TABLE overflow_locations ADD CONSTRAINT overflow_locations_hours_order CHECK (open_from_hour < open_to_hour);
  END IF;
END $$;
ALTER TABLE overflow_locations ALTER COLUMN capacity SET DEFAULT 100;

-- The demo had two counters. The guardhouse becomes the one parcel counter: when the unused guardhouse row holds
-- nothing, the township office row (which holds the parcels and their pickup codes) becomes the guardhouse, so
-- every existing pickup code keeps working. If both are in use, the office is only closed.
DO $$
DECLARE
  office record;
  guardhouse uuid;
BEGIN
  FOR office IN SELECT id, township_id FROM overflow_locations WHERE name = 'Township office parcel counter' LOOP
    SELECT id INTO guardhouse FROM overflow_locations WHERE township_id = office.township_id AND name = 'Main guardhouse counter';
    IF guardhouse IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM locker_parcels WHERE overflow_location_id = guardhouse)
       AND NOT EXISTS (SELECT 1 FROM relocation_tasks WHERE destination_id = guardhouse)
       AND NOT EXISTS (SELECT 1 FROM pickup_credentials WHERE location_id = guardhouse)
       AND NOT EXISTS (SELECT 1 FROM pickup_attempts WHERE location_id = guardhouse)
       AND NOT EXISTS (SELECT 1 FROM pickup_lockouts WHERE location_id = guardhouse) THEN
      DELETE FROM overflow_locations WHERE id = guardhouse;
      guardhouse := NULL;
    END IF;
    IF guardhouse IS NULL THEN
      UPDATE overflow_locations SET name = 'Main guardhouse' WHERE id = office.id;
    ELSE
      UPDATE overflow_locations SET active = false WHERE id = office.id;
    END IF;
  END LOOP;
END $$;
UPDATE overflow_locations
   SET name = 'Main guardhouse', kind = 'COUNTER', location = 'Elmina Valley main guardhouse', hours = 'Open daily, 8:00 am – 10:00 pm',
       instructions = 'Show your pickup code and your IC or passport to the guard on duty.',
       capacity = GREATEST(capacity, 100), accepts_deliveries = true, active = true, open_from_hour = 8, open_to_hour = 22
 WHERE name IN ('Main guardhouse', 'Main guardhouse counter');

-- --- Policy: reminders for doors and the counter; no fees ------------------------------------------
ALTER TABLE collection_policies ADD COLUMN IF NOT EXISTS door_reminder_hours integer NOT NULL DEFAULT 48 CHECK (door_reminder_hours > 0);
ALTER TABLE collection_policies ADD COLUMN IF NOT EXISTS counter_call_after_days integer NOT NULL DEFAULT 14 CHECK (counter_call_after_days > 0);
UPDATE collection_policies SET fee_enabled = false, fee_sen = NULL, extensions_enabled = false;

-- --- Parcels: why one went to the counter, and how long it has waited -------------------------------
ALTER TABLE locker_parcels ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz;
ALTER TABLE locker_parcels ADD COLUMN IF NOT EXISTS overdue_at timestamptz;
ALTER TABLE locker_parcels ADD COLUMN IF NOT EXISTS call_requested_at timestamptz;
ALTER TABLE locker_parcels ADD COLUMN IF NOT EXISTS delivery_problem text
  CHECK (delivery_problem IN ('TOO_BIG', 'DOOR_FULL', 'DOOR_DID_NOT_OPEN', 'DOOR_DAMAGED', 'PARCEL_DAMAGED', 'NO_DOOR', 'OTHER_STATION', 'COUNTER_CLOSED', 'OTHER'));
ALTER TABLE locker_parcels ADD COLUMN IF NOT EXISTS delivery_problem_note text CHECK (char_length(delivery_problem_note) <= 300);

-- Notes staff and guards add to a parcel's record ("Called the household, collecting on Sunday").
CREATE TABLE IF NOT EXISTS locker_parcel_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id uuid NOT NULL REFERENCES locker_parcels (id) ON DELETE CASCADE,
  author_id uuid REFERENCES users (id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS locker_parcel_notes_parcel_idx ON locker_parcel_notes (parcel_id, created_at);

-- --- Parcels already in the system ---------------------------------------------------------------------
-- Nothing moves out of a door any more: open moves are cancelled, and parcels waiting for one stay in their door.
UPDATE relocation_tasks SET status = 'CANCELLED', failure_reason = 'Lockers now have one door per home: the parcel stays in its door.', completed_at = now()
 WHERE status IN ('OPEN', 'IN_PROGRESS');
INSERT INTO parcel_events (parcel_id, from_state, to_state, actor_id, actor_kind, reason, at)
SELECT id, state, 'READY_FOR_COLLECTION', NULL, 'SYSTEM', 'Lockers became private doors: the parcel stays in its door, with no deadline', now()
  FROM locker_parcels WHERE state IN ('OVERDUE', 'RELOCATION_PENDING', 'RELOCATION_IN_PROGRESS') AND compartment_id IS NOT NULL;
UPDATE locker_parcels SET state = 'READY_FOR_COLLECTION', state_changed_at = now(), deadline_at = NULL
 WHERE state IN ('OVERDUE', 'RELOCATION_PENDING', 'RELOCATION_IN_PROGRESS') AND compartment_id IS NOT NULL;
UPDATE locker_parcels SET resume_state = 'READY_FOR_COLLECTION' WHERE resume_state IN ('OVERDUE', 'RELOCATION_PENDING');
UPDATE locker_parcels SET deadline_at = NULL WHERE compartment_id IS NOT NULL AND state IN ('READY_FOR_COLLECTION', 'COLLECTION_IN_PROGRESS');

-- A parcel the old rules sent back automatically stays at the counter instead (one a staff member chose to send
-- back keeps going back).
WITH auto AS (
  SELECT p.id FROM locker_parcels p
   WHERE p.state = 'RETURN_PENDING'
     AND (SELECT e.actor_kind FROM parcel_events e WHERE e.parcel_id = p.id AND e.to_state = 'RETURN_PENDING' ORDER BY e.id DESC LIMIT 1) = 'SYSTEM'
)
INSERT INTO parcel_events (parcel_id, from_state, to_state, actor_id, actor_kind, reason, at)
SELECT id, 'RETURN_PENDING', 'RELOCATED_TO_STORAGE', NULL, 'SYSTEM', 'Kept at the parcel counter: parcels are no longer sent back automatically', now() FROM auto;
UPDATE locker_parcels p SET state = 'RELOCATED_TO_STORAGE', state_changed_at = now()
 WHERE p.state = 'RETURN_PENDING'
   AND (SELECT e.to_state FROM parcel_events e WHERE e.parcel_id = p.id ORDER BY e.id DESC LIMIT 1) = 'RELOCATED_TO_STORAGE';
