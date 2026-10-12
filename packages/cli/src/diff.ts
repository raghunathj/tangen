/**
 * File Name: diff.ts
 * Purpose: Computes a ChangePlan by comparing a local SchemaDefinition against the live RuntimeSchema,
 * detecting type/field additions, renames, deletions, config changes, and index mutations.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A field type change is classified by the COLUMN KINDS of
 * the two types (column-types.ts fieldTypeToSql, the one mapping): the same
 * kind is a registry change (tier 1), a kind Postgres converts in place is a
 * cast (tier 2, classified per cast), anything else is blocked (tier 3).
 * previousName arrays are used to detect renames rather than drop+add pairs;
 * a drop+add pair of the same type is reported as a rename hint.
 */
import { relationSubfieldsIn } from '@tangen/schema'
import type { SchemaDefinition, ComponentDef } from '@tangen/types'
import type { RuntimeSchema, ChangePlan, ChangeOperation } from './types'
import { planFlags } from './plan-ops'
import { fieldTypeToSql, classifyColumnChange, fieldIsIndexable } from './column-types'

/**
 * Canonical JSON: object keys sorted recursively and `undefined`/null-ish
 * omitted, so two configs with the same content but different key order (code
 * literal vs DB-round-tripped) compare equal — no phantom "config updated" on
 * every push.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v === undefined) continue
      out[key] = canonical(v)
    }
    return out
  }
  return value
}

/** Order-insensitive deep equality for stored config/admin blobs. */
function configEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a ?? {})) === JSON.stringify(canonical(b ?? {}))
}

/**
 * A DROP_FIELD + ADD_FIELD pair on one type with the same field type is most
 * likely a rename without `previousName` - applied as-is it drops the data.
 * One hint per pair, in plan order; [] when nothing looks like a rename.
 */
type DropField = Extract<ChangeOperation, { op: 'DROP_FIELD' }>
type AddField = Extract<ChangeOperation, { op: 'ADD_FIELD' }>

/** Each DROP_FIELD paired with the first unclaimed ADD_FIELD of the same type on the same object type. */
function renamePairs(operations: ChangeOperation[]): Array<{ drop: DropField; add: AddField }> {
  const pairs: Array<{ drop: DropField; add: AddField }> = []
  const adds = operations.filter((o): o is AddField => o.op === 'ADD_FIELD')
  const used = new Set<AddField>()
  for (const drop of operations) {
    if (drop.op !== 'DROP_FIELD' || fieldTypeToSql(drop.fieldType) === null) continue
    const add = adds.find((a) => !used.has(a) && a.typeId === drop.typeId && a.field.fieldType === drop.fieldType)
    if (!add) continue
    used.add(add)
    pairs.push({ drop, add })
  }
  return pairs
}

export function renameHints(operations: ChangeOperation[]): string[] {
  return renamePairs(operations).map(({ drop, add }) =>
    `${drop.typeName}: "${drop.name}" is dropped and "${add.field.name}" is added with the same type (${drop.fieldType}) - this looks like a rename; add previousName: ['${drop.name}'] to "${add.field.name}" to keep the data`)
}

/** The approval token that names a dropped field: `drop-field:<type>.<field>`. */
export function dropFieldToken(drop: DropField): string {
  return `drop-field:${drop.typeName ? `${drop.typeName}.` : ''}${drop.name}`
}

/**
 * The drop-and-add pairs still unresolved: a drop the developer approved BY
 * NAME (`--approve drop-field:<type>.<field>`) is a delete they decided on,
 * not a rename they forgot, so its pair is no longer ambiguous (2026-09-13).
 * The drop is guarded either way: the column is kept aside as
 * `_dropped__<field>__<id>` and declaring the field again recovers it.
 */
function unapprovedRenamePairs(operations: ChangeOperation[], approvals: string[]): Array<{ drop: DropField; add: AddField }> {
  return renamePairs(operations).filter(({ drop }) => !approvals.includes(dropFieldToken(drop)))
}

export function ambiguousFieldRenames(operations: ChangeOperation[], approvals: string[] = []): string[] {
  const unresolved = new Set(unapprovedRenamePairs(operations, approvals).map(({ drop }) => drop))
  return renameHints(operations.filter((o) => o.op !== 'DROP_FIELD' || unresolved.has(o)))
}

/** The exact command that resolves every unapproved pair as a delete; null when none is left. */
export function renameGuardCommand(operations: ChangeOperation[], approvals: string[] = []): string | null {
  const tokens = unapprovedRenamePairs(operations, approvals).map(({ drop }) => dropFieldToken(drop))
  if (tokens.length === 0) return null
  return `tangen push ${[...approvals, ...tokens].map((t) => `--approve ${t}`).join(' ')}`
}

