-- The hackathon brief's PEOPLE and PLANET problems: one reporting channel,
-- secure parcel collection, guided parking, the recycling guide and
-- collections, the solar opportunity mapper, the material comparison and the
-- recycled-plastic edging trial.

-- ---------------------------------------------------------------------------
-- Lapor: live progress and "Me too"
-- ---------------------------------------------------------------------------
ALTER TABLE reports
  ADD COLUMN checked_at timestamptz,          -- staff confirmed it is genuine
  ADD COLUMN assigned_to text,                -- the team or contractor fixing it
  ADD COLUMN assigned_at timestamptz,
  ADD COLUMN target_date date,                -- when residents were told to expect the fix
  ADD COLUMN fixed_photo_id uuid REFERENCES uploads (id);

-- Residents with the same problem follow the first report instead of filing another.
CREATE TABLE report_supporters (
  report_id uuid NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (report_id, user_id)
);
CREATE INDEX report_supporters_user_idx ON report_supporters (user_id);

-- ---------------------------------------------------------------------------
-- Parcels at the guardhouse
-- ---------------------------------------------------------------------------
CREATE TABLE parcels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  home_id uuid NOT NULL REFERENCES homes (id),
  courier text NOT NULL,
  tracking_no text,
  shelf text NOT NULL,
  note text,
  photo_id uuid REFERENCES uploads (id),
  -- The one-time collection code. Only the household sees it; the guard types what they are shown.
  code text NOT NULL CHECK (code ~ '^[0-9]{6}$'),
  status text NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'COLLECTED', 'RETURNED')),
  logged_by uuid NOT NULL REFERENCES users (id),
  logged_at timestamptz NOT NULL,
  reminded_at timestamptz,
  collected_at timestamptz,
  handed_over_by uuid REFERENCES users (id),
  collected_by_name text,
  -- A resident says a parcel marked collected never reached them.
  problem_at timestamptz,
  problem_note text,
  CHECK (status <> 'COLLECTED' OR collected_at IS NOT NULL)
);
-- A code is unique among the parcels still waiting in a township, so a typed code finds exactly one.
CREATE UNIQUE INDEX parcels_waiting_code_idx ON parcels (township_id, code) WHERE status = 'WAITING';
CREATE INDEX parcels_home_idx ON parcels (home_id, logged_at DESC);
CREATE INDEX parcels_township_idx ON parcels (township_id, status, logged_at);

-- ---------------------------------------------------------------------------
-- Parking: areas, simulated occupancy, pre-booked free bays, timed searches
-- ---------------------------------------------------------------------------
CREATE TABLE parking_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  place text NOT NULL,                        -- where people are going, e.g. a park or the community hall
  name text NOT NULL,                         -- the car park or zone within it
  total_bays integer NOT NULL CHECK (total_bays > 0),
  bookable_bays integer NOT NULL DEFAULT 0 CHECK (bookable_bays >= 0),
  lat double precision,
  lng double precision,
  active boolean NOT NULL DEFAULT true,
  CHECK (bookable_bays <= total_bays),
  UNIQUE (township_id, place, name)
);

CREATE TABLE parking_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id uuid NOT NULL REFERENCES parking_areas (id),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day date NOT NULL,
  slot text NOT NULL CHECK (slot IN ('MORNING', 'AFTERNOON', 'EVENING')),
  vehicle_no text NOT NULL,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED', 'CANCELLED')),
  created_at timestamptz NOT NULL
);
CREATE INDEX parking_bookings_area_idx ON parking_bookings (area_id, day, slot) WHERE status = 'BOOKED';
CREATE INDEX parking_bookings_user_idx ON parking_bookings (user_id, day DESC);

-- How long finding a bay took, with and without guidance: the brief's test.
CREATE TABLE parking_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  place text NOT NULL,
  area_id uuid REFERENCES parking_areas (id),
  guided boolean NOT NULL,
  started_at timestamptz NOT NULL,
  parked_at timestamptz,
  CHECK (parked_at IS NULL OR parked_at >= started_at)
);
CREATE INDEX parking_searches_township_idx ON parking_searches (township_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- Kitar: partner collectors and booked collections
-- ---------------------------------------------------------------------------
CREATE TABLE recycling_collectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  name text NOT NULL,
  phone text,
  materials text[] NOT NULL CHECK (cardinality(materials) > 0),
  days text NOT NULL,                         -- when they come, as they describe it ("Tue and Sat mornings")
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (township_id, name)
);

CREATE TABLE recycling_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  home_id uuid NOT NULL REFERENCES homes (id),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  collector_id uuid NOT NULL REFERENCES recycling_collectors (id),
  materials text[] NOT NULL CHECK (cardinality(materials) > 0),
  items text NOT NULL,
  day date NOT NULL,
  slot text NOT NULL CHECK (slot IN ('MORNING', 'AFTERNOON')),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'CONFIRMED', 'COLLECTED', 'CANCELLED', 'MISSED')),
  pass_id uuid REFERENCES visitor_passes (id) ON DELETE SET NULL,
  weight_g integer CHECK (weight_g BETWEEN 1 AND 500000),
  created_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  collected_at timestamptz
);
CREATE INDEX recycling_collections_home_idx ON recycling_collections (home_id, day DESC);
CREATE INDEX recycling_collections_queue_idx ON recycling_collections (township_id, status, day);

-- ---------------------------------------------------------------------------
-- Solar opportunity mapper (staff)
-- ---------------------------------------------------------------------------
CREATE TABLE solar_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ROOFTOP', 'CAR_PARK', 'OTHER')),
  zone_id uuid REFERENCES flood_zones (id) ON DELETE SET NULL,
  usable_m2 integer NOT NULL CHECK (usable_m2 BETWEEN 1 AND 1000000),
  orientation text NOT NULL DEFAULT 'FLAT' CHECK (orientation IN ('FLAT', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW')),
  shading text CHECK (shading IN ('LOW', 'MEDIUM', 'HIGH')),           -- NULL: not surveyed yet
  roof_age_years integer CHECK (roof_age_years BETWEEN 0 AND 200),     -- NULL: not known
  structural_checked boolean NOT NULL DEFAULT false,
  expert_rank integer CHECK (expert_rank > 0),                         -- an engineer's own ranking, to test the shortlist
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (township_id, name)
);

-- ---------------------------------------------------------------------------
-- Material comparison (staff): saved shortlists, timed
-- ---------------------------------------------------------------------------
CREATE TABLE material_shortlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  use_case text NOT NULL,
  requirements jsonb NOT NULL,
  material_ids text[] NOT NULL CHECK (cardinality(material_ids) > 0),
  seconds_taken integer NOT NULL CHECK (seconds_taken >= 0),
  note text,
  created_at timestamptz NOT NULL
);
CREATE INDEX material_shortlists_time_idx ON material_shortlists (created_at DESC);

-- ---------------------------------------------------------------------------
-- Recycled-plastic landscape edging: the trial's test plan and results
-- ---------------------------------------------------------------------------
CREATE TABLE edging_trial_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  seq integer NOT NULL,
  area text NOT NULL CHECK (area IN ('SAFETY', 'PERFORMANCE', 'ENVIRONMENT')),
  name text NOT NULL,
  method text NOT NULL,
  pass_rule text NOT NULL,
  result_recycled text,
  result_conventional text,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'RUNNING', 'PASSED', 'FAILED')),
  updated_at timestamptz,
  UNIQUE (township_id, seq)
);
