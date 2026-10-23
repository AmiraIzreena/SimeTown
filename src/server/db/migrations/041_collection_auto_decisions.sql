-- Kitar collections settle themselves.
--
-- The gate record decides a household's weight: if the collector was scanned in at the gate that day (on this
-- collection's pass or on another home's), the weight is credited, counted up to a maximum per material; if not, the
-- collection closes with no reward. A disputed missed collection is decided the same way. Staff no longer approve
-- these one by one, so each decision records who made it: the system, or staff (older reviews were all staff).

ALTER TABLE recycling_collections
  ADD COLUMN decided_by text CHECK (decided_by IN ('SYSTEM', 'STAFF'));

UPDATE recycling_collections SET decided_by = 'STAFF' WHERE reviewed_at IS NOT NULL;
