/**
 * File Name: components.ts
 * Purpose: SB-8 — reusable components. `defineComponent` authors a component
 *   definition (for `app/components/<name>/schema.ts`); `resolveComponentRefs`
 *   expands **name** references against the workspace's component registry while
 *   leaving inline objects untouched; `resolveSchemaComponentRefs` applies that
 *   across every component field in a schema (including those nested inside
 *   repeater / group / component containers) at load time, so all downstream
 *   consumers see fully-resolved `ComponentDef`s.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types (ComponentDef); pure — no I/O.
 */
import type { ComponentDef, SubField } from '@tangen/types'
import { normalizeSubField } from './define-object-type'

/** A component field's `config.components` entry: a registry name, or an inline def. */
export type ComponentRef = string | ComponentDef

/** Author a reusable component definition. Sub-fields are normalized (every one
 *  gets a `config`, selects default to a static options source) so a config-less
 *  sub-field can't reach the admin renderer — same guarantee as inline blocks. */
export function defineComponent(def: ComponentDef): ComponentDef {
  return { ...def, fields: (def.fields ?? []).map(normalizeSubField) as SubField[] }
}

/**
 * Expand a list of component refs: a **string** resolves to the registry
 * component of that name (throws if absent); an **object** is kept inline
 * (schema-specific).
 */
export function resolveComponentRefs(refs: ComponentRef[], registry: ComponentDef[]): ComponentDef[] {
  return refs.map((ref) => {
    if (typeof ref !== 'string') return ref
    const found = registry.find((c) => c.name === ref)
    if (!found) {
      throw new Error(`Unknown reusable component "${ref}" - not found in the component registry (app/components).`)
    }
    return found
  })
}

type AnyField = { fieldType?: string; config?: Record<string, unknown>; [k: string]: unknown }

/** Recursively resolve component refs on component fields, descending containers. */
function resolveFields(fields: AnyField[], registry: ComponentDef[]): AnyField[] {
  return fields.map((f) => {
    const cfg = (f.config ?? {}) as Record<string, any>
    if (f.fieldType === 'component' && Array.isArray(cfg.components)) {
      const resolved = resolveComponentRefs(cfg.components as ComponentRef[], registry)
        .map((c) => ({ ...c, fields: resolveFields((c.fields ?? []) as unknown as AnyField[], registry) as any }))
      return { ...f, config: { ...cfg, components: resolved } }
    }
    if (f.fieldType === 'repeater' && Array.isArray(cfg.fields)) {
      return { ...f, config: { ...cfg, fields: resolveFields(cfg.fields as AnyField[], registry) } }
    }
    if (f.fieldType === 'group' && Array.isArray(cfg.groupFields)) {
      return { ...f, config: { ...cfg, groupFields: resolveFields(cfg.groupFields as AnyField[], registry) } }
    }
    return f
  })
}

/** Resolve every component field's name refs across a schema against the registry. */
export function resolveSchemaComponentRefs<T extends { fields: any[] }>(schema: T[], registry: ComponentDef[]): T[] {
  if (!registry.length && !schema.some((t) => t.fields?.some((f: AnyField) => f.fieldType === 'component'))) {
    return schema
  }
  return schema.map((type) => ({ ...type, fields: resolveFields(type.fields as AnyField[], registry) }))
}
