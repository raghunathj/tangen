-- The extension migration ledger (closure plan Phase 4, Unit 5): one row per
-- migration an extension applied in one workspace x environment, with the
-- checksum of the SQL that ran. Extension schema evolution is explicit,
-- deterministic and ledgered; nothing creates or alters an extension's
-- tables at import, REGISTER, ENABLE or START.
CREATE TABLE IF NOT EXISTS "extension_migrations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"env_id" text NOT NULL,
	"extension_id" text NOT NULL,
	"migration_id" text NOT NULL,
	"extension_version" text,
	"checksum" text NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"error" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "extension_migrations_scope_unique" ON "extension_migrations" ("workspace_id","env_id","extension_id","migration_id");
