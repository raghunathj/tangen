-- Extension installation per environment (closure plan Phase 4, Unit 1).
--
-- Until now one row meant "installed in this workspace, every environment".
-- The v1 contract installs, enables, upgrades and uninstalls per environment,
-- so the row gains env_id, state, enabled, version, upgraded_at and
-- uninstalled_at, and the old rows are ADOPTED: each workspace-wide row
-- becomes one row per environment the workspace has (from `environments`),
-- installed and enabled, options and installed_at/by carried over, version
-- left NULL until the first boot records the manifest's. A workspace with no
-- environment rows keeps one row under env_development, the platform's
-- default environment id, so nothing that was installed disappears.
-- Idempotent: only rows without an env_id are adopted; the second run finds none.
ALTER TABLE "workspace_installed_apps" ADD COLUMN IF NOT EXISTS "env_id" text;
ALTER TABLE "workspace_installed_apps" ADD COLUMN IF NOT EXISTS "state" text NOT NULL DEFAULT 'installed';
ALTER TABLE "workspace_installed_apps" ADD COLUMN IF NOT EXISTS "enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "workspace_installed_apps" ADD COLUMN IF NOT EXISTS "version" text;
ALTER TABLE "workspace_installed_apps" ADD COLUMN IF NOT EXISTS "upgraded_at" timestamp with time zone;
ALTER TABLE "workspace_installed_apps" ADD COLUMN IF NOT EXISTS "uninstalled_at" timestamp with time zone;

-- The old uniqueness (workspace, app) would refuse the second environment.
DROP INDEX IF EXISTS "workspace_installed_apps_ws_app_unique";

-- Adoption of the workspace-wide rows.
INSERT INTO "workspace_installed_apps" ("id", "workspace_id", "env_id", "app_id", "options", "state", "enabled", "version", "installed_at", "installed_by")
SELECT r."id" || '_' || replace(e."id", 'env_', ''), r."workspace_id", e."id", r."app_id", r."options", 'installed', true, r."version", r."installed_at", r."installed_by"
FROM "workspace_installed_apps" r
JOIN "environments" e ON e."workspace_id" = r."workspace_id"
WHERE r."env_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "workspace_installed_apps" ("id", "workspace_id", "env_id", "app_id", "options", "state", "enabled", "version", "installed_at", "installed_by")
SELECT r."id" || '_development', r."workspace_id", 'env_development', r."app_id", r."options", 'installed', true, r."version", r."installed_at", r."installed_by"
FROM "workspace_installed_apps" r
WHERE r."env_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "environments" e WHERE e."workspace_id" = r."workspace_id")
ON CONFLICT DO NOTHING;

DELETE FROM "workspace_installed_apps" WHERE "env_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_installed_apps_ws_env_app_unique" ON "workspace_installed_apps" ("workspace_id", "env_id", "app_id");
