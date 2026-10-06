-- KITA+ initial schema. Requires PostgreSQL 15 or newer.
-- Money is stored as whole sen in integer columns. 100 KITA Points = RM1, so 1 point = 1 sen.

-- ---------------------------------------------------------------------------
-- Places and organisations
-- ---------------------------------------------------------------------------
CREATE TABLE townships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE flood_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  name text NOT NULL,
  safe_route text NOT NULL,
  assembly_point text NOT NULL,
  level_pct integer NOT NULL DEFAULT 0 CHECK (level_pct BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'NORMAL' CHECK (status IN ('NORMAL', 'WARNING', 'DANGER')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (township_id, name)
);

CREATE TABLE homes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  zone_id uuid REFERENCES flood_zones (id),
  unit_code text NOT NULL,
  street text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (township_id, unit_code)
);
CREATE INDEX homes_zone_idx ON homes (zone_id);

CREATE TABLE merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  name text NOT NULL,
  registration_no text NOT NULL UNIQUE,
  category text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED')),
  plan text NOT NULL DEFAULT 'FREE' CHECK (plan IN ('FREE', 'PLUS')),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX merchants_township_status_idx ON merchants (township_id, status);

CREATE TABLE sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- People, sessions, audit
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text,                       -- NULL until an invited user sets a password
  full_name text NOT NULL,
  phone text,
  role text NOT NULL CHECK (role IN ('RESIDENT', 'MERCHANT', 'SPONSOR', 'TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'HQ_ADMIN')),
  township_id uuid REFERENCES townships (id),
  home_id uuid REFERENCES homes (id),
  occupancy text CHECK (occupancy IN ('OWNER', 'TENANT')),
  residency_status text NOT NULL DEFAULT 'NONE' CHECK (residency_status IN ('NONE', 'PENDING', 'VERIFIED', 'REJECTED')),
  verified_by uuid REFERENCES users (id),
  verified_at timestamptz,
  merchant_id uuid REFERENCES merchants (id),
  sponsor_id uuid REFERENCES sponsors (id),
  member_code text UNIQUE,                  -- what a resident shows at the counter
  xp_total integer NOT NULL DEFAULT 0 CHECK (xp_total >= 0),
  last_points_activity_at timestamptz,      -- drives the 12-month inactivity rule
  -- DELETED rows are anonymised but kept, because ledger records must stay intact.
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED', 'DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role <> 'RESIDENT' OR (home_id IS NOT NULL AND occupancy IS NOT NULL AND member_code IS NOT NULL)),
  CHECK (role <> 'MERCHANT' OR merchant_id IS NOT NULL),
  CHECK (role <> 'SPONSOR' OR sponsor_id IS NOT NULL),
  CHECK (role = 'HQ_ADMIN' OR role = 'SPONSOR' OR township_id IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE INDEX users_home_idx ON users (home_id);
CREATE INDEX users_township_role_idx ON users (township_id, role, residency_status);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,          -- SHA-256 of the cookie value; the value itself is never stored
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE user_invites (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users (id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_log (entity_type, entity_id);

CREATE TABLE notifications (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL', 'URGENT')),
  title text NOT NULL,
  body text NOT NULL,
  link text,
  dedupe_key text UNIQUE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, id DESC);

-- ---------------------------------------------------------------------------
-- Programme set-up (one row) and XP rules
-- ---------------------------------------------------------------------------
CREATE TABLE program_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  points_per_ringgit integer NOT NULL DEFAULT 1 CHECK (points_per_ringgit BETWEEN 0 AND 10),
  issuance_fee_bps integer NOT NULL DEFAULT 1500 CHECK (issuance_fee_bps BETWEEN 0 AND 5000),
  min_redeem_points integer NOT NULL DEFAULT 100 CHECK (min_redeem_points > 0),
  redeem_step_points integer NOT NULL DEFAULT 100 CHECK (redeem_step_points > 0),
  max_redeem_bps integer NOT NULL DEFAULT 3000 CHECK (max_redeem_bps BETWEEN 0 AND 10000),
  points_daily_person integer NOT NULL DEFAULT 2000 CHECK (points_daily_person > 0),
  points_monthly_person integer NOT NULL DEFAULT 20000 CHECK (points_monthly_person > 0),
  points_monthly_home integer NOT NULL DEFAULT 40000 CHECK (points_monthly_home > 0),
  expiry_inactive_months integer NOT NULL DEFAULT 12 CHECK (expiry_inactive_months > 0),
  expiry_max_months integer NOT NULL DEFAULT 24 CHECK (expiry_max_months >= expiry_inactive_months),
  redeem_confirm_minutes integer NOT NULL DEFAULT 5 CHECK (redeem_confirm_minutes BETWEEN 1 AND 60),
  flood_warning_pct integer NOT NULL DEFAULT 75 CHECK (flood_warning_pct BETWEEN 1 AND 100),
  flood_danger_pct integer NOT NULL DEFAULT 90 CHECK (flood_danger_pct BETWEEN flood_warning_pct AND 100),
  flag_hide_threshold integer NOT NULL DEFAULT 3 CHECK (flag_hide_threshold > 0),
  min_group_size integer NOT NULL DEFAULT 10 CHECK (min_group_size >= 2),
  timezone text NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  -- Set automatically when a float check fails. No points move while true.
  issuance_paused boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO program_settings (id) VALUES (true);

CREATE TABLE activity_rules (
  activity text PRIMARY KEY,
  label text NOT NULL,
  xp integer NOT NULL CHECK (xp >= 0),
  quantity_unit text,                        -- what xp_events.quantity measures, if anything
  daily_cap_person integer NOT NULL CHECK (daily_cap_person > 0),
  monthly_cap_home integer NOT NULL CHECK (monthly_cap_home > 0)
);
INSERT INTO activity_rules (activity, label, xp, quantity_unit, daily_cap_person, monthly_cap_home) VALUES
  ('JIRAN_EVENT',   'Joined a township event',          30, NULL, 2,  16),
  ('JIRAN_HELP',    'Helped a neighbour',               40, NULL, 3,  30),
  ('KONGSI_SHARE',  'Gave or lent an item',             30, NULL, 3,  30),
  ('LAPOR_REPORT',  'Report confirmed by staff',        25, NULL, 3,  20),
  ('GERAK_CHECKIN', 'Scanned a trail checkpoint',        5, NULL, 12, 400),
  ('GERAK_LOOP',    'Finished a township loop',         40, 'm',  2,  80),
  ('KITAR_DROPOFF', 'Recycling drop-off',               20, 'g',  2,  60),
  ('JIMAT_READING', 'Logged monthly meter readings',    15, NULL, 1,  1),
  ('JIMAT_SAVER',   'Used less than last month',        50, NULL, 1,  1);

CREATE TABLE xp_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  activity text NOT NULL REFERENCES activity_rules (activity),
  ref text NOT NULL,                         -- the thing that was verified; makes awards idempotent
  xp integer NOT NULL CHECK (xp >= 0),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, activity, ref)
);
CREATE INDEX xp_events_user_time_idx ON xp_events (user_id, created_at);
CREATE INDEX xp_events_activity_time_idx ON xp_events (activity, created_at);

-- ---------------------------------------------------------------------------
-- Campaigns (sponsor challenges and SDP community programmes)
-- ---------------------------------------------------------------------------
CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  sponsor_id uuid REFERENCES sponsors (id),  -- NULL = funded by Sime Darby Property
  title text NOT NULL,
  description text NOT NULL,
  activity text NOT NULL REFERENCES activity_rules (activity),
  goal_metric text NOT NULL DEFAULT 'COUNT' CHECK (goal_metric IN ('COUNT', 'QUANTITY')),
  goal_target integer NOT NULL DEFAULT 1 CHECK (goal_target > 0),
  reward_points integer NOT NULL CHECK (reward_points > 0),
  per_person_cap integer NOT NULL DEFAULT 1 CHECK (per_person_cap > 0),
  budget_sen bigint NOT NULL CHECK (budget_sen > 0),
  pool_bps integer NOT NULL CHECK (pool_bps > 0),
  fee_bps integer NOT NULL CHECK (fee_bps >= 0),
  costs_bps integer NOT NULL CHECK (costs_bps >= 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'FUNDED', 'CLOSED')),
  refunded_sen bigint,
  created_by uuid NOT NULL REFERENCES users (id),
  funded_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (pool_bps + fee_bps + costs_bps = 10000)
);
CREATE INDEX campaigns_live_idx ON campaigns (township_id, activity, status, starts_at, ends_at);
CREATE INDEX campaigns_sponsor_idx ON campaigns (sponsor_id);

