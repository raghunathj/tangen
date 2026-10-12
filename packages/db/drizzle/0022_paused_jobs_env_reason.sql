ALTER TABLE "paused_jobs" ADD COLUMN IF NOT EXISTS "env_id" text NOT NULL DEFAULT '*';
ALTER TABLE "paused_jobs" ADD COLUMN IF NOT EXISTS "reason" text;
ALTER TABLE "paused_jobs" DROP CONSTRAINT IF EXISTS "paused_jobs_workspace_id_job_id_pk";
ALTER TABLE "paused_jobs" ADD CONSTRAINT "paused_jobs_workspace_id_job_id_env_id_pk" PRIMARY KEY("workspace_id","job_id","env_id");
