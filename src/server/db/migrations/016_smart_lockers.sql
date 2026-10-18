-- Smart parcel lockers: couriers deposit, residents collect with a one-time
-- credential, overdue parcels are relocated to staffed overflow storage under a
-- recorded custody chain. Hardware is reached through an adapter; the built-in
-- simulator uses the same business logic. Additive: the guardhouse parcel shelf
-- (table parcels) keeps working as before.

-- ---------------------------------------------------------------------------
-- Couriers
-- ---------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('RESIDENT', 'MERCHANT', 'SPONSOR', 'GUARD', 'COURIER', 'TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'HQ_ADMIN'));

CREATE TABLE courier_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A courier signs up for a company; township admins approve them and choose the stations they may use.
CREATE TABLE courier_accounts (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES courier_companies (id),
  township_id uuid NOT NULL REFERENCES townships (id),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED')),
  applied_at timestamptz NOT NULL,
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  note text
);
CREATE INDEX courier_accounts_township_idx ON courier_accounts (township_id, status);

-- ---------------------------------------------------------------------------
-- Stations and compartments
-- ---------------------------------------------------------------------------
CREATE TABLE locker_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  name text NOT NULL,
  code text NOT NULL UNIQUE,                    -- printed on the station's QR poster; grants nothing by itself
  location text NOT NULL,
  lat double precision,
  lng double precision,
  adapter text NOT NULL DEFAULT 'SIMULATED' CHECK (adapter IN ('SIMULATED', 'HTTP_GATEWAY')),
  gateway_url text,                             -- HTTP_GATEWAY only: where unlock commands are sent
  device_secret text NOT NULL,                  -- signs device messages both ways; never sent to a browser
  has_door_sensor boolean NOT NULL DEFAULT true,
  has_presence_sensor boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'ONLINE' CHECK (status IN ('ONLINE', 'OFFLINE', 'MAINTENANCE')),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (township_id, name),
  CHECK (adapter <> 'HTTP_GATEWAY' OR gateway_url IS NOT NULL)
);

CREATE TABLE courier_station_access (
  user_id uuid NOT NULL REFERENCES courier_accounts (user_id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES locker_stations (id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users (id),
  granted_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, station_id)
);

CREATE TABLE locker_compartments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES locker_stations (id) ON DELETE CASCADE,
  label text NOT NULL,
  size text NOT NULL CHECK (size IN ('S', 'M', 'L', 'XL')),
  width_mm integer NOT NULL CHECK (width_mm > 0),
  height_mm integer NOT NULL CHECK (height_mm > 0),
  depth_mm integer NOT NULL CHECK (depth_mm > 0),
  -- The physical compartment's own state, separate from any parcel's lifecycle.
  state text NOT NULL DEFAULT 'AVAILABLE' CHECK (state IN ('AVAILABLE', 'RESERVED', 'OCCUPIED', 'FAULTY', 'DISABLED')),
  door text NOT NULL DEFAULT 'CLOSED' CHECK (door IN ('OPEN', 'CLOSED', 'UNKNOWN')),
  item_present boolean,
  fault text,
  sim_fail_next boolean NOT NULL DEFAULT false, -- simulator only: the next unlock fails, as a jammed door would
  parcel_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (station_id, label),
  CHECK (state NOT IN ('RESERVED', 'OCCUPIED') OR parcel_id IS NOT NULL)
);
CREATE INDEX locker_compartments_free_idx ON locker_compartments (station_id, state, size);

-- ---------------------------------------------------------------------------
-- Overflow storage and collection policy
-- ---------------------------------------------------------------------------
CREATE TABLE overflow_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('COUNTER', 'PARCEL_ROOM')),
  location text NOT NULL,
  hours text NOT NULL,
  instructions text NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0),
  accepts_deliveries boolean NOT NULL DEFAULT false, -- couriers may hand parcels to staff here when lockers are full
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (township_id, name)
);

