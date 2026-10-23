-- Account emails: a welcome when a resident creates an account, and a self-service password reset.
--
-- "Forgot your password?" on the sign-in page emails a single-use link that expires after 30 minutes. Only a hash
-- of the link's token is stored; the link itself exists only in the email. Using it sets a new password and signs
-- out every device. Account emails are always sent, whatever the resident's email preferences.

ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_kind_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_check
  CHECK (kind IN ('LOCKER_READY', 'COUNTER_READY', 'COUNTER_REMINDER', 'DOOR_FORCED', 'ACCOUNT_CREATED', 'PASSWORD_RESET'));

CREATE TABLE password_resets (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE INDEX password_resets_user_idx ON password_resets (user_id, created_at DESC);
