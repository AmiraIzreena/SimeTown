-- Third edition of the proposal (October 2026): Tamu, Shop Offers and offer-backed points,
-- sponsor tiers, the smart recycling machine, Gerak map tracking, Jimat bill reading, the
-- Banjir agent, Akses+ and Taman. Additive only: no existing row changes meaning.

-- ---------------------------------------------------------------------------
-- Roles and preferences (BR2: a Guard role)
-- ---------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('RESIDENT', 'MERCHANT', 'SPONSOR', 'GUARD', 'TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'HQ_ADMIN'));
ALTER TABLE users ADD COLUMN language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ms'));

-- The main gate, for visitor directions and the guard screen.
ALTER TABLE townships
  ADD COLUMN gate_name text,
  ADD COLUMN gate_lat double precision CHECK (gate_lat BETWEEN -90 AND 90),
  ADD COLUMN gate_lng double precision CHECK (gate_lng BETWEEN -180 AND 180);

-- ---------------------------------------------------------------------------
-- Ledger: two new income accounts. Both are real money moving from the trust
-- account to the operating account, like the issuance fee.
-- ---------------------------------------------------------------------------
ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_kind_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_kind_check CHECK (kind IN (
  'TRUST_BANK', 'OPERATING_BANK', 'FUNDER_POOL', 'WALLET', 'MERCHANT_PAYABLE', 'COMMUNITY_POOL',
  'REVENUE_ISSUANCE_FEE', 'REVENUE_CAMPAIGN_FEE', 'REVENUE_CAMPAIGN_COSTS',
  'REVENUE_SUCCESS_FEE',      -- 10% of each Shop Offer discount used (BR30)
  'REVENUE_SPONSOR_TIER'      -- yearly sponsor tier fees
));
INSERT INTO ledger_accounts (kind, normal_side) VALUES ('REVENUE_SUCCESS_FEE', 'C'), ('REVENUE_SPONSOR_TIER', 'C');

ALTER TABLE ledger_txns DROP CONSTRAINT ledger_txns_kind_check;
ALTER TABLE ledger_txns ADD CONSTRAINT ledger_txns_kind_check CHECK (kind IN (
  'DEPOSIT', 'ISSUE', 'REDEEM', 'REFUND_CLAWBACK', 'REFUND_RETURN', 'EXPIRE',
  'SETTLEMENT', 'CAMPAIGN_FUND', 'CAMPAIGN_REFUND', 'ADJUSTMENT', 'OFFER_FEE', 'SPONSOR_TIER'
));

-- ---------------------------------------------------------------------------
-- Programme settings and activity rules
-- ---------------------------------------------------------------------------
ALTER TABLE program_settings
  ADD COLUMN offer_points_monthly_home integer NOT NULL DEFAULT 800 CHECK (offer_points_monthly_home > 0),
  ADD COLUMN offer_success_fee_bps integer NOT NULL DEFAULT 1000 CHECK (offer_success_fee_bps BETWEEN 0 AND 5000);

-- Offer-backed points an action earns: `offer_points`, per `offer_per_quantity` units when set.
ALTER TABLE activity_rules
  ADD COLUMN offer_points integer NOT NULL DEFAULT 0 CHECK (offer_points >= 0),
  ADD COLUMN offer_per_quantity integer CHECK (offer_per_quantity > 0);
UPDATE activity_rules SET offer_points = 10, offer_per_quantity = 100 WHERE activity = 'KITAR_DROPOFF'; -- 10 points per 100 g, machine-verified only
UPDATE activity_rules SET offer_points = 50 WHERE activity = 'GERAK_LOOP';
UPDATE activity_rules SET offer_points = 100 WHERE activity = 'JIMAT_SAVER';                             -- bill-verified only
INSERT INTO activity_rules (activity, label, xp, quantity_unit, daily_cap_person, monthly_cap_home, offer_points, offer_per_quantity) VALUES
  ('GERAK_TRIP',     'Verified walk, run or ride',        20, 'm',  3, 90, 10, 1000),
  ('TAMAN_WATERING', 'Watered a community garden',        15, NULL, 1, 30, 20, NULL),
  ('TAMAN_SIGHTING', 'Wildlife sighting confirmed',       15, NULL, 3, 40, 0,  NULL),
  ('AKSES_UPDATE',   'Access update confirmed by staff',  20, NULL, 3, 20, 0,  NULL);

-- ---------------------------------------------------------------------------
-- Sponsor tiers
-- ---------------------------------------------------------------------------
ALTER TABLE sponsors
  ADD COLUMN tier text NOT NULL DEFAULT 'NONE' CHECK (tier IN ('NONE', 'COMMUNITY_FRIEND', 'TOWNSHIP_PARTNER', 'GREEN_CHAMPION', 'TITLE_PARTNER')),
  ADD COLUMN tier_until date,
  ADD COLUMN category text,
  ADD COLUMN tagline text;
-- There is only one Title Partner.
CREATE UNIQUE INDEX sponsors_one_title_partner ON sponsors ((true)) WHERE tier = 'TITLE_PARTNER';

CREATE TABLE sponsor_tier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id uuid NOT NULL REFERENCES sponsors (id),
  tier text NOT NULL CHECK (tier IN ('COMMUNITY_FRIEND', 'TOWNSHIP_PARTNER', 'GREEN_CHAMPION', 'TITLE_PARTNER')),
  amount_sen bigint NOT NULL CHECK (amount_sen > 0),
  bank_ref text NOT NULL UNIQUE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  txn_id uuid NOT NULL REFERENCES ledger_txns (id),
  recorded_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  CHECK (period_end > period_start)
);
CREATE INDEX sponsor_tier_payments_sponsor_idx ON sponsor_tier_payments (sponsor_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Shop Offers and offer-backed points (BR29, BR30)
-- Offer-backed points have no cash behind them, so they live outside the
-- double-entry ledger and never touch the float. What stands behind them is
-- the monthly discount budget each shop pledges.
-- ---------------------------------------------------------------------------
ALTER TABLE merchants ADD COLUMN akses_friendly boolean NOT NULL DEFAULT false;

CREATE TABLE shop_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants (id),
  title text NOT NULL,
  -- The discount, in whole ringgit. The resident gives the same number of points (1 point = 1 sen).
  discount_sen integer NOT NULL CHECK (discount_sen >= 100 AND discount_sen <= 100000 AND discount_sen % 100 = 0),
  min_spend_sen integer NOT NULL DEFAULT 0 CHECK (min_spend_sen >= 0),
  days_mask smallint NOT NULL DEFAULT 127 CHECK (days_mask BETWEEN 1 AND 127),  -- bit 0 = Monday … bit 6 = Sunday
  start_minute smallint NOT NULL DEFAULT 0 CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute smallint NOT NULL DEFAULT 1440 CHECK (end_minute BETWEEN 1 AND 1440),
  monthly_budget_sen integer NOT NULL CHECK (monthly_budget_sen <= 10000000),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'ENDED')),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  CHECK (end_minute > start_minute),
  CHECK (monthly_budget_sen >= discount_sen)
);
-- One live offer per shop keeps the counter to a single switch.
CREATE UNIQUE INDEX shop_offers_one_live_idx ON shop_offers (merchant_id) WHERE status = 'ACTIVE';

