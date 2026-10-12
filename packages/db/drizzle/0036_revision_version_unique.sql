-- Revision version numbers must be unique per object (2026-08-28).
--
-- `createRevision` allocated with `SELECT COALESCE(MAX(version),0)` followed by
-- a separate INSERT, with no transaction, no lock and no constraint. Two
-- concurrent writers to one object both read the same maximum and both inserted
-- the same version. Allocation is now a single INSERT ... SELECT that computes
-- the maximum inline and retries on conflict, and THIS index is what makes the
-- invariant real: without it the retry has nothing to catch.
--
-- The scope is (workspace_id, object_id) and deliberately NOT env_id, because
-- that is the scope the previous MAX() used. Widening it would change numbering
-- semantics; matching it changes nothing except that duplicates become
-- impossible.
--
-- A database that already contains duplicates cannot take this index. Rather
-- than fail with a bare "could not create unique index", stop first and say
-- exactly what is wrong and how to look at it: this is corrupt revision
-- history, and repairing it by renumbering rewrites a record the product
-- promises to keep, so it is an operator decision rather than a migration's.
DO $$
DECLARE dup_count integer; sample text;
BEGIN
  SELECT count(*), min(workspace_id || ' / ' || object_id || ' / v' || version)
    INTO dup_count, sample
  FROM (
    SELECT workspace_id, object_id, version
    FROM "_revisions"
    GROUP BY workspace_id, object_id, version
    HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add the revision uniqueness index: % object/version pair(s) already have duplicate revisions (for example %). '
      'This is pre-existing corrupt revision history from the unsafe allocator. Inspect with: '
      'SELECT workspace_id, object_id, version, count(*) FROM "_revisions" GROUP BY 1,2,3 HAVING count(*) > 1; '
      'Decide how to renumber or remove the duplicates, then re-run the migration.',
      dup_count, sample;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "_revisions_object_version_uniq" ON "_revisions" ("workspace_id","object_id","version");
