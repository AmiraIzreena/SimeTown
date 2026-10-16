-- SimeTown Assistant: each resident's conversations, saved to their account so
-- they can reopen them on any device. Only the owner can read them; staff
-- cannot. Kept for 90 days after the last message (the daily cleanup job), and
-- removed with the account. Included in the person's data export.

CREATE TABLE assistant_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX assistant_conversations_user_idx ON assistant_conversations (user_id, updated_at DESC);

CREATE TABLE assistant_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES assistant_conversations (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('USER', 'ASSISTANT')),
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  -- A link the answer offered, inside the app only (such as /app/banjir).
  link_href text CHECK (link_href ~ '^/app(/[A-Za-z0-9/_-]*)?$'),
  link_label text CHECK (length(link_label) <= 60),
  created_at timestamptz NOT NULL
);
CREATE INDEX assistant_messages_conversation_idx ON assistant_messages (conversation_id, id);
