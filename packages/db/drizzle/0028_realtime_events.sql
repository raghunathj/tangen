CREATE TABLE IF NOT EXISTS "realtime_events" (
  "seq" bigserial PRIMARY KEY,
  "channel" text NOT NULL,
  "id" text NOT NULL,
  "t" bigint NOT NULL,
  "type" text NOT NULL,
  "data" jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS "realtime_events_channel_seq_idx" ON "realtime_events" ("channel", "seq");
CREATE UNIQUE INDEX IF NOT EXISTS "realtime_events_channel_id_idx" ON "realtime_events" ("channel", "id");