/**
 * Identity, and why it is not the name (freeze review C3).
 *
 * A schema differ that matches by name cannot tell a rename from a delete plus
 * a create, and gets it wrong in the direction that destroys data. Both sides
 * already carry stable ids: the registry always does, and a type authored or
 * round-tripped by the Schema Builder or `tangen pull` does too
 * (`ObjectTypeDefinition.id`). Where both have one, it is the answer and the
 * name is just a label that may change.
 *
 * The fallback is deliberate, not a shortcut. `ObjectTypeDefinition.id` is
 * optional and is documented as "absent when defined locally in TS files": a
 * hand-written schema genuinely has no id, and 7 of the 10 types in this
 * repository's own demo app are that shape. For those, name plus
 * `previousName` remains the only signal available.
 *
 * What must never happen is silently matching ACROSS different ids. Two
 * objects with different stable ids are different objects however similar
 * their names, and treating them as one would rename the wrong table.
 */
export type IdentityBasis = 'id' | 'name' | 'previousName'

export interface TypeMatch {
  runtimeType: RuntimeSchema['types'][number]
  basis: IdentityBasis
}

/**
 * The registry row a local type refers to, and on what evidence.
 *
 * Returns `null` when nothing matches (a create) and throws nothing: an
 * AMBIGUOUS match is reported by `identityConflicts` before the plan is built,
 * so a caller here never has to decide.
 */
export function matchType(
  localType: SchemaDefinition['types'][number],
  runtime: RuntimeSchema,
): TypeMatch | null {
  const localId = (localType as { id?: string }).id
  if (localId) {
    const byId = runtime.types.find((rt) => rt.id === localId)
    if (byId) return { runtimeType: byId, basis: 'id' }
    // A local id that names no registry row is a NEW type that was authored
    // with an id (the builder mints one before the first push). Falling back to
    // the name here would be the dangerous case: a different id with a
    // colliding name is a different object.
    const nameHolder = runtime.types.find((rt) => rt.name === localType.name)
    if (nameHolder) return null   // reported by identityConflicts
    return null
  }
  const prev = localType.previousName ?? []
  const byName = runtime.types.find((rt) => rt.name === localType.name)
  if (byName) return { runtimeType: byName, basis: 'name' }
  const byPrev = runtime.types.find((rt) => prev.includes(rt.name))
  return byPrev ? { runtimeType: byPrev, basis: 'previousName' } : null
}

/**
 * Identity problems that must stop a push before any DDL is planned.
 *
 * Every one of these fails CLOSED. The alternative to refusing an ambiguous
 * schema is emitting a drop, and a drop is the operation that cannot be undone
 * by running the tool again.
 */
export function identityConflicts(local: SchemaDefinition, runtime: RuntimeSchema): string[] {
  const problems: string[] = []
  const seenIds = new Map<string, string>()

  for (const t of local.types) {
    const id = (t as { id?: string }).id
    if (id === undefined) continue

    if (typeof id !== 'string' || id.trim() === '') {
      problems.push(`"${t.name}" has a malformed type id (${JSON.stringify(id)}); remove it or restore the id this type was created with`)
      continue
    }
    const twin = seenIds.get(id)
    if (twin) {
      problems.push(`"${twin}" and "${t.name}" share the type id "${id}"; two types cannot be the same registry row`)
      continue
    }
    seenIds.set(id, t.name)

    const byId = runtime.types.find((rt) => rt.id === id)
    const byName = runtime.types.find((rt) => rt.name === t.name)
    if (!byId && byName) {
      problems.push(
        `"${t.name}" declares id "${id}" but the registry's "${t.name}" is id "${byName.id}". `
        + 'Same name, different identity: pushing would drop one and create the other. '
        + 'Restore the original id, or rename this type if it is genuinely new.',
      )
    }
    if (byId && byId.name !== t.name) {
      const nameTaken = runtime.types.find((rt) => rt.name === t.name && rt.id !== id)
      if (nameTaken) {
        problems.push(
          `renaming "${byId.name}" to "${t.name}" would collide with the existing type "${t.name}" (id "${nameTaken.id}")`,
        )
      }
    }
  }
  return problems
}

/**
 * A DROP_FIELD and ADD_FIELD pair on one type, same SQL shape: almost always a
 * rename whose `previousName` was forgotten.
 *
 * Fields have no stable id to check (`FieldDefinition` carries none today), so
 * this cannot be resolved by identity the way types can. It is therefore
 * REFUSED rather than hinted: the plan would otherwise drop a populated column
 * on the strength of a guess.
 */