-- A shop's promise for one month. Fixed once made; used_sen can never pass it (BR30).
CREATE TABLE offer_pledges (
  offer_id uuid NOT NULL REFERENCES shop_offers (id),
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  township_id uuid NOT NULL REFERENCES townships (id),
  budget_sen integer NOT NULL CHECK (budget_sen > 0),
  used_sen integer NOT NULL DEFAULT 0 CHECK (used_sen >= 0),
  PRIMARY KEY (offer_id, month),
  CHECK (used_sen <= budget_sen)
);
CREATE INDEX offer_pledges_township_month_idx ON offer_pledges (township_id, month);

-- Offer-backed points given per township per month. Locked while giving, so the total
-- can never pass the sum of that month's pledges: no pledge, no points (BR29).
CREATE TABLE offer_months (
  township_id uuid NOT NULL REFERENCES townships (id),
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  issued_points integer NOT NULL DEFAULT 0 CHECK (issued_points >= 0),
  PRIMARY KEY (township_id, month)
);

CREATE TABLE offer_point_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  township_id uuid NOT NULL REFERENCES townships (id),
  pledge_month date NOT NULL,
  source text NOT NULL CHECK (source IN ('ACTION', 'REFUND_RETURN')),
  label text NOT NULL,
  ref text,                                  -- the verified action, for the resident's history
  amount integer NOT NULL CHECK (amount > 0),
  remaining integer NOT NULL CHECK (remaining >= 0),
  redeemed integer NOT NULL DEFAULT 0 CHECK (redeemed >= 0),
  earned_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (remaining + redeemed <= amount)
);
CREATE INDEX offer_point_lots_open_idx ON offer_point_lots (user_id, expires_at, earned_at) WHERE remaining > 0;
CREATE INDEX offer_point_lots_month_idx ON offer_point_lots (township_id, pledge_month);
CREATE INDEX offer_point_lots_user_time_idx ON offer_point_lots (user_id, earned_at DESC);

