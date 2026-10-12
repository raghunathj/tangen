/**
 * File Name: define-object-type.ts
 * Purpose: Exports defineObjectType — the primary authoring function for declaring CMS content types with full TypeScript safety, field flattening, and name validation.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends on @tangen/types for ObjectTypeDefinition, FieldDefinition, FieldInput, and AdminConfig. Group sub-fields are flattened here so the CLI migration diff sees them as real columns.
 */
import type { ObjectTypeDefinition, FieldDefinition, FieldInput, StrictFieldInput, ValidateFields, AdminConfig } from '@tangen/types'

const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/

/**
 * Repeater/component sub-fields are authored as raw objects, not through the
 * `field.*` builders, so they miss the builders' defaults — including a `config`
 * object at all. Give every sub-field a `config`, default select-like sub-fields
 * to a static options source (what `field.select` injects), and recurse into
 * nested repeaters/component blocks. This guarantees downstream code (the admin
 * renderer, validation, GraphQL) never meets an undefined sub-field config —
 * closing the class of "config-less sub-field crashes the editor" bug.
 */
export function normalizeSubField(sf: unknown): unknown {
  if (!sf || typeof sf !== 'object') return sf   // string component-refs pass through
  const src = sf as { fieldType?: string; config?: Record<string, unknown> }
  const config: Record<string, unknown> = { ...(src.config ?? {}) }
  if ((src.fieldType === 'select' || src.fieldType === 'multiselect')
    && config.optionsSource == null && typeof config.options !== 'function') {
    config.optionsSource = 'static'
  }
  return { ...src, config: normalizeContainerConfig(config) }
}

/** Normalize the sub-fields nested inside a container field's config
 *  (repeater `fields`, component `components[].fields`, group `groupFields`). */
function normalizeContainerConfig(config: unknown): Record<string, unknown> {
  const next = { ...((config as Record<string, unknown>) ?? {}) }
  if (Array.isArray(next.fields)) next.fields = next.fields.map(normalizeSubField)
  if (Array.isArray(next.groupFields)) next.groupFields = next.groupFields.map(normalizeSubField)
  if (Array.isArray(next.components)) {
    next.components = next.components.map((c: unknown) =>
      c && typeof c === 'object' && Array.isArray((c as { fields?: unknown[] }).fields)
        ? { ...(c as object), fields: (c as { fields: unknown[] }).fields.map(normalizeSubField) }
        : c)
  }
  return next
}

/**
 * Define an object type with full TypeScript safety.
 *
 * Field names are the keys of the `fields` object — VS Code validates admin
 * config references and provides autocomplete against them automatically.
 *
 * @example
 * defineObjectType({
 *   name: 'post',
 *   fields: {
 *     title: field.text({ label: 'Title' }),
 *     body:  field.richtext({ label: 'Body' }),
 *   },
 *   admin: {
 *     editorView: { main: ['body'], sidebar: ['title'] },  // ✓ both keys exist
 *     listView:   { columns: ['nonExistent'] },            // ✗ TS error + red squiggly
 *   },
 * })
 */
/**
 * Column names every content table already owns (codegen's systemCols()). A
 * user field with one of these names used to type-check clean and then die at
 * the DDL with a raw `column "slug" specified more than once` - long after
 * the mistake, with no mention of which field caused it (finding #6).
 */
const RESERVED_FIELD_NAMES = new Set([
  'id', 'workspaceId', 'title', 'slug', 'status',
  'publishedAt', 'publishedBy', 'publishedValues', 'scheduledAt',
  'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
])

type GroupSubField = { name?: string; fieldType?: string; config?: { groupFields?: unknown[] } }

/** Every sub-field declared under a group, recursing into nested groups. */
function* walkGroupSubFields(group: GroupSubField): Generator<GroupSubField> {
  for (const sf of (group.config?.groupFields ?? []) as GroupSubField[]) {
    if (!sf || typeof sf !== 'object') continue
    yield sf
    if (sf.fieldType === 'group') yield* walkGroupSubFields(sf)
  }
}

/**
 * Flattens group sub-fields into the field list, beside their group marker -
 * the ONE place that expansion lives. Group sub-fields are stored as flat
 * columns: codegen, diff, apply and every API surface read `type.fields` and
 * skip only the `group` markers (`flattenFields` in @tangen/types), so the
 * sub-fields must be present as entries of their own. Each copy carries
 * `group: <group name>`, which is what keeps it distinguishable from a field
 * declared at the top level under the same name (a column collision -
 * validateColumnNamespace reports those). Nested groups flatten to the top as
 * well. Idempotent: a list that already carries a group's copies is returned
 * with nothing added, so callers need not know whether their input came
 * straight from a declaration or from defineObjectType.
 */
