-- OSM way 380002608 was initially treated as a cycling connector. Its current
-- tags identify it as a designated one-way motorcycle lane beside the highway
-- (bicycles permitted), so it is not suitable for this community Gerak demo.
-- Keep the historical record but hide it until a verified neighbourhood cycle
-- route is available.
UPDATE gerak_loops l
   SET active = false
 WHERE l.name = 'Elmina Park Connector Ride'
   AND l.township_id IN (
     SELECT id FROM townships WHERE name = 'City of Elmina (demo data)'
   );
