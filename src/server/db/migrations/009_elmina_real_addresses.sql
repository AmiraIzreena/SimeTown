-- Move the demo township's addresses onto City of Elmina's real precincts and
-- streets: Elmina Valley 1-3 and Elmina Gardens in Seksyen U16 (Elmina East) and
-- Pangsapuri Harmoni Elmina in Seksyen U17 (Elmina West), all 40160 Shah Alam,
-- as mapped in OpenStreetMap and used in property listings, October 2026. The
-- invented Precincts Kenanga, Melur and Teratai, Residensi SimeTown and SimeTown
-- Square go. People, house numbers and shops stay invented. Only the demo
-- township is touched, and only rows still holding the old demo values; the
-- audit log is history and is left as it was.

DO $$
DECLARE
  t uuid;
  zone_valley12 uuid;
  zone_valley345 uuid;
  zone_gardens uuid;
  zone_west uuid;
BEGIN
  SELECT id INTO t FROM townships WHERE name = 'City of Elmina (demo data)';
  IF t IS NULL THEN
    RETURN;
  END IF;

  -- Areas: one per precinct group, in place of Zone A, B and C.
  UPDATE flood_zones
     SET name = 'Elmina Valley 1 & 2',
         safe_route = 'Leave by Persiaran Metafasa, away from Sungai Subang. Keep off the riverside paths.',
         assembly_point = 'Persiaran Metafasa at Jalan Metafasa U16/156'
   WHERE township_id = t AND name = 'Zone A · Lakeside';
  UPDATE flood_zones
     SET name = 'Elmina Valley 3, 4 & 5',
         safe_route = 'Leave by Persiaran Elektron towards Persiaran Elmina. Keep off the Central Park riverside paths.',
         assembly_point = 'SJK (T) Ladang Rasak field'
   WHERE township_id = t AND name = 'Zone B · Central';
  UPDATE flood_zones
     SET name = 'Elmina Gardens',
         safe_route = 'Leave by Jalan Frekuensi U16/110 towards Persiaran Atmosfera. Keep off the lake path by Sungai Subang.',
         assembly_point = 'Surau Elmina Gardens car park'
   WHERE township_id = t AND name = 'Zone C · Hillside';
  INSERT INTO flood_zones (township_id, name, safe_route, assembly_point, level_pct)
  VALUES (t, 'Elmina West', 'Leave by Persiaran Casuarina towards Persiaran Elmina.', 'Pangsapuri Harmoni Elmina car park', 6)
  ON CONFLICT (township_id, name) DO NOTHING;

  SELECT id INTO zone_valley12 FROM flood_zones WHERE township_id = t AND name = 'Elmina Valley 1 & 2';
  SELECT id INTO zone_valley345 FROM flood_zones WHERE township_id = t AND name = 'Elmina Valley 3, 4 & 5';
  SELECT id INTO zone_gardens FROM flood_zones WHERE township_id = t AND name = 'Elmina Gardens';
  SELECT id INTO zone_west FROM flood_zones WHERE township_id = t AND name = 'Elmina West';

  -- Homes: street, precinct, area and the property reference staff match against.
  UPDATE homes SET street = 'Jalan Metafasa U16/171', precinct = 'Elmina Valley 1', zone_id = zone_valley12,
                   unit_code = regexp_replace(unit_code, '^KN-', 'EV1-')
   WHERE township_id = t AND street = 'Jalan Kenanga 1/KT1' AND building IS NULL;
  UPDATE homes SET street = 'Jalan Metafasa U16/161', precinct = 'Elmina Valley 2', zone_id = zone_valley12,
                   unit_code = regexp_replace(unit_code, '^ML-', 'EV2-')
   WHERE township_id = t AND street = 'Jalan Melur 2/KT2' AND building IS NULL;
  UPDATE homes SET street = 'Jalan Metafasa U16/1N', precinct = 'Elmina Valley 3', zone_id = zone_valley345,
                   unit_code = regexp_replace(unit_code, '^CP-', 'EV3-')
   WHERE township_id = t AND street = 'Jalan Cempaka 2/KT3' AND building IS NULL;
  UPDATE homes SET street = 'Jalan Frekuensi U16/115', precinct = 'Elmina Gardens', zone_id = zone_gardens,
                   unit_code = regexp_replace(unit_code, '^TR-', 'EG-')
   WHERE township_id = t AND street = 'Jalan Teratai 3/KT4' AND building IS NULL;
  UPDATE homes SET street = 'Jalan Casuarina U17/56', precinct = 'Elmina West', zone_id = zone_west,
                   building = 'Pangsapuri Harmoni Elmina, Block A',
                   unit_code = regexp_replace(unit_code, '^RK-', 'HM-')
   WHERE township_id = t AND building = 'Residensi SimeTown, Block A';
  UPDATE homes SET postcode = '40160', city = 'Shah Alam', state = 'Selangor' WHERE township_id = t;

  -- Shops: the Elmina East shop row on Jalan Eserina AB U16/AB.
  UPDATE merchants
     SET address_line = regexp_replace(address_line, '^Lot G-0*([0-9]+), SimeTown Square, Jalan Melur 2/KT2$', 'No. \1, Jalan Eserina AB U16/AB, Elmina East')
   WHERE township_id = t AND address_line LIKE '%, SimeTown Square, Jalan Melur 2/KT2';

  -- Place names and locations the demo wrote, value for value.
  CREATE TEMPORARY TABLE elmina_place_names (old text PRIMARY KEY, new text NOT NULL) ON COMMIT DROP;
  INSERT INTO elmina_place_names VALUES
    ('Kiosk Lakeside', 'Kiosk Elmina Valley'),
    ('Kiosk Central', 'Kiosk Elmina Gardens'),
    ('Beside the Lakeside playground', 'Elmina Valley Central Park car park'),
    ('Community hall car park', 'Beside Surau Elmina Gardens'),
    ('Smart machine · Lakeside', 'Smart machine · Elmina Valley'),
    ('Smart machine · Central', 'Smart machine · Elmina Gardens'),
    ('Lakeside playground', 'Elmina Valley Central Park'),
    ('Hillside back lane', 'Elmina Gardens back lane'),
    ('Lake path, gate to boathouse', 'Valley Central Park lake path'),
    ('Lakeside, the whole western side', 'Around the lake, Elmina Valley Central Park'),
    ('Community hall, Jalan Melur 2/KT2', 'Community hall, front entrance'),
    ('Residensi SimeTown Block A lift', 'Pangsapuri Harmoni Elmina Block A lift'),
    ('SimeTown Square OKU bays', 'Jalan Eserina AB shop row OKU bays'),
    ('SimeTown Square car park, row A (2 bays)', 'Jalan Eserina AB U16/AB car park, row A (2 bays)'),
    ('Hillside surau ramp', 'Surau Elmina Gardens ramp'),
    ('Hillside surau entrance', 'Surau Elmina Gardens entrance'),
    ('Lakeside community garden', 'Elmina Valley community garden'),
    ('Beside Kiosk Lakeside, next to the playground', 'Beside Kiosk Elmina Valley, Elmina Valley Central Park'),
    ('Hillside herb garden', 'Elmina Gardens herb garden'),
    ('Behind the Hillside surau', 'Behind Surau Elmina Gardens'),
    ('Lakeside garden fence', 'Elmina Valley garden fence'),
    ('Lake, near the boathouse', 'Lake, Elmina Valley Central Park'),
    ('Jalan Kenanga drain, after rain', 'Jalan Metafasa U16/171 drain, after rain'),
    ('Jalan Kenanga, near house KN-04', 'Jalan Metafasa U16/171, near No. 4'),
    ('Behind Jalan Cempaka shop row', 'Back lane behind Jalan Metafasa U16/1N'),
    ('Jalan Melur, before the school', 'Persiaran Metafasa, before SJK (T) Ladang Rasak'),
    ('Jalan Melur', 'Jalan Metafasa U16/161'),
    ('Jalan Cempaka', 'Jalan Metafasa U16/1N'),
    ('Jalan Teratai', 'Jalan Frekuensi U16/115');

  UPDATE kitar_kiosks x SET name = m.new FROM elmina_place_names m WHERE x.township_id = t AND x.name = m.old;
  UPDATE kitar_kiosks x SET location = m.new FROM elmina_place_names m WHERE x.township_id = t AND x.location = m.old;
  UPDATE kitar_machines x SET name = m.new FROM elmina_place_names m WHERE x.township_id = t AND x.name = m.old;
  UPDATE patrol_points x SET name = m.new FROM elmina_place_names m WHERE x.township_id = t AND x.name = m.old;
  UPDATE access_places x SET name = m.new FROM elmina_place_names m WHERE x.township_id = t AND x.name = m.old;
  UPDATE access_places x SET location = m.new FROM elmina_place_names m WHERE x.township_id = t AND x.location = m.old;
  UPDATE gardens x SET name = m.new FROM elmina_place_names m WHERE x.township_id = t AND x.name = m.old;
  UPDATE gardens x SET location = m.new FROM elmina_place_names m WHERE x.township_id = t AND x.location = m.old;
  UPDATE wildlife_sightings x SET location = m.new FROM elmina_place_names m WHERE x.township_id = t AND x.location = m.old;
  UPDATE posts x SET location = m.new FROM elmina_place_names m WHERE x.township_id = t AND x.location = m.old;
  UPDATE reports x SET location_text = m.new FROM elmina_place_names m WHERE x.township_id = t AND x.location_text = m.old;
  -- The rubbish report was at the playground beside the kiosk, not the patrol point of the same old name.
  UPDATE reports SET location_text = 'Kiosk Elmina Valley, Elmina Valley Central Park'
   WHERE township_id = t AND location_text = 'Elmina Valley Central Park' AND description = 'Rubbish left beside the recycling kiosk';

  -- Flood messages and notifications already sent name the old areas, kiosks and streets.
  UPDATE flood_messages f
     SET what = replace(replace(replace(f.what, 'Zone A · Lakeside', 'Elmina Valley 1 & 2'), 'Zone B · Central', 'Elmina Valley 3, 4 & 5'), 'Zone C · Hillside', 'Elmina Gardens'),
         where_text = CASE
           WHEN f.where_text = 'Zone B · Central: Jalan Cempaka 2/KT3, Jalan Melur 2/KT2' THEN 'Elmina Valley 3, 4 & 5: Jalan Metafasa U16/1N'
           ELSE replace(replace(replace(replace(replace(replace(replace(f.where_text,
             'Zone A · Lakeside', 'Elmina Valley 1 & 2'), 'Zone B · Central', 'Elmina Valley 3, 4 & 5'), 'Zone C · Hillside', 'Elmina Gardens'),
             'Jalan Kenanga 1/KT1', 'Jalan Metafasa U16/171'), 'Jalan Melur 2/KT2', 'Jalan Metafasa U16/161'),
             'Jalan Cempaka 2/KT3', 'Jalan Metafasa U16/1N'), 'Jalan Teratai 3/KT4', 'Jalan Frekuensi U16/115')
         END
   WHERE f.zone_id IN (SELECT id FROM flood_zones WHERE township_id = t);
  UPDATE notifications n
     SET title = replace(replace(replace(replace(replace(n.title,
           'Zone A · Lakeside', 'Elmina Valley 1 & 2'), 'Zone B · Central', 'Elmina Valley 3, 4 & 5'), 'Zone C · Hillside', 'Elmina Gardens'),
           'Smart machine · Lakeside', 'Smart machine · Elmina Valley'), 'Smart machine · Central', 'Smart machine · Elmina Gardens')
   WHERE n.user_id IN (SELECT id FROM users WHERE township_id = t)
     AND n.title ~ 'Zone [ABC] · |Smart machine · (Lakeside|Central)';
END $$;