export function flattenGroupFields(fields: readonly FieldDefinition[]): FieldDefinition[] {
  const out: FieldDefinition[] = []
  const key = (group: string, name: string) => `${group}/${name}`
  const present = new Set(fields.filter((f) => f.group).map((f) => key(f.group!, f.name)))
  const expand = (group: FieldDefinition) => {
    for (const sf of (group.config as { groupFields?: unknown[] } | undefined)?.groupFields ?? []) {
      if (!sf || typeof sf !== 'object' || typeof (sf as { name?: unknown }).name !== 'string') continue
      const copy: FieldDefinition = { ...(sf as FieldDefinition), group: group.name }
      if (!present.has(key(group.name, copy.name))) out.push(copy)
      if (copy.fieldType === 'group') expand(copy)
    }
  }
  for (const f of fields) {
    out.push(f)
    // A flattened copy of a nested group was expanded along with its parent.
    if (f.fieldType === 'group' && !f.group) expand(f)
  }
  return out
}

function assertNotReserved(typeName: string, fieldName: string): void {
  if (RESERVED_FIELD_NAMES.has(fieldName)) {
    throw new Error(
      `Type "${typeName}": field "${fieldName}" is built in - every content type `
      + `already has it (title and slug are editable in the admin; the rest are `
      + `system columns). Remove the declaration, or pick another name.`,
    )
  }
}

export function defineObjectType<
  // The self-referential constraint (F must satisfy ValidateFields<F>) re-resolves each
  // field to its exact per-fieldType shape, so a built-in field's config is excess-checked
  // against its OWN interface — a foreign key like `targetType` on `richtext` is a compile
  // error instead of being swallowed by the loose custom fallback. Keeping `fields: F`
  // (not the mapped type) preserves clean literal inference. See StrictFieldOf.
  F extends ValidateFields<F> & Record<string, StrictFieldInput>,
>(
  def: Omit<ObjectTypeDefinition, 'fields' | 'admin'> & {
    fields: F
    admin?: AdminConfig<keyof F & string>
  }
): ObjectTypeDefinition {
  if (!def.name || !NAME_RE.test(def.name)) {
    throw new Error(
      `Invalid type name "${def.name}": must start with a letter and contain only letters, numbers, underscores, or hyphens (e.g. "post", "blogPost", "blog-post")`
    )
  }

  const fields: FieldDefinition[] = []
  for (const [name, f] of Object.entries(def.fields)) {
    assertNotReserved(def.name, name)
    const def_: FieldDefinition = {
      name,
      label: f.label,
      helpText: f.helpText,
      fieldType: f.fieldType,
      config: normalizeContainerConfig(f.config ?? {}) as FieldDefinition['config'],
      previousName: f.previousName ?? [],
      required: f.required ?? false,
      ...(f.disabled ? { disabled: true } : {}),
      // Code-side behavior — carried in-process, stripped by push's JSON boundary
      ...(f.hooks ? { hooks: f.hooks } : {}),
      ...(f.validate ? { validate: f.validate } : {}),
      ...(f.dynamicOptions ? { dynamicOptions: f.dynamicOptions } : {}),
    }
    fields.push(def_)
    // Group sub-fields are stored in config.groupFields for UI purposes, but they
    // also need to be present as flat entries so the CLI diff sees them as real
    // columns - see flattenGroupFields, the one place that expansion lives.
    if (f.fieldType === 'group') {
      for (const sf of walkGroupSubFields(def_ as GroupSubField)) assertNotReserved(def.name, sf.name ?? '')
    }
  }
  const flattened = flattenGroupFields(fields)

  // Orderable taxonomies need a numeric sort column. Auto-provide a hidden
  // `position` field so users (and the GUI builder) don't hand-add it — the
  // drag-to-reorder UI PATCHes it and push creates the column.
  const orderable = (def.admin as { taxonomy?: { orderable?: boolean } } | undefined)?.taxonomy?.orderable === true
  if (orderable && !flattened.some((f) => f.name === 'position')) {
    flattened.push({
      name: 'position',
      label: 'Position',
      fieldType: 'number',
      config: { admin: { hidden: true }, validation: { integer: true, min: 0 } },
      previousName: [],
      required: false,
    } as FieldDefinition)
  }

  // Hierarchical taxonomies need a self-referential `parent` relation — it's what
  // drives the tree browser and the editor's tree-select parent picker. Auto-provide
  // it (mirroring `position` above) so neither the GUI builder nor code-first users
  // have to hand-wire the self relation. A manually-declared `parent` is respected.
  const hierarchical = (def.admin as { taxonomy?: { hierarchical?: boolean } } | undefined)?.taxonomy?.hierarchical === true
  if (hierarchical && !flattened.some((f) => f.name === 'parent')) {
    flattened.push({
      name: 'parent',
      label: 'Parent',
      fieldType: 'relation',
      config: { targetType: def.name, many: false },
      previousName: [],
      required: false,
    } as FieldDefinition)
  }

  return {
    ...def,
    fields: flattened,
    singleton: def.singleton ?? false,
    previousName: def.previousName ?? [],
  } as ObjectTypeDefinition
}
