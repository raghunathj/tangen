CREATE TABLE IF NOT EXISTS "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"env_id" text NOT NULL,
	"email" text,
	"name" text,
	"password_hash" text,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"env_id" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "auth_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_sso_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"env_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sso_accounts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_users_workspace_env_idx" ON "auth_users" ("workspace_id","env_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_users_anon_idx" ON "auth_users" ("workspace_id","env_id","is_anonymous");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_users_workspace_env_email_idx" ON "auth_users" ("workspace_id","env_id","email") WHERE email IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_user_idx" ON "auth_sessions" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_workspace_env_idx" ON "auth_sessions" ("workspace_id","env_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_sso_accounts_provider_user_idx" ON "auth_sso_accounts" ("workspace_id","env_id","provider","provider_user_id");