-- Proposed defaults, not a verified township policy: management changes them.
CREATE TABLE collection_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  station_id uuid REFERENCES locker_stations (id) ON DELETE CASCADE,  -- NULL: the township's default
  first_reminder_hours integer NOT NULL DEFAULT 24 CHECK (first_reminder_hours > 0),
  final_reminder_hours integer NOT NULL DEFAULT 36,
  relocate_after_hours integer NOT NULL DEFAULT 48,
  overflow_collect_days integer NOT NULL DEFAULT 7 CHECK (overflow_collect_days > 0),
  quiet_from_hour integer NOT NULL DEFAULT 22 CHECK (quiet_from_hour BETWEEN 0 AND 23),
  quiet_to_hour integer NOT NULL DEFAULT 8 CHECK (quiet_to_hour BETWEEN 0 AND 23),
  extensions_enabled boolean NOT NULL DEFAULT false,
  extension_hours integer NOT NULL DEFAULT 24 CHECK (extension_hours > 0),
  max_extensions integer NOT NULL DEFAULT 1 CHECK (max_extensions >= 0),
  fee_enabled boolean NOT NULL DEFAULT false,
  fee_sen integer CHECK (fee_sen > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (final_reminder_hours > first_reminder_hours AND relocate_after_hours > final_reminder_hours),
  CHECK (NOT fee_enabled OR fee_sen IS NOT NULL)
);
CREATE UNIQUE INDEX collection_policies_township_idx ON collection_policies (township_id) WHERE station_id IS NULL;
CREATE UNIQUE INDEX collection_policies_station_idx ON collection_policies (station_id) WHERE station_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Parcels and their history
-- ---------------------------------------------------------------------------
CREATE TABLE locker_parcels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  home_id uuid REFERENCES homes (id),          -- NULL only when the recipient could not be verified
  recipient_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  company_id uuid NOT NULL REFERENCES courier_companies (id),
  courier_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  tracking_no text NOT NULL,
  size text NOT NULL CHECK (size IN ('S', 'M', 'L', 'XL')),
  width_mm integer, height_mm integer, depth_mm integer,
  station_id uuid NOT NULL REFERENCES locker_stations (id),
  compartment_id uuid REFERENCES locker_compartments (id),
  overflow_location_id uuid REFERENCES overflow_locations (id),
  state text NOT NULL CHECK (state IN (
    'REGISTERED', 'VERIFIED', 'LOCKER_RESERVED', 'DEPOSIT_IN_PROGRESS', 'DEPOSITED', 'READY_FOR_COLLECTION', 'OVERDUE',
    'RELOCATION_PENDING', 'RELOCATION_IN_PROGRESS', 'RELOCATED_TO_STORAGE', 'COLLECTION_IN_PROGRESS', 'COLLECTED',
    'DELIVERY_FAILED', 'RETURN_PENDING', 'RETURNED', 'EXCEPTION')),
  resume_state text,                            -- where a collection that does not finish goes back to
  state_changed_at timestamptz NOT NULL,
  registered_at timestamptz NOT NULL,
  ready_at timestamptz,
  deadline_at timestamptz,
  first_reminder_at timestamptz,
  final_reminder_at timestamptz,
  collected_at timestamptz,
  relocated_at timestamptz,
  extensions integer NOT NULL DEFAULT 0,
  fee_agreed_at timestamptz,
  failure_reason text,
  exception_note text,
  CHECK (home_id IS NOT NULL OR state IN ('REGISTERED', 'DELIVERY_FAILED'))
);
-- A tracking number can be live only once per courier company.
CREATE UNIQUE INDEX locker_parcels_active_tracking_idx ON locker_parcels (company_id, upper(tracking_no))
  WHERE state NOT IN ('COLLECTED', 'RETURNED', 'DELIVERY_FAILED');
CREATE INDEX locker_parcels_home_idx ON locker_parcels (home_id, registered_at DESC);
CREATE INDEX locker_parcels_state_idx ON locker_parcels (township_id, state, deadline_at);
CREATE INDEX locker_parcels_station_idx ON locker_parcels (station_id, registered_at DESC);
ALTER TABLE locker_compartments ADD CONSTRAINT locker_compartments_parcel_fk FOREIGN KEY (parcel_id) REFERENCES locker_parcels (id);

CREATE TABLE parcel_events (
  id bigserial PRIMARY KEY,
  parcel_id uuid NOT NULL REFERENCES locker_parcels (id) ON DELETE CASCADE,
  from_state text,
  to_state text NOT NULL,
  actor_id uuid REFERENCES users (id) ON DELETE SET NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('USER', 'DEVICE', 'SYSTEM')),
  reason text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX parcel_events_parcel_idx ON parcel_events (parcel_id, id);

