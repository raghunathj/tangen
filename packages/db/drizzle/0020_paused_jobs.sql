CREATE TABLE IF NOT EXISTS "paused_jobs" (
	"workspace_id" text NOT NULL,
	"job_id" text NOT NULL,
	"paused_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paused_by" text,
	CONSTRAINT "paused_jobs_workspace_id_job_id_pk" PRIMARY KEY("workspace_id","job_id")
);
