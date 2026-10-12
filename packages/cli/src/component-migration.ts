/**
 * File Name: component-migration.ts
 * Purpose: Turns declared component rename intent into planner-facing facts:
 *   where a component's blocks can be stored, and how many stored values a
 *   proposed rename would move, conflict with, or find already moved.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: READ-ONLY by contract. Every query here is a SELECT, and
 *   this module contains no UPDATE, by design: the plan has to be able to say
 *   what would happen before anything is authorised to make it happen.
 *
 *   It also contains NO risk decision. It produces facts; `classifyOperation`
 *   in plan-ops.ts remains the only place that says safe, destructive or
 *   ambiguous. That is why the probe returns counts and a conflict flag rather
 *   than a verdict.
 *
 *   Two things about the SQL are not obvious and were established by running it:
 *
 *   1. `strict $.**` is required. In lax mode the path yields every block
 *      TWICE - once through array auto-unwrapping and once directly - so any
 *      count over `jsonb_path_query` is doubled. `jsonb_path_exists` is
 *      unaffected because it answers per row.
 *   2. A locale overlay has a different shape from the base: it is an OBJECT
 *      keyed by block `_key`, whose values are objects keyed by sub-field name,
 *      with no `_type` anywhere. So an overlay entry can only be attributed to
 *      a component by joining back to the base array on `_key`.
 */
import { sql } from 'drizzle-orm'
import type { SchemaDefinition, ComponentDef, FieldDefinition } from '@tangen/types'
import { flattenFields } from '@tangen/types'
import { isSafeIdent, safeId } from './column-types'
import { queryRows, type SqlReader } from './migration-plan'

// ─── The normalized planner input ────────────────────────────────────────────

/**
 * One declared rename: every name a value may still be stored under, and the
 * one name the current definition uses.
 *
 * `sources` is a set, not a single name, because `previousName` is a trail. A
 * chain title → heading → headline leaves rows that may hold EITHER old key,
 * depending on when they were last written, and both have to be found. A block
 * holding two of them at once has two candidate values for one destination and
 * is a conflict: choosing by chain order would be picking a winner, which is
 * exactly what this model refuses to do.
 */
export interface ComponentRename {
  /** Registry component name, matched against a stored block's `_type`. */
  component: string
  /** Every name the value may still be stored under, oldest first. */
  sources: string[]
  /** The name the current definition uses. */
  to: string
}

/**
 * A column where blocks of a component can be stored. Derived from the schema,
 * not from the data: which content types reference the component, through which
 * top-level JSONB column, at any depth beneath it.
 *
 * Depth is not part of this on purpose. `strict $.**` searches every level, so
 * the probe needs the column, not the path; the eventual writer will need the
 * path, and that is a separate concern from establishing the facts.
 */
export interface ComponentSite {
  typeName: string
  column: string
  /** True when the type is localized, so a `<type>_i18n` side table may exist. */
  localized: boolean
}

/** Every component reachable from a field's config, following registry refs. */
function componentsUnder(
  refs: unknown,
  registry: ComponentDef[],
  seen: Set<string>,
  out: Set<string>,
): void {
  for (const ref of (Array.isArray(refs) ? refs : []) as Array<string | ComponentDef>) {
    const def = typeof ref === 'string' ? registry.find((c) => c.name === ref) : ref
    if (!def?.name || seen.has(def.name)) continue
    seen.add(def.name)
    out.add(def.name)
    for (const sf of (def.fields ?? []) as FieldDefinition[]) {
      const cfg = (sf.config ?? {}) as { components?: unknown; fields?: unknown }
      if (sf.fieldType === 'component') componentsUnder(cfg.components, registry, seen, out)
      if (sf.fieldType === 'repeater') {
        for (const rf of (Array.isArray(cfg.fields) ? cfg.fields : []) as FieldDefinition[]) {
          if (rf.fieldType === 'component') componentsUnder((rf.config as { components?: unknown })?.components, registry, seen, out)
        }
      }
    }
  }
}

/**
 * The columns where blocks of `component` can appear. A component reached only
 * through another component still resolves, because the outer component's own
 * sub-fields are followed.
 */
