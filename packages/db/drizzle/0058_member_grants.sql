CREATE TABLE IF NOT EXISTS "member_grants" (
	"workspace_id" text NOT NULL,
	"member_id" text NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extensions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"granted_by" text,
	"reason" text,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_grants_workspace_id_member_id_pk" PRIMARY KEY("workspace_id","member_id")
);
