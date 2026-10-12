/**
 * File Name: component-projection.ts
 * Purpose: The read side of the C5 rule, and the write-side guard that makes it
 *   safe. Storage keeps every component sub-field value it was ever given; an
 *   ordinary response shows only what the CURRENT component definition lists.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Two exported functions, one rule, deliberately in one file
 *   because neither is correct alone:
 *
 *     projectComponentValues   what a response shows   (pure, read side)
 *     reconcileComponentWrite  what a write may store  (pure, write side)
 *
 *   Both sort a block's keys into the same three classes, which is the single
 *   classification this module exists to own:
 *
 *     reserved     `_type`, `_key`, `_label`, `_studio`, anything `_`-prefixed
 *     current      listed by the component definition in force right now
 *     historical   stored earlier, under a definition that no longer lists it
 *
 *   Hiding a key from a response is only safe if a client that echoes the
 *   response back cannot delete the key it never saw. The admin editor, the
 *   SDK, and any script that fetches an object, changes one field and writes it
 *   back all do exactly that, and a container field is written as a whole
 *   array. Without the second function the projection would move the C5 data
 *   loss from the server into every client. See docs/architecture/database-safety.md.
 *
 *   Neither function touches storage and neither mutates its arguments. A read
 *   never rewrites a row: the projection builds new objects and leaves the
 *   stored value exactly as it was, so migration, Porter, revisions, raw SQL
 *   and the explicit purge all still see the historical values.
 *
 *   An unresolvable definition is never destructive. A block whose `_type` has
 *   no definition, a component field whose refs resolve to nothing, and a
 *   repeater that declares no row fields all pass through unfiltered: showing
 *   an extra key is recoverable, deciding a definition does not exist is not.
 */
import { flattenFields, type FieldDefinition, type ComponentDef } from '@tangen/types'

/** Tolerant ref resolution — unknown registry names are dropped, never thrown. */
function safeDefs(refs: unknown, registry: ComponentDef[]): ComponentDef[] {
  const out: ComponentDef[] = []
  for (const ref of (Array.isArray(refs) ? refs : []) as Array<string | ComponentDef>) {
    if (typeof ref === 'string') {
      const found = registry.find((c) => c.name === ref)
      if (found) out.push(found)
    } else if (ref && typeof ref === 'object') {
      out.push(ref)
    }
  }
  return out
}

/** Reserved keys always survive: `_type`, `_key`, `_label`, Studio's `_studio`, whatever comes next. */
const isReserved = (k: string) => k.startsWith('_') || k === 'type'

const rowFieldsOf = (f: { config?: unknown }) => {
  const fields = (f.config as { fields?: unknown } | undefined)?.fields
  return Array.isArray(fields) ? fields as FieldDefinition[] : null
}

/** Container fields, flattened out of groups, that this row actually carries. */
function containerFields(typeDef: { fields: FieldDefinition[] }, values: Record<string, unknown>) {
  return flattenFields(typeDef.fields)
    .filter((f) => (f.fieldType === 'component' || f.fieldType === 'repeater') && f.name in values)
}

/**
 * Return `values` with every component block and repeater row reduced to the
 * sub-fields the current definition lists. Reserved keys survive; nested
 * containers recurse; anything the definition cannot explain is left alone.
 */
export function projectComponentValues(
  typeDef: { fields: FieldDefinition[] },
  registry: ComponentDef[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const fields = containerFields(typeDef, values)
  if (fields.length === 0) return values

  /** Keep the sub-fields `defs` lists, recursing through nested containers. */
  const projectFields = (source: Record<string, unknown>, defs: FieldDefinition[]): Record<string, unknown> => {
    const allowed = new Map(defs.map((f) => [f.name, f]))
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(source)) {
      if (isReserved(k)) { next[k] = v; continue }
      const sub = allowed.get(k)
      if (!sub) continue                                     // historical key: not shown, still stored
      if (sub.fieldType === 'component') {
        next[k] = projectBlocks(v, safeDefs((sub.config as { components?: unknown })?.components, registry))
      } else if (sub.fieldType === 'repeater') {
        next[k] = projectRows(v, rowFieldsOf(sub))
      } else {
        next[k] = v
      }
    }
    return next
  }

  function projectBlocks(blocks: unknown, defs: ComponentDef[]): unknown {
    if (!Array.isArray(blocks) || defs.length === 0) return blocks
    return blocks.map((block) => {
      if (!block || typeof block !== 'object') return block
      const b = block as Record<string, unknown>
      const def = defs.find((d) => d.name === (b._type ?? b.type))
      if (!def) return block                                 // definition absent: never guess
      // Editor blocks are usually FLAT; the nested `values` shape is still read.
      const nested = !!b.values && typeof b.values === 'object' && !Array.isArray(b.values)
      const source = nested ? (b.values as Record<string, unknown>) : b
      const projected = projectFields(source, (def.fields ?? []) as FieldDefinition[])
      return nested ? { ...b, values: projected } : projected
    })
  }

  function projectRows(rows: unknown, fields: FieldDefinition[] | null): unknown {
    if (!Array.isArray(rows) || !fields || fields.length === 0) return rows
    return rows.map((row) => (row && typeof row === 'object' && !Array.isArray(row))
      ? projectFields(row as Record<string, unknown>, fields)
      : row)
  }

  const out = { ...values }
  for (const f of fields) {
    out[f.name] = f.fieldType === 'component'
      ? projectBlocks(out[f.name], safeDefs((f.config as { components?: unknown })?.components, registry))
      : projectRows(out[f.name], rowFieldsOf(f))
  }
  return out
}

