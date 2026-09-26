-- Migration: move "section" from students to subjects.
-- Run this against your EXISTING database to preserve current data.
-- (If you'd rather just wipe and start fresh, see database.sql instead.)

ALTER TABLE subjects ADD COLUMN section VARCHAR(50);

-- Your existing test data already has one consistent section per subject
-- (Math 101 -> BSIT-3A, Science 201 -> BSIT-3B), so this restores that:
UPDATE subjects SET section = 'BSIT-3A' WHERE name = 'Math 101';
UPDATE subjects SET section = 'BSIT-3B' WHERE name = 'Science 201';

-- Catch-all in case you have other subjects without a section set yet:
UPDATE subjects SET section = 'TBA' WHERE section IS NULL;

ALTER TABLE subjects ALTER COLUMN section SET NOT NULL;

-- Section is no longer tracked per-student.
ALTER TABLE students DROP COLUMN section;
