/**
 * File Name: schema-builder-model.ts
 * Purpose: SB-3 — the pure state model + reducer behind the Content Object
 *   Builder canvas. Fields live in two ordered stages (Main / Sidebar); the
 *   reducer adds/moves/reorders/resizes/removes them, and toObjectType /
 *   fromObjectType round-trip to the object-type definition (editorView + width)
 *   the write API (SB-2) persists to code.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: pure — no React, no I/O — so the canvas logic is testable
 *   in isolation.
 */
import { RESERVED_FIELD_NAMES, groupMemberNames } from '@tangen/types'

export type Stage = 'main' | 'sidebar'
export type Width = 'full' | 'half' | 'third'

export interface BuilderField {
  /**
   * Stable client key (fields may be renamed before save). It is regenerated on
   * every load, so it identifies a field WITHIN one editing session and is not
   * what a rename is remembered by: `previousName` is.
   */
  key: string
  name: string
  /**
   * Explicit rename intent, oldest first. Set when the developer edits the
   * technical name of an EXISTING field, never inferred from similarity, and
   * written into the schema file so the planner emits RENAME_FIELD instead of
   * DROP_FIELD + ADD_FIELD.
   */
  previousName?: string[]
  label: string
  fieldType: string
  config: Record<string, unknown>
  required: boolean
  /** Soft-disabled: hidden from every runtime surface; column + data preserved. */
  disabled?: boolean
  width: Width
}

export interface BuilderModel {
  id: string
  name: string
  /** Explicit type rename intent, oldest first. Same rule as the field one. */
  previousName?: string[]
  label: string
  /** Explicit plural word — set at creation, locked afterwards (changing it would
   *  rename the GraphQL list query, an API break). Empty = inferred from name. */
  plural?: string
  description: string
  icon: string
  /** Type-level soft delete — round-tripped, toggled from the schema list/builder. */
  disabled?: boolean
  /** Single-entry type (e.g. Homepage, Site Settings) — no list view, one editor. */
  singleton?: boolean
  /** Translatable type — title (and any localized fields) get a <type>_i18n side
   *  table on push. Only meaningful when workspace localization is enabled. */
  localized?: boolean
  /** Taxonomy config — nav nesting (parentType), a term tree (hierarchical), and
   *  drag-reorder (orderable). `parent` (hierarchical) + `position` (orderable) are
   *  auto-provided by defineObjectType, so the builder only stores the flags. */
  taxonomy?: { hierarchical?: boolean; parentType?: string; orderable?: boolean }
  main: BuilderField[]
  sidebar: BuilderField[]
}

export type BuilderAction =
  | { type: 'ADD_FIELD'; fieldType: string; name: string; label: string; stage?: Stage; key?: string }
  | { type: 'MOVE_FIELD'; key: string; toStage: Stage; toIndex: number }
  | { type: 'SET_WIDTH'; key: string; width: Width }
  | { type: 'REMOVE_FIELD'; key: string }
  | { type: 'DUPLICATE_FIELD'; key: string }
  | { type: 'UPDATE_FIELD'; key: string; patch: Partial<Omit<BuilderField, 'key'>> }
  | { type: 'SET_META'; patch: Partial<Pick<BuilderModel, 'name' | 'label' | 'plural' | 'description' | 'icon' | 'disabled' | 'singleton' | 'localized' | 'taxonomy'>> }
  | { type: 'SET_MODEL'; model: BuilderModel }

let _seq = 0
export const newKey = () => `f_${Date.now().toString(36)}_${(_seq++).toString(36)}`

/** An empty content type with the given meta. */
export function emptyModel(name = '', label = '', description = '', icon = ''): BuilderModel {
  return { id: name ? `oty_${name}` : '', name, label, description, icon, main: [], sidebar: [] }
}

/**
 * Append `from` to a rename trail, unless the developer has renamed back to a
 * name already in it: title → headline → title is not a rename, it is somebody
 * changing their mind, and recording it would make the planner look for a
 * column that is still called what it was always called.
 */
export function recordRename(previous: string[] | undefined, from: string, to: string): string[] | undefined {
  if (from === to) return previous
  const trail = previous ?? []
  if (trail.includes(to)) {
    // Renaming back: drop everything from that name onwards.
    const kept = trail.slice(0, trail.indexOf(to))
    return kept.length > 0 ? kept : undefined
  }
  return trail.includes(from) ? trail : [...trail, from]
}

