-- The courier platform. Township admins approve courier companies, not each
-- courier: an approved company manages its own couriers (its managers invite
-- and suspend them) or signs them in through its own identity system. Parcels
-- are identified by the barcode already on the label and checked with the
-- courier company's system (simulated in the demo; no courier company's real
-- system is connected). Every scan is logged, and a shipment can be deposited
-- once. Additive: couriers approved one by one keep working as before.

-- ---------------------------------------------------------------------------
-- Companies: how their couriers sign in and how shipments are checked
-- ---------------------------------------------------------------------------
ALTER TABLE courier_companies
  ADD COLUMN code text UNIQUE CHECK (code ~ '^[A-Z0-9]{2,12}$'),
  -- MANUAL: couriers apply and a township admin approves each one (the fallback).
  -- COMPANY_MANAGED: the company's own managers invite and suspend its couriers.
  -- FEDERATED: couriers sign in through the company's identity system (OpenID Connect).
  ADD COLUMN auth_method text NOT NULL DEFAULT 'MANUAL' CHECK (auth_method IN ('MANUAL', 'COMPANY_MANAGED', 'FEDERATED')),
  -- NONE: no shipment lookup. SIMULATED: the built-in demo provider. GATEWAY: SimeTown's signed lookup contract.
  ADD COLUMN provider_mode text NOT NULL DEFAULT 'NONE' CHECK (provider_mode IN ('NONE', 'SIMULATED', 'GATEWAY')),
  ADD COLUMN provider_url text,
  ADD COLUMN provider_secret_env text,          -- the NAME of the environment variable holding the shared secret, never the secret
  ADD COLUMN can_confirm_assignment boolean NOT NULL DEFAULT false, -- the provider says which courier carries a shipment
  ADD COLUMN tracking_pattern text,             -- what this company's tracking numbers look like, as a regular expression
  ADD COLUMN idp_mode text CHECK (idp_mode IN ('SIMULATED', 'OIDC')),
  ADD COLUMN idp_issuer text,
  ADD COLUMN idp_client_id text,
  ADD COLUMN idp_client_secret_env text,
  ADD COLUMN webhook_secret_env text,           -- signs the company's "courier suspended" messages
  ADD COLUMN require_mfa boolean NOT NULL DEFAULT false,
  ADD COLUMN sim_outage boolean NOT NULL DEFAULT false, -- simulated providers only: pretend the provider is down
  ADD COLUMN provider_checked_at timestamptz,
  ADD COLUMN provider_ok boolean,
  ADD COLUMN provider_error text,
  ADD COLUMN provider_latency_ms integer,
  ADD CONSTRAINT courier_companies_gateway_check CHECK (provider_mode <> 'GATEWAY' OR (provider_url IS NOT NULL AND provider_secret_env IS NOT NULL)),
  ADD CONSTRAINT courier_companies_federated_check CHECK (auth_method <> 'FEDERATED' OR idp_mode IS NOT NULL),
  ADD CONSTRAINT courier_companies_oidc_check CHECK (idp_mode IS DISTINCT FROM 'OIDC' OR (idp_issuer IS NOT NULL AND idp_client_id IS NOT NULL AND idp_client_secret_env IS NOT NULL));

-- A company's approval in one township: its agreement, its stations and its standing.
CREATE TABLE courier_company_townships (
  company_id uuid NOT NULL REFERENCES courier_companies (id) ON DELETE CASCADE,
  township_id uuid NOT NULL REFERENCES townships (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED')),
  verified_note text,                           -- how the company's identity was checked (registration, signed agreement)
  agreement_ref text,
  agreement_until date,
  -- The least assurance a delivery needs to go ahead without a resident's delivery code.
  min_assurance text NOT NULL DEFAULT 'MEDIUM' CHECK (min_assurance IN ('HIGH', 'MEDIUM')),
  -- When the provider cannot be reached, may couriers fall back on the resident's delivery code?
  allow_fallback boolean NOT NULL DEFAULT true,
  status_reason text,
  approved_by uuid REFERENCES users (id) ON DELETE SET NULL,
  approved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, township_id)
);

