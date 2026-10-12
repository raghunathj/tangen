/**
 * File Name: component-relations.ts
 * Purpose: CR-1 — shared walkers for relations NESTED inside component blocks. One
 *   place understands both `config.components` shapes (string registry names and
 *   inline ComponentDefs), so the block editor, the read-time resolver, and the
 *   delete cascade can never disagree about where nested relations live.
 *
 *   Philosophy (ACF model): definitions are scanned/cleaned eagerly, stored block
 *   values are only ever transformed in-flight (reads) or on the row being written —
 *   nothing here mass-rewrites data.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ComponentDef } from '@tangen/types'
import { isLocalizableFieldType } from '@tangen/types'
import type { ComponentRef } from './components'
import { validateComponentProtection } from './component-protection'

export interface NestedRelationSubfield {
  componentName: string
  subfield: string
  targetType: string
  many: boolean
}

/**
 * Every relation sub-field reachable from a list of component refs — through registry
 * names, inline defs, and component-in-component nesting. Unknown registry names are
 * SKIPPED (stored schemas may reference components that no longer exist — a scanner
 * must never throw). De-duplicated by component+subfield.
 */
export function relationSubfieldsIn(
  refs: ComponentRef[] | undefined,
  registry: ComponentDef[] = [],
  _seen: Set<string> = new Set(),
): NestedRelationSubfield[] {
  const out: NestedRelationSubfield[] = []
  for (const ref of refs ?? []) {
    const def = typeof ref === 'string' ? registry.find((c) => c.name === ref) : ref
    if (!def || _seen.has(def.name)) continue
    _seen.add(def.name)
    const walkFields = (fields: Array<Record<string, unknown>> | undefined) => {
      for (const f of fields ?? []) {
        const cfg = (f.config ?? {}) as { targetType?: string; many?: boolean; components?: ComponentRef[]; fields?: unknown }
        if (f.fieldType === 'relation' && cfg.targetType) {
          out.push({ componentName: def.name, subfield: f.name as string, targetType: cfg.targetType, many: cfg.many === true })
        } else if (f.fieldType === 'component') {
          out.push(...relationSubfieldsIn(cfg.components, registry, _seen))
        } else if (f.fieldType === 'repeater') {
          walkFields(cfg.fields as never)   // NR-1: relations in repeater rows count too
        }
      }
    }
    walkFields(def.fields as never)
  }
  return out
}

/**
 * A stored component block. The editor stores blocks FLAT — `{ _key, _type,
 * <subfield>: value }` — but a legacy nested `{ type, values: {...} }` shape is also
 * accepted. Meta keys are underscore-prefixed.
 */
export interface ComponentBlockValue {
  _type?: string
  type?: string
  values?: Record<string, unknown>
  [k: string]: unknown
}

/** The block's component name across both shapes. */
export const blockTypeOf = (b: ComponentBlockValue): string | undefined =>
  (b?._type as string | undefined) ?? (b?.type as string | undefined)

/**
 * Map the relation ids inside stored component block values. `resolve` returns the
 * replacement for an id — or null, which FILTERS it (dropped from arrays, nulls a
 * single). Everything else — non-relation sub-fields, unknown block types, malformed
 * values — passes through untouched (fail-open: data is never damaged by a walk).
 * Handles component-in-component nesting.
 */
