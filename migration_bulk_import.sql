-- Migration: allow students to exist without a fingerprint yet (for Excel
-- import / the new "Register" button flow). Run this against your EXISTING
-- database. Safe to run even if you already applied the earlier
-- migration_section_to_subject.sql.

ALTER TABLE students ALTER COLUMN fingerprint_id DROP NOT NULL;
