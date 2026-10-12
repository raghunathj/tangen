/**
 * File Name: style-value.ts
 * Purpose: The stored shape of ONE style property across breakpoints and
 *          states, and the inheritance chain for reading it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Lives in the shared package because the emitter, the
 *          admin panel and the porter all read it - three implementations of
 *          this cascade would be three chances to disagree.
 *
 *          Both dimensions are here from the start ON PURPOSE. Adding states
 *          or breakpoints later would change the shape underneath a live
 *          panel and a live stylesheet, which is exactly the rewrite this
 *          module exists to avoid.
 *
 *          Desktop-first, cascading DOWN: `base` is desktop and every
 *          narrower breakpoint inherits from the next wider one, matching
 *          Webflow and the `max-width` media queries the emitter writes.
 */

/** Widest to narrowest - the inheritance order, and the emission order. */
export const BREAKPOINTS = ['base', 'tablet', 'mobile'] as const
export type Breakpoint = (typeof BREAKPOINTS)[number]

/** `normal` is the absence of a state, not a selector. */
export const STATES = ['normal', 'hover', 'focus'] as const
export type StyleState = (typeof STATES)[number]

/** Per-breakpoint values for one state. */
export type StateValue = Partial<Record<Breakpoint, string>>

export interface PropValue extends StateValue {
  hover?: StateValue
  focus?: StateValue
}

/** A plain string is shorthand for `{ base }` - the overwhelming common case. */
export type StoredValue = string | PropValue

export interface ValueAt {
  state?: StyleState
  breakpoint?: Breakpoint
}

/** Narrowest-first lookup order for a breakpoint: itself, then wider. */
function chain(breakpoint: Breakpoint): Breakpoint[] {
  const at = BREAKPOINTS.indexOf(breakpoint)
  // BREAKPOINTS is widest-first, so walking backwards from `at` gives
  // mobile -> tablet -> base.
  return BREAKPOINTS.slice(0, at + 1).reverse()
}

function asObject(value: StoredValue | undefined): PropValue | null {
  if (typeof value === 'string') return { base: value }
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  return null
}

function stateBag(value: PropValue, state: StyleState): StateValue {
  if (state === 'normal') return value
  const bag = value[state]
  return bag && typeof bag === 'object' && !Array.isArray(bag) ? bag : {}
}

function pick(bag: StateValue, breakpoint: Breakpoint): string | undefined {
  for (const bp of chain(breakpoint)) {
    const v = bag[bp]
    if (typeof v === 'string' && v !== '') return v
  }
  return undefined
}

/**
 * The value that applies at a state and breakpoint. A state inherits within
 * itself first, then falls back to `normal` - without that, a button with a
 * hover set on only one property would lose every other value on hover.
 */
export function readValue(value: StoredValue | undefined, at: ValueAt): string | undefined {
  const obj = asObject(value)
  if (!obj) return undefined
  const breakpoint = at.breakpoint ?? 'base'
  const state = at.state ?? 'normal'

  const own = pick(stateBag(obj, state), breakpoint)
  if (own !== undefined) return own
  return state === 'normal' ? undefined : pick(obj, breakpoint)
}

/** True when a value is set HERE rather than inherited - the indicator dot. */
export function hasOverride(value: StoredValue | undefined, at: ValueAt): boolean {
  const obj = asObject(value)
  if (!obj) return false
  const bag = stateBag(obj, at.state ?? 'normal')
  const v = bag[at.breakpoint ?? 'base']
  return typeof v === 'string' && v !== ''
}

/**
 * Collapses a value back to its simplest form: a plain string when only base
 * is set, and undefined when nothing is. Keeping the common case a string
 * means stored pages stay readable and the emitter keeps a fast path.
 */
export function normalizeValue(value: StoredValue | undefined): StoredValue | undefined {
  const obj = asObject(value)
  return obj ? normalize(obj) : undefined
}

function normalize(value: PropValue): StoredValue | undefined {
  const out: PropValue = {}
  for (const bp of BREAKPOINTS) {
    const v = value[bp]
    if (typeof v === 'string' && v !== '') out[bp] = v
  }
  for (const state of ['hover', 'focus'] as const) {
    const bag = value[state]
    if (!bag) continue
    const kept: StateValue = {}
    for (const bp of BREAKPOINTS) {
      const v = bag[bp]
      if (typeof v === 'string' && v !== '') kept[bp] = v
    }
    if (Object.keys(kept).length > 0) out[state] = kept
  }

  const keys = Object.keys(out)
  if (keys.length === 0) return undefined
  if (keys.length === 1 && keys[0] === 'base') return out.base
  return out
}

/** Sets one value. An empty string clears that slot. */
export function writeValue(
  value: StoredValue | undefined,
  at: ValueAt,
  next: string,
): StoredValue | undefined {
  const obj = asObject(value)
  const breakpoint = at.breakpoint ?? 'base'
  const state = at.state ?? 'normal'
  const clean = String(next ?? '').trim()

  // Copied, never mutated: callers hold the previous value for undo.
  const draft: PropValue = { ...(obj ?? {}) }
  if (state === 'normal') {
    if (clean === '') delete draft[breakpoint]
    else draft[breakpoint] = clean
  } else {
    const bag: StateValue = { ...(draft[state] ?? {}) }
    if (clean === '') delete bag[breakpoint]
    else bag[breakpoint] = clean
    draft[state] = bag
  }
  return normalize(draft)
}

/** Removes one override so the value falls back to what it inherits. */
export function clearValue(value: StoredValue | undefined, at: ValueAt): StoredValue | undefined {
  return writeValue(value, at, '')
}