export function mapNestedRelationIds(
  blocks: ComponentBlockValue[] | undefined,
  defs: ComponentDef[],
  resolve: (id: string, target: string) => unknown | null,
): ComponentBlockValue[] {
  if (!Array.isArray(blocks)) return blocks ?? []
  return blocks.map((block) => {
    const def = defs.find((d) => d.name === blockTypeOf(block))
    if (!def) return block
    // Editor blocks are FLAT ({ _type, sub: v }); legacy shape nests under `values`.
    const nested = !!block.values && typeof block.values === 'object'
    const values: Record<string, unknown> = nested ? { ...(block.values as Record<string, unknown>) } : { ...block }
    let changed = false
    for (const f of def.fields ?? []) {
      const cfg = (f.config ?? {}) as { targetType?: string; many?: boolean; components?: ComponentRef[] }
      const v = values[f.name]
      if (f.fieldType === 'relation' && cfg.targetType) {
        if (cfg.many === true && Array.isArray(v)) {
          values[f.name] = v
            .map((id) => (typeof id === 'string' ? resolve(id, cfg.targetType!) : id))
            .filter((x) => x !== null && x !== undefined)
          changed = true
        } else if (typeof v === 'string' && v) {
          values[f.name] = resolve(v, cfg.targetType)
          changed = true
        }
      } else if (f.fieldType === 'component' && Array.isArray(v)) {
        const nestedDefs = (cfg.components ?? []).filter((r): r is ComponentDef => typeof r !== 'string')
        // registry-name nested refs were resolved into defs by the caller when needed
        values[f.name] = mapNestedRelationIds(v as ComponentBlockValue[], [...nestedDefs, ...defs], resolve)
        changed = true
      } else if (f.fieldType === 'repeater' && Array.isArray(v)) {
        values[f.name] = mapRowRelationIds(v as Array<Record<string, unknown>>, ((cfg as { fields?: unknown }).fields ?? []) as never, defs, resolve)
        changed = true
      }
    }
    if (!changed) return block
    return nested ? { ...block, values } : values
  })
}

/**
 * BL-1 — the top-level container fields (component / repeater) holding at least
 * one `localized: true` sub-field anywhere: inline defs, reusable registry refs,
 * nested containers. These earn a JSONB overlay column in the type's i18n side
 * table (per-locale sub-values keyed by block/row `_key`). Media sub-fields
 * never count — they localize at the asset level. Cycle-safe; unknown registry
 * names are skipped.
 */
export function localizedContainerFields(
  fields: Array<{ name: string; fieldType?: string; config?: Record<string, unknown> }>,
  registry: ComponentDef[] = [],
): string[] {
  const subLocalized = (
    subs: Array<Record<string, unknown>> | undefined,
    seen: Set<string>,
  ): boolean => {
    for (const sf of subs ?? []) {
      const cfg = (sf.config ?? {}) as Record<string, unknown>
      if (cfg.localized === true && sf.fieldType !== 'media') return true
      if (sf.fieldType === 'component' && refsLocalized(cfg.components as ComponentRef[] | undefined, seen)) return true
      if (sf.fieldType === 'repeater' && subLocalized(cfg.fields as never, seen)) return true
      if (sf.fieldType === 'group' && subLocalized(cfg.groupFields as never, seen)) return true
    }
    return false
  }

  const refsLocalized = (refs: ComponentRef[] | undefined, seen: Set<string>): boolean => {
    for (const ref of refs ?? []) {
      const def = typeof ref === 'string' ? registry.find((c) => c.name === ref) : ref
      if (!def) continue
      if (typeof ref === 'string') {
        if (seen.has(def.name)) continue
        seen.add(def.name)
      }
      if (subLocalized(def.fields as never, seen)) return true
    }
    return false
  }

  const out: string[] = []
  for (const f of fields ?? []) {
    const cfg = (f.config ?? {}) as Record<string, unknown>
    if (f.fieldType === 'component' && refsLocalized(cfg.components as ComponentRef[] | undefined, new Set())) out.push(f.name)
    else if (f.fieldType === 'repeater' && subLocalized(cfg.fields as never, new Set())) out.push(f.name)
  }
  return out
}

/**
 * NR-1 — relation sub-fields reachable from a REPEATER's row-field list
 * (recursing nested repeaters and component refs). The repeater twin of
 * relationSubfieldsIn.
 */