function findField(m: BuilderModel, key: string): { stage: Stage; index: number; field: BuilderField } | null {
  for (const stage of ['main', 'sidebar'] as Stage[]) {
    const index = m[stage].findIndex((f) => f.key === key)
    if (index !== -1) return { stage, index, field: m[stage][index] }
  }
  return null
}

export function builderReducer(state: BuilderModel, action: BuilderAction): BuilderModel {
  switch (action.type) {
    case 'SET_MODEL':
      return action.model
    case 'ADD_FIELD': {
      const field: BuilderField = {
        key: action.key ?? newKey(),
        name: action.name,
        label: action.label,
        fieldType: action.fieldType,
        config: {},
        required: false,
        width: 'full',
      }
      const stage = action.stage ?? 'main'
      return { ...state, [stage]: [...state[stage], field] }
    }
    case 'MOVE_FIELD': {
      const found = findField(state, action.key)
      if (!found) return state
      // Remove from source stage.
      const source = state[found.stage].filter((f) => f.key !== action.key)
      const next: BuilderModel = { ...state, [found.stage]: source }
      // Insert into the (possibly same) target stage at the clamped index.
      const target = [...next[action.toStage]]
      const idx = Math.max(0, Math.min(action.toIndex, target.length))
      target.splice(idx, 0, found.field)
      return { ...next, [action.toStage]: target }
    }
    case 'SET_WIDTH':
    case 'UPDATE_FIELD': {
      const patch = action.type === 'SET_WIDTH' ? { width: action.width } : action.patch
      // The key is what makes this a rename rather than a guess: the reducer
      // KNOWS this is the same field, because the developer edited that field.
      const apply = (arr: BuilderField[]) => arr.map((f) => {
        if (f.key !== action.key) return f
        const next = { ...f, ...patch }
        if (typeof patch.name === 'string' && patch.name !== f.name) {
          const trail = recordRename(f.previousName, f.name, patch.name)
          if (trail) next.previousName = trail
          else delete next.previousName
        }
        return next
      })
      return { ...state, main: apply(state.main), sidebar: apply(state.sidebar) }
    }
    case 'DUPLICATE_FIELD': {
      const found = findField(state, action.key)
      if (!found) return state
      const names = new Set([...state.main, ...state.sidebar].map((f) => f.name))
      let name = `${found.field.name}_copy`
      for (let i = 2; names.has(name); i++) name = `${found.field.name}_copy${i}`
      const clone: BuilderField = {
        ...found.field,
        // A copy is a NEW field. Carrying the original's rename trail would tell
        // the planner to rename a column that the original still holds.
        previousName: undefined,
        key: newKey(),
        name: found.field.name ? name : '',
        label: found.field.label ? `${found.field.label} (copy)` : '',
        config: JSON.parse(JSON.stringify(found.field.config ?? {})),
      }
      const list = [...state[found.stage]]
      list.splice(found.index + 1, 0, clone)
      return { ...state, [found.stage]: list }
    }
    case 'REMOVE_FIELD':
      return {
        ...state,
        main: state.main.filter((f) => f.key !== action.key),
        sidebar: state.sidebar.filter((f) => f.key !== action.key),
      }
    case 'SET_META': {
      const next = { ...state, ...action.patch, id: state.id || (action.patch.name ? `oty_${action.patch.name}` : state.id) }
      if (typeof action.patch.name === 'string' && action.patch.name !== state.name && state.name) {
        const trail = recordRename(state.previousName, state.name, action.patch.name)
        if (trail) next.previousName = trail
        else delete next.previousName
      }
      return next
    }
    default:
      return state
  }
}