CREATE TABLE courier_company_stations (
  company_id uuid NOT NULL REFERENCES courier_companies (id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES locker_stations (id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users (id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, station_id)
);

-- Who changed a company's access, and why: its access history.
CREATE TABLE courier_company_events (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES courier_companies (id) ON DELETE CASCADE,
  township_id uuid REFERENCES townships (id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid REFERENCES users (id) ON DELETE SET NULL,
  note text,
  webhook_event_id text,                        -- a message from the company's own system, accepted once
  at timestamptz NOT NULL
);
CREATE INDEX courier_company_events_idx ON courier_company_events (company_id, at DESC);
CREATE UNIQUE INDEX courier_company_events_webhook_idx ON courier_company_events (company_id, webhook_event_id) WHERE webhook_event_id IS NOT NULL;

-- Existing companies keep working exactly as before: approved, couriers approved one by one.
INSERT INTO courier_company_townships (company_id, township_id, status, verified_note, approved_at)
SELECT c.id, t.id, CASE WHEN c.active THEN 'ACTIVE' ELSE 'SUSPENDED' END, 'Approved before company-level approval existed', now()
  FROM courier_companies c CROSS JOIN townships t
 WHERE EXISTS (SELECT 1 FROM locker_stations s WHERE s.township_id = t.id);

-- ---------------------------------------------------------------------------
-- Couriers: who manages each account
-- ---------------------------------------------------------------------------
ALTER TABLE courier_accounts DROP CONSTRAINT courier_accounts_status_check;
ALTER TABLE courier_accounts
  ADD CONSTRAINT courier_accounts_status_check CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED')),
  ADD COLUMN kind text NOT NULL DEFAULT 'COURIER' CHECK (kind IN ('COURIER', 'MANAGER')),
  ADD COLUMN managed_by text NOT NULL DEFAULT 'TOWNSHIP' CHECK (managed_by IN ('TOWNSHIP', 'COMPANY', 'FEDERATED')),
  ADD COLUMN employee_ref text,                 -- the company's own staff number, or the subject from its sign-in
  ADD COLUMN invited_by uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN last_verified_at timestamptz;     -- when the company's sign-in or managers last confirmed this courier
CREATE UNIQUE INDEX courier_accounts_employee_idx ON courier_accounts (company_id, employee_ref) WHERE employee_ref IS NOT NULL;

-- Courier sign-ins, to spot a stolen login used from many places at once.
CREATE TABLE courier_logins (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('PASSWORD', 'FEDERATED')),
  ip text NOT NULL,
  user_agent text,
  at timestamptz NOT NULL
);
CREATE INDEX courier_logins_user_idx ON courier_logins (user_id, at DESC);

-- A federated sign-in in progress: state, nonce and the PKCE verifier, used once within ten minutes.
CREATE TABLE courier_login_states (
  state_hash text PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES courier_companies (id) ON DELETE CASCADE,
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  return_to text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Shipments: one row per courier company and tracking number, for ever
-- ---------------------------------------------------------------------------
CREATE TABLE courier_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES courier_companies (id),
  township_id uuid NOT NULL REFERENCES townships (id),
  tracking_no text NOT NULL CHECK (tracking_no = upper(tracking_no)),
  provider_ref text,
  verification text NOT NULL CHECK (verification IN (
    'VERIFIED', 'NOT_FOUND', 'UNVERIFIED', 'PROVIDER_UNAVAILABLE', 'RECIPIENT_MISMATCH', 'NOT_ELIGIBLE', 'ALREADY_DEPOSITED')),
  reason text,
  -- HIGH: the provider confirmed the shipment and that this courier carries it. MEDIUM: the shipment only.
  -- LOW: nothing from the provider; the courier gave the resident's delivery code.
  assurance text CHECK (assurance IN ('HIGH', 'MEDIUM', 'LOW')),
  match_method text CHECK (match_method IN ('MEMBER_CODE', 'PHONE_NAME_ADDRESS', 'ADDRESS_NAME', 'DELIVERY_CODE', 'LABEL_ADDRESS_NAME')),
  match_evidence jsonb NOT NULL DEFAULT '[]', -- which details agreed, never the details themselves
  home_id uuid REFERENCES homes (id),
  recipient_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  size text CHECK (size IN ('S', 'M', 'L', 'XL')),
  parcel_id uuid REFERENCES locker_parcels (id) ON DELETE SET NULL,
  deposited_at timestamptz,                     -- set once and never cleared: the same shipment is never deposited twice
  provider_notified_at timestamptz,             -- when the courier company was told it is in a locker
  notify_attempts integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL,
  last_checked_at timestamptz NOT NULL,
  UNIQUE (company_id, tracking_no)
);
CREATE INDEX courier_shipments_township_idx ON courier_shipments (township_id, last_checked_at DESC);

ALTER TABLE locker_parcels
  ADD COLUMN shipment_id uuid REFERENCES courier_shipments (id) ON DELETE SET NULL,
  ADD COLUMN assurance text CHECK (assurance IN ('HIGH', 'MEDIUM', 'LOW'));
-- The database itself refuses a second delivery of the same shipment: at most one parcel that was not a failed delivery.
CREATE UNIQUE INDEX locker_parcels_one_delivery_per_shipment_idx ON locker_parcels (shipment_id) WHERE shipment_id IS NOT NULL AND state <> 'DELIVERY_FAILED';

-- Every scan or typed tracking number, with what happened: duplicate and replayed scans show up here.
CREATE TABLE courier_scans (
  id bigserial PRIMARY KEY,
  township_id uuid NOT NULL REFERENCES townships (id) ON DELETE CASCADE,
  company_id uuid REFERENCES courier_companies (id) ON DELETE SET NULL,
  courier_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  station_id uuid REFERENCES locker_stations (id) ON DELETE SET NULL,
  shipment_id uuid REFERENCES courier_shipments (id) ON DELETE SET NULL,
  tracking_no text NOT NULL,
  outcome text NOT NULL,
  reason text,
  at timestamptz NOT NULL
);
CREATE INDEX courier_scans_township_idx ON courier_scans (township_id, at DESC);
CREATE INDEX courier_scans_shipment_idx ON courier_scans (shipment_id, at DESC);
CREATE INDEX courier_scans_courier_idx ON courier_scans (courier_user_id, at DESC);

-- ---------------------------------------------------------------------------
-- The simulated courier companies (demo only; clearly labelled everywhere)
-- ---------------------------------------------------------------------------
-- The simulated company's own shipment records: what its real system would answer.
CREATE TABLE sim_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES courier_companies (id) ON DELETE CASCADE,
  tracking_no text NOT NULL CHECK (tracking_no = upper(tracking_no)),
  status text NOT NULL CHECK (status IN ('IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'ON_HOLD', 'CANCELLED', 'RETURNED')),
  locker_eligible boolean NOT NULL DEFAULT true,
  recipient_name text NOT NULL,
  recipient_phone text,
  address_line text NOT NULL,
  postcode text,
  simetown_code text,                           -- a resident's SimeTown delivery code, when they gave it to the shop
  weight_g integer,
  length_mm integer, width_mm integer, height_mm integer,
  assigned_courier_ref text,                    -- the employee carrying it, when the provider tracks that
  demo_case text NOT NULL,                      -- what this record shows in the demo
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, tracking_no)
);

-- The simulated company's own staff directory (what its identity system knows).
CREATE TABLE sim_directory (
  company_id uuid NOT NULL REFERENCES courier_companies (id) ON DELETE CASCADE,
  employee_ref text NOT NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (company_id, employee_ref)
);

-- The simulated identity provider's signing keys and one-time authorisation codes.
CREATE TABLE sim_idp_keys (
  company_id uuid PRIMARY KEY REFERENCES courier_companies (id) ON DELETE CASCADE,
  kid text NOT NULL,
  private_pem text NOT NULL,                    -- a demo key for the simulated provider only
  public_jwk jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE sim_idp_codes (
  code_hash text PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES courier_companies (id) ON DELETE CASCADE,
  employee_ref text NOT NULL,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  nonce text NOT NULL,
  code_challenge text NOT NULL,
  amr text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Security incidents and staff exceptions
-- ---------------------------------------------------------------------------
CREATE TABLE locker_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'BARCODE_REPLAY', 'SHIPMENT_IN_USE', 'SUSPENDED_COURIER', 'UNKNOWN_SHIPMENT', 'RECIPIENT_MISMATCH', 'PROVIDER_OUTAGE',
    'DOOR_FORCED', 'DOOR_LEFT_OPEN', 'UNLOCK_FAILED', 'COMMAND_REJECTED', 'KEYPAD_LOCKED', 'SUSPICIOUS_LOGIN',
    'NOT_COLLECTED_BY_ME', 'STAFF_REPORT')),
  severity text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  station_id uuid REFERENCES locker_stations (id) ON DELETE SET NULL,
  parcel_id uuid REFERENCES locker_parcels (id) ON DELETE SET NULL,
  shipment_id uuid REFERENCES courier_shipments (id) ON DELETE SET NULL,
  company_id uuid REFERENCES courier_companies (id) ON DELETE SET NULL,
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,   -- whose action raised it, when there was one
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  dedupe_key text UNIQUE,
  handled_by uuid REFERENCES users (id) ON DELETE SET NULL,
  resolution text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX locker_incidents_open_idx ON locker_incidents (township_id, status, created_at DESC);

-- A staff request to open an occupied compartment outside the normal flow, approved by a second admin.
CREATE TABLE locker_exception_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id) ON DELETE CASCADE,
  parcel_id uuid NOT NULL REFERENCES locker_parcels (id) ON DELETE CASCADE,
  compartment_id uuid NOT NULL REFERENCES locker_compartments (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'WRONG_COMPARTMENT', 'WRONG_RECIPIENT', 'INTERRUPTED_DEPOSIT', 'RETRIEVAL', 'DAMAGED', 'SUSPECTED_THEFT', 'HARDWARE', 'UNCOLLECTED')),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'DONE', 'CANCELLED')),
  requested_by uuid NOT NULL REFERENCES users (id),
  requested_at timestamptz NOT NULL,
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  decision_note text,
  command_id uuid REFERENCES locker_commands (id) ON DELETE SET NULL,
  CHECK (decided_by IS NULL OR decided_by <> requested_by OR status = 'CANCELLED')
);
CREATE UNIQUE INDEX locker_exception_open_idx ON locker_exception_requests (parcel_id) WHERE status IN ('PENDING', 'APPROVED');

ALTER TABLE collection_policies ADD COLUMN exceptions_need_second_approval boolean NOT NULL DEFAULT true;

-- Door commands: the exception purpose, and when the (simulated) controller carried a command out.
ALTER TABLE locker_commands DROP CONSTRAINT locker_commands_purpose_check;
ALTER TABLE locker_commands
  ADD CONSTRAINT locker_commands_purpose_check CHECK (purpose IN ('DEPOSIT', 'COLLECT', 'RELOCATE', 'MAINTENANCE', 'EXCEPTION')),
  ADD COLUMN executed_at timestamptz;
