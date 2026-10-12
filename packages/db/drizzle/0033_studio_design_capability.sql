-- Studio decision 3 (2026-08-25): `studio:design` splits class, tag, token,
-- theme and stylesheet work off `studio:edit`.
--
-- Every custom role that could style a page BEFORE this release did so through
-- one of three grants: `studio:edit` directly, or `studio:manage` /
-- `studio:creative`, both of which implied `studio:edit`. Shipping the split
-- without this statement would take styling away from all of them silently, at
-- the moment of deploy, with no admin action and no notice.
--
-- So the grandfather is written down as data, not hidden in the capability
-- resolver: each of those roles gets `studio:design` (and `studio:edit`, when
-- it was only ever implied) added to its stored capability list, where an
-- owner can SEE it in the roles editor and remove it from the marketer roles
-- that should not have kept it. A silent implication would have been
-- invisible forever.
--
-- Owners and admins are unaffected: they never carry a capability list.
-- Code-defined roles (defineRole() in a site's config) are not stored here and
-- must add `studio:design` in code - see docs/rbac.md.
UPDATE "roles"
SET "permissions" = jsonb_set(
      "permissions",
      '{capabilities}',
      COALESCE("permissions"->'capabilities', '[]'::jsonb)
        || (CASE WHEN "permissions"->'capabilities' @> '"studio:design"'::jsonb
                 THEN '[]'::jsonb ELSE '["studio:design"]'::jsonb END)
        || (CASE WHEN "permissions"->'capabilities' @> '"studio:edit"'::jsonb
                 THEN '[]'::jsonb ELSE '["studio:edit"]'::jsonb END),
      true
    ),
    "updated_at" = now()
WHERE jsonb_typeof("permissions"->'capabilities') = 'array'
  AND ("permissions"->'capabilities' @> '"studio:edit"'::jsonb
    OR "permissions"->'capabilities' @> '"studio:manage"'::jsonb
    OR "permissions"->'capabilities' @> '"studio:creative"'::jsonb)
  AND NOT ("permissions"->'capabilities' @> '"studio:design"'::jsonb
       AND "permissions"->'capabilities' @> '"studio:edit"'::jsonb);