-- ---------------------------------------------------------------------------
-- The points ledger (double entry)
-- ---------------------------------------------------------------------------
CREATE TABLE ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'TRUST_BANK',               -- asset: the ring-fenced reward float
    'OPERATING_BANK',           -- asset: KITA+'s own money
    'FUNDER_POOL',              -- liability: money a shop or campaign has paid in, not yet given as points
    'WALLET',                   -- liability: points a resident holds
    'MERCHANT_PAYABLE',         -- liability: owed to a shop for points it accepted
    'COMMUNITY_POOL',           -- liability: value held for community rewards
    'REVENUE_ISSUANCE_FEE',     -- income
    'REVENUE_CAMPAIGN_FEE',     -- income
    'REVENUE_CAMPAIGN_COSTS'    -- income earmarked for running campaigns
  )),
  normal_side char(1) NOT NULL CHECK (normal_side IN ('D', 'C')),
  merchant_id uuid REFERENCES merchants (id),
  campaign_id uuid REFERENCES campaigns (id),
  user_id uuid REFERENCES users (id),
  -- Kept up to date by a trigger. It can never go below zero: this is the
  -- database-level guarantee behind "no pool, no points".
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(merchant_id, campaign_id, user_id) <= 1),
  UNIQUE NULLS NOT DISTINCT (kind, merchant_id, campaign_id, user_id)
);
CREATE INDEX ledger_accounts_user_idx ON ledger_accounts (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX ledger_accounts_merchant_idx ON ledger_accounts (merchant_id) WHERE merchant_id IS NOT NULL;

INSERT INTO ledger_accounts (kind, normal_side) VALUES
  ('TRUST_BANK', 'D'), ('OPERATING_BANK', 'D'), ('COMMUNITY_POOL', 'C'),
  ('REVENUE_ISSUANCE_FEE', 'C'), ('REVENUE_CAMPAIGN_FEE', 'C'), ('REVENUE_CAMPAIGN_COSTS', 'C');

CREATE TABLE ledger_txns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'DEPOSIT', 'ISSUE', 'REDEEM', 'REFUND_CLAWBACK', 'REFUND_RETURN', 'EXPIRE',
    'SETTLEMENT', 'CAMPAIGN_FUND', 'CAMPAIGN_REFUND', 'ADJUSTMENT'
  )),
  label text NOT NULL,                       -- who funded or received it, in words a resident can read
  ref_type text,
  ref_id uuid,
  actor_user_id uuid REFERENCES users (id),
  created_at timestamptz NOT NULL
);
CREATE INDEX ledger_txns_ref_idx ON ledger_txns (ref_type, ref_id);