export function diff(local: SchemaDefinition, runtime: RuntimeSchema): ChangePlan {
  const operations: ChangeOperation[] = []
  const orphans: ChangePlan['orphans'] = []

  for (const localType of local.types) {
    // Identity by stable id where both sides have one; name and previousName
    // only for schemas that genuinely lack ids. See matchType.
    const runtimeType = matchType(localType, runtime)?.runtimeType

    if (!runtimeType) {
      operations.push({ op: 'CREATE_TYPE', type: localType })
      if (localType.singleton) {
        operations.push({ op: 'CREATE_SINGLETON_OBJECT', typeName: localType.name })
      }
      continue
    }

    if (localType.name !== runtimeType.name) {
      operations.push({ op: 'RENAME_TYPE', typeId: runtimeType.id, from: runtimeType.name, to: localType.name })
    }

    if ((localType.singleton ?? false) !== runtimeType.singleton) {
      operations.push({ op: 'UPDATE_TYPE_SINGLETON', typeId: runtimeType.id, typeName: runtimeType.name, singleton: localType.singleton ?? false })
    }

    if ((localType.disabled ?? false) !== (runtimeType.disabled ?? false)) {
      operations.push({ op: 'UPDATE_TYPE_DISABLED', typeId: runtimeType.id, typeName: runtimeType.name, disabled: localType.disabled ?? false })
    }

    if (((localType as { localized?: boolean }).localized ?? false) !== (runtimeType.localized ?? false)) {
      operations.push({ op: 'UPDATE_TYPE_LOCALIZED', typeId: runtimeType.id, typeName: runtimeType.name, localized: (localType as { localized?: boolean }).localized ?? false })
    }

    if ((localType.plural ?? null) !== (runtimeType.plural ?? null)) {
      operations.push({ op: 'UPDATE_TYPE_PLURAL', typeId: runtimeType.id, typeName: runtimeType.name, plural: localType.plural ?? null })
    }

    if (localType.label !== runtimeType.label) {
      operations.push({ op: 'UPDATE_TYPE_LABEL', typeId: runtimeType.id, typeName: runtimeType.name, label: localType.label })
    }

    // Provenance: who declares this type now. Registry-only, no DDL - it moves
    // when a site adopts an extension's type (to null) or when an extension
    // starts providing one the site used to own.
    if ((localType.providedBy ?? null) !== (runtimeType.providedBy ?? null)) {
      operations.push({ op: 'UPDATE_TYPE_PROVIDED_BY', typeId: runtimeType.id, typeName: localType.name, providedBy: localType.providedBy ?? null })
    }

    if (!configEqual(localType.admin ?? {}, runtimeType.adminConfig)) {
      operations.push({ op: 'UPDATE_TYPE_ADMIN_CONFIG', typeId: runtimeType.id, typeName: runtimeType.name, admin: localType.admin })
    }

    for (const localField of localType.fields) {
      const localFieldPrevNames = localField.previousName ?? []

      const runtimeField = runtimeType.fields.find(
        rf => rf.name === localField.name || localFieldPrevNames.includes(rf.name)
      )

      if (!runtimeField) {
        operations.push({ op: 'ADD_FIELD', typeId: runtimeType.id, typeName: runtimeType.name, field: localField })
        continue
      }

      if (localField.name !== runtimeField.name) {
        operations.push({ op: 'RENAME_FIELD', typeId: runtimeType.id, typeName: runtimeType.name, fieldId: runtimeField.id, from: runtimeField.name, to: localField.name })
      }

      if (localField.fieldType !== runtimeField.fieldType) {
        // The tier comes from the column kinds, so rating -> number (both
        // NUMERIC) is a registry change and tags -> text (TEXT[] to TEXT) a cast.
        const fromSql = fieldTypeToSql(runtimeField.fieldType, runtimeField.config)
        const toSql = fieldTypeToSql(localField.fieldType, localField.config as Record<string, unknown>)
        operations.push({
          op: 'CHANGE_FIELD_TYPE',
          typeId: runtimeType.id,
          typeName: runtimeType.name,
          fieldId: runtimeField.id,
          fieldName: localField.name,
          from: runtimeField.fieldType,
          to: localField.fieldType,
          tier: classifyColumnChange(fromSql, toSql),
          fromSql,
          toSql,
        })
      }

      if (!configEqual(localField.config, runtimeField.config)) {
        operations.push({ op: 'UPDATE_FIELD_CONFIG', typeId: runtimeType.id, typeName: runtimeType.name, fieldId: runtimeField.id, field: localField })
      }

      if (localField.required !== runtimeField.required) {
        operations.push({ op: 'UPDATE_FIELD_REQUIRED', typeId: runtimeType.id, typeName: runtimeType.name, fieldId: runtimeField.id, fieldName: localField.name, required: localField.required })
      }

      // Soft-disable toggle — metadata only (the column is never dropped).
      if ((localField.disabled ?? false) !== (runtimeField.disabled ?? false)) {
        operations.push({ op: 'UPDATE_FIELD_DISABLED', typeId: runtimeType.id, typeName: runtimeType.name, fieldId: runtimeField.id, fieldName: localField.name, disabled: localField.disabled ?? false })
      }

      if (fieldIsIndexable(localField.fieldType, localField.config as Record<string, unknown>)) {
        const localIdx = localField.config.index === true
        const runtimeIdx = runtimeField.config.index === true
        if (localIdx && !runtimeIdx) {
          operations.push({ op: 'CREATE_INDEX', typeId: runtimeType.id, typeName: runtimeType.name, field: localField })
        } else if (!localIdx && runtimeIdx) {
          operations.push({ op: 'DROP_INDEX', typeId: runtimeType.id, typeName: runtimeType.name, fieldName: runtimeField.name })
        }
      }
    }

    for (const runtimeField of runtimeType.fields) {
      const localFieldPrevNames = localType.fields.flatMap(lf => lf.previousName ?? [])
      const matched = localType.fields.some(
        lf => lf.name === runtimeField.name || (lf.previousName ?? []).includes(runtimeField.name)
      )
      if (!matched) {
        operations.push({ op: 'DROP_FIELD', typeId: runtimeType.id, typeName: runtimeType.name, fieldId: runtimeField.id, name: runtimeField.name, fieldType: runtimeField.fieldType, warned: true })
      }
    }
  }

  for (const runtimeType of runtime.types) {
    // Same identity rule as the create/rename pass above, and it must be: a
    // type renamed BY ID is no longer found by its old name, so a name-only
    // check here reported it orphaned and emitted DROP_TYPE beside the
    // RENAME_TYPE that had just been planned for it.
    const matched = local.types.some((lt) => matchType(lt, runtime)?.runtimeType.id === runtimeType.id)
    if (matched) continue
    // Nobody declares this type any more. Whether that is a drop depends on WHO
    // used to declare it. The site's own code: their call, so the ordinary
    // DROP_TYPE (which needs its approval) applies. An extension's: the extension
    // was removed, disabled, or simply changed its mind, and none of those is a
    // decision to destroy a table full of authored content. It becomes an
    // ORPHAN - reported by push and by doctor, dropped by nobody.
    if (runtimeType.providedBy) {
      orphans.push({ type: runtimeType.name, providedBy: runtimeType.providedBy })
      continue
    }
    operations.push({ op: 'DROP_TYPE', typeId: runtimeType.id, name: runtimeType.name, warned: true })
  }

  // Destructive and migration flags come from plan-ops, the same helper the
  // scoped filter uses - a group drop (no column) is neither, and a plan is a
  // migration exactly when it carries DDL.
  return { operations, ...planFlags(operations), orphans }
}

