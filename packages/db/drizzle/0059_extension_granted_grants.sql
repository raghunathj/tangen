-- Extension Kernel K5.2a: the grants an operator approved for an installation.
-- NULL = not reviewed (an installation that predates review): the runtime
-- binds to the manifest's required grants, as before. A JSON array = the
-- approval; the runtime binds to it intersected with what the current
-- manifest declares, so a new required grant waits for re-review and a
-- grant the manifest dropped is revoked without touching the record.
ALTER TABLE "workspace_installed_apps" ADD COLUMN IF NOT EXISTS "granted_grants" jsonb;