/** Serialize the model to an object-type definition for the write API. */
export function toObjectType(m: BuilderModel) {
  const toField = (f: BuilderField) => ({
    id: `fld_${f.name}`,
    name: f.name,
    // Explicit rename intent, straight into the schema file. Absent when there
    // is none, so an untouched schema file does not grow a new key.
    ...(f.previousName?.length ? { previousName: f.previousName } : {}),
    label: f.label,
    fieldType: f.fieldType,
    // Width rides in config.admin.width (the shape the field model reads).
    config: { ...f.config, ...(f.width && f.width !== 'full' ? { admin: { ...(f.config.admin as object ?? {}), width: f.width } } : {}) },
    required: f.required,
    ...(f.disabled ? { disabled: true } : {}),
  })
  return {
    id: m.id || `oty_${m.name}`,
    name: m.name,
    ...(m.previousName?.length ? { previousName: m.previousName } : {}),
    label: m.label,
    ...(m.plural?.trim() ? { plural: m.plural.trim() } : {}),
    ...(m.disabled ? { disabled: true } : {}),
    ...(m.singleton ? { singleton: true } : {}),
    ...(m.localized ? { localized: true } : {}),
    fields: [...m.main, ...m.sidebar].map(toField),
    admin: {
      ...(m.description ? { description: m.description } : {}),
      ...(m.icon ? { menu: { icon: m.icon } } : {}),
      ...(m.taxonomy && (m.taxonomy.hierarchical || m.taxonomy.orderable || m.taxonomy.parentType)
        ? { taxonomy: {
            ...(m.taxonomy.hierarchical ? { hierarchical: true } : {}),
            ...(m.taxonomy.orderable ? { orderable: true } : {}),
            ...(m.taxonomy.parentType ? { parentType: m.taxonomy.parentType } : {}),
          } }
        : {}),
      editorView: {
        main: m.main.map((f) => f.name),
        sidebar: m.sidebar.map((f) => f.name),
      },
    },
  }
}

/**
 * Mandatory-value check for ONE field: name + label present, name not colliding with
 * `otherNames`, and type-required config set (relation target, select/multiselect options
 * unless dynamic). Used by the field-config Sheet's Done button AND validateBuilderModel,
 * so both layers enforce the same rules.
 */
export function validateBuilderField(
  f: Pick<BuilderField, 'name' | 'label' | 'fieldType' | 'config'>,
  otherNames: ReadonlySet<string> = new Set(),
  opts: { checkReserved?: boolean; sheetLevel?: boolean } = {},
): string[] {
  const problems: string[] = []
  const who = f.label?.trim() || f.name?.trim() || `(${f.fieldType})`
  if (!f.name?.trim()) problems.push(`Field ${who} needs a name (code id)`)
  // Only content-type fields become table columns; component/global fields live in
  // jsonb, so a "title" sub-field there is fine.
  else if (opts.checkReserved && RESERVED_FIELD_NAMES.has(f.name)) problems.push(`"${f.name}" is a system column (every type already has it) - pick another name`)
  else if (otherNames.has(f.name)) problems.push(`Duplicate field name "${f.name}"`)
  if (!f.label?.trim()) problems.push(`Field ${who} needs a label`)
  const cfg = (f.config ?? {}) as Record<string, any>
  if (f.fieldType === 'relation' && !cfg.targetType?.trim?.()) {
    problems.push(`Relation ${who} needs a target type`)
  }
  if (f.fieldType === 'range') {
    const v = (cfg.validation ?? {}) as { min?: number; max?: number }
    if (typeof v.min !== 'number' || typeof v.max !== 'number') problems.push(`Range ${who} needs Minimum and Maximum`)
    else if (v.min >= v.max) problems.push(`Range ${who}: Minimum must be below Maximum`)
  }
  // Container emptiness only blocks the SAVE — the Sheet's Done must let you close and
  // reach the Manage Fields modal (fields are added there, not in the Sheet).
  if (!opts.sheetLevel) {
    if (f.fieldType === 'repeater' && !(Array.isArray(cfg.fields) && cfg.fields.length > 0)) {
      problems.push(`Repeater ${who} needs at least one row field (use Manage Fields on its card)`)
    }
    if (f.fieldType === 'group' && !(Array.isArray(cfg.groupFields) && cfg.groupFields.length > 0)) {
      problems.push(`Group ${who} needs at least one field (use Manage Fields on its card)`)
    }
    if (f.fieldType === 'component' && !(Array.isArray(cfg.components) && cfg.components.length > 0)) {
      problems.push(`Component field ${who} needs at least one component (use Manage Fields on its card)`)
    }
  }
  if ((f.fieldType === 'select' || f.fieldType === 'multiselect') && cfg.optionsSource !== 'dynamic') {
    if (!(Array.isArray(cfg.options) && cfg.options.length > 0)) {
      problems.push(`${f.fieldType === 'select' ? 'Select' : 'Multiselect'} ${who} needs at least one option`)
    } else if (cfg.options.some((o: { value?: string }) => !o?.value?.trim?.())) {
      problems.push(`${who}: every option needs a value (labels are optional)`)
    }
  }
  return problems
}

