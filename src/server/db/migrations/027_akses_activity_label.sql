-- Akses+ Impact XP is now earned when a responsible provider confirms a resident's
-- accessibility report, or when staff verify a place the resident suggested.
UPDATE activity_rules SET label = 'Access report or place confirmed' WHERE activity = 'AKSES_UPDATE';