CREATE TABLE ledger_entries (
  id bigserial PRIMARY KEY,
  txn_id uuid NOT NULL REFERENCES ledger_txns (id),
  account_id uuid NOT NULL REFERENCES ledger_accounts (id),
  amount bigint NOT NULL CHECK (amount <> 0)  -- positive = debit, negative = credit
);
CREATE INDEX ledger_entries_account_idx ON ledger_entries (account_id, id DESC);
CREATE INDEX ledger_entries_txn_idx ON ledger_entries (txn_id);

-- 1. Every entry moves its account balance.
CREATE FUNCTION ledger_apply_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE ledger_accounts
     SET balance = balance + CASE normal_side WHEN 'D' THEN NEW.amount ELSE -NEW.amount END
   WHERE id = NEW.account_id;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_entries_apply AFTER INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_apply_entry();

-- 2. Every transaction must balance, checked when the database transaction commits.
CREATE FUNCTION ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT sum(amount) FROM ledger_entries WHERE txn_id = NEW.txn_id) <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % does not balance', NEW.txn_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

-- 3. The ledger is append-only. Corrections are new transactions.
CREATE FUNCTION ledger_forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the ledger is append-only' USING ERRCODE = 'restrict_violation';
END $$;
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_forbid_change();
CREATE TRIGGER ledger_txns_immutable BEFORE UPDATE OR DELETE ON ledger_txns
  FOR EACH ROW EXECUTE FUNCTION ledger_forbid_change();

-- Each batch of points remembers who funded it and when it expires.
CREATE TABLE point_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  funder_account_id uuid NOT NULL REFERENCES ledger_accounts (id),
  txn_id uuid NOT NULL REFERENCES ledger_txns (id),
  source text NOT NULL CHECK (source IN ('PURCHASE', 'CAMPAIGN', 'ADJUSTMENT', 'REFUND_RETURN')),
  amount integer NOT NULL CHECK (amount > 0),
  remaining integer NOT NULL CHECK (remaining >= 0),
  redeemed integer NOT NULL DEFAULT 0 CHECK (redeemed >= 0),  -- how much of this batch was spent at shops
  earned_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (remaining + redeemed <= amount)
);
CREATE INDEX point_lots_open_idx ON point_lots (user_id, expires_at, earned_at) WHERE remaining > 0;
CREATE INDEX point_lots_earned_idx ON point_lots (user_id, earned_at);
CREATE INDEX point_lots_txn_idx ON point_lots (txn_id);

