-- The semantic environment role (closure plan Phase 5A, Unit 2).
--
-- Exactly three roles exist in v1 - development, staging, production - and
-- every production protection keys on the role, never on a slug or a label.
-- The column is nullable at the database level so a legacy row waits for
-- adoption (migration 0048 / doctor) instead of being guessed; a row that
-- has a role keeps it: the trigger refuses every later change. One
-- environment per role per workspace.
ALTER TABLE "environments" ADD COLUMN IF NOT EXISTS "role" text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'environments_role_check') THEN
    ALTER TABLE "environments" ADD CONSTRAINT "environments_role_check" CHECK ("role" IS NULL OR "role" IN ('development', 'staging', 'production'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "environments_workspace_role_unique" ON "environments" ("workspace_id", "role") WHERE "role" IS NOT NULL;
CREATE OR REPLACE FUNCTION environments_role_set_once() RETURNS trigger AS $$
BEGIN
  IF OLD.role IS NOT NULL AND NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'environments.role is immutable: % is % and cannot become %', OLD.id, OLD.role, COALESCE(NEW.role, 'null')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS environments_role_set_once ON "environments";
CREATE TRIGGER environments_role_set_once BEFORE UPDATE ON "environments" FOR EACH ROW EXECUTE FUNCTION environments_role_set_once();
