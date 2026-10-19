-- Akses+ accessibility management. A place's accessibility (has it been
-- verified as accessible?) and its availability today (is it blocked right
-- now?) become two separate things, so a temporary obstruction never undoes a
-- verification. Resident reports are grouped into incidents, routed by rules
-- to the organisation that actually runs the facility (the township, security,
-- a JMB, a lift contractor), followed to a verified resolution, and escalated
-- on their own when nobody acts. Staff handle the exceptions.

-- Organisations responsible for facilities. Not accounts: members act through
-- their existing SimeTown role; external ones are reached through an integration.
CREATE TABLE access_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('TOWNSHIP_OPERATIONS', 'SECURITY', 'FACILITY_MANAGER', 'JMB_MC', 'MAINTENANCE_CONTRACTOR', 'LOCAL_AUTHORITY', 'ACCESS_VERIFIER')),
  -- IN_APP: its members act in SimeTown. SIMULATED: a stand-in for the organisation's own system (prototype only).
  integration text NOT NULL DEFAULT 'IN_APP' CHECK (integration IN ('IN_APP', 'SIMULATED')),
  contact text,
  active boolean NOT NULL DEFAULT true,
  -- Demo only: the next N deliveries to the simulated system fail, to show retries.
  simulate_failures smallint NOT NULL DEFAULT 0 CHECK (simulate_failures BETWEEN 0 AND 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (township_id, name)
);

-- Who may act for an in-app party: township staff, or guards for the security team.
CREATE TABLE access_party_members (
  party_id uuid NOT NULL REFERENCES access_parties (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (party_id, user_id)
);
CREATE INDEX access_party_members_user_idx ON access_party_members (user_id);

ALTER TABLE access_places
  ADD COLUMN verification text NOT NULL DEFAULT 'PENDING_VERIFICATION'
    CHECK (verification IN ('PENDING_VERIFICATION', 'VERIFIED', 'VERIFICATION_REQUIRED', 'NOT_VERIFIED')),
  ADD COLUMN availability text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (availability IN ('AVAILABLE', 'REPORTED_BLOCKED', 'CONFIRMED_BLOCKED', 'RESOLUTION_PENDING', 'UNKNOWN')),
  ADD COLUMN availability_changed_at timestamptz,
  ADD COLUMN party_id uuid REFERENCES access_parties (id) ON DELETE SET NULL,
  ADD COLUMN next_inspection_at timestamptz,
  ADD COLUMN inspection_reminded_at timestamptz,
  ADD COLUMN duplicate_of uuid REFERENCES access_places (id) ON DELETE SET NULL,
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN archive_reason text;

-- Existing records keep their meaning. A checked place stays verified, even if it is blocked today.
UPDATE access_places SET verification = CASE WHEN verified_at IS NOT NULL OR status = 'VERIFIED' THEN 'VERIFIED' ELSE 'PENDING_VERIFICATION' END,
                         availability = CASE status WHEN 'VERIFIED' THEN 'AVAILABLE' WHEN 'BLOCKED' THEN 'REPORTED_BLOCKED' ELSE 'UNKNOWN' END,
                         availability_changed_at = updated_at;
ALTER TABLE access_places DROP COLUMN status;
CREATE INDEX access_places_queue_idx ON access_places (township_id, verification, availability) WHERE archived_at IS NULL;

-- Residents who asked to hear when a place's availability changes.
CREATE TABLE access_place_follows (
  place_id uuid NOT NULL REFERENCES access_places (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (place_id, user_id)
);

-- Inspections: the place's verification history. Never edited.
CREATE TABLE access_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id uuid NOT NULL REFERENCES access_places (id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('VERIFIED', 'NOT_VERIFIED', 'VERIFICATION_REQUIRED')),
  note text,
  photo_id uuid REFERENCES uploads (id) ON DELETE SET NULL,
  inspector_id uuid REFERENCES users (id) ON DELETE SET NULL,
  at timestamptz NOT NULL
);
CREATE INDEX access_inspections_place_idx ON access_inspections (place_id, at DESC);

-- Which organisation handles which kind of problem. Most specific rule wins; code defaults fill gaps.
CREATE TABLE access_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id) ON DELETE CASCADE,
  category text NOT NULL,
  place_kind text,                                -- NULL: any kind of place
  target text NOT NULL CHECK (target IN ('PLACE', 'PARTY')),   -- PLACE: whoever runs that facility
  party_id uuid REFERENCES access_parties (id) ON DELETE CASCADE,
  priority text NOT NULL CHECK (priority IN ('CRITICAL', 'HIGH', 'NORMAL', 'LOW')),
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((target = 'PARTY') = (party_id IS NOT NULL))
);
CREATE UNIQUE INDEX access_routing_rules_key ON access_routing_rules (township_id, category, coalesce(place_kind, '*'));

