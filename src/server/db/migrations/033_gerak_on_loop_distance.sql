-- Gerak: distance walked, run or ridden ON the township loops, counted even when a loop is not finished.
-- While a trip is tracked, each fair-play stretch within 30 m of a drawn loop path adds to on_loop_m.
-- Distance off the loops never counts here, so the figure rewards using the township's own paths.
ALTER TABLE gerak_activities ADD COLUMN on_loop_m integer NOT NULL DEFAULT 0 CHECK (on_loop_m >= 0);

-- Recorded once per finished trip (ref = the trip id), so challenges can count it. It adds no Impact XP
-- and no offer-backed points of its own: the trip itself already earns those, as before.
-- Limits match GERAK_TRIP, so it can never be recorded more often than a trip.
INSERT INTO activity_rules (activity, label, xp, quantity_unit, daily_cap_person, monthly_cap_home, offer_points, offer_per_quantity) VALUES
  ('GERAK_ON_LOOP', 'Distance on township loops', 0, 'm', 3, 90, 0, NULL)
ON CONFLICT (activity) DO NOTHING;
