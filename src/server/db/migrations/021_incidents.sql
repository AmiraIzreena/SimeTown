-- Central incident management. The smart lockers' incident log becomes the
-- township's one incident table, for lockers, guardhouse parcels, gate access
-- and later modules. Each case has a reference, a responsible party, a
-- priority, one accountable owner, deadlines, a resident-facing outcome and a
-- tamper-evident history. Courier-only problems are not incidents: the
-- resident is sent to the courier, and only a referral is recorded.

ALTER TABLE locker_incidents RENAME TO incidents;
ALTER TABLE incidents DROP CONSTRAINT locker_incidents_kind_check;   -- categories are checked by the rules in code
ALTER TABLE incidents DROP CONSTRAINT locker_incidents_status_check;

CREATE SEQUENCE incident_reference_seq;
ALTER TABLE incidents
  ADD COLUMN reference text UNIQUE DEFAULT ('INC-' || lpad(nextval('incident_reference_seq')::text, 6, '0')),
  ADD COLUMN module text NOT NULL DEFAULT 'LOCKERS' CHECK (module IN ('LOCKERS', 'PARCELS', 'GUARDHOUSE', 'COURIERS', 'FACILITIES', 'COMMUNITY')),
  -- Who must act: the township, both (the township checks its own records), or not yet known (triage).
  ADD COLUMN responsibility text NOT NULL DEFAULT 'TOWNSHIP' CHECK (responsibility IN ('TOWNSHIP', 'MIXED', 'UNCERTAIN')),
  ADD COLUMN priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('CRITICAL', 'HIGH', 'NORMAL', 'LOW')),
  ADD COLUMN description text,                    -- the reporter's own words
  ADD COLUMN home_id uuid REFERENCES homes (id) ON DELETE SET NULL,
  ADD COLUMN guard_parcel_id uuid REFERENCES parcels (id) ON DELETE SET NULL,
  ADD COLUMN owner_id uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN assigned_at timestamptz,
  ADD COLUMN assign_due_at timestamptz,
  ADD COLUMN resolve_due_at timestamptz,
  ADD COLUMN awaiting text CHECK (awaiting IN ('RESIDENT', 'COURIER', 'CONTRACTOR', 'OTHER')),
  ADD COLUMN escalated_at timestamptz,
  ADD COLUMN resolution_category text,
  ADD COLUMN resident_outcome text,               -- what the resident is told; staff notes stay internal
  ADD COLUMN actions_taken text,
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN reopen_count integer NOT NULL DEFAULT 0;

-- Existing records keep their meaning: an acknowledged incident was being looked into by whoever acknowledged it.
UPDATE incidents SET status = 'INVESTIGATING', owner_id = handled_by, assigned_at = updated_at WHERE status = 'ACKNOWLEDGED' AND handled_by IS NOT NULL;
UPDATE incidents SET status = 'OPEN' WHERE status = 'ACKNOWLEDGED';
UPDATE incidents SET resolved_at = updated_at WHERE status = 'RESOLVED';
UPDATE incidents SET priority = CASE severity WHEN 'HIGH' THEN 'HIGH' WHEN 'LOW' THEN 'LOW' ELSE 'NORMAL' END;
UPDATE incidents SET priority = 'CRITICAL' WHERE kind = 'DOOR_FORCED';
UPDATE incidents SET responsibility = 'MIXED' WHERE kind = 'NOT_COLLECTED_BY_ME';
ALTER TABLE incidents ALTER COLUMN reference SET NOT NULL;
ALTER TABLE incidents
  ADD CONSTRAINT incidents_status_check CHECK (status IN ('OPEN', 'ASSIGNED', 'INVESTIGATING', 'AWAITING_EXTERNAL_PARTY', 'RESOLVED', 'REOPENED', 'CLOSED')),
  -- A case being worked on always has exactly one accountable owner.
  ADD CONSTRAINT incidents_owner_check CHECK (status NOT IN ('ASSIGNED', 'INVESTIGATING', 'AWAITING_EXTERNAL_PARTY') OR owner_id IS NOT NULL),
  ADD CONSTRAINT incidents_awaiting_status_check CHECK ((status = 'AWAITING_EXTERNAL_PARTY') = (awaiting IS NOT NULL));
