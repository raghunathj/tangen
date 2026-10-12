-- Adoption of legacy environments into the three roles (closure plan Phase 5A, Unit 3).
--
-- The rule is environmentRoleForSlug in @tangen/types: development | dev,
-- staging | stage, production | prod, case-insensitively. A role is assigned
-- only when exactly ONE null-role environment of the workspace names it and
-- the workspace does not already hold it. Two candidates for one role
-- (prod and production side by side), a slug the rule does not know (uat,
-- live, prod-eu) or a role already held leave the row null: doctor reports
-- it and `tangen environment adopt-role` is the operator's decision. Never
-- a guess; never two productions. Idempotent: only null roles are touched.
WITH candidates AS (
  SELECT e."id", e."workspace_id",
    CASE
      WHEN lower(e."slug") IN ('development', 'dev') THEN 'development'
      WHEN lower(e."slug") IN ('staging', 'stage') THEN 'staging'
      WHEN lower(e."slug") IN ('production', 'prod') THEN 'production'
    END AS "role"
  FROM "environments" e
  WHERE e."role" IS NULL
), counted AS (
  SELECT c."id", c."workspace_id", c."role",
    count(*) OVER (PARTITION BY c."workspace_id", c."role") AS "n",
    EXISTS (SELECT 1 FROM "environments" x WHERE x."workspace_id" = c."workspace_id" AND x."role" = c."role") AS "taken"
  FROM candidates c
  WHERE c."role" IS NOT NULL
)
UPDATE "environments" e
SET "role" = counted."role"
FROM counted
WHERE e."id" = counted."id" AND counted."n" = 1 AND NOT counted."taken";
