-- SimeTown Assistant as an agent. The model looks things up with tools and may
-- propose an action, which runs only after the resident confirms it in the app.
-- Questions it cannot answer can be handed to the township office, whose reply
-- comes back into the same conversation.

-- Answers may be longer, the township office can reply in the chat, and each
-- answer keeps its checked sources, the action it proposed and how it was made.
ALTER TABLE assistant_messages DROP CONSTRAINT assistant_messages_role_check;
ALTER TABLE assistant_messages ADD CONSTRAINT assistant_messages_role_check CHECK (role IN ('USER', 'ASSISTANT', 'STAFF'));
ALTER TABLE assistant_messages DROP CONSTRAINT assistant_messages_content_check;
ALTER TABLE assistant_messages ADD CONSTRAINT assistant_messages_content_check CHECK (length(content) BETWEEN 1 AND 4000);
ALTER TABLE assistant_messages
  ADD COLUMN sources jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(sources) = 'array'),
  ADD COLUMN action_id uuid,
  -- How the answer was made (AI or rules, tools used, tokens). Never shown to the resident.
  ADD COLUMN meta jsonb;

-- A task the Assistant proposed. Nothing happens until the resident confirms it
-- (with their own permissions); unconfirmed proposals expire.
CREATE TABLE assistant_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  conversation_id uuid NOT NULL REFERENCES assistant_conversations (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('CREATE_VISITOR_PASS', 'HAND_OVER_TO_STAFF')),
  params jsonb NOT NULL,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'DONE', 'CANCELLED', 'EXPIRED', 'FAILED')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  decided_at timestamptz
);
CREATE INDEX assistant_actions_user_idx ON assistant_actions (user_id, status);
ALTER TABLE assistant_messages ADD CONSTRAINT assistant_messages_action_fk FOREIGN KEY (action_id) REFERENCES assistant_actions (id) ON DELETE SET NULL;

-- A question the resident chose to send to the township office. Staff see this
-- question and who asked it, never the rest of the conversation.
CREATE TABLE assistant_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  user_id uuid NOT NULL REFERENCES users (id),
  conversation_id uuid REFERENCES assistant_conversations (id) ON DELETE SET NULL,
  question text NOT NULL CHECK (length(question) BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ANSWERED')),
  answer text CHECK (length(answer) <= 2000),
  answered_by uuid REFERENCES users (id),
  answered_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX assistant_handoffs_township_idx ON assistant_handoffs (township_id, status, created_at);

-- Chats saved before this change may hold the old preview's made-up recycling
-- schedule. Replace that exact answer with the checked one, with its sources.
UPDATE assistant_messages
   SET content = 'Household rubbish in Shah Alam is collected for MBSA by KDEB Waste Management. Landed homes usually get three collections a week and high-rise homes daily; MBSA’s page has the schedule for your area, or call MBSA on 03-5510 5133.',
       sources = '[{"title":"MBSA: Kutipan sampah domestik (KDEB)","url":"https://www.mbsa.gov.my/ms-my/mbsa/perkhidmatan/perkhidmatanperbandaran/Halaman/kutipan_sampah_domestik.aspx","checked":"2026-10-14"},{"title":"KDEBWM: Roll-on roll-off bins for bulky waste around MBSA","url":"https://www.kdebwm.com/media-room/articles/kdebwm-sedia-tong-roro-kutip-sampah-pukal-di-384-k/","checked":"2026-10-14"}]'::jsonb,
       link_href = '/app/kitar', link_label = 'Open Kitar'
 WHERE role = 'ASSISTANT'
   AND content = 'Recycling is collected on Tuesday and Friday mornings: bins out before 8am. The smart machines at Elmina Valley and Elmina Gardens are open all day and give you XP.';