ALTER TABLE sales
  ADD COLUMN offer_id uuid REFERENCES shop_offers (id),
  ADD COLUMN offer_points integer NOT NULL DEFAULT 0 CHECK (offer_points >= 0),
  ADD COLUMN success_fee_sen integer NOT NULL DEFAULT 0 CHECK (success_fee_sen >= 0),
  ADD CONSTRAINT sales_offer_pair CHECK ((offer_id IS NULL) = (offer_points = 0)),
  ADD CONSTRAINT sales_cash_part CHECK (redeem_points + offer_points < bill_sen);
CREATE INDEX sales_offer_idx ON sales (offer_id) WHERE offer_id IS NOT NULL;

-- Success fees: taken from the shop's pool, else from what the float owes it, else
-- carried until the next deposit or settlement. Never more than once per sale.
CREATE TABLE offer_fees (
  sale_id uuid PRIMARY KEY REFERENCES sales (id),
  merchant_id uuid NOT NULL REFERENCES merchants (id),
  amount_sen integer NOT NULL CHECK (amount_sen > 0),
  status text NOT NULL DEFAULT 'DUE' CHECK (status IN ('DUE', 'PAID')),
  txn_id uuid REFERENCES ledger_txns (id),
  created_at timestamptz NOT NULL,
  paid_at timestamptz,
  CHECK ((status = 'PAID') = (txn_id IS NOT NULL))
);
CREATE INDEX offer_fees_due_idx ON offer_fees (merchant_id) WHERE status = 'DUE';

-- ---------------------------------------------------------------------------
-- Tamu: visitor passes and the guard at the main gate (BR26, BR27)
-- ---------------------------------------------------------------------------
CREATE TABLE visitor_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  home_id uuid NOT NULL REFERENCES homes (id),
  host_user_id uuid NOT NULL REFERENCES users (id),
  type text NOT NULL CHECK (type IN ('ONE_VISIT', 'REGULAR_HELPER', 'DELIVERY', 'EVENT', 'CONTRACTOR', 'CARER')),
  visitor_name text NOT NULL,
  vehicle_no text,
  code text NOT NULL UNIQUE,                 -- in the QR code and printed under it, for the guard
  token_hash text NOT NULL UNIQUE,           -- the visitor's link; only its hash is kept
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  max_entries integer CHECK (max_entries > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  created_at timestamptz NOT NULL,
  CHECK (valid_until > valid_from)
);
CREATE INDEX visitor_passes_home_idx ON visitor_passes (home_id, created_at DESC);
CREATE INDEX visitor_passes_valid_idx ON visitor_passes (valid_until);

