-- Forms leaves core (tasks/plan-core-slimming.md S3, 2026-09-13): the three
-- tables belong to @tangen/ext-forms, whose migrations create them where the
-- extension is installed. Nothing outside this repository holds form data yet,
-- so the core copies are dropped rather than migrated.
DROP TABLE IF EXISTS "form_submissions" CASCADE;
DROP TABLE IF EXISTS "form_app_settings" CASCADE;
DROP TABLE IF EXISTS "forms" CASCADE;
