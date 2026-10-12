/**
 * File Name: scoped-apply.ts
 * Purpose: Pure helpers for `tangen push --type <name>` — a SCOPED schema apply that
 *   applies ONLY one content type's DB ops (plus any OUT-OF-SYNC types it depends on via
 *   relations), instead of the whole-codebase reconcile. Keeps a teammate's WIP schema
 *   (pulled from git) out of your DB.
 *
 * The two hard parts, both solved here as pure functions (unit-tested, no DB/fs):
 *   1. The scoped SET — target type + transitive out-of-sync relation deps (so a brand-new
 *      dependency type comes along; an in-sync one is left alone).
 *   2. The ARTIFACT — a SchemaDefinition matching the DB AFTER the scoped apply (runtime
 *      types as-is, scoped types overlaid with their local shape), so the regenerated
 *      Drizzle `content-tables.ts` never drifts from the DB.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: relation columns are plain TEXT (no DB foreign keys), so applyPlan
 *   is order-independent and filtering operations by owning type is DB-safe.
 */
import type { SchemaDefinition, ObjectTypeDefinition, FieldDefinition, AdminConfig } from '@tangen/types'
import type { RuntimeSchema, RuntimeObjectType, ChangePlan, ChangeOperation } from './types'
import { opTypeName } from './print-plan'
import { planFlags } from './plan-ops'

/** Owning content-type name(s) for an op. `opTypeName` covers all variants except
 *  RENAME_TYPE, which owns BOTH its old and new name. */
export function opTypeNames(op: ChangeOperation): string[] {
  if (op.op === 'RENAME_TYPE') return [op.from, op.to]
  const n = opTypeName(op)
  return n ? [n] : []
}

/** Every content type touched by the plan — i.e. the types that are OUT OF SYNC with the DB. */
export function affectedTypeNames(plan: ChangePlan): Set<string> {
  const s = new Set<string>()
  for (const op of plan.operations) for (const n of opTypeNames(op)) s.add(n)
  return s
}

/** The content types a type depends on: relation `targetType` + polymorphic object `include`. */
export function relationTargets(type: ObjectTypeDefinition): string[] {
  const out: string[] = []
  for (const f of type.fields ?? []) {
    const cfg = f.config as { targetType?: unknown; include?: unknown } | undefined
    if (f.fieldType === 'relation' && typeof cfg?.targetType === 'string') out.push(cfg.targetType)
    if (f.fieldType === 'object' && Array.isArray(cfg?.include)) {
      for (const inc of cfg.include as unknown[]) if (typeof inc === 'string') out.push(inc)
    }
  }
  return out
}

/**
 * The scoped set for `push --type <seeds>`: the seed type(s) plus the transitive closure of
 * relation-target types that are ALSO out of sync (present in `affected`). An in-sync
 * dependency is skipped — its table already exists, so nothing is needed. `extras` is the
 * out-of-sync dependencies pulled in (what the GUI warns about).
 *
 * `seeds` is usually one type (a create/update). A DELETE seeds with the dropped type AND
 * the types that referenced it (their relation columns drop in the same apply), so the whole
 * detach lands together.
 */
export function computeScopedTypes(
  seeds: string[],
  local: SchemaDefinition,
  affected: Set<string>,
): { scoped: Set<string>; extras: string[] } {
  const seedSet = new Set(seeds)
  const byName = new Map(local.types.map((t) => [t.name, t]))
  const scoped = new Set<string>(seeds)
  const queue = [...seeds]
  while (queue.length) {
    const t = byName.get(queue.shift()!)
    if (!t) continue
    for (const dep of relationTargets(t)) {
      if (!scoped.has(dep) && affected.has(dep)) { scoped.add(dep); queue.push(dep) }
    }
  }
  const extras = [...scoped].filter((n) => !seedSet.has(n))
  return { scoped, extras }
}

/** Narrow a plan to operations owned by a scoped type (order preserved). */
export function filterPlanToTypes(plan: ChangePlan, scoped: Set<string>): ChangePlan {
  const operations = plan.operations.filter((op) => opTypeNames(op).some((n) => scoped.has(n)))
  // The same flags diff() computes - a scoped plan means the same thing as a full one.
  // Orphans follow the scope too: a --type push should not report a type it was
  // told not to look at.
  return { operations, ...planFlags(operations), orphans: (plan.orphans ?? []).filter((o) => scoped.has(o.type)) }
}

/** RuntimeObjectType (DB rows) → ObjectTypeDefinition (the SchemaDefinition shape). */
export function runtimeTypeToDefinition(rt: RuntimeObjectType): ObjectTypeDefinition {
  return {
    id: rt.id,
    name: rt.name,
    label: rt.label,
    ...(rt.plural ? { plural: rt.plural } : {}),
    singleton: rt.singleton,
    ...(rt.disabled ? { disabled: true } : {}),
    ...(rt.localized ? { localized: true } : {}),
    previousName: rt.previousNames,
    admin: rt.adminConfig as AdminConfig,
    fields: rt.fields.map((f): FieldDefinition => ({
      name: f.name,
      label: f.label,
      fieldType: f.fieldType as FieldDefinition['fieldType'],
      config: f.config as FieldDefinition['config'],
      previousName: f.previousNames,
      required: f.required,
      ...(f.disabled ? { disabled: true } : {}),
    })),
  }
}

/**
 * The SchemaDefinition that matches the DB AFTER a scoped apply of `scoped`: every runtime
 * type kept as-is, but each scoped type replaced by its LOCAL shape (or dropped when it's
 * gone from local code). Feed this to the content-tables generator so the Drizzle schema
 * reflects the DB — NOT the full local code (which may hold other types' WIP).
 */
export function overlaySchema(runtime: RuntimeSchema, local: SchemaDefinition, scoped: Set<string>): SchemaDefinition {
  const localByName = new Map(local.types.map((t) => [t.name, t]))
  const types: ObjectTypeDefinition[] = []
  const seen = new Set<string>()
  for (const rt of runtime.types) {
    seen.add(rt.name)
    if (scoped.has(rt.name)) {
      const localType = localByName.get(rt.name)
      if (localType) types.push(localType)          // updated shape
      // else: dropped from local code → omit it (a scoped delete)
    } else {
      types.push(runtimeTypeToDefinition(rt))        // untouched - keep its runtime shape
    }
  }
  // Scoped types that are brand-new (in local code, not yet in the DB).
  for (const name of scoped) {
    if (!seen.has(name)) { const lt = localByName.get(name); if (lt) types.push(lt) }
  }
  // Local types this environment does not have at all, out of scope. They
  // are NOT applied, but the artifact built from this schema (the generated
  // content-tables module) is one file per project serving every environment
  // the process runs: a scoped push to a sparse environment used to drop the
  // tables the richer environment still needs, and the dev API lost its
  // `test`, `showcase` and `coupon` tables until the next push restored them.
  for (const lt of local.types) {
    if (!seen.has(lt.name) && !scoped.has(lt.name)) { types.push(lt); seen.add(lt.name) }
  }
  return { types }
}

/** Local types filtered to the scoped set (for validation + i18n reconcile scoping). */
export function scopedLocalSchema(local: SchemaDefinition, scoped: Set<string>): SchemaDefinition {
  return { types: local.types.filter((t) => scoped.has(t.name)) }
}
