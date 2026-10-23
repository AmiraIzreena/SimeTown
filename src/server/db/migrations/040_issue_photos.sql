-- The photo neighbours see on a public Lapor problem.
--
-- Every new community report now needs a photo. Once a problem is public (enough residents share it), Reports
-- around the township shows one photo for it: the first report's photo that has one, unless staff picked another
-- report's photo, or hid the photo altogether (a face, a car plate or a house number in the picture, say).

ALTER TABLE report_issues
  ADD COLUMN photo_report_id uuid REFERENCES reports (id) ON DELETE SET NULL,
  ADD COLUMN photo_hidden boolean NOT NULL DEFAULT false;