export function componentSites(
  schema: SchemaDefinition,
  registry: ComponentDef[],
  component: string,
): ComponentSite[] {
  const sites: ComponentSite[] = []
  for (const type of schema.types ?? []) {
    if (!isSafeIdent(type.name)) continue
    for (const f of flattenFields(type.fields ?? [])) {
      if (!isSafeIdent(f.name)) continue
      const cfg = (f.config ?? {}) as { components?: unknown; fields?: unknown }
      const reachable = new Set<string>()
      if (f.fieldType === 'component') componentsUnder(cfg.components, registry, new Set(), reachable)
      if (f.fieldType === 'repeater') {
        for (const rf of (Array.isArray(cfg.fields) ? cfg.fields : []) as FieldDefinition[]) {
          if (rf.fieldType === 'component') componentsUnder((rf.config as { components?: unknown })?.components, registry, new Set(), reachable)
        }
      }
      if (reachable.has(component)) {
        sites.push({ typeName: type.name, column: f.name, localized: (type as { localized?: boolean }).localized === true })
      }
    }
  }
  return sites
}

/**
 * Every rename declared across a registry, ONE PER DESTINATION FIELD so a chain
 * is a single operation carrying every source it might find.
 */
export function declaredRenames(registry: ComponentDef[]): ComponentRename[] {
  const out: ComponentRename[] = []
  for (const c of registry) {
    for (const f of (c.fields ?? []) as Array<{ name: string; previousName?: string[] }>) {
      const sources = (f.previousName ?? []).filter((p) => p && p !== f.name)
      if (sources.length > 0) out.push({ component: c.name, sources: [...new Set(sources)], to: f.name })
    }
  }
  return out
}

// ─── JSON path predicates ────────────────────────────────────────────────────

/** A JSON string literal's inner text, safe to paste into a path expression. */
const lit = (name: string) => JSON.stringify(name).slice(1, -1)

/** Exactly one of `sources` present, and the destination absent: the movable set. */
function movablePredicate(sources: string[], to: string): string {
  const one = sources.map((s) =>
    [`exists(@.${lit(s)})`, ...sources.filter((o) => o !== s).map((o) => `!exists(@.${lit(o)})`)].join(' && '),
  )
  return `(${one.map((p) => `(${p})`).join(' || ')}) && !exists(@.${lit(to)})`
}

/**
 * Two candidate values for one destination. Either a source sits beside the
 * destination, or two sources sit beside each other.
 */
function conflictPredicate(sources: string[], to: string): string {
  const anySource = sources.map((s) => `exists(@.${lit(s)})`).join(' || ')
  const pairs: string[] = []
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      pairs.push(`(exists(@.${lit(sources[i]!)}) && exists(@.${lit(sources[j]!)}))`)
    }
  }
  return [`((${anySource}) && exists(@.${lit(to)}))`, ...pairs].join(' || ')
}

/** No source left and the destination present: nothing to do. */
const migratedPredicate = (sources: string[], to: string) =>
  `${sources.map((s) => `!exists(@.${lit(s)})`).join(' && ')} && exists(@.${lit(to)})`

// ─── The read-only probe ─────────────────────────────────────────────────────

/** What one rename would do, per column, counted from the stored data. */
export interface RenameImpact {
  typeName: string
  column: string
  /** Rows holding at least one block with the old key and not the new one. */
  baseSource: number
  /** Rows holding at least one block with BOTH keys: two values, no winner. */
  baseConflict: number
  /** Rows holding blocks with only the new key: already migrated, nothing to do. */
  baseMigrated: number
  /** Locale overlay entries with the old key and not the new one, per locale. */
  localeSource: Record<string, number>
  /** Locale overlay entries holding both. */
  localeConflict: number
  /** True when a localized side table was found and counted. */
  sideTable?: boolean
  /** Set when a table or column is not there to count; the counts are then 0. */
  unavailable?: string
}

/** A block of `_type` = component, anywhere in the column, matching a key predicate. */
const blockPath = (component: string, pred: string) =>
  `strict $.** ? (@._type == "${component}" && ${pred})`

async function countRows(db: SqlReader, table: string, column: string, path: string): Promise<number> {
  const rows = await queryRows<{ n: number }>(db, sql.raw(
    `SELECT count(*)::int AS n FROM "${safeId(table)}" WHERE jsonb_path_exists("${safeId(column)}", '${path.replace(/'/g, "''")}')`,
  ))
  return rows[0]?.n ?? 0
}

