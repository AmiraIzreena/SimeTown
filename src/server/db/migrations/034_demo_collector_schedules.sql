-- Kitar collections: the two demo partner collectors were seeded with free-text days
-- ("Tue and Sat mornings", "Every Thursday"). The system cannot read free text, so it let
-- residents book them on any day and time. Give them the schedules their text describes,
-- in the format collector-schedule.ts reads. Only these exact demo rows change.
UPDATE recycling_collectors SET days = 'schedule:v1 days=TUE,SAT time=MORNING'
 WHERE name = 'Kitar Plus Recyclers' AND days = 'Tue and Sat mornings';
UPDATE recycling_collectors SET days = 'schedule:v1 days=THU time=BOTH'
 WHERE name = 'Minyak Hijau Collectors' AND days = 'Every Thursday';
