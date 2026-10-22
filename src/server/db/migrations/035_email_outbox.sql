-- Email: parcel notices sent from the SimeTown mail account, in the resident's language.
--
-- An email is written to the outbox in the same transaction as the event (a parcel in the door, a parcel at the
-- counter, a weekly reminder, a door opened without a code), so it exists only if the event happened, and once
-- per event and person. The scheduled job sends what is queued; a slow mail server never slows a door or a
-- request. Without a mail account configured nothing is sent, and old queued emails are skipped rather than sent
-- late. Sent emails keep no body after 30 days.

-- Residents may switch parcel emails off. Security alerts are always sent.
ALTER TABLE users ADD COLUMN parcel_emails boolean NOT NULL DEFAULT true;

CREATE TABLE email_outbox (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('LOCKER_READY', 'COUNTER_READY', 'COUNTER_REMINDER', 'DOOR_FORCED')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  html text,
  body_text text,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  dedupe_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX email_outbox_due_idx ON email_outbox (next_attempt_at) WHERE status = 'QUEUED';
CREATE INDEX email_outbox_user_idx ON email_outbox (user_id, created_at DESC);
