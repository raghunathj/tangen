-- Remove first-class Environments (tasks/remove-environments-programme.md, R6 + R7).
--
-- One deployment has one database context; a workspace is the content
-- boundary. This migration keeps ONE environment's rows per workspace and
-- drops every env_id column, the environment tables and the promotion
-- bookkeeping. It is generic over information_schema, so content tables,
-- custom tables and extension tables that carry env_id are handled the same
-- way as the platform's own tables.
--
-- Which environment is kept, per workspace:
--   1. TANGEN_KEEP_ENVIRONMENT (run as `SET tangen.keep_environment = '<slug>'`
--      by the migration runner) names it explicitly.
--   2. Otherwise, when exactly one environment holds data rows, that one.
--   3. Otherwise, when no environment holds data rows, the production-role one.
--   4. Otherwise the migration REFUSES with the per-environment row counts and
--      the variable to set. Nothing is deleted on refusal.
-- Data rows are counted in every env-scoped table except bookkeeping and
-- history (registry, ledgers, queues, caches, logs), which follow the decision.
--
-- History tables (audit_log, workspace_activity, job_runs, schema_pushes,
-- migration_runs, release_history, webhook_deliveries, search_query_log,
-- knowledge_queries) keep every row and only lose the column.

-- ── 1. Decide, and delete the rows of the environments that are not kept ────
DO $tangen$
DECLARE
  has_env boolean;
  keep_slug text := nullif(trim(current_setting('tangen.keep_environment', true)), '');
  ws record;
  env record;
  t record;
  k record;
  n bigint;
  counts jsonb;
  data_total bigint;
  with_data int;
  kept text;
  prod text;
  first_env text;
  refusal text := '';
  primary_env text;
  primary_rows bigint := -1;
  bookkeeping text[] := ARRAY[
    'environments', 'object_types', 'fields', 'member_env_roles', 'member_env_membership',
    'workspace_installed_apps', 'custom_table_owners', 'extension_migrations', 'scheduler_state',
    'paused_jobs', 'job_queue', 'cron_jobs', 'delivery_artifacts', 'search_documents',
    'knowledge_chunks', 'knowledge_meta', 'porter_transfer_codes', 'porter_transfer_tokens',
    'auth_sessions', 'playground_collections', 'playground_variables', 'saved_views', 'ai_chats',
    'audit_log', 'workspace_activity', 'job_runs', 'schema_pushes', 'migration_runs',
    'release_history', 'webhook_deliveries', 'search_query_log', 'knowledge_queries', 'promotion_log'
  ];
  history text[] := ARRAY[
    'audit_log', 'workspace_activity', 'job_runs', 'schema_pushes', 'migration_runs',
    'release_history', 'webhook_deliveries', 'search_query_log', 'knowledge_queries'
  ];
