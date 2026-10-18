-- A station keypad locked after too many wrong pickup codes in a day. It stays
-- locked until township staff unlock it, so a PIN cannot be guessed slowly
-- over many 10-minute windows. Opening from the app is not affected.
CREATE TABLE pickup_lockouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL,
  township_id uuid NOT NULL REFERENCES townships (id) ON DELETE CASCADE,
  failures integer NOT NULL,
  locked_at timestamptz NOT NULL,
  cleared_at timestamptz,
  cleared_by uuid REFERENCES users (id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX pickup_lockouts_open_idx ON pickup_lockouts (location_id) WHERE cleared_at IS NULL;
CREATE INDEX pickup_lockouts_location_idx ON pickup_lockouts (location_id, cleared_at DESC);
