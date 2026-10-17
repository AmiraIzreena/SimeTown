-- Offer-backed points per home per month: 800 -> 1000 (RM10), a deliberate decision for now.
-- docs/BUSINESS_RULES.md (BR6) still says 800; the team docs are not changed here.
--
-- The limit is one setting, program_settings.offer_points_monthly_home, read by
-- GET /kitar (limits) and by the step that credits offer-backed points. New
-- databases start at 1000. An existing database moves to 1000 only while it still
-- has the old default of 800, so a value SDP HQ chose by hand is left alone. The
-- change is logged like any settings change, with no person as the actor.
ALTER TABLE program_settings ALTER COLUMN offer_points_monthly_home SET DEFAULT 1000;

INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail)
  SELECT NULL, 'SETTINGS_CHANGED', 'program_settings', NULL,
         jsonb_build_object('offer_points_monthly_home', jsonb_build_object('from', 800, 'to', 1000), 'source', '015_home_offer_points_1000.sql')
  FROM program_settings
  WHERE offer_points_monthly_home = 800;

UPDATE program_settings SET offer_points_monthly_home = 1000 WHERE offer_points_monthly_home = 800;
