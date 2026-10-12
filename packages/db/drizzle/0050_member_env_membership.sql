-- Environment membership (tasks/plan-environment-architecture.md D3, Stage 1
-- T1.9). A workspace member reaches an environment only through an ACTIVE row
-- here; a member is no longer implied into every environment of its database.
-- Backfilled with today's behaviour made explicit: every member active in
-- every environment of its workspace. Member and environment creation write
-- the rows from now on; the Stage 3 reconciler converges them to desired state.
CREATE TABLE IF NOT EXISTS "member_env_membership" (
  "member_id" text NOT NULL REFERENCES "members"("id") ON DELETE CASCADE,
  "env_id" text NOT NULL REFERENCES "environments"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("member_id", "env_id")
);
CREATE INDEX IF NOT EXISTS "member_env_membership_ws_env_idx" ON "member_env_membership" ("workspace_id", "env_id");
INSERT INTO "member_env_membership" ("member_id", "env_id", "workspace_id", "status")
SELECT m."id", e."id", m."workspace_id", 'active'
FROM "members" m
JOIN "environments" e ON e."workspace_id" = m."workspace_id"
ON CONFLICT DO NOTHING;