CREATE TABLE campaign_awards (
  campaign_id uuid NOT NULL REFERENCES campaigns (id),
  user_id uuid NOT NULL REFERENCES users (id),
  seq integer NOT NULL CHECK (seq > 0),      -- 1st, 2nd … reward for this person, up to per_person_cap
  points integer NOT NULL CHECK (points > 0),
  txn_id uuid NOT NULL REFERENCES ledger_txns (id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (campaign_id, user_id, seq)
);

-- ---------------------------------------------------------------------------
-- Shops: sales, settlements, money paid in
-- ---------------------------------------------------------------------------
CREATE TABLE sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants (id),
  user_id uuid NOT NULL REFERENCES users (id),
  cashier_user_id uuid NOT NULL REFERENCES users (id),
  idempotency_key uuid NOT NULL,             -- a retried request never creates a second sale
  bill_sen integer NOT NULL CHECK (bill_sen > 0),
  redeem_points integer NOT NULL DEFAULT 0 CHECK (redeem_points >= 0 AND redeem_points < bill_sen),
  points_earned integer NOT NULL DEFAULT 0 CHECK (points_earned >= 0),
  fee_sen integer NOT NULL DEFAULT 0 CHECK (fee_sen >= 0),
  earn_note text CHECK (earn_note IN ('POOL_EMPTY', 'LIMIT_REACHED')),
  status text NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'DECLINED', 'EXPIRED', 'REFUNDED')),
  expires_at timestamptz,                    -- deadline for the resident to confirm on their phone
  completed_at timestamptz,
  refunded_at timestamptz,
  refund_shortfall_sen integer,
  created_at timestamptz NOT NULL,
  UNIQUE (merchant_id, idempotency_key)
);
CREATE INDEX sales_merchant_time_idx ON sales (merchant_id, created_at DESC);
CREATE INDEX sales_user_status_idx ON sales (user_id, status);

CREATE TABLE settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants (id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  amount_sen bigint NOT NULL CHECK (amount_sen > 0),
  txn_id uuid NOT NULL REFERENCES ledger_txns (id),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL,
  UNIQUE (merchant_id, period_end),
  CHECK (period_end >= period_start)
);

CREATE TABLE deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid REFERENCES merchants (id),
  campaign_id uuid REFERENCES campaigns (id),
  amount_sen bigint NOT NULL CHECK (amount_sen > 0),
  bank_ref text NOT NULL,
  txn_id uuid NOT NULL REFERENCES ledger_txns (id),
  recorded_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  CHECK (num_nonnulls(merchant_id, campaign_id) <= 1),  -- neither = paid into the community pool
  UNIQUE (bank_ref)
);

CREATE TABLE float_checks (
  id bigserial PRIMARY KEY,
  checked_at timestamptz NOT NULL,
  trust_sen bigint NOT NULL,
  wallets_sen bigint NOT NULL,
  payables_sen bigint NOT NULL,
  pools_sen bigint NOT NULL,
  community_sen bigint NOT NULL,
  lots_sen bigint NOT NULL,
  bank_statement_sen bigint,
  ok boolean NOT NULL,
  issues jsonb NOT NULL DEFAULT '[]',
  run_by uuid REFERENCES users (id)
);

