/**
 * File Name: binding.ts
 * Purpose: The AUTHORING model for data binding - which kit props may read
 *          from a loop record, whether the selected block sits inside a
 *          kit.loop item template (and against which collection), which
 *          source fields the picker may offer, and the descriptor read/
 *          write helpers the "Connect Data" control uses.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The RUNTIME half - resolving a descriptor against a
 *          record - lives in @tangen/studio-react (src/binding.ts), which
 *          carries zero dependencies by contract and so cannot import this.
 *          Only the tiny `{ $bind, fallback }` shape is common to both;
 *          each side owns its half (mirroring precedent: the AI coerce
 *          schema merge). Bindable props are a deliberate WHITELIST, not
 *          "every text prop": binding a token or visibility prop would put
 *          layout decisions in content, which is exactly the line Studio
 *          holds.
 */
import type { StudioBlock } from './ops'

/** A prop that reads from the current loop record instead of a fixed value. */
export type BindingDescriptor = { $bind: string; fallback?: unknown }

/** The binding root a loop item template exposes. */
const ROOT = 'item'

/**
 * Content props that may bind, per kit type. Style, layout, and visibility
 * props are deliberately absent - a record supplies COPY and MEDIA, never
 * how the page is laid out.
 */
export const BINDABLE_PROPS: Record<string, string[]> = {
  'kit.heading': ['text'],
  'kit.text': ['body'],
  'kit.image': ['image', 'alt'],
  'kit.video': ['url'],
  'kit.form': ['formSlug'],
}

/** Repeater row props that may bind, keyed `<type>.<repeaterProp>`. */
const BINDABLE_REPEATER_PROPS: Record<string, string[]> = {
  'kit.buttons.items': ['label', 'href'],
}

/** True when this prop of this block type may carry a binding. */
export function isBindableProp(type: string, prop: string): boolean {
  return (BINDABLE_PROPS[type] ?? []).includes(prop)
}

/** The bindable props of one repeater's rows; empty when it is not bindable. */
export function bindableRepeaterProps(type: string, repeaterProp: string): string[] {
  return BINDABLE_REPEATER_PROPS[`${type}.${repeaterProp}`] ?? []
}

/** The loop a selected block renders inside, if any. */
export interface LoopContext {
  /** `_key` of the enclosing kit.loop. */
  loopKey: string
  /** The loop's collection; empty string when not chosen yet. */
  source: string
}

/**
 * Finds the kit.loop whose item template contains `key`, searching the whole
 * tree. Returns null for blocks outside any loop and for a loop block itself
 * (a loop configures its own query; it does not bind to its own rows).
 * Junk-tolerant: non-arrays and non-object entries are skipped, matching the
 * rest of Studio's half-written-draft tolerance.
 */
export function findLoopContext(blocks: StudioBlock[], key: string): LoopContext | null {
  function walk(list: unknown, loop: LoopContext | null): LoopContext | null {
    if (!Array.isArray(list)) return null
    for (const raw of list) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const block = raw as StudioBlock
      // A loop block itself belongs to its PARENT context, not its own.
      if (block._key === key) return loop
      const inner: LoopContext | null =
        block._type === 'kit.loop'
          ? { loopKey: typeof block._key === 'string' ? block._key : '', source: typeof block.source === 'string' ? block.source : '' }
          : loop
      for (const value of Object.values(block)) {
        if (!Array.isArray(value)) continue
        // Only child BLOCK arrays descend; repeater rows have no _type.
        const found = walk(value, inner)
        if (found !== null) return found
      }
    }
    return null
  }
  // A found-but-not-in-a-loop hit and a not-found miss both read as null, so
  // the walk returns the context only when the key actually resolved.
  if (!Array.isArray(blocks)) return null
  return walk(blocks, null)
}

/** Builds a descriptor for one source field, rooted at the item context. */
export function makeBinding(path: string, fallback?: unknown): BindingDescriptor {
  return fallback === undefined ? { $bind: `${ROOT}.${path}` } : { $bind: `${ROOT}.${path}`, fallback }
}

/** The bound source path, or null when the value is static / foreign-rooted. */
export function boundPath(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const bind = (value as BindingDescriptor).$bind
  if (typeof bind !== 'string') return null
  const prefix = `${ROOT}.`
  return bind.startsWith(prefix) && bind.length > prefix.length ? bind.slice(prefix.length) : null
}

/** One source field offered in the picker. */
export interface SourceField {
  name: string
  label: string
  fieldType: string
}

/** Field types with no single value to bind - containers, not content. */
const NOT_BINDABLE_TYPES = new Set(['component', 'repeater', 'group', 'object'])

/**
 * The fields of the loop's collection a prop may bind to: scalars and media,
 * never containers. Relations stay bindable - depth-expanded records read
 * through dotted paths (`item.author.name`).
 */
export function bindableSourceFields(fields: SourceField[] | undefined): SourceField[] {
  return (fields ?? [])
    .filter((f) => !NOT_BINDABLE_TYPES.has(f.fieldType))
    .map((f) => ({ name: f.name, label: f.label || f.name, fieldType: f.fieldType }))
}
