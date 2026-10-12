-- Push history integrity (closure plan, Phase 1 Unit 4).
--
-- Every push records a checksum of the effective plan and the statements it
-- ran; the next push re-fingerprints the environment's rows from what they
-- store and refuses when one disagrees. Rows from before this column exist
-- with NULL: legacy, accepted as they are, reported, never rewritten.
ALTER TABLE "schema_pushes" ADD COLUMN IF NOT EXISTS "checksum" text;