-- Name, vehicle number and host home only. Never an identity card (BR26).
CREATE TABLE visitor_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  home_id uuid NOT NULL REFERENCES homes (id),
  pass_id uuid REFERENCES visitor_passes (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('PASS', 'WALK_IN')),
  visitor_name text NOT NULL,
  vehicle_no text,
  guard_user_id uuid NOT NULL REFERENCES users (id),
  host_reply text CHECK (host_reply IN ('EXPECTED', 'NOT_EXPECTED', 'CALL_ME')),
  replied_by uuid REFERENCES users (id),
  replied_at timestamptz,
  entered_at timestamptz NOT NULL,
  exited_at timestamptz,
  CHECK (exited_at IS NULL OR exited_at >= entered_at)
);
CREATE INDEX visitor_entries_township_idx ON visitor_entries (township_id, entered_at DESC);
CREATE INDEX visitor_entries_home_idx ON visitor_entries (home_id, entered_at DESC);
CREATE INDEX visitor_entries_pass_idx ON visitor_entries (pass_id);

CREATE TABLE guard_sos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  home_id uuid NOT NULL REFERENCES homes (id),
  user_id uuid NOT NULL REFERENCES users (id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'CLOSED')),
  created_at timestamptz NOT NULL,
  acknowledged_by uuid REFERENCES users (id),
  acknowledged_at timestamptz,
  closed_at timestamptz
);
CREATE INDEX guard_sos_open_idx ON guard_sos (township_id, created_at DESC) WHERE status <> 'CLOSED';
-- One open call per home: pressing again does not flood the guardhouse.
CREATE UNIQUE INDEX guard_sos_one_open_idx ON guard_sos (home_id) WHERE status = 'OPEN';

CREATE TABLE patrol_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  seq integer NOT NULL CHECK (seq > 0),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  UNIQUE (township_id, seq)
);
CREATE TABLE patrol_scans (
  id bigserial PRIMARY KEY,
  point_id uuid NOT NULL REFERENCES patrol_points (id) ON DELETE CASCADE,
  guard_user_id uuid NOT NULL REFERENCES users (id),
  scanned_at timestamptz NOT NULL
);
CREATE INDEX patrol_scans_time_idx ON patrol_scans (scanned_at DESC);

-- ---------------------------------------------------------------------------
-- Kitar: the smart recycling machine (BR23)
-- ---------------------------------------------------------------------------
CREATE TABLE kitar_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  kiosk_id uuid NOT NULL REFERENCES kitar_kiosks (id),
  name text NOT NULL,
  secret text NOT NULL,                      -- the key the machine signs its records with; never sent to a browser
  status text NOT NULL DEFAULT 'ONLINE' CHECK (status IN ('ONLINE', 'FULL', 'OFFLINE')),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (township_id, name)
);

