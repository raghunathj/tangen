-- Forms v2: code-first forms need an origin marker and a slug identity.
-- Pre-dedupe: suffix any duplicate slugs before the unique index lands.
WITH d AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY workspace_id, env_id, slug ORDER BY created_at) AS rn
  FROM forms
)
UPDATE forms f SET slug = f.slug || '-' || d.rn
FROM d WHERE f.id = d.id AND d.rn > 1;

ALTER TABLE forms ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'admin';
CREATE UNIQUE INDEX IF NOT EXISTS forms_workspace_env_slug_unique ON forms (workspace_id, env_id, slug);
