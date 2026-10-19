-- Banjir: from simulator to real early warning (proposal Appendix E).
-- Sensors are rows of data, not code: a zone has two or three water-level
-- sensors (lake edge, main drain, low road), each signing its own readings.

-- ---------------------------------------------------------------------------
-- The sensor registry (E.3 modules/flood/sensors)
-- ---------------------------------------------------------------------------
CREATE TABLE flood_sensors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES flood_zones (id),
  code text NOT NULL UNIQUE,                 -- the label on the device, e.g. EV12-DRAIN-1
  kind text NOT NULL CHECK (kind IN ('ULTRASONIC', 'RADAR')),
  site text NOT NULL CHECK (site IN ('LAKE_EDGE', 'MAIN_DRAIN', 'LOW_ROAD', 'OTHER')),
  location_note text,
  secret text NOT NULL,                      -- the key the sensor signs its readings with; shown once, never sent to a browser again
  -- Calibration (rule 1): a level is a percentage of the calibrated height from base_cm (0%) to overflow_cm (100%).
  base_cm real NOT NULL DEFAULT 0 CHECK (base_cm >= 0),
  overflow_cm real NOT NULL CHECK (overflow_cm > 0),
  calibrated_at timestamptz,
  -- Thresholds (rules 5 and 6), set from the site survey.
  rise_cm_10min real NOT NULL DEFAULT 15 CHECK (rise_cm_10min > 0),
  low_battery_pct integer NOT NULL DEFAULT 20 CHECK (low_battery_pct BETWEEN 1 AND 90),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  health text NOT NULL DEFAULT 'UNKNOWN' CHECK (health IN ('UNKNOWN', 'OK', 'FAULTY')),
  health_reason text CHECK (health_reason IN ('NO_READING', 'STUCK', 'LOW_BATTERY')),
  last_seen_at timestamptz,
  last_level_cm real,
  last_level_pct integer,
  last_battery integer,
  last_rssi integer,
  -- Prototype only: a simulated sensor is driven from the console and still sends signed readings
  -- through the real ingestion path. A real sensor has simulated = false.
  simulated boolean NOT NULL DEFAULT false,
  sim_level_cm real,
  sim_battery integer CHECK (sim_battery BETWEEN 0 AND 100),
  sim_paused boolean NOT NULL DEFAULT false, -- "power cut": the sensor stops reporting
  sim_stuck boolean NOT NULL DEFAULT false,  -- the sensor repeats one value exactly
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (overflow_cm > base_cm)
);
CREATE INDEX flood_sensors_zone_idx ON flood_sensors (zone_id);

-- Health changes and the maintenance log. A FAULT opens a ticket for staff; logging maintenance closes it.
CREATE TABLE flood_sensor_health (
  id bigserial PRIMARY KEY,
  sensor_id uuid NOT NULL REFERENCES flood_sensors (id),
  kind text NOT NULL CHECK (kind IN ('REGISTERED', 'FAULT', 'RECOVERED', 'MAINTENANCE', 'CALIBRATED', 'THRESHOLDS', 'RETIRED')),
  reason text CHECK (reason IN ('NO_READING', 'STUCK', 'LOW_BATTERY')),
  note text,
  ticket_open boolean NOT NULL DEFAULT false,
  at timestamptz NOT NULL,
  resolved_at timestamptz,
  actor_user_id uuid REFERENCES users (id)
);
CREATE INDEX flood_sensor_health_sensor_idx ON flood_sensor_health (sensor_id, id DESC);
-- At most one open ticket per sensor, so a flapping sensor does not flood the staff inbox.
CREATE UNIQUE INDEX flood_sensor_health_one_ticket_idx ON flood_sensor_health (sensor_id) WHERE ticket_open;

-- ---------------------------------------------------------------------------
-- Readings (E.3 modules/flood/ingest). Every signed reading is kept for 90 days, then summarised.
-- The pilot partitions this table by day; the prototype's database keeps one table with a time index.
-- ---------------------------------------------------------------------------
ALTER TABLE flood_readings
  ADD COLUMN sensor_id uuid REFERENCES flood_sensors (id),
  ADD COLUMN level_cm real,
  ADD COLUMN battery integer CHECK (battery BETWEEN 0 AND 100),
  ADD COLUMN rssi integer CHECK (rssi BETWEEN -200 AND 0),
  ADD COLUMN signature text;
-- A gateway that lost its link re-sends what it buffered: the same reading twice is dropped.
CREATE UNIQUE INDEX flood_readings_dedupe_idx ON flood_readings (sensor_id, created_at) WHERE sensor_id IS NOT NULL;
CREATE INDEX flood_readings_time_idx ON flood_readings (created_at);