export function relationRowFieldsIn(
  fields: Array<Record<string, unknown>> | undefined,
  registry: ComponentDef[] = [],
): NestedRelationSubfield[] {
  const out: NestedRelationSubfield[] = []
  for (const f of fields ?? []) {
    const cfg = (f.config ?? {}) as { targetType?: string; many?: boolean; components?: ComponentRef[]; fields?: unknown }
    if (f.fieldType === 'relation' && cfg.targetType) {
      out.push({ componentName: '', subfield: f.name as string, targetType: cfg.targetType, many: cfg.many === true })
    } else if (f.fieldType === 'repeater') {
      out.push(...relationRowFieldsIn(cfg.fields as never, registry))
    } else if (f.fieldType === 'component') {
      out.push(...relationSubfieldsIn(cfg.components, registry))
    }
  }
  return out
}

/**
 * NR-1 — map relation ids inside repeater ROWS (same resolve semantics as
 * mapNestedRelationIds; `_`-meta keys untouched; nested repeaters and
 * component blocks recurse; fail-open on malformed rows).
 */
export function mapRowRelationIds(
  rows: Array<Record<string, unknown>> | undefined,
  fields: Array<Record<string, unknown>>,
  registry: ComponentDef[],
  resolve: (id: string, target: string) => unknown | null,
): Array<Record<string, unknown>> {
  if (!Array.isArray(rows)) return rows ?? []
  return rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row
    const next = { ...row }
    for (const f of fields ?? []) {
      const cfg = (f.config ?? {}) as { targetType?: string; many?: boolean; components?: ComponentRef[]; fields?: unknown }
      const name = f.name as string
      const v = next[name]
      if (f.fieldType === 'relation' && cfg.targetType) {
        if (cfg.many === true && Array.isArray(v)) {
          next[name] = v
            .map((id) => (typeof id === 'string' ? resolve(id, cfg.targetType!) : id))
            .filter((x) => x !== null && x !== undefined)
        } else if (typeof v === 'string' && v) {
          next[name] = resolve(v, cfg.targetType)
        }
      } else if (f.fieldType === 'repeater' && Array.isArray(v)) {
        next[name] = mapRowRelationIds(v as never, (cfg.fields ?? []) as never, registry, resolve)
      } else if (f.fieldType === 'component' && Array.isArray(v)) {
        const inline = (cfg.components ?? []).filter((r): r is ComponentDef => typeof r !== 'string')
        next[name] = mapNestedRelationIds(v as never, [...inline, ...registry], resolve)
      }
    }
    return next
  })
}

/**
 * Empty containers are invalid schema: a component field with nothing to pick, a
 * repeater/group with no fields, an inline or reusable component with zero fields.
 * One rule for every door — the builder blocks at Apply, `tangen push` fails before
 * touching the database, and the write API answers 422.
 */
export function validateContainerEmptiness(
  types: Array<{ name: string; fields?: Array<Record<string, unknown>> }>,
  registry: ComponentDef[] = [],
): string[] {
  const errors: string[] = []

  const checkFields = (fields: Array<Record<string, unknown>> | undefined, owner: string) => {
    for (const f of fields ?? []) {
      const cfg = (f.config ?? {}) as Record<string, unknown>
      const at = `${owner}.${f.name as string}`
      if (f.fieldType === 'component') {
        const refs = (Array.isArray(cfg.components) ? cfg.components : []) as Array<string | ComponentDef>
        if (refs.length === 0) errors.push(`${at}: a component field needs at least one component`)
        for (const ref of refs) {
          if (typeof ref === 'string') continue // registry components validated once below
          if (isDeliberateLeaf(ref)) continue
          if (!ref.fields?.length) errors.push(`${at}: inline component "${ref.name}" has no fields`)
          else checkFields(ref.fields as never, `${at}:${ref.name}`)
        }
      } else if (f.fieldType === 'repeater') {
        const sub = cfg.fields as Array<Record<string, unknown>> | undefined
        if (!sub?.length) errors.push(`${at}: a repeater needs at least one row field`)
        else checkFields(sub, at)
      } else if (f.fieldType === 'group') {
        const sub = cfg.groupFields as Array<Record<string, unknown>> | undefined
        if (!sub?.length) errors.push(`${at}: a group needs at least one field`)
        else checkFields(sub, at)
      }
    }
  }

  for (const t of types) checkFields(t.fields, t.name)
  for (const c of registry) {
    if (isDeliberateLeaf(c)) continue
    if (!c.fields?.length) errors.push(`component "${c.name}" has no fields`)
    else checkFields(c.fields as never, c.name)
  }
  return errors
}

