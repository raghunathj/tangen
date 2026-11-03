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

/**
 * The presentation controls the PLATFORM owns, for a project to spread.
 *
 * Only two, and both earn it by being universal rather than a design decision:
 * an anchor id is a DOM id and a URL fragment, and a class list is the one
 * escape hatch that cannot misbehave. Which tones or spacing steps exist is a
 * project's business and belongs in the project.
 *
 * A project SPREADS this into the blocks that want it, usually through one
 * shared function of its own, so a block's schema file says what the block
 * has. Nothing injects it: a file that lists six fields while the block has
 * ten is how an author loses track of their own component.
 *
 * Both sit in `advanced`, which is where Gutenberg puts an HTML anchor and
 * additional CSS classes too. A class list is applied VERBATIM and never
 * parsed back, the same contract Studio gives its escape-hatch classes: a
 * class that does not exist simply does nothing, which is what separates this
 * from a free-form stylesheet field.
 *
 * A function, not a const: these objects are handed to every block in a
 * workspace, and one shared instance would let any consumer's mutation reach
 * all of them.
 */
export function blockPresentationFields(): SubField[] {
  return [
    {
      name: 'anchorId', label: 'Anchor ID', fieldType: 'text', group: 'advanced',
      config: {
        validation: { pattern: '^[a-z][a-z0-9-]*$' },
        admin: { width: 'half', helpText: 'For in-page links: /about#our-work. Lowercase and hyphens.' },
      },
    },
    {
      name: 'className', label: 'CSS classes', fieldType: 'text', group: 'advanced',
      config: {
        // A NEGATED set, deliberately. The value is rendered into a class
        // attribute, so what matters is that it cannot close that attribute or
        // open a tag - not that it matches some allow-list of utility syntax
        // we would get wrong (arbitrary values, fractions, `!` prefixes all
        // have to keep working).
        validation: { pattern: '^[^"\'<>\n\r]*$' },
        admin: { width: 'half', helpText: 'Design-system utility classes, applied as written. Unknown classes do nothing.' },
      },
    },
  ]
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
