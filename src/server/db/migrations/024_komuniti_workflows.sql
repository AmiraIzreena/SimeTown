-- Komuniti workflows. Help, give-away and lend requests now go
-- Request -> Accept -> Confirm, and a loan is only complete once the item
-- comes back. Event RSVPs can be cancelled before the event starts (the row
-- is deleted, which frees the place).
--
--   PENDING    asked, or RSVP'd to an event
--   ACCEPTED   the author picked this neighbour (help, give, lend)
--   DECLINED   the author said no; they cannot ask again on this post
--   CONFIRMED  it happened: attended, helped, collected, or lent out
--   RETURNED   a lent item came back (Impact XP is given here for loans)

ALTER TABLE post_responses DROP CONSTRAINT IF EXISTS post_responses_status_check;
ALTER TABLE post_responses
  ADD CONSTRAINT post_responses_status_check CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CONFIRMED', 'RETURNED')),
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN due_back date,
  ADD COLUMN returned_at timestamptz;