/**
 * Return `updates` as a normal schema-aware write is allowed to store it:
 *
 *   current      the payload's value wins, including absent meaning "cleared"
 *   historical    the STORED value is carried through, whatever the payload says
 *   reserved      passed through
 *   anything else dropped, because it is neither
 *
 * In one line: a write may change what the current schema presents; it may
 * neither manufacture nor mutate historical data.
 *
 * The two halves each close a different hole. Carrying the stored value forward
 * stops a projected read/edit/write cycle from deleting a key the client never
 * saw. Dropping the payload's undeclared keys stops the same client from
 * inventing one, or from editing a historical value just because it knows the
 * old field name: storage is not a hidden writable API.
 *
 * Neither half deletes anything stored. A historical key keeps exactly the
 * value it had; only an explicit purge may remove it. Blocks and repeater rows
 * are matched by `_key`, so reordering never crosses values over, and a block
 * whose definition cannot be resolved is passed through untouched.
 *
 * `stored` is null on create, where there is no history to carry and the rule
 * reduces to "a write may only store what the schema declares".
 */
export function reconcileComponentWrite(
  typeDef: { fields: FieldDefinition[] },
  registry: ComponentDef[],
  stored: Record<string, unknown> | null | undefined,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const fields = containerFields(typeDef, updates)
  if (fields.length === 0) return updates

  const byKey = (blocks: unknown): Map<string, Record<string, unknown>> => {
    const map = new Map<string, Record<string, unknown>>()
    if (!Array.isArray(blocks)) return map
    for (const b of blocks) {
      const key = (b as Record<string, unknown> | null)?._key
      if (typeof key === 'string') map.set(key, b as Record<string, unknown>)
    }
    return map
  }

  /** The rule itself, applied to one block or one repeater row. */
  const reconcileFields = (
    now: Record<string, unknown>,
    was: Record<string, unknown> | undefined,
    defs: FieldDefinition[],
  ): Record<string, unknown> => {
    const allowed = new Map(defs.map((f) => [f.name, f]))
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(now)) {
      if (isReserved(k)) { next[k] = v; continue }
      const sub = allowed.get(k)
      if (!sub) continue                                     // undeclared: never becomes stored data
      if (sub.fieldType === 'component') {
        next[k] = reconcileBlocks(v, was?.[k], safeDefs((sub.config as { components?: unknown })?.components, registry))
      } else if (sub.fieldType === 'repeater') {
        next[k] = reconcileRows(v, was?.[k], rowFieldsOf(sub))
      } else {
        next[k] = v
      }
    }
    if (was) {
      for (const [k, v] of Object.entries(was)) {
        // `k in next`: the payload set it. `allowed.has(k)`: a CURRENT field the
        // payload omitted, which still means "cleared". Neither is history.
        if (isReserved(k) || k in next || allowed.has(k)) continue
        next[k] = v                                          // historical: carried unchanged
      }
    }
    return next
  }

  function reconcileBlocks(blocks: unknown, storedBlocks: unknown, defs: ComponentDef[]): unknown {
    if (!Array.isArray(blocks) || defs.length === 0) return blocks
    const map = byKey(storedBlocks)
    return blocks.map((block) => {
      if (!block || typeof block !== 'object') return block
      const b = block as Record<string, unknown>
      const def = defs.find((d) => d.name === (b._type ?? b.type))
      if (!def) return block                                 // definition absent: never guess
      const was = typeof b._key === 'string' ? map.get(b._key) : undefined
      const nested = !!b.values && typeof b.values === 'object' && !Array.isArray(b.values)
      const source = nested ? (b.values as Record<string, unknown>) : b
      const wasSource = was && nested && was.values && typeof was.values === 'object'
        ? was.values as Record<string, unknown>
        : was
      const out = reconcileFields(source, wasSource, (def.fields ?? []) as FieldDefinition[])
      return nested ? { ...b, values: out } : out
    })
  }

  function reconcileRows(rows: unknown, storedRows: unknown, fields: FieldDefinition[] | null): unknown {
    if (!Array.isArray(rows) || !fields || fields.length === 0) return rows
    const map = byKey(storedRows)
    return rows.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row
      const r = row as Record<string, unknown>
      const was = typeof r._key === 'string' ? map.get(r._key) : undefined
      return reconcileFields(r, was, fields)
    })
  }

  const out = { ...updates }
  for (const f of fields) {
    out[f.name] = f.fieldType === 'component'
      ? reconcileBlocks(out[f.name], stored?.[f.name], safeDefs((f.config as { components?: unknown })?.components, registry))
      : reconcileRows(out[f.name], stored?.[f.name], rowFieldsOf(f))
  }
  return out
}