/**
 * Count what `rename` would do at one site. Nothing is written, and a missing
 * table or column reports `unavailable` rather than throwing: a plan must never
 * fail because a preview could not be computed.
 */
export async function probeRename(
  db: SqlReader,
  rename: ComponentRename,
  site: ComponentSite,
): Promise<RenameImpact> {
  const base: RenameImpact = {
    typeName: site.typeName, column: site.column,
    baseSource: 0, baseConflict: 0, baseMigrated: 0, localeSource: {}, localeConflict: 0,
  }
  if (!isSafeIdent(site.typeName) || !isSafeIdent(site.column)) return { ...base, unavailable: 'unsafe identifier' }
  const { sources, to } = rename

  try {
    base.baseSource = await countRows(db, site.typeName, site.column, blockPath(rename.component, movablePredicate(sources, to)))
    base.baseConflict = await countRows(db, site.typeName, site.column, blockPath(rename.component, conflictPredicate(sources, to)))
    base.baseMigrated = await countRows(db, site.typeName, site.column, blockPath(rename.component, migratedPredicate(sources, to)))
  } catch (e) {
    return { ...base, unavailable: e instanceof Error ? e.message : String(e) }
  }

  if (!site.localized) return base
  // The overlay carries no `_type`, so an entry is attributed to this component
  // by joining back to the base array on `_key`.
  const side = `${site.typeName}_i18n`
  const join = (having: string) => `
    SELECT i.locale AS locale, count(*)::int AS n
    FROM "${safeId(side)}" i
    JOIN "${safeId(site.typeName)}" p ON p.id = i.object_id
    CROSS JOIN LATERAL jsonb_path_query(p."${safeId(site.column)}", 'strict $.** ? (@._type == "${rename.component}")') AS blk
    WHERE jsonb_typeof(i."${safeId(site.column)}") = 'object' AND ${having}
    GROUP BY i.locale`
  const entry = `i."${safeId(site.column)}" -> (blk->>'_key')`
  const has = (k: string) => `(${entry}) ? '${k.replace(/'/g, "''")}'`
  // The same three questions as the base, in the overlay's own shape: an object
  // keyed by block `_key` whose values are keyed by sub-field name.
  const movable = `(${sources.map((sv) => [has(sv), ...sources.filter((o) => o !== sv).map((o) => `NOT ${has(o)}`)].join(' AND ')).map((p) => `(${p})`).join(' OR ')}) AND NOT ${has(to)}`
  const conflicting = [
    `((${sources.map(has).join(' OR ')}) AND ${has(to)})`,
    ...sources.flatMap((a, i) => sources.slice(i + 1).map((b) => `(${has(a)} AND ${has(b)})`)),
  ].join(' OR ')
  try {
    for (const r of await queryRows<{ locale: string; n: number }>(db, sql.raw(join(movable)))) {
      base.localeSource[r.locale] = r.n
    }
    for (const r of await queryRows<{ locale: string; n: number }>(db, sql.raw(join(conflicting)))) {
      base.localeConflict += r.n
    }
    base.sideTable = true
  } catch {
    // No side table yet: the type is localized in code but never pushed.
  }
  return base
}

/** The totals across every site, which is what an operation carries. */
export function totalImpact(impacts: RenameImpact[]) {
  const localeSource: Record<string, number> = {}
  let baseSource = 0, baseConflict = 0, baseMigrated = 0, localeConflict = 0
  for (const i of impacts) {
    baseSource += i.baseSource; baseConflict += i.baseConflict; baseMigrated += i.baseMigrated
    localeConflict += i.localeConflict
    for (const [loc, n] of Object.entries(i.localeSource)) localeSource[loc] = (localeSource[loc] ?? 0) + n
  }
  return { baseSource, baseConflict, baseMigrated, localeSource, localeConflict }
}

// ─── The writer ──────────────────────────────────────────────────────────────

/**
 * The recursive walker the rename runs through. One function handles every
 * depth, so the statement does not have to know the path: a block is found by
 * its `_type` wherever it sits, including inside a repeater row, inside another
 * component, at any nesting.
 *
 * It rebuilds arrays element by element, so ORDER is preserved, and it moves a
 * key only when exactly the safe condition holds, so running it twice is a
 * no-op. Everything it does not recognise it returns untouched: other block
 * types, `_studio`, `_key`, `_type`, relations, unrelated historical keys,
 * nulls and empty arrays.
 */
