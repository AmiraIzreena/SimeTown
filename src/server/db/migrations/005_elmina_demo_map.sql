-- Align the bundled demo with a real public walking area at City of Elmina.
-- People, homes, shops and activity remain synthetic. The route geometry is a
-- simplified copy of OpenStreetMap ways 909856763 (walking) and 380002608
-- (asphalt cycling path), retrieved 14 October 2026.

UPDATE townships
   SET name = 'City of Elmina (demo data)',
       gate_name = 'Elmina Central Park entrance',
       gate_lat = 3.175561,
       gate_lng = 101.509990
 WHERE name IN ('Taman KITA (demo township)', 'Taman SimeTown (demo township)', 'City of Elmina (demo data)');

UPDATE homes
   SET postcode = '40160', city = 'Shah Alam', state = 'Selangor'
 WHERE township_id IN (SELECT id FROM townships WHERE name = 'City of Elmina (demo data)');

UPDATE merchants
   SET postcode = '40160', city = 'Shah Alam', state = 'Selangor'
 WHERE township_id IN (SELECT id FROM townships WHERE name = 'City of Elmina (demo data)');

UPDATE gerak_checkpoints cp
   SET name = CASE cp.seq WHEN 1 THEN 'Central Park entrance' WHEN 2 THEN 'Elmina Gardens turn' ELSE cp.name END,
       lat = CASE cp.seq WHEN 1 THEN 3.175561 WHEN 2 THEN 3.171723 ELSE cp.lat END,
       lng = CASE cp.seq WHEN 1 THEN 101.509990 WHEN 2 THEN 101.506009 ELSE cp.lng END
 WHERE cp.loop_id IN (
   SELECT l.id FROM gerak_loops l JOIN townships t ON t.id = l.township_id
    WHERE t.name = 'City of Elmina (demo data)' AND l.name IN ('Lake Loop', 'Elmina Central Park Walk')
 );

UPDATE gerak_loops
   SET name = 'Elmina Central Park Walk',
       description = 'A public walking route through Elmina Central Park and Elmina Gardens.',
       distance_m = 2400,
       path = '[[3.175561,101.50999],[3.175366,101.509835],[3.175165,101.509519],[3.175021,101.509355],[3.175033,101.508722],[3.175304,101.508301],[3.173212,101.507805],[3.171921,101.507526],[3.17111,101.507122],[3.169887,101.507283],[3.169409,101.506995],[3.16969,101.505543],[3.171723,101.506009],[3.173472,101.506388],[3.174056,101.50621],[3.174587,101.506111],[3.175044,101.506414],[3.175383,101.506809],[3.1762,101.507788],[3.176725,101.508839],[3.176876,101.50914],[3.176925,101.509489],[3.176636,101.509763],[3.176291,101.509918],[3.175938,101.510051],[3.174793,101.510063]]'::jsonb
 WHERE township_id IN (SELECT id FROM townships WHERE name = 'City of Elmina (demo data)')
   AND name IN ('Lake Loop', 'Elmina Central Park Walk');

UPDATE gerak_checkpoints cp
   SET name = CASE cp.seq WHEN 1 THEN 'Central Park east' WHEN 2 THEN 'Elmina Valley connector' WHEN 3 THEN 'Denai Alam trail junction' ELSE cp.name END,
       lat = CASE cp.seq WHEN 1 THEN 3.181559 WHEN 2 THEN 3.172576 WHEN 3 THEN 3.158978 ELSE cp.lat END,
       lng = CASE cp.seq WHEN 1 THEN 101.519395 WHEN 2 THEN 101.519799 WHEN 3 THEN 101.520795 ELSE cp.lng END
 WHERE cp.loop_id IN (
   SELECT l.id FROM gerak_loops l JOIN townships t ON t.id = l.township_id
    WHERE t.name = 'City of Elmina (demo data)' AND l.name IN ('Park Connector Ride', 'Elmina Park Connector Ride')
 );

UPDATE gerak_loops
   SET name = 'Elmina Park Connector Ride',
       description = 'The mapped asphalt cycling path between Elmina and Denai Alam.',
       distance_m = 2700,
       path = '[[3.181559,101.519395],[3.181326,101.519427],[3.181168,101.519351],[3.180885,101.518981],[3.180757,101.518856],[3.180442,101.518696],[3.180057,101.518641],[3.179743,101.518701],[3.179009,101.518904],[3.177962,101.519102],[3.177116,101.519206],[3.176387,101.51926],[3.175503,101.519249],[3.174859,101.519249],[3.173884,101.519349],[3.173607,101.519474],[3.173282,101.519742],[3.172576,101.519799],[3.172174,101.519805],[3.17131,101.519785],[3.170387,101.519421],[3.169824,101.519272],[3.169146,101.519183],[3.168273,101.519144],[3.165859,101.519086],[3.164629,101.519074],[3.162402,101.519054],[3.161711,101.519075],[3.161002,101.519161],[3.160452,101.519294],[3.160136,101.519419],[3.160002,101.519531],[3.159145,101.52073],[3.158978,101.520795]]'::jsonb
 WHERE township_id IN (SELECT id FROM townships WHERE name = 'City of Elmina (demo data)')
   AND name IN ('Park Connector Ride', 'Elmina Park Connector Ride');