ALTER TABLE flood_signals
  ADD COLUMN sensor_id uuid REFERENCES flood_sensors (id),
  ADD COLUMN level_cm real;
CREATE INDEX flood_signals_sensor_idx ON flood_signals (sensor_id, created_at DESC) WHERE sensor_id IS NOT NULL;
CREATE INDEX flood_signals_time_idx ON flood_signals (created_at);

-- What the clean-up job keeps after 90 days: one row per sensor (or zone) per day.
CREATE TABLE flood_readings_daily (
  zone_id uuid NOT NULL REFERENCES flood_zones (id),
  sensor_id uuid REFERENCES flood_sensors (id),
  day date NOT NULL,
  readings integer NOT NULL,
  min_pct integer NOT NULL,
  max_pct integer NOT NULL,
  avg_pct real NOT NULL
);
CREATE UNIQUE INDEX flood_readings_daily_key ON flood_readings_daily (zone_id, sensor_id, day) NULLS NOT DISTINCT;

-- ---------------------------------------------------------------------------
-- Flood events (rule 10): from the first alert in a zone to its all clear, for the post-event report.
-- ---------------------------------------------------------------------------
CREATE TABLE flood_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES flood_zones (id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  peak_status text NOT NULL CHECK (peak_status IN ('WARNING', 'DANGER')),
  peak_level_pct integer CHECK (peak_level_pct BETWEEN 0 AND 100),
  first_warning_at timestamptz,
  first_danger_at timestamptz,
  people_warned integer NOT NULL DEFAULT 0,
  -- The false-alarm review, filled in by staff after the event.
  false_alarm boolean,
  review_note text,
  reviewed_by uuid REFERENCES users (id),
  reviewed_at timestamptz
);
CREATE UNIQUE INDEX flood_events_open_idx ON flood_events (zone_id) WHERE ended_at IS NULL;
CREATE INDEX flood_events_zone_idx ON flood_events (zone_id, started_at DESC);

ALTER TABLE flood_alerts ADD COLUMN event_id uuid REFERENCES flood_events (id);

-- Link existing open alerts to an event, so the dashboard has one for any zone already under an alert.
DO $$
DECLARE
  a record;
  e uuid;
BEGIN
  FOR a IN SELECT al.id, al.zone_id, al.level, al.started_at, z.level_pct FROM flood_alerts al JOIN flood_zones z ON z.id = al.zone_id WHERE al.ended_at IS NULL LOOP
    INSERT INTO flood_events (zone_id, started_at, peak_status, peak_level_pct, first_warning_at, first_danger_at)
    VALUES (a.zone_id, a.started_at, a.level, a.level_pct, a.started_at, CASE WHEN a.level = 'DANGER' THEN a.started_at END)
    RETURNING id INTO e;
    UPDATE flood_alerts SET event_id = e WHERE id = a.id;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Priority help (E.3 tab 4): duty staff assign a guard to reach a resident, and the guard marks them reached.
-- ---------------------------------------------------------------------------
CREATE TABLE flood_help_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES flood_events (id),
  user_id uuid NOT NULL REFERENCES users (id),       -- the resident to reach
  reason text NOT NULL CHECK (reason IN ('PRIORITY', 'NEED_HELP')),
  assigned_to uuid NOT NULL REFERENCES users (id),   -- the guard or staff member going
  assigned_by uuid NOT NULL REFERENCES users (id),
  status text NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN ('ASSIGNED', 'REACHED')),
  note text,
  created_at timestamptz NOT NULL,
  reached_at timestamptz,
  reached_by uuid REFERENCES users (id),
  UNIQUE (event_id, user_id)
);
CREATE INDEX flood_help_tasks_assignee_idx ON flood_help_tasks (assigned_to, status);

-- ---------------------------------------------------------------------------
-- SMS for danger alerts (BR19). The prototype records each message as SIMULATED; a provider sends them in the pilot.
-- ---------------------------------------------------------------------------
CREATE TABLE sms_outbox (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users (id),
  phone text NOT NULL,
  body text NOT NULL CHECK (char_length(body) <= 480),
  reason text NOT NULL CHECK (reason IN ('FLOOD_DANGER')),
  zone_id uuid REFERENCES flood_zones (id),
  status text NOT NULL CHECK (status IN ('SIMULATED', 'QUEUED', 'SENT', 'FAILED')),
  created_at timestamptz NOT NULL
);
CREATE INDEX sms_outbox_time_idx ON sms_outbox (created_at);