export const RENAME_FN = 'tangen_rename_block_key'

export const renameFunctionSql = `
CREATE OR REPLACE FUNCTION ${RENAME_FN}(data jsonb, comp text, src text, dst text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE out jsonb; elem jsonb; k text; v jsonb;
BEGIN
  IF data IS NULL THEN RETURN data; END IF;
  IF jsonb_typeof(data) = 'array' THEN
    out := '[]'::jsonb;
    FOR elem IN SELECT * FROM jsonb_array_elements(data) LOOP
      out := out || jsonb_build_array(${RENAME_FN}(elem, comp, src, dst));
    END LOOP;
    RETURN out;
  ELSIF jsonb_typeof(data) = 'object' THEN
    out := data;
    FOR k, v IN SELECT * FROM jsonb_each(data) LOOP
      IF jsonb_typeof(v) IN ('array','object') THEN
        out := jsonb_set(out, ARRAY[k], ${RENAME_FN}(v, comp, src, dst));
      END IF;
    END LOOP;
    IF out->>'_type' = comp AND out ? src AND NOT (out ? dst) THEN
      out := (out - src) || jsonb_build_object(dst, out->src);
    END IF;
    RETURN out;
  END IF;
  RETURN data;
END $fn$;`

const sqlLit = (v: string) => `'${v.replace(/'/g, "''")}'`

/**
 * The statements one rename runs, in order. The first is not an optimisation:
 * it is the reason a stale plan cannot do damage.
 *
 * `--plan` reports what the database looked like when it was asked. Content can
 * legitimately change before the push runs, and more rows becoming movable is
 * fine - they are movable under the same declared intent. What is not fine is
 * SAFETY changing, so the guard re-asks the conflict question inside the push
 * transaction and raises if the answer has changed. Raising rolls the whole
 * transaction back, so nothing is half migrated: not the base, not the
 * translations, and not the schema changes that were travelling with them.
 *
 * Skipping the newly conflicting blocks and migrating the rest is deliberately
 * NOT what happens. A rename is one logical operation; leaving some blocks on
 * the old key and some on the new is the state this whole programme exists to
 * prevent.
 */
export function renameStatements(
  rename: ComponentRename,
  sites: Array<ComponentSite & { sideTable?: boolean }>,
): Array<{ label: string; sql: string }> {
  const out: Array<{ label: string; sql: string }> = []
  const { component, sources, to } = rename
  const what = `component ${component}: ${sources.join('/')} → ${to}`
  if (sites.length === 0) return out

  // ── 1. Revalidate, inside the transaction ──────────────────────────────────
  const checks: string[] = []
  for (const site of sites) {
    const t = safeId(site.typeName), col = safeId(site.column)
    checks.push(`SELECT 1 FROM "${t}" WHERE jsonb_path_exists("${col}", ${sqlLit(blockPath(component, conflictPredicate(sources, to)))})`)
    if (site.sideTable) {
      const has = (k: string) => `(i."${col}" -> (blk->>'_key')) ? ${sqlLit(k)}`
      const conflicting = [
        `((${sources.map(has).join(' OR ')}) AND ${has(to)})`,
        ...sources.flatMap((a, i) => sources.slice(i + 1).map((b) => `(${has(a)} AND ${has(b)})`)),
      ].join(' OR ')
      checks.push(`
      SELECT 1 FROM "${t}_i18n" i
      JOIN "${t}" p ON p.id = i.object_id
      CROSS JOIN LATERAL jsonb_path_query(p."${col}", ${sqlLit(`strict $.** ? (@._type == "${component}")`)}) AS blk
      WHERE jsonb_typeof(i."${col}") = 'object' AND (${conflicting})`)
    }
  }
  out.push({
    label: `${what}: revalidate before migrating`,
    sql: `DO $guard$ BEGIN
  IF EXISTS (${checks.join('\n    UNION ALL\n    ')}) THEN
    RAISE EXCEPTION 'component "%": renaming "%" to "%" is no longer safe - a stored block now holds more than one candidate value. Nothing was migrated; re-run tangen push --plan to see the current state.', ${sqlLit(component)}, ${sqlLit(sources.join('/'))}, ${sqlLit(to)};
  END IF;
END $guard$;`,
  })

  // ── 2. Move the values ─────────────────────────────────────────────────────
  for (const site of sites) {
    const t = safeId(site.typeName), col = safeId(site.column)
    for (const from of sources) {
      out.push({
        label: `${t}.${col}: move ${component}.${from} to ${to}`,
        sql: `UPDATE "${t}" SET "${col}" = ${RENAME_FN}("${col}", ${sqlLit(component)}, ${sqlLit(from)}, ${sqlLit(to)})
WHERE jsonb_path_exists("${col}", ${sqlLit(blockPath(component, `exists(@.${lit(from)}) && !exists(@.${lit(to)})`))})`,
      })
    }
    if (!site.sideTable) continue
    // The overlay carries no `_type`, so ownership comes from the base block's
    // `_key`. A translation whose base value has already moved still migrates:
    // the key set is chosen by block type, not by which keys the block holds.
    for (const from of sources) {
      out.push({
        label: `${t}_i18n.${col}: move ${component}.${from} translations to ${to}`,
        sql: `UPDATE "${t}_i18n" i
SET "${col}" = COALESCE((
  SELECT jsonb_object_agg(e.k, CASE
    WHEN (e.v ? ${sqlLit(from)}) AND NOT (e.v ? ${sqlLit(to)}) AND e.k IN (
      SELECT blk->>'_key' FROM jsonb_path_query(p."${col}", ${sqlLit(`strict $.** ? (@._type == "${component}")`)}) AS blk)
    THEN (e.v - ${sqlLit(from)}) || jsonb_build_object(${sqlLit(to)}, e.v->${sqlLit(from)})
    ELSE e.v END)
  FROM jsonb_each(i."${col}") AS e(k, v)), '{}'::jsonb)
FROM "${t}" p
WHERE p.id = i.object_id AND jsonb_typeof(i."${col}") = 'object'`,
      })
    }
  }
  return out
}

