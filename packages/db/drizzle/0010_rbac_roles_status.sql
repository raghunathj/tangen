-- RBAC: workspace-defined custom roles + member suspension status.
CREATE TABLE IF NOT EXISTS roles (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_workspace_slug_unique UNIQUE (workspace_id, slug)
);

ALTER TABLE members ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