/**
 * Mandatory-value check before save: the schema needs a name + label, and every field
 * passes validateBuilderField. Returns human-readable problems ([] = ok).
 */
export function validateBuilderModel(m: BuilderModel, opts: { checkReserved?: boolean; requireFields?: boolean } = {}): string[] {
  const problems: string[] = []
  if (!m.name?.trim()) problems.push('Give the schema a name (code id)')
  if (!m.label?.trim()) problems.push('Give the schema a label')
  if (opts.requireFields && m.main.length + m.sidebar.length === 0) {
    problems.push('Add at least one field')
  }
  const seen = new Set<string>()
  for (const f of [...m.main, ...m.sidebar]) {
    problems.push(...validateBuilderField(f, seen, opts))
    if (f.name?.trim()) seen.add(f.name)
    // Containers: their sub-field trees must be valid too (the modal validates on
    // Done; this is the save-time backstop).
    const cfg = (f.config ?? {}) as Record<string, unknown>
    const label = f.label || f.name || f.fieldType
    if (f.fieldType === 'repeater') problems.push(...validateSubFields(cfg.fields as never, label))
    if (f.fieldType === 'group') problems.push(...validateSubFields(cfg.groupFields as never, label))
    if (f.fieldType === 'component') problems.push(...validateComponentRefs(cfg.components as never))
  }
  // Group sub-fields are stored as flat columns, so they share the type's namespace
  // with the top-level fields (and with each other). The write API refuses the same
  // collisions with the same words; catching it here keeps the Save button honest.
  for (const [name, owners] of groupMemberNames([...m.main, ...m.sidebar])) {
    const top = seen.has(name) ? ['as a top-level field'] : []
    const decls = [...top, ...owners.map((g) => `inside group "${g}"`)]
    if (decls.length < 2) continue
    const joined = decls.length === 2 ? decls.join(' and ') : `${decls.slice(0, -1).join(', ')} and ${decls[decls.length - 1]}`
    problems.push(`"${name}" is declared ${decls.length === 2 ? 'twice' : `${decls.length} times`} - ${joined}. Group fields are stored as flat columns, so a name may appear once per type. Keep one declaration (the group keeps the editor section).`)
  }
  return problems
}

/** Serialize the model to a reusable-component definition (flat field list). */
export function toComponentDef(m: BuilderModel) {
  return {
    name: m.name,
    label: m.label,
    ...(m.description ? { description: m.description } : {}),
    fields: m.main.map((f) => ({
      id: `fld_${f.name}`, name: f.name,
      // A component sub-field is a JSONB key, not a column, so this is not an
      // ALTER instruction: it is the only record that two keys are the same
      // field, and an explicit migration is what acts on it.
      ...(f.previousName?.length ? { previousName: f.previousName } : {}),
      label: f.label, fieldType: f.fieldType, config: { ...f.config }, required: f.required,
    })),
  }
}

/** Parse a reusable-component definition into the builder model (fields in main). */
export function fromComponentDef(def: any): BuilderModel {
  return {
    id: '', name: def?.name ?? '', label: def?.label ?? '', description: def?.description ?? '', icon: '',
    main: (def?.fields ?? []).map((f: any) => ({
      key: newKey(), name: f.name,
      ...(Array.isArray(f.previousName) && f.previousName.length ? { previousName: f.previousName } : {}),
      label: f.label ?? f.name, fieldType: f.fieldType, config: f.config ?? {}, required: !!f.required, width: 'full',
    })),
    sidebar: [],
  }
}

/**
 * Convert an AI-generated draft (GeneratedSchema from /admin/ai/schema-generate) into a
 * builder model. Fields with stage 'sidebar' land in the sidebar (content types); everything
 * else in main — so components/globals (no stage) become a flat single-stage list.
 */
