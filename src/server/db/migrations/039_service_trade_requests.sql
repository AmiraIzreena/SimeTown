-- Licence checks for risky home services.
--
-- A company adds most kinds of work itself. Plumbing, electrical and air-conditioning work needs a licence, so
-- for those the company sends a request with its licence or registration number, and township staff approve or
-- decline it. Residents can book the service only after it is approved.

CREATE TABLE service_trade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants (id),
  category text NOT NULL CHECK (category IN ('PLUMBING', 'ELECTRICAL', 'AIRCON', 'CLEANING', 'REPAIRS', 'RENOVATION')),
  -- The licence or registration number staff check.
  note text NOT NULL CHECK (char_length(note) BETWEEN 3 AND 300),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'DECLINED')),
  decline_reason text CHECK (decline_reason IS NULL OR char_length(decline_reason) BETWEEN 3 AND 300),
  requested_by uuid REFERENCES users (id),
  decided_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (status <> 'DECLINED' OR decline_reason IS NOT NULL)
);
-- One open request per company and kind of work.
CREATE UNIQUE INDEX service_trade_requests_one_open ON service_trade_requests (merchant_id, category) WHERE status = 'PENDING';
CREATE INDEX service_trade_requests_merchant_idx ON service_trade_requests (merchant_id, created_at DESC);
