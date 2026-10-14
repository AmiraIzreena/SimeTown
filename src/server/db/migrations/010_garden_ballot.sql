-- Taman: plots are given out by ballot, as at the real Elmina Community
-- Edible Gardens (Sime Darby Property with MBSA, Elmina Central Park, Elmina
-- West, opened January 2019: over 100 plots of 2 m x 1 m to 6.5 m x 1 m,
-- allotted to residents by ballot). Residents join a waiting list; staff draw it.

CREATE TABLE garden_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  garden_id uuid NOT NULL REFERENCES gardens (id),
  home_id uuid NOT NULL REFERENCES homes (id),
  user_id uuid NOT NULL REFERENCES users (id),
  status text NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'ALLOCATED', 'WITHDRAWN')),
  plot_id uuid REFERENCES garden_plots (id),
  created_at timestamptz NOT NULL,
  decided_at timestamptz,
  CHECK ((status = 'ALLOCATED') = (plot_id IS NOT NULL))
);
-- One place on one waiting list per home.
CREATE UNIQUE INDEX garden_applications_one_waiting_idx ON garden_applications (home_id) WHERE status = 'WAITING';
CREATE INDEX garden_applications_garden_idx ON garden_applications (garden_id, status);

-- The demo township's two invented gardens become one garden named after the
-- real one. Its plot numbers and holders stay demo data. A home holding a plot
-- in the herb garden that goes keeps a plot in the edible gardens.
DO $$
DECLARE
  t uuid;
  edible uuid;
  herb uuid;
  held record;
  spare uuid;
  n integer;
BEGIN
  SELECT id INTO t FROM townships WHERE name = 'City of Elmina (demo data)';
  IF t IS NULL THEN
    RETURN;
  END IF;
  SELECT id INTO edible FROM gardens WHERE township_id = t AND name = 'Elmina Valley community garden';
  SELECT id INTO herb FROM gardens WHERE township_id = t AND name = 'Elmina Gardens herb garden';
  IF edible IS NULL THEN
    RETURN;
  END IF;

  UPDATE gardens SET name = 'Elmina Community Edible Gardens', location = 'Elmina Central Park, Elmina West' WHERE id = edible;

  -- 24 demo plots in the real garden's range of sizes: 2, 4 and 6 square metres.
  SELECT count(*) INTO n FROM garden_plots WHERE garden_id = edible;
  FOR i IN n + 1 .. 24 LOOP
    INSERT INTO garden_plots (garden_id, plot_no, size_m2) VALUES (edible, lpad(i::text, 2, '0'), 2);
  END LOOP;
  UPDATE garden_plots SET size_m2 = CASE WHEN plot_no <= '08' THEN 2 WHEN plot_no <= '16' THEN 4 ELSE 6 END WHERE garden_id = edible;

  IF herb IS NOT NULL THEN
    FOR held IN SELECT * FROM garden_plots WHERE garden_id = herb AND holder_home_id IS NOT NULL LOOP
      SELECT id INTO spare FROM garden_plots WHERE garden_id = edible AND holder_home_id IS NULL ORDER BY plot_no LIMIT 1;
      UPDATE garden_plots SET holder_home_id = NULL, holder_user_id = NULL WHERE id = held.id;
      IF spare IS NOT NULL THEN
        UPDATE garden_plots
           SET holder_home_id = held.holder_home_id, holder_user_id = held.holder_user_id, booked_at = held.booked_at, booked_until = held.booked_until
         WHERE id = spare;
      END IF;
    END LOOP;
    -- Watering days already taken there move across, unless that day is taken here.
    UPDATE garden_roster r SET garden_id = edible
     WHERE r.garden_id = herb AND NOT EXISTS (SELECT 1 FROM garden_roster x WHERE x.garden_id = edible AND x.day = r.day);
    DELETE FROM garden_roster WHERE garden_id = herb;
    DELETE FROM garden_plots WHERE garden_id = herb;
    DELETE FROM gardens WHERE id = herb;
  END IF;

  UPDATE wildlife_sightings SET location = 'Elmina Community Edible Gardens' WHERE township_id = t AND location = 'Elmina Gardens herb garden';
  UPDATE wildlife_sightings SET location = 'Edible garden fence, Elmina Central Park' WHERE township_id = t AND location = 'Elmina Valley garden fence';
END $$;
