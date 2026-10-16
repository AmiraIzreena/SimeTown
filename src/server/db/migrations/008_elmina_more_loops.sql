-- More public walking and cycling loops at City of Elmina. Each path follows
-- paths mapped in OpenStreetMap around Eco Lake, Elmina Lakeside, Elmina Valley
-- Central Park, Elmina Gardens, the Rainforest Knowledge Centre and along Sungai
-- Subang, retrieved and simplified on 14 October 2026. The same loops are in
-- scripts/elmina-loops.ts for a fresh seed. Only added where missing.

CREATE TEMPORARY TABLE elmina_new_loops (name text, description text, mode text, distance_m integer, path jsonb, checkpoints jsonb) ON COMMIT DROP;
INSERT INTO elmina_new_loops VALUES
  ('Eco Lake Loop', 'Around Eco Lake and Elmina Urban Park, beside Elmina Lakeside Mall.', 'WALK', 600,
   '[[3.179498,101.508282],[3.179507,101.508402],[3.17943,101.508477],[3.179826,101.509945],[3.179917,101.510095],[3.180002,101.510155],[3.180944,101.510279],[3.180662,101.509999],[3.180232,101.50941],[3.179663,101.508356],[3.179498,101.508282]]'::jsonb,
   '[{"name":"Elmina Urban Park","lat":3.179498,"lng":101.508282},{"name":"Eco Lake, mall side","lat":3.180944,"lng":101.510279}]'::jsonb),
  ('Elmina Lakeside Park Loop', 'Around the pond and lawns beside EV Arena, behind Elmina Lakeside Mall.', 'WALK', 700,
   '[[3.180206,101.511019],[3.180187,101.510887],[3.18021,101.51059],[3.179743,101.510573],[3.179787,101.510624],[3.179849,101.510798],[3.179799,101.511186],[3.180116,101.511707],[3.180111,101.512321],[3.180156,101.512411],[3.180327,101.51253],[3.180902,101.512711],[3.180999,101.512677],[3.181448,101.512132],[3.181476,101.512047],[3.181445,101.511952],[3.181247,101.511726],[3.181157,101.511708],[3.181068,101.511726],[3.180876,101.511806],[3.180769,101.511781],[3.180575,101.511663],[3.180437,101.511517],[3.180206,101.511019]]'::jsonb,
   '[{"name":"EV Arena","lat":3.180206,"lng":101.511019},{"name":"Lakeside pond","lat":3.180902,"lng":101.512711}]'::jsonb),
  ('Elmina Valley Central Park Lake Loop', 'Around the lake in Elmina Valley Central Park, next to Sungai Subang.', 'WALK', 750,
   '[[3.178999,101.515077],[3.178891,101.515263],[3.17889,101.515546],[3.178756,101.515556],[3.178784,101.515698],[3.178934,101.515973],[3.178972,101.516164],[3.178927,101.516386],[3.178773,101.516639],[3.178721,101.516895],[3.178815,101.517446],[3.178868,101.517525],[3.178975,101.517601],[3.179174,101.517618],[3.179386,101.517535],[3.179478,101.517457],[3.179583,101.517277],[3.179575,101.516683],[3.179764,101.516052],[3.179834,101.51574],[3.179841,101.515574],[3.179715,101.515203],[3.179591,101.515004],[3.179404,101.514929],[3.179296,101.514938],[3.178999,101.515077]]'::jsonb,
   '[{"name":"Valley Central Park west","lat":3.178999,"lng":101.515077},{"name":"Valley Central Park east","lat":3.179478,"lng":101.517457}]'::jsonb),
  ('Elmina Gardens Lakeside Loop', 'Around the retention lake beside Sungai Subang at Elmina Gardens.', 'WALK', 1200,
   '[[3.187549,101.522083],[3.188828,101.522618],[3.188867,101.522785],[3.189142,101.522908],[3.189274,101.522923],[3.18947,101.523085],[3.189502,101.523451],[3.189547,101.523528],[3.189699,101.523582],[3.189793,101.523651],[3.189883,101.523915],[3.189928,101.524183],[3.189922,101.524344],[3.189826,101.52466],[3.189843,101.524833],[3.189805,101.524897],[3.189695,101.524963],[3.189488,101.525005],[3.189404,101.524999],[3.189238,101.524929],[3.188863,101.525026],[3.188608,101.525035],[3.188237,101.524936],[3.188116,101.524873],[3.188058,101.524788],[3.188071,101.524694],[3.188129,101.5246],[3.188085,101.524403],[3.187709,101.523816],[3.18753,101.523314],[3.187324,101.523135],[3.186984,101.522772],[3.186904,101.522616],[3.186613,101.522342],[3.186479,101.522177],[3.186471,101.522059],[3.186411,101.521999],[3.186765,101.521667],[3.186919,101.521631],[3.187549,101.522083]]'::jsonb,
   '[{"name":"Elmina Gardens lake south","lat":3.187549,"lng":101.522083},{"name":"Elmina Gardens lake north","lat":3.188608,"lng":101.525035}]'::jsonb),
  ('Rainforest Centre Pond Loop', 'Around the pond at the Elmina Rainforest Knowledge Centre, below Empangan Subang.', 'WALK', 650,
   '[[3.17187,101.500511],[3.171505,101.500997],[3.171467,101.501091],[3.171517,101.501538],[3.171592,101.501649],[3.17234,101.502328],[3.172754,101.500893],[3.172785,101.500584],[3.172611,101.499818],[3.172549,101.499782],[3.172415,101.49983],[3.17187,101.500511]]'::jsonb,
   '[{"name":"Rainforest Centre","lat":3.17187,"lng":101.500511},{"name":"Rainforest pond west","lat":3.172754,"lng":101.500893}]'::jsonb),
  ('Elmina Valley Riverside Ride', 'Along Sungai Subang and around the Elmina Valley 2 homes. Shared path: give way to walkers.', 'CYCLE', 2650,
   '[[3.176302,101.510409],[3.176123,101.510483],[3.175981,101.510498],[3.175817,101.510449],[3.17575,101.510363],[3.175585,101.510376],[3.17532,101.510349],[3.175256,101.510356],[3.17521,101.510405],[3.175187,101.511377],[3.175216,101.514536],[3.175305,101.514535],[3.175314,101.514821],[3.176242,101.514821],[3.176399,101.514999],[3.17639,101.516219],[3.176468,101.516335],[3.178396,101.516365],[3.178447,101.51633],[3.178458,101.514687],[3.178388,101.514636],[3.178153,101.514634],[3.178153,101.51452],[3.178096,101.51452],[3.178097,101.513813],[3.178266,101.513364],[3.178249,101.513337],[3.178022,101.513284],[3.177953,101.513323],[3.177917,101.51328],[3.177876,101.513282],[3.177801,101.513333],[3.177764,101.513257],[3.177782,101.513185],[3.17798,101.513009],[3.177929,101.512766],[3.177749,101.51265],[3.177801,101.512519],[3.177852,101.512505],[3.177997,101.512708],[3.177945,101.51232],[3.178011,101.511795],[3.177872,101.511876],[3.177892,101.511727],[3.177978,101.51148],[3.177832,101.511479],[3.177832,101.511523],[3.177687,101.51168],[3.177689,101.511968],[3.17775,101.512055],[3.17775,101.512375],[3.177691,101.512435],[3.177685,101.512741],[3.177875,101.512828],[3.177904,101.513004],[3.17768,101.51315],[3.177682,101.511253],[3.177833,101.511431],[3.177832,101.511479],[3.177978,101.51148],[3.177742,101.511202],[3.177736,101.510869],[3.177784,101.510706],[3.177646,101.510532],[3.17744,101.510393],[3.177066,101.510341],[3.176784,101.510397],[3.176302,101.510409]]'::jsonb,
   '[{"name":"Bulatan Elmina riverside","lat":3.176302,"lng":101.510409},{"name":"Elmina Valley 2 south","lat":3.178388,"lng":101.514636}]'::jsonb);

WITH added AS (
  INSERT INTO gerak_loops (township_id, name, description, mode, distance_m, path)
  SELECT t.id, n.name, n.description, n.mode, n.distance_m, n.path
    FROM elmina_new_loops n CROSS JOIN townships t
   WHERE t.name = 'City of Elmina (demo data)'
     AND NOT EXISTS (SELECT 1 FROM gerak_loops l WHERE l.township_id = t.id AND lower(l.name) = lower(n.name))
  RETURNING id, name
)
-- Codes use the app's alphabet (no look-alikes). The subquery refers to cp.seq so
-- each checkpoint gets its own code instead of one shared value.
INSERT INTO gerak_checkpoints (loop_id, seq, name, code, lat, lng)
SELECT a.id, cp.seq::int, cp.value->>'name',
       'G' || (SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
                 FROM generate_series(1, 9) WHERE cp.seq IS NOT NULL),
       (cp.value->>'lat')::double precision, (cp.value->>'lng')::double precision
  FROM added a
  JOIN elmina_new_loops n ON n.name = a.name
  CROSS JOIN LATERAL jsonb_array_elements(n.checkpoints) WITH ORDINALITY AS cp(value, seq);
