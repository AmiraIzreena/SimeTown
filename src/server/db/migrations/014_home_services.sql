-- SimeTown Home Services: residents book a township service company, the company
-- assigns one of its registered workers, and the resident confirms the job, reviews
-- it or privately reports a problem. Prices are agreed in person after inspection;
-- no money moves through SimeTown and nothing here touches the points ledger.

-- A business account can run a shop, offer home services, or both.
-- Existing shops stay retail-only.
ALTER TABLE merchants
  ADD COLUMN offers_retail boolean NOT NULL DEFAULT true,
  ADD COLUMN offers_services boolean NOT NULL DEFAULT false,
  ADD COLUMN service_about text CHECK (char_length(service_about) <= 600),
  ADD CONSTRAINT merchants_offers_something CHECK (offers_retail OR offers_services);

-- One listing per service category per company, with its pricing disclosed before booking.
CREATE TABLE service_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants (id),
  category text NOT NULL CHECK (category IN ('PLUMBING', 'ELECTRICAL', 'AIRCON', 'CLEANING', 'REPAIRS', 'RENOVATION')),
  description text NOT NULL CHECK (char_length(description) BETWEEN 5 AND 600),
  pricing text NOT NULL CHECK (pricing IN ('FIXED', 'INSPECTION', 'QUOTE')),
  -- An inspection or call-out fee shown before booking; NULL when there is none.
  callout_fee_sen integer CHECK (callout_fee_sen BETWEEN 0 AND 100000),
  price_note text NOT NULL CHECK (char_length(price_note) BETWEEN 3 AND 200),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, category)
);
CREATE INDEX service_listings_category_idx ON service_listings (category) WHERE active;

-- The company's registered workers. They do not sign in; the company assigns them.
-- Name and phone only, never an identity card number.
CREATE TABLE service_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants (id),
  full_name text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 80),
  phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_workers_merchant_idx ON service_workers (merchant_id);

CREATE TABLE service_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  merchant_id uuid NOT NULL REFERENCES merchants (id),
  listing_id uuid NOT NULL REFERENCES service_listings (id),
  resident_id uuid NOT NULL REFERENCES users (id),
  home_id uuid NOT NULL REFERENCES homes (id),
  worker_id uuid REFERENCES service_workers (id),
  problem text NOT NULL CHECK (char_length(problem) BETWEEN 5 AND 1000),
  photo_id uuid REFERENCES uploads (id) ON DELETE SET NULL,
  preferred_date date NOT NULL,
  preferred_slot text NOT NULL CHECK (preferred_slot IN ('MORNING', 'AFTERNOON', 'EVENING')),
  -- Set by the company when it accepts; may differ from the resident's preference.
  scheduled_at timestamptz,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN (
    'REQUESTED',   -- waiting for the company
    'ACCEPTED',    -- the company confirmed a visit time
    'SCHEDULED',   -- a worker is assigned
    'IN_PROGRESS', -- the worker is on site: inspection, price agreed in person, work
    'WORK_DONE',   -- the company says the work is finished; waiting for the resident
    'COMPLETED',   -- the resident confirmed
    'DECLINED', 'CANCELLED')),
  provider_note text CHECK (char_length(provider_note) <= 300),
  closed_reason text CHECK (char_length(closed_reason) <= 300),
  -- The Tamu contractor pass the resident sent for this visit, if any.
  pass_id uuid REFERENCES visitor_passes (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK (status NOT IN ('ACCEPTED', 'SCHEDULED', 'IN_PROGRESS', 'WORK_DONE', 'COMPLETED') OR scheduled_at IS NOT NULL),
  CHECK (status NOT IN ('SCHEDULED', 'IN_PROGRESS', 'WORK_DONE', 'COMPLETED') OR worker_id IS NOT NULL),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL))
);
CREATE INDEX service_bookings_merchant_idx ON service_bookings (merchant_id, created_at DESC);
CREATE INDEX service_bookings_resident_idx ON service_bookings (resident_id, created_at DESC);
CREATE INDEX service_bookings_worker_idx ON service_bookings (worker_id);
-- One open booking per home for the same listing: a double tap cannot book twice.
CREATE UNIQUE INDEX service_bookings_one_open_idx ON service_bookings (home_id, listing_id)
  WHERE status IN ('REQUESTED', 'ACCEPTED', 'SCHEDULED', 'IN_PROGRESS', 'WORK_DONE');

-- Every change of status or worker, with who made it and when: the record staff
-- rely on when they look into a complaint.
CREATE TABLE service_booking_events (
  id bigserial PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES service_bookings (id),
  actor_user_id uuid REFERENCES users (id),
  kind text NOT NULL CHECK (kind IN ('STATUS', 'WORKER', 'PASS')),
  from_status text,
  to_status text,
  worker_id uuid REFERENCES service_workers (id),
  -- The worker's name as it was then, in case the record is edited later.
  worker_name text,
  note text CHECK (char_length(note) <= 300),
  created_at timestamptz NOT NULL
);
CREATE INDEX service_booking_events_booking_idx ON service_booking_events (booking_id, id);

-- Only a completed booking can be reviewed, once.
CREATE TABLE service_reviews (
  booking_id uuid PRIMARY KEY REFERENCES service_bookings (id),
  merchant_id uuid NOT NULL REFERENCES merchants (id),
  resident_id uuid NOT NULL REFERENCES users (id),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text CHECK (char_length(comment) <= 500),
  created_at timestamptz NOT NULL
);
CREATE INDEX service_reviews_merchant_idx ON service_reviews (merchant_id, created_at DESC);

-- Private reports about a booking. Seen by the resident who made them and township
-- staff only, never by the company.
CREATE TABLE service_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  booking_id uuid NOT NULL REFERENCES service_bookings (id),
  merchant_id uuid NOT NULL REFERENCES merchants (id),
  -- The worker assigned when the report was made.
  worker_id uuid REFERENCES service_workers (id),
  resident_id uuid NOT NULL REFERENCES users (id),
  category text NOT NULL CHECK (category IN ('HARASSMENT', 'MISCONDUCT', 'NO_SHOW', 'POOR_WORK', 'PRICING', 'OTHER')),
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 1000),
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'REVIEWING', 'CLOSED')),
  staff_note text CHECK (char_length(staff_note) <= 500),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX service_reports_township_idx ON service_reports (township_id, status, created_at DESC);
CREATE INDEX service_reports_booking_idx ON service_reports (booking_id);