// ─── Plan assembly ───────────────────────────────────────────────────────────

/**
 * Turn every declared rename into an operation carrying the facts a
 * classification needs. Read-only: this is still the probe, and it emits
 * nothing at all for a rename with no stored values left to move, which is how
 * an applied migration retires itself without a ledger.
 */
export async function planComponentRenames(
  db: SqlReader,
  schema: SchemaDefinition,
  registry: ComponentDef[],
): Promise<Array<Extract<import('./types').ChangeOperation, { op: 'COMPONENT_FIELD_RENAME' }>>> {
  const out: Array<Extract<import('./types').ChangeOperation, { op: 'COMPONENT_FIELD_RENAME' }>> = []
  for (const rename of declaredRenames(registry)) {
    const sites = componentSites(schema, registry, rename.component)
    if (sites.length === 0) continue
    const impacts = await Promise.all(sites.map((s) => probeRename(db, rename, s)))
    const impact = totalImpact(impacts)
    const locales = Object.values(impact.localeSource).reduce((a, b) => a + b, 0)
    const conflict = impact.baseConflict > 0 || impact.localeConflict > 0
    // Nothing to move and nothing wrong: the rename has already run, or never
    // had anything to do. Emitting an operation here would make every push
    // after the first report work it was not going to do.
    if (!conflict && impact.baseSource === 0 && locales === 0) continue
    out.push({
      op: 'COMPONENT_FIELD_RENAME',
      component: rename.component, sources: rename.sources, to: rename.to,
      conflict, impact,
      sites: sites.map((s, i) => ({ typeName: s.typeName, column: s.column, sideTable: impacts[i]!.sideTable })),
    })
  }
  return out
}

// ─── Purge: the explicit destruction of historical values ────────────────────

/** What a purge targets, precisely: one key, in one component, and nothing else. */
export interface PurgeTarget {
  component: string
  /** The historical key to delete. Must NOT be a current field of the component. */
  key: string
}

/** What a purge would delete, counted. */
export interface PurgeImpact {
  typeName: string
  column: string
  /** Content rows holding at least one matching block with the key. */
  baseRows: number
  /** Overlay entries with the key, owned by a block of this component, per locale. */
  localeEntries: Record<string, number>
  /**
   * Overlay entries with the key whose `_key` matches NO block in the base row.
   * Ownership cannot be established, so they are counted and reported, and
   * deliberately NOT deleted: guessing is how a translation of something else
   * disappears.
   */
  localeOrphans: number
  sideTable?: boolean
  unavailable?: string
}