/**
 * A component that declares `leaf: true` has said, in code, that it carries
 * no props: the Builder Kit's divider is one, a block whose whole meaning is
 * its presence. That is not an empty container - the rule above exists for a
 * container someone forgot to fill, and the schema builder's Apply relies on
 * it to refuse a reusable component with nothing in it. So the signal is an
 * explicit flag, not an empty array: `fields: []` alone is still refused,
 * `leaf: true` with `fields: []` is the author's word. Refusing the divider
 * had blocked every push of a project whose pages could hold one.
 */
function isDeliberateLeaf(def: { fields?: unknown; leaf?: unknown }): boolean {
  return def.leaf === true && Array.isArray(def.fields) && def.fields.length === 0
}

/**
 * Structural field/sub-field config validation — catches malformed configs at
 * `push` instead of at runtime in the editor: a select/multiselect needs options
 * (or a dynamic source), a relation needs a targetType, a polymorphic object
 * needs an include list. Recurses into repeater/component/group containers,
 * mirroring validateContainerEmptiness. Returns human-readable error strings.
 *
 * This is the guardrail the type system doesn't yet provide for repeater/
 * component SUB-FIELDS (authored as raw objects, not `field.*` builders).
 */
export function validateFieldConfigs(
  types: Array<{ name: string; fields?: Array<Record<string, unknown>> }>,
  registry: ComponentDef[] = [],
): string[] {
  const errors: string[] = []

  // A component's Studio `protection` declaration, checked where the def is
  // met - inline in a component field, or once in the registry - so a
  // malformed one is a push error naming the component and the key rather
  // than a Block that reads as Open in production. Structural only; see
  // component-protection.ts for what the Studio-side validator adds.
  const checkProtection = (def: { name?: unknown; protection?: unknown }, at: string) => {
    for (const issue of validateComponentProtection(def.protection)) {
      errors.push(`${at}: ${issue}`)
    }
  }

  const check = (fields: Array<Record<string, unknown>> | undefined, owner: string) => {
    for (const f of fields ?? []) {
      const cfg = (f.config ?? {}) as Record<string, unknown>
      const at = `${owner}.${f.name as string}`
      const ft = f.fieldType as string
      if (ft === 'select' || ft === 'multiselect') {
        const hasOptions = Array.isArray(cfg.options) && cfg.options.length > 0
        const isDynamic = cfg.optionsSource === 'dynamic'
        if (!hasOptions && !isDynamic) {
          errors.push(`${at}: a ${ft} field needs config.options (or optionsSource: 'dynamic')`)
        }
      } else if (ft === 'relation') {
        if (!cfg.targetType) errors.push(`${at}: a relation field needs config.targetType`)
      } else if (ft === 'object') {
        const inc = cfg.include
        if (!(Array.isArray(inc) && inc.length > 0)) errors.push(`${at}: an object field needs a non-empty config.include list`)
      }
      // Recurse into containers (same shape as validateContainerEmptiness).
      if (ft === 'component') {
        for (const ref of (Array.isArray(cfg.components) ? cfg.components : []) as Array<string | ComponentDef>) {
          if (typeof ref === 'string') continue // registry components checked once below
          checkProtection(ref, `${at}:${ref.name}`)
          check(ref.fields as never, `${at}:${ref.name}`)
        }
      } else if (ft === 'repeater') {
        check(cfg.fields as never, at)
      } else if (ft === 'group') {
        check(cfg.groupFields as never, at)
      }
    }
  }

  for (const t of types) check(t.fields, t.name)
  for (const c of registry) {
    checkProtection(c, c.name)
    check(c.fields as never, c.name)
  }
  return errors
}

// ── Cross-reference validation ────────────────────────────────────────────────