-- Response targets and verification rules. Proposals, not SDP's agreed service levels.
CREATE TABLE access_policies (
  township_id uuid PRIMARY KEY REFERENCES townships (id) ON DELETE CASCADE,
  policy jsonb NOT NULL,
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL
);

CREATE SEQUENCE access_incident_reference_seq;
CREATE TABLE access_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE DEFAULT ('ACC-' || lpad(nextval('access_incident_reference_seq')::text, 6, '0')),
  township_id uuid NOT NULL REFERENCES townships (id) ON DELETE CASCADE,
  place_id uuid NOT NULL REFERENCES access_places (id) ON DELETE CASCADE,
  category text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('CRITICAL', 'HIGH', 'NORMAL', 'LOW')),
  status text NOT NULL CHECK (status IN ('REPORTED', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLUTION_SUBMITTED', 'VERIFICATION_PENDING', 'RESOLVED', 'REOPENED', 'ESCALATED')),
  blocks_access boolean NOT NULL,                 -- whether this kind of problem stops people using the place
  party_id uuid REFERENCES access_parties (id) ON DELETE SET NULL,
  routing jsonb NOT NULL DEFAULT '{}',            -- the rule that decided, kept for audit
  exception_reason text,                          -- why automation could not route or proceed
  report_count integer NOT NULL DEFAULT 0,
  reporter_count integer NOT NULL DEFAULT 0,
  ack_due_at timestamptz,
  resolve_due_at timestamptz,
  verify_due_at timestamptz,
  assigned_at timestamptz,
  acknowledged_at timestamptz,
  -- When the problem was confirmed real: by the responsible party, staff on site, or enough separate residents.
  confirmed_at timestamptz,
  confirmed_by text CHECK (confirmed_by IN ('PARTY', 'STAFF', 'CORROBORATION')),
  -- Set while a claimed fix waits for verification; cleared if it is rejected.
  resolution_submitted_at timestamptz,
  resolved_at timestamptz,
  reopen_count integer NOT NULL DEFAULT 0,
  escalated_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX access_incidents_queue_idx ON access_incidents (township_id, status, priority);
CREATE INDEX access_incidents_place_idx ON access_incidents (place_id, status);
CREATE INDEX access_incidents_party_idx ON access_incidents (party_id, status);

-- Each resident submission. A resident reporting the same open incident again is told it is already in.
CREATE TABLE access_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES access_incidents (id) ON DELETE CASCADE,
  place_id uuid NOT NULL REFERENCES access_places (id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category text NOT NULL,
  description text,
  photo_id uuid REFERENCES uploads (id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (reporter_id, idempotency_key)
);
CREATE INDEX access_reports_incident_idx ON access_reports (incident_id);
CREATE INDEX access_reports_reporter_idx ON access_reports (reporter_id, created_at DESC);

-- What the responsible party says it did, with its evidence, and what verification decided.
CREATE TABLE access_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES access_incidents (id) ON DELETE CASCADE,
  party_id uuid REFERENCES access_parties (id) ON DELETE SET NULL,
  submitted_by uuid REFERENCES users (id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('IN_APP', 'SIMULATED_INTEGRATION', 'STAFF_ON_BEHALF')),
  action_taken text NOT NULL,
  photo_id uuid REFERENCES uploads (id) ON DELETE SET NULL,
  telemetry boolean NOT NULL DEFAULT false,       -- the facility's own system reports it back in service
  outcome text NOT NULL DEFAULT 'PENDING' CHECK (outcome IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  decided_by uuid REFERENCES users (id) ON DELETE SET NULL,
  decision_basis text,
  decided_at timestamptz,
  submitted_at timestamptz NOT NULL
);
CREATE INDEX access_resolutions_incident_idx ON access_resolutions (incident_id, submitted_at DESC);

-- Residents saying a claimed fix is (or is not) real. One answer per person per claimed fix.
CREATE TABLE access_confirmations (
  resolution_id uuid NOT NULL REFERENCES access_resolutions (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  answer text NOT NULL CHECK (answer IN ('CLEAR', 'STILL_BLOCKED')),
  note text,
  photo_id uuid REFERENCES uploads (id) ON DELETE SET NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (resolution_id, user_id)
);

-- Every step of an incident, once, in order, each hashed onto the one before. Rows can never be changed.
CREATE TABLE access_incident_events (
  id bigserial PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES access_incidents (id) ON DELETE CASCADE,
  kind text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('INTERNAL', 'PUBLIC')),
  body text,
  data jsonb NOT NULL DEFAULT '{}',
  actor_id uuid REFERENCES users (id) ON DELETE SET NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('USER', 'SYSTEM', 'INTEGRATION')),
  at timestamptz NOT NULL,
  prev_hash text,
  hash text NOT NULL
);
CREATE INDEX access_incident_events_incident_idx ON access_incident_events (incident_id, id);
CREATE TRIGGER access_incident_events_no_update BEFORE UPDATE ON access_incident_events FOR EACH ROW EXECUTE FUNCTION incident_events_append_only();

-- Reminders and escalations, each raised once per incident and occasion.
CREATE TABLE access_escalations (
  id bigserial PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES access_incidents (id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('UNROUTED', 'NOT_ACKNOWLEDGED', 'OVERDUE', 'CRITICAL', 'DISPUTED', 'RECURRING', 'VERIFICATION_STALLED', 'DISPATCH_FAILED')),
  level text NOT NULL CHECK (level IN ('REMINDER', 'ESCALATION')),
  escalation_key text NOT NULL,
  note text,
  at timestamptz NOT NULL,
  UNIQUE (incident_id, escalation_key)
);

-- Messages to a responsible party's own system: an outbox, delivered and retried by the `access` job.
CREATE TABLE access_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES access_incidents (id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES access_parties (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ASSIGNMENT', 'REMINDER', 'REOPENED')),
  dedupe_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,                         -- never the reporter's name, contact or home
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempts smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  external_ref text,
  last_error text,
  created_at timestamptz NOT NULL,
  sent_at timestamptz
);
CREATE INDEX access_dispatches_due_idx ON access_dispatches (status, next_attempt_at);

-- A place reported blocked before this change becomes an open incident, so its
-- "reported blocked" has a record behind it. Nobody is recorded as running it
-- yet, so it waits in the exception queue for an admin to assign a team.
WITH legacy AS (
  INSERT INTO access_incidents (township_id, place_id, category, priority, status, blocks_access, exception_reason, report_count, reporter_count, created_at, updated_at, escalated_at)
  SELECT township_id, id, 'OBSTRUCTION', 'NORMAL', 'ESCALATED', true, 'Reported before automatic routing. Choose the team responsible.',
         CASE WHEN reported_by IS NULL THEN 0 ELSE 1 END, CASE WHEN reported_by IS NULL THEN 0 ELSE 1 END, updated_at, updated_at, updated_at
    FROM access_places WHERE availability = 'REPORTED_BLOCKED'
  RETURNING id, place_id, created_at
), reports AS (
  INSERT INTO access_reports (incident_id, place_id, reporter_id, category, description, idempotency_key, created_at)
  SELECT l.id, l.place_id, p.reported_by, 'OBSTRUCTION', p.note, 'legacy-' || p.id, l.created_at
    FROM legacy l JOIN access_places p ON p.id = l.place_id WHERE p.reported_by IS NOT NULL
  RETURNING id
)
INSERT INTO access_escalations (incident_id, reason, level, escalation_key, note, at)
SELECT id, 'UNROUTED', 'ESCALATION', 'legacy', 'Reported before automatic routing.', created_at FROM legacy;

-- Events received from a party's system. The same event id is processed once, however often it arrives.
CREATE TABLE access_integration_events (
  party_id uuid NOT NULL REFERENCES access_parties (id) ON DELETE CASCADE,
  event_id text NOT NULL,
  incident_id uuid REFERENCES access_incidents (id) ON DELETE CASCADE,
  kind text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}',
  received_at timestamptz NOT NULL,
  PRIMARY KEY (party_id, event_id)
);