CREATE TABLE kitar_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES kitar_machines (id),
  user_id uuid REFERENCES users (id),        -- NULL for a guest until claimed
  mode text NOT NULL CHECK (mode IN ('SCREEN_QR', 'MEMBER_QR', 'GUEST')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE', 'EXPIRED')),
  started_at timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL,
  closed_at timestamptz,
  accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  accepted_g integer NOT NULL DEFAULT 0 CHECK (accepted_g BETWEEN 0 AND 50000),
  summary_signature text,                    -- the machine's signature over the closing summary
  claim_hash text UNIQUE,                    -- guests: hash of the claim code
  claim_expires_at timestamptz,
  claimed_by uuid REFERENCES users (id),
  claimed_at timestamptz,
  reward jsonb,
  CHECK (mode = 'GUEST' OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX kitar_sessions_one_open_idx ON kitar_sessions (machine_id) WHERE status = 'OPEN';
CREATE INDEX kitar_sessions_user_idx ON kitar_sessions (user_id, started_at DESC);

CREATE TABLE kitar_items (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES kitar_sessions (id),
  seq integer NOT NULL CHECK (seq > 0),
  material text NOT NULL CHECK (material IN ('PLASTIC_PET', 'PLASTIC_OTHER', 'PAPER', 'GLASS', 'ALUMINIUM', 'E_WASTE', 'TEXTILE', 'COOKING_OIL')),
  camera_material text,
  barcode_ok boolean NOT NULL,
  weight_g integer NOT NULL CHECK (weight_g BETWEEN 1 AND 5000),
  accepted boolean NOT NULL,
  reason text,
  signature text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (session_id, seq)                   -- a replayed record is refused
);

ALTER TABLE kitar_dropoffs ADD COLUMN session_id uuid REFERENCES kitar_sessions (id);

-- ---------------------------------------------------------------------------
-- Gerak: map tracking (BR24)
-- ---------------------------------------------------------------------------
-- The loop as drawn on the map: [[lat, lng], …] through its checkpoints.
ALTER TABLE gerak_loops ADD COLUMN path jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(path) = 'array');

ALTER TABLE gerak_checkpoints
  ADD COLUMN lat double precision CHECK (lat BETWEEN -90 AND 90),
  ADD COLUMN lng double precision CHECK (lng BETWEEN -180 AND 180),
  ADD COLUMN radius_m integer NOT NULL DEFAULT 25 CHECK (radius_m BETWEEN 5 AND 200);

CREATE TABLE gerak_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  township_id uuid NOT NULL REFERENCES townships (id),
  mode text NOT NULL CHECK (mode IN ('WALK', 'RUN', 'CYCLE', 'WHEELCHAIR')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'FINISHED', 'ABANDONED')),
  simulated boolean NOT NULL DEFAULT false, -- demo GPS playback; refused in production
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  last_point_at timestamptz,
  last_moved_at timestamptz,
  last_lat double precision,
  last_lng double precision,
  points_count integer NOT NULL DEFAULT 0,
  ignored_points integer NOT NULL DEFAULT 0,
  distance_m integer NOT NULL DEFAULT 0,
  valid_m integer NOT NULL DEFAULT 0,       -- distance inside the speed band for the activity
  too_fast_m integer NOT NULL DEFAULT 0,
  active_s integer NOT NULL DEFAULT 0,
  route jsonb NOT NULL DEFAULT '[]',        -- [[lat, lng], …]; trimmed near start and end, deleted after 30 days
  route_deleted_at timestamptz,
  reward jsonb
);
CREATE UNIQUE INDEX gerak_activities_one_active_idx ON gerak_activities (user_id) WHERE status = 'ACTIVE';
CREATE INDEX gerak_activities_user_idx ON gerak_activities (user_id, started_at DESC);

CREATE TABLE gerak_activity_hits (
  activity_id uuid NOT NULL REFERENCES gerak_activities (id) ON DELETE CASCADE,
  checkpoint_id uuid NOT NULL REFERENCES gerak_checkpoints (id) ON DELETE CASCADE,
  hit_at timestamptz NOT NULL,
  PRIMARY KEY (activity_id, checkpoint_id)
);

-- ---------------------------------------------------------------------------
-- Jimat: bills read from a photo or PDF (BR25)
-- The file itself is never stored: it is checked and read in memory, and only
-- its fingerprint and the numbers are kept.
-- ---------------------------------------------------------------------------
ALTER TABLE jimat_readings
  ALTER COLUMN electricity_kwh DROP NOT NULL,
  ALTER COLUMN water_litres DROP NOT NULL,
  ADD COLUMN electricity_sen integer CHECK (electricity_sen BETWEEN 0 AND 10000000),
  ADD COLUMN water_sen integer CHECK (water_sen BETWEEN 0 AND 10000000),
  ADD COLUMN electricity_source text CHECK (electricity_source IN ('TYPED', 'BILL')),
  ADD COLUMN water_source text CHECK (water_source IN ('TYPED', 'BILL')),
  ADD CONSTRAINT jimat_readings_something CHECK (electricity_kwh IS NOT NULL OR water_litres IS NOT NULL);