/** A dangling cross-type reference: a targetType/parentType/object types entry
 *  that names a content type which doesn't exist. */
export interface CrossRefIssue {
  /** Where the reference lives, e.g. `product.category` or `page.blocks → hero.author`. */
  at: string
  /** The property that's dangling. */
  kind: 'relation.targetType' | 'object.types' | 'taxonomy.parentType'
  /** The bad name that was referenced. */
  reference: string
  /** Closest existing type name, when one is within edit-distance 2. */
  suggestion?: string
}

/** Levenshtein distance, capped — used only for "did you mean" suggestions. */
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  if (Math.abs(m - n) > 2) return 99
  const prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j]
      prev[j] = a[i - 1] === b[j - 1] ? diag : 1 + Math.min(prev[j], prev[j - 1], diag)
      diag = tmp
    }
  }
  return prev[n]
}

function nearest(name: string, names: string[]): string | undefined {
  let best: string | undefined
  let bestD = 3
  for (const n of names) {
    const d = editDistance(name, n)
    if (d < bestD) { bestD = d; best = n }
  }
  return best
}

/**
 * Scans every content type (and the reusable components its fields use) for
 * cross-type references that point at a type name which doesn't exist — the
 * usual cause being a typo or a singular/plural mismatch (`product` vs
 * `products`). Covers relation `targetType`, polymorphic `object` `types`,
 * and taxonomy `parentType`, including relations nested inside
 * component/repeater/group containers. Never throws — returns a list of
 * issues with a closest-name suggestion when available.
 */
export function validateCrossReferences(
  types: Array<{ name: string; fields?: Array<Record<string, unknown>>; admin?: Record<string, unknown>; adminConfig?: Record<string, unknown> }>,
  registry: ComponentDef[] = [],
  /**
   * Type names that exist beyond `types`. A scoped push validates only the
   * types it applies, but their relations may point at any type the project
   * has - without this a `--type post` push warned that `post_category` and
   * `author` do not exist while both sat one scope away.
   */
  known: readonly string[] = [],
): CrossRefIssue[] {
  const names = [...new Set([...types.map((t) => t.name), ...known])]
  const nameSet = new Set(names)
  const issues: CrossRefIssue[] = []

  const checkTarget = (target: string | undefined, at: string, kind: CrossRefIssue['kind']) => {
    if (!target || nameSet.has(target)) return
    issues.push({ at, kind, reference: target, suggestion: nearest(target, names) })
  }

  const walk = (fields: Array<Record<string, unknown>> | undefined, path: string, seenComp: Set<string>) => {
    for (const f of fields ?? []) {
      const cfg = (f.config ?? {}) as {
        targetType?: string; types?: string[]; components?: ComponentRef[]; fields?: unknown; groupFields?: unknown
      }
      const at = `${path}.${f.name as string}`
      if (f.fieldType === 'relation') {
        checkTarget(cfg.targetType, at, 'relation.targetType')
      } else if (f.fieldType === 'object') {
        for (const t of cfg.types ?? []) checkTarget(t, at, 'object.types')
      } else if (f.fieldType === 'component') {
        for (const ref of cfg.components ?? []) {
          const def = typeof ref === 'string' ? registry.find((c) => c.name === ref) : ref
          if (def && !seenComp.has(def.name)) {
            seenComp.add(def.name)
            walk(def.fields as never, `${at} → ${def.name}`, seenComp)
          }
        }
      } else if (f.fieldType === 'repeater') {
        walk(cfg.fields as never, at, seenComp)
      } else if (f.fieldType === 'group') {
        walk(cfg.groupFields as never, at, seenComp)
      }
    }
  }

  for (const t of types) {
    walk(t.fields, t.name, new Set())
    const admin = (t.admin ?? t.adminConfig ?? {}) as { taxonomy?: { parentType?: string } }
    checkTarget(admin.taxonomy?.parentType, `${t.name} (taxonomy.parentType)`, 'taxonomy.parentType')
  }
  return issues
}
