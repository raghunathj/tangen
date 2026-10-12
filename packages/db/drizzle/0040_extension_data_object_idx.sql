-- Extension data by object.
--
-- Every admin list asks extension_data which of the page's objects carry
-- unpublished extension data (the draft-changes indicator). Both existing
-- indexes lead with extension_id, so that lookup - by workspace, environment
-- and object - had no index at all and scanned the whole table: measured at
-- 37 ms over 120k rows, on every admin list, growing with every extension row
-- a site accumulates. This index makes it a handful of probes, and lets the
-- indicator ride the page query itself instead of costing a round trip.
CREATE INDEX IF NOT EXISTS "extension_data_object_idx" ON "extension_data" ("workspace_id", "env_id", "object_id");
