-- Kitar test mode (local demos only): mark where each drop-off came from.
--
-- LIVE: a real drop-off (a bin's signed session, a claimed guest session or a typed kiosk drop-off).
-- TEST: a practice entry typed by a resident while DEMO_MANUAL_ENTRY is on with a pglite database
--       (src/server/modules/kitar/test-entry.ts). Every TEST entry is also in the audit log.
-- Existing rows are all real, so they become LIVE.
ALTER TABLE kitar_dropoffs
  ADD COLUMN source text NOT NULL DEFAULT 'LIVE' CHECK (source IN ('LIVE', 'TEST'));