UPDATE jimat_readings SET electricity_source = 'TYPED', water_source = 'TYPED';

CREATE TABLE jimat_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_id uuid NOT NULL REFERENCES homes (id),
  user_id uuid NOT NULL REFERENCES users (id),
  kind text NOT NULL CHECK (kind IN ('ELECTRICITY', 'WATER')),
  status text NOT NULL DEFAULT 'READ' CHECK (status IN ('READ', 'CONFIRMED', 'DISCARDED')),
  file_mime text NOT NULL CHECK (file_mime IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  file_sha256 text NOT NULL,
  file_size integer NOT NULL CHECK (file_size > 0),
  pages integer,
  read_source text NOT NULL CHECK (read_source IN ('MODEL', 'TEXT', 'NONE')),
  fields jsonb NOT NULL DEFAULT '{}',
  checks jsonb NOT NULL DEFAULT '[]',
  account_hash text,
  period_month date CHECK (period_month IS NULL OR extract(day FROM period_month) = 1),
  usage integer CHECK (usage BETWEEN 0 AND 10000000),
  amount_sen integer CHECK (amount_sen BETWEEN 0 AND 10000000),
  address_match boolean,
  created_at timestamptz NOT NULL,
  confirmed_at timestamptz
);
CREATE INDEX jimat_bills_home_idx ON jimat_bills (home_id, created_at DESC);
-- The same bill cannot be used twice (BR25 and the proposal's "fake or borrowed bill").
CREATE UNIQUE INDEX jimat_bills_file_once_idx ON jimat_bills (file_sha256) WHERE status = 'CONFIRMED';
CREATE UNIQUE INDEX jimat_bills_period_once_idx ON jimat_bills (kind, account_hash, period_month)
  WHERE status = 'CONFIRMED' AND account_hash IS NOT NULL AND period_month IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Banjir: signals, the agent's log, official messages and check-ins (BR28)
-- ---------------------------------------------------------------------------
CREATE TABLE flood_signals (
  id bigserial PRIMARY KEY,
  zone_id uuid NOT NULL REFERENCES flood_zones (id),
  source text NOT NULL CHECK (source IN ('SENSOR', 'CAMERA', 'RAIN', 'REPORT')),
  level_pct integer CHECK (level_pct BETWEEN 0 AND 100),
  rain_mm_hr integer CHECK (rain_mm_hr BETWEEN 0 AND 500),
  confidence real CHECK (confidence BETWEEN 0 AND 1),
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL
);
CREATE INDEX flood_signals_zone_idx ON flood_signals (zone_id, created_at DESC);

ALTER TABLE flood_alerts ADD COLUMN next_update_at timestamptz;

-- Every official message follows the Calm Alert Flow: what, where, what to do, next update.
CREATE TABLE flood_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES flood_zones (id),
  level text NOT NULL CHECK (level IN ('NORMAL', 'WARNING', 'DANGER')),
  kind text NOT NULL CHECK (kind IN ('ALERT', 'UPDATE', 'ALL_CLEAR')),
  what text NOT NULL,
  where_text text NOT NULL,
  todo text NOT NULL,
  next_update_at timestamptz,
  status text NOT NULL CHECK (status IN ('DRAFT', 'SENT', 'CANCELLED')),
  decision text NOT NULL CHECK (decision IN ('TWO_SIGNALS', 'ONE_SIGNAL', 'ESCALATED', 'OFFICER', 'SCHEDULED')),
  signals jsonb NOT NULL DEFAULT '[]',
  deadline_at timestamptz,                  -- a one-signal draft must be confirmed by then
  created_at timestamptz NOT NULL,
  sent_at timestamptz,
  decided_by uuid REFERENCES users (id)
);
CREATE INDEX flood_messages_zone_idx ON flood_messages (zone_id, created_at DESC);
CREATE UNIQUE INDEX flood_messages_one_draft_idx ON flood_messages (zone_id) WHERE status = 'DRAFT';

