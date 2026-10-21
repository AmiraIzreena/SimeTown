-- Residents can report a problem from the Kitar (recycling kiosks) and Gerak (township loops) pages. These are
-- township cases like parcel and gate reports, filed under their own two areas, and they may carry one screenshot
-- or photo (the same upload rules as Lapor photos). Residents follow them in Lapor → Kitar / Gerak reports.

ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_module_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_module_check
  CHECK (module IN ('LOCKERS', 'PARCELS', 'GUARDHOUSE', 'COURIERS', 'FACILITIES', 'COMMUNITY', 'KITAR', 'GERAK'));

-- The reporter's screenshot or photo, if they added one. Served only to them and to staff of that township.
ALTER TABLE incidents ADD COLUMN photo_id uuid REFERENCES uploads (id) ON DELETE SET NULL;
