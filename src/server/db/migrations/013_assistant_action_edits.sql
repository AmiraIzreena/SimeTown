-- SimeTown Assistant proposals: the resident can change the details on the card
-- before saying Yes, and a newer proposal in the same conversation replaces an
-- older one the resident has not answered, so only one is ever open.
ALTER TABLE assistant_actions DROP CONSTRAINT assistant_actions_status_check;
ALTER TABLE assistant_actions ADD CONSTRAINT assistant_actions_status_check
  CHECK (status IN ('PROPOSED', 'DONE', 'CANCELLED', 'EXPIRED', 'FAILED', 'SUPERSEDED'));
-- Leave older open proposals as the newest one per conversation.
UPDATE assistant_actions a SET status = 'SUPERSEDED', decided_at = now()
 WHERE a.status = 'PROPOSED'
   AND EXISTS (SELECT 1 FROM assistant_actions b WHERE b.conversation_id = a.conversation_id AND b.status = 'PROPOSED' AND b.created_at > a.created_at);