CREATE TABLE locker_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compartment_id uuid NOT NULL REFERENCES locker_compartments (id) ON DELETE CASCADE,
  parcel_id uuid NOT NULL REFERENCES locker_parcels (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONSUMED', 'RELEASED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  released_reason text
);
-- The database itself refuses two live reservations on one compartment.
CREATE UNIQUE INDEX locker_reservations_one_active_idx ON locker_reservations (compartment_id) WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- Hardware commands and device messages
-- ---------------------------------------------------------------------------
CREATE TABLE locker_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES locker_stations (id) ON DELETE CASCADE,
  compartment_id uuid NOT NULL REFERENCES locker_compartments (id) ON DELETE CASCADE,
  parcel_id uuid REFERENCES locker_parcels (id) ON DELETE CASCADE,
  action text NOT NULL DEFAULT 'UNLOCK' CHECK (action IN ('UNLOCK')),
  purpose text NOT NULL CHECK (purpose IN ('DEPOSIT', 'COLLECT', 'RELOCATE', 'MAINTENANCE')),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'ACKED', 'FAILED', 'TIMED_OUT')),
  requested_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  sent_at timestamptz,
  acked_at timestamptz,
  expires_at timestamptz NOT NULL,
  error text
);
CREATE INDEX locker_commands_open_idx ON locker_commands (status, expires_at) WHERE status IN ('PENDING', 'SENT');
CREATE INDEX locker_commands_station_idx ON locker_commands (station_id, created_at DESC);

-- Every message from a station, once: a replayed message is refused.
CREATE TABLE locker_device_events (
  id bigserial PRIMARY KEY,
  station_id uuid NOT NULL REFERENCES locker_stations (id) ON DELETE CASCADE,
  event_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  source text NOT NULL CHECK (source IN ('DEVICE', 'SIMULATOR')),
  received_at timestamptz NOT NULL,
  UNIQUE (station_id, event_id)
);

-- ---------------------------------------------------------------------------
-- Pickup credentials
-- ---------------------------------------------------------------------------
-- The PIN itself is never stored: it is derived from a server secret and the
-- credential id, shown only to the household, and looked up by its hash.
CREATE TABLE pickup_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id uuid NOT NULL REFERENCES locker_parcels (id) ON DELETE CASCADE,
  location_kind text NOT NULL CHECK (location_kind IN ('LOCKER', 'OVERFLOW')),
  location_id uuid NOT NULL,                    -- the station or the overflow location it works at
  pin_lookup text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'USED', 'REVOKED')),
  issued_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX pickup_credentials_active_pin_idx ON pickup_credentials (pin_lookup) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX pickup_credentials_one_active_idx ON pickup_credentials (parcel_id) WHERE status = 'ACTIVE';

-- Wrong PINs typed at a station or counter, to slow down guessing.
CREATE TABLE pickup_attempts (
  id bigserial PRIMARY KEY,
  location_id uuid NOT NULL,
  ok boolean NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX pickup_attempts_idx ON pickup_attempts (location_id, at DESC);

-- ---------------------------------------------------------------------------
-- Relocation and custody
-- ---------------------------------------------------------------------------
CREATE TABLE relocation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id uuid NOT NULL REFERENCES locker_parcels (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'DONE', 'FAILED', 'CANCELLED')),
  created_at timestamptz NOT NULL,
  assigned_to uuid REFERENCES users (id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_at timestamptz,
  destination_id uuid REFERENCES overflow_locations (id),
  tracking_verified boolean NOT NULL DEFAULT false,
  failure_reason text
);
CREATE UNIQUE INDEX relocation_tasks_one_live_idx ON relocation_tasks (parcel_id) WHERE status IN ('OPEN', 'IN_PROGRESS');

CREATE TABLE custody_transfers (
  id bigserial PRIMARY KEY,
  parcel_id uuid NOT NULL REFERENCES locker_parcels (id) ON DELETE CASCADE,
  from_kind text NOT NULL CHECK (from_kind IN ('COURIER', 'LOCKER', 'STAFF', 'OVERFLOW', 'RESIDENT')),
  from_ref text,
  to_kind text NOT NULL CHECK (to_kind IN ('COURIER', 'LOCKER', 'STAFF', 'OVERFLOW', 'RESIDENT')),
  to_ref text,
  actor_id uuid REFERENCES users (id) ON DELETE SET NULL,
  note text,
  at timestamptz NOT NULL
);
CREATE INDEX custody_transfers_parcel_idx ON custody_transfers (parcel_id, id);