-- Manual balance changes need a second person (BR22).
CREATE TABLE adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  points integer NOT NULL CHECK (points <> 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  requested_by uuid NOT NULL REFERENCES users (id),
  decided_by uuid REFERENCES users (id),
  txn_id uuid REFERENCES ledger_txns (id),
  created_at timestamptz NOT NULL,
  decided_at timestamptz,
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE INDEX adjustments_status_idx ON adjustments (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Jiran and Kongsi: community posts
-- ---------------------------------------------------------------------------
CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  author_id uuid NOT NULL REFERENCES users (id),
  type text NOT NULL CHECK (type IN ('EVENT', 'HELP', 'GIVE', 'LEND')),
  title text NOT NULL,
  body text NOT NULL,
  location text,
  starts_at timestamptz,
  capacity integer CHECK (capacity > 0),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'HIDDEN', 'REMOVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (type <> 'EVENT' OR starts_at IS NOT NULL)
);
CREATE INDEX posts_feed_idx ON posts (township_id, type, status, created_at DESC);

CREATE TABLE post_responses (
  post_id uuid NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX post_responses_user_idx ON post_responses (user_id);

CREATE TABLE post_flags (
  post_id uuid NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Lapor: reports and their photos
-- ---------------------------------------------------------------------------
CREATE TABLE uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id),
  mime text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  reporter_id uuid NOT NULL REFERENCES users (id),
  zone_id uuid REFERENCES flood_zones (id),
  category text NOT NULL CHECK (category IN ('POTHOLE', 'LIGHTING', 'DRAINAGE', 'WASTE', 'ACCESS_BARRIER', 'SAFETY', 'OTHER')),
  urgency text NOT NULL CHECK (urgency IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  -- What the classifier suggested, kept so staff corrections can be measured (BR21).
  ai_category text,
  ai_urgency text,
  ai_source text CHECK (ai_source IN ('MODEL', 'RULES')),
  description text NOT NULL,
  location_text text NOT NULL,
  photo_id uuid REFERENCES uploads (id),
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED')),
  staff_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX reports_queue_idx ON reports (township_id, status, created_at DESC);
CREATE INDEX reports_reporter_idx ON reports (reporter_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Gerak: loops and checkpoints
-- ---------------------------------------------------------------------------
CREATE TABLE gerak_loops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  name text NOT NULL,
  description text NOT NULL,
  mode text NOT NULL DEFAULT 'WALK' CHECK (mode IN ('WALK', 'CYCLE')),
  distance_m integer NOT NULL CHECK (distance_m > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (township_id, name)
);

CREATE TABLE gerak_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id uuid NOT NULL REFERENCES gerak_loops (id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq > 0),
  name text NOT NULL,
  code text NOT NULL UNIQUE,                 -- printed as a QR code at the checkpoint
  UNIQUE (loop_id, seq)
);

CREATE TABLE gerak_checkins (
  checkpoint_id uuid NOT NULL REFERENCES gerak_checkpoints (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  day date NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (checkpoint_id, user_id, day)
);
CREATE INDEX gerak_checkins_user_day_idx ON gerak_checkins (user_id, day);

-- ---------------------------------------------------------------------------
-- Kitar: kiosks and drop-offs
-- ---------------------------------------------------------------------------
CREATE TABLE kitar_kiosks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  name text NOT NULL,
  location text NOT NULL,
  code text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (township_id, name)
);

CREATE TABLE kitar_dropoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kiosk_id uuid NOT NULL REFERENCES kitar_kiosks (id),
  user_id uuid NOT NULL REFERENCES users (id),
  material text NOT NULL CHECK (material IN ('PLASTIC_PET', 'PLASTIC_OTHER', 'PAPER', 'GLASS', 'ALUMINIUM', 'E_WASTE', 'TEXTILE', 'COOKING_OIL')),
  weight_g integer NOT NULL CHECK (weight_g BETWEEN 1 AND 20000),
  created_at timestamptz NOT NULL
);
CREATE INDEX kitar_dropoffs_user_idx ON kitar_dropoffs (user_id, created_at DESC);
CREATE INDEX kitar_dropoffs_time_idx ON kitar_dropoffs (created_at);

-- ---------------------------------------------------------------------------
-- Jimat: meter readings and solar interest
-- ---------------------------------------------------------------------------
CREATE TABLE jimat_readings (
  home_id uuid NOT NULL REFERENCES homes (id),
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  electricity_kwh integer NOT NULL CHECK (electricity_kwh BETWEEN 0 AND 100000),
  water_litres integer NOT NULL CHECK (water_litres BETWEEN 0 AND 10000000),
  entered_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (home_id, month)
);

-- Created only when a resident asks to be contacted (BR16).
CREATE TABLE solar_leads (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  consent_at timestamptz NOT NULL,
  note text
);

-- ---------------------------------------------------------------------------
-- Banjir: readings and alerts
-- ---------------------------------------------------------------------------
CREATE TABLE flood_readings (
  id bigserial PRIMARY KEY,
  zone_id uuid NOT NULL REFERENCES flood_zones (id),
  level_pct integer NOT NULL CHECK (level_pct BETWEEN 0 AND 100),
  source text NOT NULL CHECK (source IN ('SENSOR', 'MANUAL')),
  created_at timestamptz NOT NULL
);
CREATE INDEX flood_readings_zone_idx ON flood_readings (zone_id, id DESC);

CREATE TABLE flood_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES flood_zones (id),
  level text NOT NULL CHECK (level IN ('WARNING', 'DANGER')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz
);
-- At most one open alert per zone.
CREATE UNIQUE INDEX flood_alerts_open_idx ON flood_alerts (zone_id) WHERE ended_at IS NULL;