CREATE TABLE flood_agent_log (
  id bigserial PRIMARY KEY,
  zone_id uuid NOT NULL REFERENCES flood_zones (id),
  at timestamptz NOT NULL,
  step text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  actor_user_id uuid REFERENCES users (id)
);
CREATE INDEX flood_agent_log_zone_idx ON flood_agent_log (zone_id, id DESC);

CREATE TABLE flood_checkins (
  alert_id uuid NOT NULL REFERENCES flood_alerts (id),
  user_id uuid NOT NULL REFERENCES users (id),
  status text NOT NULL CHECK (status IN ('SAFE', 'NEED_HELP')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (alert_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Akses+ (BR32): private access needs, carers and accessible places
-- ---------------------------------------------------------------------------
CREATE TABLE access_profiles (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  needs text[] NOT NULL DEFAULT '{}' CHECK (needs <@ ARRAY['MOBILITY', 'VISION', 'HEARING', 'COGNITIVE', 'ELDERLY']::text[]),
  simple_mode boolean NOT NULL DEFAULT false,
  read_aloud boolean NOT NULL DEFAULT false,
  flash_alerts boolean NOT NULL DEFAULT false,
  priority_help boolean NOT NULL DEFAULT false,  -- staff phone this home first in a flood warning
  priority_note text,
  consent_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE carer_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES users (id),
  carer_id uuid NOT NULL REFERENCES users (id),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED')),
  created_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (resident_id, carer_id),
  CHECK (resident_id <> carer_id)
);
CREATE INDEX carer_links_carer_idx ON carer_links (carer_id);

CREATE TABLE access_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('STEP_FREE_ROUTE', 'RAMP', 'LIFT', 'ACCESSIBLE_TOILET', 'OKU_PARKING', 'SEATING')),
  location text NOT NULL,
  status text NOT NULL CHECK (status IN ('VERIFIED', 'REPORTED', 'BLOCKED')),
  note text,
  reported_by uuid REFERENCES users (id),
  verified_by uuid REFERENCES users (id),
  verified_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX access_places_township_idx ON access_places (township_id, kind);

-- ---------------------------------------------------------------------------
-- Taman: gardens, plots, watering roster and the wildlife log
-- ---------------------------------------------------------------------------
CREATE TABLE gardens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  name text NOT NULL,
  location text NOT NULL,
  code text NOT NULL UNIQUE,                 -- printed at the garden gate; scanned when watering
  UNIQUE (township_id, name)
);

CREATE TABLE garden_plots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  garden_id uuid NOT NULL REFERENCES gardens (id),
  plot_no text NOT NULL,
  size_m2 integer NOT NULL CHECK (size_m2 BETWEEN 1 AND 500),
  holder_home_id uuid REFERENCES homes (id),
  holder_user_id uuid REFERENCES users (id),
  booked_at timestamptz,
  booked_until date,
  UNIQUE (garden_id, plot_no),
  CHECK ((holder_home_id IS NULL) = (holder_user_id IS NULL))
);
CREATE UNIQUE INDEX garden_plots_one_per_home_idx ON garden_plots (holder_home_id) WHERE holder_home_id IS NOT NULL;

CREATE TABLE garden_roster (
  garden_id uuid NOT NULL REFERENCES gardens (id),
  day date NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id),
  done_at timestamptz,
  PRIMARY KEY (garden_id, day)
);
CREATE INDEX garden_roster_user_idx ON garden_roster (user_id, day);

CREATE TABLE wildlife_sightings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  user_id uuid NOT NULL REFERENCES users (id),
  kind text NOT NULL CHECK (kind IN ('BIRD', 'INSECT', 'MAMMAL', 'REPTILE', 'AMPHIBIAN', 'PLANT', 'OTHER')),
  species text NOT NULL,
  location text NOT NULL,
  note text,
  photo_id uuid REFERENCES uploads (id),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED')),
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX wildlife_sightings_township_idx ON wildlife_sightings (township_id, status, created_at DESC);
