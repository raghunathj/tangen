CREATE TABLE IF NOT EXISTS "realtime_presence" (
  "channel" text NOT NULL,
  "session_id" text NOT NULL,
  "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "expires_at" bigint NOT NULL,
  PRIMARY KEY ("channel", "session_id")
);
CREATE INDEX IF NOT EXISTS "realtime_presence_expires_idx" ON "realtime_presence" ("expires_at");
