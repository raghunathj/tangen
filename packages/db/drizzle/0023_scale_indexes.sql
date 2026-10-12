CREATE INDEX IF NOT EXISTS "auth_users_workspace_env_created_idx" ON "auth_users" ("workspace_id","env_id","created_at" DESC);
CREATE INDEX IF NOT EXISTS "form_submissions_form_created_idx" ON "form_submissions" ("form_id","created_at" DESC);
CREATE INDEX IF NOT EXISTS "extension_data_scope_prefix_idx" ON "extension_data" ("extension_id","workspace_id","env_id","object_id" text_pattern_ops);
