/**
 * File Name: schema-diff.ts
 * Purpose: Field-level schema comparison between two environments - the
 *   truth behind "schemas are in sync" for Settings -> Sync, preflight and
 *   migrate. Replaces the old guards that compared type NAMES (server) and
 *   field COUNTS (client), both of which waved a renamed field straight
 *   through (sync overhaul defect 5).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The contract per type is the set of ENABLED fields'
 *   (name, fieldType, required, config) plus the type-level localized flag.
 *   Disabled types/fields are invisible to every runtime surface, so they
 *   are invisible here too. Two sync notions fall out of one diff:
 *   - sourceInSyncWithTarget: every SOURCE type matches its target twin -
 *     the directional gate migration needs (extra target types are harmless).
 *   - inSync: strict equality both ways - what the Sync page reports.
 */
import { eq, and } from 'drizzle-orm'
import { objectTypes, fields } from '@tangen/db'

export interface FieldFingerprint {
  name: string
  fieldType: string
  required: boolean
  config: Record<string, unknown>
}

export interface TypeSchema {
  name: string
  localized: boolean
  fields: FieldFingerprint[]
}

export interface SchemaDiffEntry {
  typeName: string
  status: 'in_sync' | 'missing_in_target' | 'missing_in_source' | 'mismatched'
  /** Human-readable field-level reasons, present when status is 'mismatched'. */
  mismatches?: string[]
}

export interface SchemaDiff {
  /** Strict: both envs define identical type sets with identical fields. */
  inSync: boolean
  /** Directional: every source type exists in target with identical fields. */
  sourceInSyncWithTarget: boolean
  entries: SchemaDiffEntry[]
}

/** Deep key-order-insensitive canonical form for config comparison. */
function canonical(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>).sort()
        .map((k) => [k, sortDeep((value as Record<string, unknown>)[k])]),
    )
  }
  return value
}

function diffType(src: TypeSchema, tgt: TypeSchema): string[] {
  const reasons: string[] = []
  if (src.localized !== tgt.localized) {
    reasons.push(`localized flag differs (source ${src.localized}, target ${tgt.localized})`)
  }
  const tgtByName = new Map(tgt.fields.map((f) => [f.name, f]))
  const srcNames = new Set(src.fields.map((f) => f.name))
  for (const f of src.fields) {
    const other = tgtByName.get(f.name)
    if (!other) { reasons.push(`field "${f.name}" missing in target`); continue }
    if (f.fieldType !== other.fieldType) {
      reasons.push(`field "${f.name}" fieldType differs (${f.fieldType} vs ${other.fieldType})`)
    } else if (f.required !== other.required) {
      reasons.push(`field "${f.name}" required differs`)
    } else if (canonical(f.config) !== canonical(other.config)) {
      reasons.push(`field "${f.name}" config differs`)
    }
  }
  for (const f of tgt.fields) {
    if (!srcNames.has(f.name)) reasons.push(`field "${f.name}" missing in source`)
  }
  return reasons
}

export function computeSchemaDiff(source: TypeSchema[], target: TypeSchema[]): SchemaDiff {
  const tgtByName = new Map(target.map((t) => [t.name, t]))
  const srcNames = new Set(source.map((t) => t.name))
  const entries: SchemaDiffEntry[] = []

  for (const src of source) {
    const tgt = tgtByName.get(src.name)
    if (!tgt) { entries.push({ typeName: src.name, status: 'missing_in_target' }); continue }
    const mismatches = diffType(src, tgt)
    entries.push(mismatches.length === 0
      ? { typeName: src.name, status: 'in_sync' }
      : { typeName: src.name, status: 'mismatched', mismatches })
  }
  for (const tgt of target) {
    if (!srcNames.has(tgt.name)) entries.push({ typeName: tgt.name, status: 'missing_in_source' })
  }

  const sourceInSyncWithTarget = entries.every(
    (e) => e.status === 'in_sync' || e.status === 'missing_in_source',
  )
  const inSync = entries.every((e) => e.status === 'in_sync')
  return { inSync, sourceInSyncWithTarget, entries }
}

/** Loads the enabled types (with their enabled fields) of one environment. */
export async function loadTypeSchemas(db: any): Promise<TypeSchema[]> {
  const typeRows = await db
    .select({ id: objectTypes.id, name: objectTypes.name, localized: objectTypes.localized })
    .from(objectTypes)
    .where(and(eq(objectTypes.disabled, false))) as
    { id: string; name: string; localized: boolean }[]

  const out: TypeSchema[] = []
  for (const type of typeRows) {
    const fieldRows = await db
      .select({ name: fields.name, fieldType: fields.fieldType, required: fields.required, config: fields.config })
      .from(fields)
      .where(and(eq(fields.typeId, type.id), eq(fields.disabled, false))) as
      { name: string; fieldType: string; required: boolean; config: Record<string, unknown> }[]
    out.push({
      name: type.name,
      localized: type.localized === true,
      fields: fieldRows.map((f) => ({
        name: f.name,
        fieldType: f.fieldType,
        required: f.required === true,
        config: (f.config ?? {}) as Record<string, unknown>,
      })),
    })
  }
  return out
}


// ── Scoping the gate to what a migration touches ────────────────────────────

type FieldLike = { name?: unknown; fieldType?: unknown; config?: Record<string, unknown> }
type TypeLike = { name: string; fields?: FieldLike[] }

/**
 * The types a migration of `typeName` depends on: the type itself and every
 * type its relation fields target, found at any depth (groups, repeaters,
 * inline components). Those are the rows the relation remapper has to find on
 * the other side; nothing else on the workspace matters to this run.
 *
 * Found by hand: posts could not move from development to staging because
 * an unrelated type (a showcase, a coupon) did not exist in staging yet. A
 * workspace-wide "everything must match" gate turns one half-deployed type
 * into a freeze of every migration.
 */
export function requiredTypesFor(typeName: string, types: readonly TypeLike[]): string[] {
  const out = new Set<string>([typeName])
  const walk = (fields: FieldLike[] | undefined) => {
    for (const f of fields ?? []) {
      const cfg = (f.config ?? {}) as Record<string, unknown>
      if (f.fieldType === 'relation' && typeof cfg.targetType === 'string') out.add(cfg.targetType)
      if (f.fieldType === 'group') walk(cfg.groupFields as FieldLike[] | undefined)
      if (f.fieldType === 'repeater') walk(cfg.fields as FieldLike[] | undefined)
      if (f.fieldType === 'component') {
        for (const ref of (Array.isArray(cfg.components) ? cfg.components : []) as Array<string | { fields?: FieldLike[] }>) {
          if (typeof ref === 'object' && ref) walk(ref.fields)
        }
      }
    }
  }
  walk(types.find((t) => t.name === typeName)?.fields)
  return [...out]
}

/**
 * The schema gate a migration actually needs: every REQUIRED type exists in
 * the target with identical fields. Returns the offending entries, so the
 * caller can say which types to push rather than "the schema".
 */
export function scopedSchemaGate(diff: SchemaDiff, required: readonly string[]): { ok: boolean; entries: SchemaDiffEntry[] } {
  const wanted = new Set(required)
  const entries = diff.entries.filter((e) => wanted.has(e.typeName) && e.status !== 'in_sync' && e.status !== 'missing_in_source')
  return { ok: entries.length === 0, entries }
}

