-- Watering a community garden earns Impact XP only. The gate code is printed and
-- never changes, so a scan proves little: it could be shared as a photo, and it
-- says nothing about whether the plants were watered.
UPDATE activity_rules SET offer_points = 0 WHERE activity = 'TAMAN_WATERING';