/**
 * TL-5 — schema-level restrict for permanent type deletion: a DROP_TYPE cannot proceed
 * while the LOCAL (post-plan) schema still has relation fields targeting the dropped
 * type. Evaluating against local means removing the referring field in the SAME push is
 * fine — the guarantee is simply that no dangling targetType can survive the apply.
 */
export function dropTypeBlockers(
  local: SchemaDefinition,
  operations: ChangeOperation[],
  components: ComponentDef[] = [],
): string[] {
  const dropped = operations.filter((o) => o.op === 'DROP_TYPE').map((o) => (o as { name: string }).name)
  if (dropped.length === 0) return []
  const blockers: string[] = []
  for (const name of dropped) {
    for (const t of local.types) {
      for (const f of t.fields ?? []) {
        if (f.fieldType === 'relation') {
          if ((f.config as { targetType?: string } | undefined)?.targetType === name) {
            blockers.push(`${t.name}.${f.name} still targets "${name}" - remove or retarget that relation field first`)
          }
        } else if (f.fieldType === 'component') {
          // Inline component defs nested in this field (registry names are checked below).
          const inline = (((f.config as { components?: unknown })?.components ?? []) as Array<string | ComponentDef>)
            .filter((r): r is ComponentDef => typeof r !== 'string')
          for (const hit of relationSubfieldsIn(inline, components)) {
            if (hit.targetType === name) {
              blockers.push(`${t.name}.${f.name} (inline component ${hit.componentName}.${hit.subfield}) still targets "${name}" - remove that sub-field first`)
            }
          }
        }
      }
    }
    for (const comp of components) {
      for (const hit of relationSubfieldsIn([comp], components)) {
        if (hit.targetType === name && hit.componentName === comp.name) {
          blockers.push(`component ${comp.name}.${hit.subfield} still targets "${name}" - remove that sub-field first (edits the component everywhere it's used)`)
        }
      }
    }
  }
  return blockers
}
