-- Rollback for the "Review Nilai v2" schema additions (see schema.sql).
-- Run ONLY after deploying code that no longer reads these columns, otherwise
-- the next boot's schema.sql re-adds them (harmless, but empty).
-- Data loss: drops every instruktur-written sample answer and every correction
-- note. Corrected scores themselves (submissions.final_score) are untouched.
--   docker compose exec -T db psql -U tekser -d tekser < server/src/db/rollback/2026-11-06-review-nilai-v2.sql
BEGIN;
ALTER TABLE questions   DROP COLUMN IF EXISTS sample_answers;
ALTER TABLE submissions DROP COLUMN IF EXISTS review_note;
COMMIT;