export function fromGeneratedSchema(draft: any): BuilderModel {
  const fields: any[] = Array.isArray(draft?.fields) ? draft.fields : []
  const toField = (f: any): BuilderField => ({
    key: newKey(),
    name: f.name,
    label: f.label ?? f.name,
    fieldType: f.fieldType,
    config: f.config ?? {},
    required: !!f.required,
    width: (['full', 'half', 'third'].includes(f.width) ? f.width : 'full') as Width,
  })
  return {
    id: draft?.name ? `oty_${draft.name}` : '',
    name: draft?.name ?? '',
    label: draft?.label ?? draft?.name ?? '',
    description: draft?.description ?? '',
    icon: draft?.icon ?? '',
    main: fields.filter((f) => f.stage !== 'sidebar').map(toField),
    sidebar: fields.filter((f) => f.stage === 'sidebar').map(toField),
  }
}

/** Serialize the model to a global definition (flat field list + icon/description). */
export function toGlobalDef(m: BuilderModel) {
  return {
    name: m.name,
    label: m.label,
    ...(m.description ? { description: m.description } : {}),
    ...(m.icon ? { icon: m.icon } : {}),
    fields: m.main.map((f) => ({
      id: `fld_${f.name}`, name: f.name,
      // A component sub-field is a JSONB key, not a column, so this is not an
      // ALTER instruction: it is the only record that two keys are the same
      // field, and an explicit migration is what acts on it.
      ...(f.previousName?.length ? { previousName: f.previousName } : {}),
      label: f.label, fieldType: f.fieldType, config: { ...f.config }, required: f.required,
    })),
  }
}

/** Parse a global definition into the builder model (fields in main, no sidebar). */
export function fromGlobalDef(def: any): BuilderModel {
  return {
    id: '', name: def?.name ?? '', label: def?.label ?? '', description: def?.description ?? '', icon: def?.icon ?? '',
    main: (def?.fields ?? []).map((f: any) => ({
      key: newKey(), name: f.name,
      ...(Array.isArray(f.previousName) && f.previousName.length ? { previousName: f.previousName } : {}),
      label: f.label ?? f.name, fieldType: f.fieldType, config: f.config ?? {}, required: !!f.required, width: 'full',
    })),
    sidebar: [],
  }
}

/** Parse an object-type definition back into the builder model. */
export function fromObjectType(def: any): BuilderModel {
  const editor = def?.admin?.editorView ?? {}
  const mainNames: string[] = editor.main ?? []
  const sidebarNames: string[] = editor.sidebar ?? []
  const byName = new Map<string, BuilderField>()
  // The API hands over the FLATTENED field list: a group's sub-fields sit beside the
  // group marker as rows of their own (they are real columns). Only the group is a
  // declaration here - re-adding its members as top-level fields is how a saved
  // schema grew `metaTitle` twice (once in `seo`, once flat) and broke the next push.
  const claimed = groupMemberNames(def?.fields)
  for (const f of def?.fields ?? []) {
    if (f.group || claimed.has(f.name)) continue
    byName.set(f.name, {
      key: newKey(),
      name: f.name,
      ...(Array.isArray(f.previousName) && f.previousName.length ? { previousName: f.previousName } : {}),
      label: f.label ?? f.name,
      fieldType: f.fieldType,
      config: f.config ?? {},
      required: !!f.required,
      ...(f.disabled ? { disabled: true } : {}),
      width: ((f.config?.admin?.width as Width) ?? 'full'),
    })
  }
  const pick = (names: string[]) => names.map((n) => byName.get(n)).filter(Boolean) as BuilderField[]
  const placed = new Set([...mainNames, ...sidebarNames])
  // Fields not referenced by editorView default to the main stage.
  const orphans = [...byName.values()].filter((f) => !placed.has(f.name))
  return {
    id: def?.id ?? (def?.name ? `oty_${def.name}` : ''),
    name: def?.name ?? '',
    // A pending rename lives in the schema file, so it survives a reload, a
    // restart and a second developer. The builder key never could.
    ...(Array.isArray(def?.previousName) && def.previousName.length ? { previousName: def.previousName } : {}),
    label: def?.label ?? '',
    plural: def?.plural ?? '',
    disabled: def?.disabled === true,
    singleton: def?.singleton === true,
    localized: (def as { localized?: boolean } | undefined)?.localized === true,
    taxonomy: def?.admin?.taxonomy,
    description: def?.admin?.description ?? '',
    icon: (typeof def?.admin?.menu?.icon === 'string' ? def.admin.menu.icon : '') ?? '',
    main: [...pick(mainNames), ...orphans],
    sidebar: pick(sidebarNames),
  }
}