/**
 * True when `key` is still a declared field of the component. Purge is for
 * historical data; deleting every value of a live field is a different
 * operation with different semantics, and it is not this one.
 */
export function isCurrentField(registry: ComponentDef[], target: PurgeTarget): boolean {
  const def = registry.find((c) => c.name === target.component)
  return (def?.fields ?? []).some((f) => (f as { name: string }).name === target.key)
}

/** Read-only. Nothing here deletes; it counts what a purge would. */
export async function probePurge(db: SqlReader, target: PurgeTarget, site: ComponentSite): Promise<PurgeImpact> {
  const out: PurgeImpact = { typeName: site.typeName, column: site.column, baseRows: 0, localeEntries: {}, localeOrphans: 0 }
  if (!isSafeIdent(site.typeName) || !isSafeIdent(site.column)) return { ...out, unavailable: 'unsafe identifier' }
  try {
    out.baseRows = await countRows(db, site.typeName, site.column, blockPath(target.component, `exists(@.${lit(target.key)})`))
  } catch (e) {
    return { ...out, unavailable: e instanceof Error ? e.message : String(e) }
  }
  if (!site.localized) return out

  const t = safeId(site.typeName), col = safeId(site.column)
  const k = sqlLit(target.key)
  const owned = `
    SELECT i.locale AS locale, count(*)::int AS n
    FROM "${t}_i18n" i
    JOIN "${t}" p ON p.id = i.object_id
    CROSS JOIN LATERAL jsonb_each(i."${col}") AS e(k, v)
    WHERE jsonb_typeof(i."${col}") = 'object' AND (e.v ? ${k}) AND e.k IN (
      SELECT blk->>'_key' FROM jsonb_path_query(p."${col}", ${sqlLit(`strict $.** ? (@._type == "${target.component}")`)}) AS blk)
    GROUP BY i.locale`
  const orphaned = `
    SELECT count(*)::int AS n
    FROM "${t}_i18n" i
    JOIN "${t}" p ON p.id = i.object_id
    CROSS JOIN LATERAL jsonb_each(i."${col}") AS e(k, v)
    WHERE jsonb_typeof(i."${col}") = 'object' AND (e.v ? ${k}) AND e.k NOT IN (
      SELECT blk->>'_key' FROM jsonb_path_query(p."${col}", 'strict $.** ? (exists(@._key))') AS blk)`
  try {
    for (const r of await queryRows<{ locale: string; n: number }>(db, sql.raw(owned))) out.localeEntries[r.locale] = r.n
    out.localeOrphans = (await queryRows<{ n: number }>(db, sql.raw(orphaned)))[0]?.n ?? 0
    out.sideTable = true
  } catch {
    // No side table: the type is localized in code but was never pushed.
  }
  return out
}

export const PURGE_FN = 'tangen_purge_block_key'

/** The same recursive shape as the rename walker, deleting instead of moving. */
export const purgeFunctionSql = `
CREATE OR REPLACE FUNCTION ${PURGE_FN}(data jsonb, comp text, k text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE out jsonb; elem jsonb; kk text; v jsonb;
BEGIN
  IF data IS NULL THEN RETURN data; END IF;
  IF jsonb_typeof(data) = 'array' THEN
    out := '[]'::jsonb;
    FOR elem IN SELECT * FROM jsonb_array_elements(data) LOOP
      out := out || jsonb_build_array(${PURGE_FN}(elem, comp, k));
    END LOOP;
    RETURN out;
  ELSIF jsonb_typeof(data) = 'object' THEN
    out := data;
    FOR kk, v IN SELECT * FROM jsonb_each(data) LOOP
      IF jsonb_typeof(v) IN ('array','object') THEN
        out := jsonb_set(out, ARRAY[kk], ${PURGE_FN}(v, comp, k));
      END IF;
    END LOOP;
    IF out->>'_type' = comp AND out ? k THEN
      out := out - k;
    END IF;
    RETURN out;
  END IF;
  RETURN data;
END $fn$;`