CREATE INDEX incidents_queue_idx ON incidents (township_id, status, priority, assign_due_at);
CREATE INDEX incidents_owner_idx ON incidents (owner_id, status);
CREATE INDEX incidents_home_idx ON incidents (home_id, created_at DESC);
DROP INDEX locker_incidents_open_idx;

-- Every step of a case, once, in order. Each row carries a hash of the one
-- before, so a changed or removed step shows; rows can never be updated.
CREATE TABLE incident_events (
  id bigserial PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'CREATED', 'ASSIGNED', 'REASSIGNED', 'STATUS', 'NOTE', 'RESIDENT_UPDATE', 'INFO_REQUESTED', 'RESIDENT_REPLY',
    'ESCALATED', 'RESOLVED', 'REOPENED', 'CLOSED', 'RECLASSIFIED', 'REPEATED')),
  visibility text NOT NULL CHECK (visibility IN ('INTERNAL', 'RESIDENT')),
  body text,
  data jsonb NOT NULL DEFAULT '{}',
  actor_id uuid REFERENCES users (id) ON DELETE SET NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('USER', 'SYSTEM')),
  at timestamptz NOT NULL,
  prev_hash text,
  hash text NOT NULL
);
CREATE INDEX incident_events_incident_idx ON incident_events (incident_id, id);
CREATE FUNCTION incident_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'incident history cannot be changed';
END;
$$;
CREATE TRIGGER incident_events_no_update BEFORE UPDATE ON incident_events FOR EACH ROW EXECUTE FUNCTION incident_events_append_only();

-- Each escalation is raised once: the same case and reason never alert twice.
CREATE TABLE incident_escalations (
  id bigserial PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('UNASSIGNED', 'OVERDUE', 'CRITICAL', 'DISPUTED', 'STAFF_REQUEST', 'EVIDENCE_REVIEW')),
  escalation_key text NOT NULL,
  note text,
  raised_by uuid REFERENCES users (id) ON DELETE SET NULL,
  at timestamptz NOT NULL,
  UNIQUE (incident_id, escalation_key)
);

-- How fast each priority must be picked up and resolved, per township. Proposals, not SDP's agreed service levels.
CREATE TABLE incident_policies (
  township_id uuid PRIMARY KEY REFERENCES townships (id) ON DELETE CASCADE,
  targets jsonb NOT NULL,
  workday_start smallint NOT NULL DEFAULT 9 CHECK (workday_start BETWEEN 0 AND 23),
  workday_end smallint NOT NULL DEFAULT 18 CHECK (workday_end BETWEEN 1 AND 24),
  workdays smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',   -- ISO weekdays, Monday = 1
  holidays date[] NOT NULL DEFAULT '{}',
  dispute_days smallint NOT NULL DEFAULT 7 CHECK (dispute_days BETWEEN 1 AND 60),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (workday_end > workday_start)
);

-- A problem the courier company handles. Not a township case, so it never counts as one.
CREATE TABLE courier_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id) ON DELETE CASCADE,
  home_id uuid REFERENCES homes (id) ON DELETE SET NULL,
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  company_id uuid REFERENCES courier_companies (id) ON DELETE SET NULL,
  tracking_no text,
  reason text NOT NULL,
  locker_parcel_id uuid REFERENCES locker_parcels (id) ON DELETE SET NULL,
  guard_parcel_id uuid REFERENCES parcels (id) ON DELETE SET NULL,
  ticket_ref text,                                -- only when the company's own system issued one
  ticket_status text,
  ticket_simulated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX courier_referrals_home_idx ON courier_referrals (home_id, created_at DESC);

-- A courier company's support channel, as the township has checked it. Never filled in by guesswork.
ALTER TABLE courier_companies
  ADD COLUMN support_name text,
  ADD COLUMN support_url text CHECK (support_url IS NULL OR support_url ~ '^https://'),
  ADD COLUMN support_phone text,
  ADD COLUMN support_verified_at timestamptz,
  ADD COLUMN support_verified_by uuid REFERENCES users (id) ON DELETE SET NULL;
