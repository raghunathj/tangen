CREATE TABLE IF NOT EXISTS "rate_limit_counters" (
  "key" text PRIMARY KEY NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  "reset_at" timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS "rate_limit_counters_reset_idx" ON "rate_limit_counters" ("reset_at");