/**
 * The statements a purge runs. There is no ambiguity to revalidate: a purge has
 * exactly one outcome and the developer authorised it by name. What execution
 * still has to be sure of is that the TARGET has not changed meaning, and that
 * check is not SQL: a component definition lives in code, so the command
 * re-reads it and refuses if the key has become a current field again.
 *
 * A rising count between plan and apply is not a reason to stop. "Purge every
 * historical hero.title" is the same instruction whether there are 20 of them
 * or 21.
 */
export function purgeStatements(
  target: PurgeTarget,
  sites: Array<ComponentSite & { sideTable?: boolean }>,
): Array<{ label: string; sql: string }> {
  const out: Array<{ label: string; sql: string }> = []
  const k = sqlLit(target.key)
  const comp = sqlLit(target.component)
  for (const site of sites) {
    const t = safeId(site.typeName), col = safeId(site.column)
    out.push({
      label: `${t}.${col}: purge ${target.component}.${target.key}`,
      sql: `UPDATE "${t}" SET "${col}" = ${PURGE_FN}("${col}", ${comp}, ${k})
WHERE jsonb_path_exists("${col}", ${sqlLit(blockPath(target.component, `exists(@.${lit(target.key)})`))})`,
    })
    if (!site.sideTable) continue
    // Only entries whose `_key` names a block of this component. An entry that
    // matches no block at all is left alone and reported: it may be the
    // translation of something else entirely.
    out.push({
      label: `${t}_i18n.${col}: purge ${target.component}.${target.key} translations`,
      sql: `UPDATE "${t}_i18n" i
SET "${col}" = COALESCE((
  SELECT jsonb_object_agg(e.k, CASE
    WHEN (e.v ? ${k}) AND e.k IN (
      SELECT blk->>'_key' FROM jsonb_path_query(p."${col}", ${sqlLit(`strict $.** ? (@._type == "${target.component}")`)}) AS blk)
    THEN e.v - ${k}
    ELSE e.v END)
  FROM jsonb_each(i."${col}") AS e(k, v)), '{}'::jsonb)
FROM "${t}" p
WHERE p.id = i.object_id AND jsonb_typeof(i."${col}") = 'object'`,
    })
  }
  return out
}

/** Read-only: the operation a purge command would run, with its impact. */
export async function planComponentPurge(
  db: SqlReader,
  schema: SchemaDefinition,
  registry: ComponentDef[],
  target: PurgeTarget,
): Promise<{ op: Extract<import('./types').ChangeOperation, { op: 'COMPONENT_FIELD_PURGE' }> | null; impacts: PurgeImpact[] }> {
  const sites = componentSites(schema, registry, target.component)
  if (sites.length === 0) return { op: null, impacts: [] }
  const impacts = await Promise.all(sites.map((s) => probePurge(db, target, s)))
  const baseRows = impacts.reduce((a, i) => a + i.baseRows, 0)
  const localeEntries: Record<string, number> = {}
  let localeOrphans = 0
  for (const i of impacts) {
    localeOrphans += i.localeOrphans
    for (const [loc, n] of Object.entries(i.localeEntries)) localeEntries[loc] = (localeEntries[loc] ?? 0) + n
  }
  return {
    op: {
      op: 'COMPONENT_FIELD_PURGE',
      component: target.component, key: target.key,
      impact: { baseRows, localeEntries, localeOrphans },
      sites: sites.map((s, i) => ({ typeName: s.typeName, column: s.column, sideTable: impacts[i]!.sideTable })),
    },
    impacts,
  }
}

/** The statements a purge operation runs, function install and drop included. */
export function purgePlan(op: Extract<import('./types').ChangeOperation, { op: 'COMPONENT_FIELD_PURGE' }>) {
  const work = purgeStatements(
    { component: op.component, key: op.key },
    (op.sites ?? []).map((s) => ({ typeName: s.typeName, column: s.column, localized: !!s.sideTable, sideTable: s.sideTable })),
  )
  if (work.length === 0) return []
  return [
    { group: 'component-data' as const, label: 'install the component key walker', sql: purgeFunctionSql },
    ...work.map((w) => ({ group: 'component-data' as const, ...w })),
    { group: 'component-data' as const, label: 'drop the component key walker', sql: `DROP FUNCTION IF EXISTS ${PURGE_FN}(jsonb, text, text)` },
  ]
}
