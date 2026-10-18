-- Residents at a locked station keypad asking staff to unlock it. Once per
-- resident per lockout, so staff are told without being flooded.
CREATE TABLE pickup_lockout_help (
  lockout_id uuid NOT NULL REFERENCES pickup_lockouts (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  at timestamptz NOT NULL,
  PRIMARY KEY (lockout_id, user_id)
);
