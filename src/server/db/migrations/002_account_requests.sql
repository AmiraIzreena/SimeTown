-- Two-person control for account powers, like BR22 for balances.
-- A new admin account, or a new password for an account someone already uses,
-- is requested by one admin and approved by a different one. Only the approver
-- receives the one-time set-password link.

CREATE TABLE account_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('NEW_ADMIN', 'PASSWORD_RESET')),
  -- PASSWORD_RESET: whose password. NEW_ADMIN: the account, once approved.
  user_id uuid REFERENCES users (id),
  -- NEW_ADMIN: the account to create.
  email text,
  full_name text,
  role text CHECK (role IN ('TOWNSHIP_ADMIN', 'HQ_ADMIN')),
  township_id uuid REFERENCES townships (id),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  requested_by uuid NOT NULL REFERENCES users (id),
  decided_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL,
  decided_at timestamptz,
  CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CHECK (kind <> 'PASSWORD_RESET' OR user_id IS NOT NULL),
  CHECK (kind <> 'NEW_ADMIN' OR (email IS NOT NULL AND full_name IS NOT NULL AND role IS NOT NULL)),
  CHECK (role IS DISTINCT FROM 'TOWNSHIP_ADMIN' OR township_id IS NOT NULL)
);
CREATE INDEX account_requests_status_idx ON account_requests (status, created_at DESC);
-- One open reset per account, and one open request per new admin email.
CREATE UNIQUE INDEX account_requests_open_reset_idx ON account_requests (user_id) WHERE kind = 'PASSWORD_RESET' AND status = 'PENDING';
CREATE UNIQUE INDEX account_requests_open_admin_idx ON account_requests (lower(email)) WHERE kind = 'NEW_ADMIN' AND status = 'PENDING';