/**
 * Relation fields elsewhere that target `typeName` — "type.field" labels for the
 * delete dialog: deleting the type DETACHES these (their columns + values drop too).
 */
export function referringRelationFields(
  types: Array<{ name: string; fields?: Array<{ name: string; fieldType: string; config?: Record<string, unknown> }> }>,
  typeName: string,
  registry: Array<{ name: string; fields?: Array<{ name: string; fieldType: string; config?: Record<string, unknown> }> }> = [],
): string[] {
  const out: string[] = []
  const subRefs = (fields: Array<{ name: string; fieldType: string; config?: Record<string, unknown> }> | undefined, label: (sub: string) => string) => {
    for (const sf of fields ?? []) {
      if (sf.fieldType === 'relation' && (sf.config as { targetType?: string } | undefined)?.targetType === typeName) out.push(label(sf.name))
    }
  }
  for (const t of types) {
    if (t.name === typeName) continue
    for (const f of t.fields ?? []) {
      if (f.fieldType === 'relation' && (f.config as { targetType?: string } | undefined)?.targetType === typeName) {
        out.push(`${t.name}.${f.name}`)
      } else if (f.fieldType === 'component') {
        // inline defs only — registry components are listed once, below
        for (const ref of ((f.config as { components?: unknown })?.components ?? []) as Array<string | { name: string; fields?: never[] }>) {
          if (typeof ref === 'string' || !ref) continue
          subRefs((ref as { fields?: never[] }).fields, (sub) => `${t.name}.${f.name}:${(ref as { name: string }).name}.${sub}`)
        }
      }
    }
  }
  // Reusable components — detaching edits them EVERYWHERE they're used.
  for (const comp of registry) {
    subRefs(comp.fields, (sub) => `${comp.name}.${sub} (component - edits it everywhere it's used)`)
  }
  return out
}

/**
 * Validate a container's sub-field tree (repeater rows, group fields, component
 * fields) — the same per-field rules as top-level, plus per-level duplicate names,
 * recursing into nested containers. `at` prefixes problems ("Gallery › Caption …").
 */
export function validateSubFields(
  fields: Array<Record<string, unknown>> | undefined,
  at = '',
): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const sf of fields ?? []) {
    const f = {
      name: (sf.name as string) ?? '',
      label: (sf.label as string) ?? '',
      fieldType: (sf.fieldType as string) ?? 'text',
      config: (sf.config as Record<string, unknown>) ?? {},
    }
    const prefix = at ? `${at} › ` : ''
    for (const p of validateBuilderField(f, seen)) problems.push(`${prefix}${p}`)
    if (f.name?.trim()) seen.add(f.name)
    const cfg = f.config as { fields?: Array<Record<string, unknown>>; groupFields?: Array<Record<string, unknown>> }
    const label = f.label || f.name || f.fieldType
    if (f.fieldType === 'repeater') problems.push(...validateSubFields(cfg.fields, `${prefix}${label}`))
    if (f.fieldType === 'group') problems.push(...validateSubFields(cfg.groupFields, `${prefix}${label}`))
  }
  return problems
}

/**
 * Validate a component field's refs: inline components need label + block id (unique
 * among the field's components) and a valid field tree; reusable names pass through.
 */
export function validateComponentRefs(
  refs: Array<string | Record<string, unknown>> | undefined,
): string[] {
  const problems: string[] = []
  const names = new Set<string>()
  for (const r of refs ?? []) {
    if (typeof r === 'string') { names.add(r); continue }
    const label = (r.label as string) || '(unnamed component)'
    if (!(r.label as string)?.trim()) problems.push('An inline component needs a label')
    if (!(r.name as string)?.trim()) problems.push(`Component ${label} needs a block id`)
    else if (names.has(r.name as string)) problems.push(`Duplicate component id "${r.name}"`)
    else names.add(r.name as string)
    const cfields = (r.fields as Array<Record<string, unknown>>) ?? []
    if (cfields.length === 0) problems.push(`Component ${label} needs at least one field`)
    problems.push(...validateSubFields(cfields, label))
  }
  return problems
}