BEGIN
  -- The decision, per workspace, survives into step 3 (same transaction).
  CREATE TEMP TABLE tangen_kept (workspace_id text, env_id text) ON COMMIT DROP;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'environments') INTO has_env;

  -- Every (workspace, environment) pair that exists: the environments rows,
  -- plus the pairs the data itself names for a workspace the table never
  -- registered (its rows would otherwise survive as several environments in
  -- one workspace and collide once env_id is gone).
  CREATE TEMP TABLE tangen_env_scope (workspace_id text, env_id text, slug text, role text) ON COMMIT DROP;
  IF has_env THEN
    INSERT INTO tangen_env_scope SELECT workspace_id, id, slug, role FROM environments;
  END IF;
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    WHERE c.table_schema = current_schema() AND c.column_name = 'env_id' AND c.table_name <> 'environments'
      AND EXISTS (SELECT 1 FROM information_schema.columns w WHERE w.table_schema = c.table_schema AND w.table_name = c.table_name AND w.column_name = 'workspace_id')
  LOOP
    EXECUTE format(
      'INSERT INTO tangen_env_scope SELECT DISTINCT r.workspace_id, r.env_id, regexp_replace(r.env_id, ''^env_'', ''''), NULL FROM %I r ' ||
      'WHERE r.env_id IS NOT NULL AND r.workspace_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tangen_env_scope s WHERE s.workspace_id = r.workspace_id AND s.env_id = r.env_id)',
      t.table_name);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM tangen_env_scope) THEN
    RAISE NOTICE 'tangen: no environment rows anywhere; dropping env_id columns without selecting rows';
    RETURN;
  END IF;

  FOR ws IN SELECT DISTINCT workspace_id FROM tangen_env_scope ORDER BY workspace_id LOOP
    counts := '{}'::jsonb;
    data_total := 0;
    with_data := 0;
    prod := NULL;
    first_env := NULL;
    kept := NULL;

    FOR env IN SELECT env_id AS id, slug, role FROM tangen_env_scope WHERE workspace_id = ws.workspace_id ORDER BY slug LOOP
      n := 0;
      FOR t IN
        SELECT c.table_name
        FROM information_schema.columns c
        WHERE c.table_schema = current_schema() AND c.column_name = 'env_id'
          AND c.table_name <> ALL (bookkeeping)
          AND EXISTS (SELECT 1 FROM information_schema.columns w WHERE w.table_schema = c.table_schema AND w.table_name = c.table_name AND w.column_name = 'workspace_id')
      LOOP
        EXECUTE format('SELECT count(*) FROM %I WHERE env_id = $1 AND workspace_id = $2', t.table_name) INTO n USING env.id, ws.workspace_id;
        counts := counts || jsonb_build_object(env.slug, coalesce((counts ->> env.slug)::bigint, 0) + n);
      END LOOP;
      IF coalesce((counts ->> env.slug)::bigint, 0) > 0 THEN with_data := with_data + 1; END IF;
      data_total := data_total + coalesce((counts ->> env.slug)::bigint, 0);
      IF env.role = 'production' THEN prod := env.id; END IF;
      IF first_env IS NULL THEN first_env := env.id; END IF;
    END LOOP;

    -- TANGEN_KEEP_ENVIRONMENT decides where it names one of the workspace's
    -- environments; a workspace it does not fit is decided by its data like
    -- any other (one environment with rows, else the production one), and
    -- refused only when that is ambiguous too.
    IF keep_slug IS NOT NULL THEN
      SELECT env_id INTO kept FROM tangen_env_scope WHERE workspace_id = ws.workspace_id AND (slug = keep_slug OR env_id = keep_slug) LIMIT 1;
    END IF;
    IF kept IS NOT NULL THEN
      NULL;
    ELSIF with_data = 1 THEN
      SELECT e.env_id INTO kept FROM tangen_env_scope e WHERE e.workspace_id = ws.workspace_id AND coalesce((counts ->> e.slug)::bigint, 0) > 0 LIMIT 1;
    ELSIF with_data = 0 THEN
      kept := coalesce(prod, first_env);
    ELSE
      refusal := refusal || format(E'\n  workspace %s holds data in %s environments: %s. Set TANGEN_KEEP_ENVIRONMENT=<slug> to the one to keep (it has: %s); the others are deleted.',
        ws.workspace_id, with_data,
        (SELECT string_agg(format('%s (%s rows)', key, value), ', ' ORDER BY key) FROM jsonb_each_text(counts)),
        (SELECT string_agg(slug, ', ' ORDER BY slug) FROM tangen_env_scope WHERE workspace_id = ws.workspace_id));
      CONTINUE;
    END IF;
    INSERT INTO tangen_kept VALUES (ws.workspace_id, kept);
    RAISE NOTICE 'tangen: workspace % keeps environment % (% data rows)', ws.workspace_id, kept, data_total;
    -- Tables without a workspace column (the schema registry: object_types,
    -- fields) hold ONE environment's rows afterwards: the named one, else the
    -- one kept by the workspace with the most data.
    IF keep_slug IS NOT NULL AND (kept = keep_slug OR kept = 'env_' || keep_slug) THEN
      primary_env := kept; primary_rows := 9223372036854775807;
    ELSIF data_total > primary_rows THEN
      primary_env := kept; primary_rows := data_total;
    END IF;
  END LOOP;

  IF refusal <> '' THEN
    RAISE EXCEPTION E'Environment removal refused - the environment to keep is ambiguous:%\nNothing was changed. Run the migration again with TANGEN_KEEP_ENVIRONMENT set (the API boot, or db:migrate in packages/db).', refusal
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO tangen_kept VALUES ('*', primary_env);
  RAISE NOTICE 'tangen: the schema registry and every other workspace-less table keep environment %', primary_env;

  -- Delete the rows of every other environment: workspace-scoped tables by
  -- their workspace's decision, workspace-less tables by the primary one.
  -- A row with no environment (env_id NULL) predates the model and stays.
  -- Children before parents: a table whose rows reference another
  -- environment-scoped table (fields -> object_types) empties first, so no
  -- foreign key is violated half-way.
  FOR t IN
    WITH RECURSIVE scoped AS (
      SELECT c.table_name::text AS table_name,
        EXISTS (SELECT 1 FROM information_schema.columns w WHERE w.table_schema = c.table_schema AND w.table_name = c.table_name AND w.column_name = 'workspace_id') AS has_ws
      FROM information_schema.columns c
      WHERE c.table_schema = current_schema() AND c.column_name = 'env_id'
        AND c.table_name <> ALL (history) AND c.table_name <> 'environments'
    ), refs AS (
      SELECT con.conrelid::regclass::text AS child, con.confrelid::regclass::text AS parent
      FROM pg_constraint con WHERE con.contype = 'f' AND con.conrelid <> con.confrelid
    ), depth AS (
      SELECT table_name::text AS table_name, 0 AS d FROM scoped
      UNION ALL
      SELECT r.child::text, depth.d + 1 FROM depth JOIN refs r ON r.parent = depth.table_name JOIN scoped s ON s.table_name = r.child WHERE depth.d < 8
    )
    SELECT s.table_name, s.has_ws FROM scoped s
    ORDER BY (SELECT max(d) FROM depth WHERE depth.table_name = s.table_name) DESC, s.table_name
  LOOP
    IF t.table_name = 'paused_jobs' THEN
      -- '*' pauses every environment; keep it unless the kept environment has its own row.
      EXECUTE 'DELETE FROM paused_jobs p WHERE p.env_id IS NOT NULL AND p.env_id <> ''*'' AND NOT EXISTS (SELECT 1 FROM tangen_kept k WHERE k.workspace_id = p.workspace_id AND k.env_id = p.env_id)';
      EXECUTE 'DELETE FROM paused_jobs p WHERE p.env_id = ''*'' AND EXISTS (SELECT 1 FROM paused_jobs q WHERE q.workspace_id = p.workspace_id AND q.job_id = p.job_id AND q.env_id <> ''*'')';
    ELSIF t.has_ws THEN
      -- A child table that carries env_id but no workspace_id (fields ->
      -- object_types) cannot be scoped by workspace itself: its rows go
      -- with the parent rows they reference.
      FOR k IN
        SELECT con.conrelid::regclass::text AS child, a.attname AS fkcol, pa.attname AS pkcol
        FROM pg_constraint con
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
        WHERE con.contype = 'f' AND con.confrelid = quote_ident(t.table_name)::regclass AND con.conrelid <> con.confrelid
          AND array_length(con.conkey, 1) = 1
          AND EXISTS (SELECT 1 FROM information_schema.columns e WHERE e.table_schema = current_schema() AND e.table_name = con.conrelid::regclass::text AND e.column_name = 'env_id')
      LOOP
        EXECUTE format('DELETE FROM %I c USING %I p WHERE p.%I = c.%I AND p.env_id IS NOT NULL AND EXISTS (SELECT 1 FROM tangen_kept k WHERE k.workspace_id = p.workspace_id) AND NOT EXISTS (SELECT 1 FROM tangen_kept k WHERE k.workspace_id = p.workspace_id AND k.env_id = p.env_id)',
          k.child, t.table_name, k.pkcol, k.fkcol);
      END LOOP;
      EXECUTE format('DELETE FROM %I r WHERE r.env_id IS NOT NULL AND EXISTS (SELECT 1 FROM tangen_kept k WHERE k.workspace_id = r.workspace_id) AND NOT EXISTS (SELECT 1 FROM tangen_kept k WHERE k.workspace_id = r.workspace_id AND k.env_id = r.env_id)', t.table_name);
    ELSE
      FOR k IN
        SELECT con.conrelid::regclass::text AS child, a.attname AS fkcol, pa.attname AS pkcol
        FROM pg_constraint con
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
        WHERE con.contype = 'f' AND con.confrelid = quote_ident(t.table_name)::regclass AND con.conrelid <> con.confrelid
          AND array_length(con.conkey, 1) = 1
          AND EXISTS (SELECT 1 FROM information_schema.columns e WHERE e.table_schema = current_schema() AND e.table_name = con.conrelid::regclass::text AND e.column_name = 'env_id')
      LOOP
        EXECUTE format('DELETE FROM %I c USING %I p WHERE p.%I = c.%I AND p.env_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tangen_kept k WHERE k.workspace_id = ''*'' AND k.env_id = p.env_id)',
          k.child, t.table_name, k.pkcol, k.fkcol);
      END LOOP;
      EXECUTE format('DELETE FROM %I r WHERE r.env_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tangen_kept k WHERE k.workspace_id = ''*'' AND k.env_id = r.env_id)', t.table_name);
    END IF;
  END LOOP;
END
$tangen$;

-- ── 2. Drop the environment tables and the promotion bookkeeping ────────────
DROP TABLE IF EXISTS "member_env_roles" CASCADE;
DROP TABLE IF EXISTS "member_env_membership" CASCADE;
DROP TABLE IF EXISTS "promotion_log" CASCADE;
DROP TABLE IF EXISTS "environments" CASCADE;

-- ── 3. Drop every env_id column, re-keying what it was part of ──────────────
DO $tangen$
DECLARE
  t record;
  k record;
  pk record;
  cols text;
  def text;
  newname text;
BEGIN
  IF to_regclass('pg_temp.tangen_kept') IS NULL THEN
    CREATE TEMP TABLE tangen_kept (workspace_id text, env_id text) ON COMMIT DROP;
  END IF;
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    WHERE c.table_schema = current_schema() AND c.column_name = 'env_id'
    ORDER BY c.table_name
  LOOP
    -- Rows that differ only by env_id would collide on a unique key once the
    -- column is gone: a workspace the environments table never registered, a
    -- pre-model row with no environment beside an adopted one. Keep one per
    -- key - the kept environment's row, else the one with no environment,
    -- else the first by env_id - and say how many went.
    FOR k IN
      SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) AS rest, con.conname AS name
      FROM pg_constraint con JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
      WHERE con.conrelid = quote_ident(t.table_name)::regclass AND con.contype IN ('p', 'u')
        AND EXISTS (SELECT 1 FROM pg_attribute e WHERE e.attrelid = con.conrelid AND e.attnum = ANY (con.conkey) AND e.attname = 'env_id')
        AND a.attname <> 'env_id'
      GROUP BY con.conname
      UNION ALL
      SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum), i.indexrelid::regclass::text
      FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = quote_ident(t.table_name)::regclass AND i.indisunique AND NOT i.indisprimary AND i.indpred IS NULL
        AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
        AND EXISTS (SELECT 1 FROM pg_attribute e WHERE e.attrelid = i.indrelid AND e.attnum = ANY (i.indkey) AND e.attname = 'env_id')
        AND a.attname <> 'env_id'
      GROUP BY i.indexrelid
    LOOP
      IF k.rest IS NULL THEN CONTINUE; END IF;
      DROP TABLE IF EXISTS tangen_dupes;
      EXECUTE format(
        'CREATE TEMP TABLE tangen_dupes ON COMMIT DROP AS WITH ranked AS (SELECT ctid AS row_ctid, row_number() OVER (PARTITION BY %s ORDER BY (EXISTS (SELECT 1 FROM tangen_kept kk WHERE kk.env_id = r.env_id)) DESC, (r.env_id IS NULL) DESC, r.env_id) AS rn FROM %I r WHERE %s) SELECT row_ctid FROM ranked WHERE rn > 1',
        k.rest, t.table_name, (SELECT string_agg(x || ' IS NOT NULL', ' AND ') FROM unnest(string_to_array(k.rest, ', ')) AS x));
      -- Rows another table references follow their parent out.
      FOR pk IN
        SELECT con.conrelid::regclass::text AS child, a.attname AS fkcol, pa.attname AS pkcol
        FROM pg_constraint con
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
        WHERE con.contype = 'f' AND con.confrelid = quote_ident(t.table_name)::regclass AND con.conrelid <> con.confrelid AND array_length(con.conkey, 1) = 1
      LOOP
        EXECUTE format('DELETE FROM %I c USING %I p, tangen_dupes x WHERE p.ctid = x.row_ctid AND p.%I = c.%I', pk.child, t.table_name, pk.pkcol, pk.fkcol);
      END LOOP;
      EXECUTE format('DELETE FROM %I d USING tangen_dupes x WHERE d.ctid = x.row_ctid', t.table_name);
      GET DIAGNOSTICS cols = ROW_COUNT;
      IF cols::bigint > 0 THEN
        RAISE NOTICE 'tangen: % rows of % differed only by environment on key % and are gone', cols, t.table_name, k.name;
      END IF;
    END LOOP;

    -- Primary keys and unique constraints that include env_id: remember them without it.
    FOR k IN
      SELECT conname, contype,
        (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY array_position(con.conkey, a.attnum))
           FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey) AND a.attname <> 'env_id') AS rest
      FROM pg_constraint con
      WHERE con.conrelid = quote_ident(t.table_name)::regclass AND con.contype IN ('p', 'u')
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey) AND a.attname = 'env_id')
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t.table_name, k.conname);
      IF k.rest IS NOT NULL THEN
        newname := regexp_replace(regexp_replace(k.conname, '_env_id_', '_'), '_env_', '_');
        IF k.contype = 'p' THEN
          EXECUTE format('ALTER TABLE %I ADD PRIMARY KEY (%s)', t.table_name, k.rest);
        ELSE
          EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (%s)', t.table_name, newname, k.rest);
        END IF;
      END IF;
    END LOOP;

    -- Indexes that include env_id: recreate without it, under the environment-free name.
    FOR k IN
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = t.table_name
        AND indexdef ~ '[(, ]env_id[,) ]'
        AND indexname NOT IN (SELECT conname FROM pg_constraint)
    LOOP
      EXECUTE format('DROP INDEX IF EXISTS %I', k.indexname);
      def := regexp_replace(k.indexdef, 'env_id,\s*', '');
      def := regexp_replace(def, ',\s*env_id(?=[,)])', '');
      newname := regexp_replace(regexp_replace(regexp_replace(k.indexname, '_workspace_env_', '_workspace_'), '_ws_env_', '_ws_'), '_env_', '_');
      newname := regexp_replace(newname, '_env$', '');
      def := replace(def, 'INDEX ' || quote_ident(k.indexname) || ' ON', 'INDEX ' || quote_ident(newname) || ' ON');
      def := replace(def, 'INDEX ' || k.indexname || ' ON', 'INDEX ' || quote_ident(newname) || ' ON');
      IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = newname) THEN
        -- An environment-free index of that name already exists (a later
        -- migration or a heal created it beside the environment-keyed one):
        -- it is the one that stays, and the environment-keyed one is gone.
        RAISE NOTICE 'tangen: index % already exists; % dropped', newname, k.indexname;
      ELSIF def !~ '\(\s*\)' AND def !~ 'USING \w+ \(\s*\)' THEN
        EXECUTE replace(replace(def, 'CREATE UNIQUE INDEX', 'CREATE UNIQUE INDEX IF NOT EXISTS'), 'CREATE INDEX', 'CREATE INDEX IF NOT EXISTS');
      END IF;
    END LOOP;

    EXECUTE format('ALTER TABLE %I DROP COLUMN env_id', t.table_name);
  END LOOP;
END
$tangen$;

-- ── 4. Releases change in place; runs and history keep their rows ───────────
DO $tangen$
DECLARE
  pair record;
BEGIN
  FOR pair IN
    SELECT * FROM (VALUES
      ('releases', 'source_env_id'), ('releases', 'target_env_id'),
      ('release_history', 'source_env_id'), ('release_history', 'target_env_id'),
      ('release_history', 'source_role'), ('release_history', 'target_role'),
      ('migration_runs', 'source_env_id'), ('migration_runs', 'target_env_id')
    ) AS v(table_name, column_name)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = current_schema() AND c.table_name = pair.table_name AND c.column_name = pair.column_name) THEN
      EXECUTE format('ALTER TABLE %I DROP COLUMN %I', pair.table_name, pair.column_name);
    END IF;
  END LOOP;
END
$tangen$;
