-- One controlled approval for several exceptional parcel removals at one
-- locker station. Approval never opens a door: the requesting staff member
-- works through the selected parcels one at a time, with every step logged.

CREATE TABLE locker_access_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES locker_stations (id) ON DELETE CASCADE,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'ACTIVE', 'COMPLETED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
  requested_by uuid NOT NULL REFERENCES users (id),
  requested_at timestamptz NOT NULL,
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  decision_note text,
  expires_at timestamptz,
  completed_at timestamptz,
  CHECK (decided_by IS NULL OR decided_by <> requested_by OR status = 'CANCELLED')
);

CREATE TABLE locker_access_session_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES locker_access_sessions (id) ON DELETE CASCADE,
  parcel_id uuid NOT NULL REFERENCES locker_parcels (id) ON DELETE CASCADE,
  compartment_id uuid NOT NULL REFERENCES locker_compartments (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'OPENED', 'COMPLETED', 'CANCELLED')),
  command_id uuid REFERENCES locker_commands (id) ON DELETE SET NULL,
  opened_at timestamptz,
  completed_at timestamptz,
  UNIQUE (session_id, parcel_id)
);

CREATE INDEX locker_access_sessions_queue_idx ON locker_access_sessions (township_id, status, requested_at DESC);
CREATE INDEX locker_access_session_items_session_idx ON locker_access_session_items (session_id, status);
