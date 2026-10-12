/**
 * File Name: provenance.ts
 * Purpose: Answering "why is this value what it is" - which class supplied
 *          the effective value, forking a shared class, and which controls a
 *          section should actually show.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Webflow's composition problem is not that elements can
 *          carry several classes - it is that nothing tells you WHICH one
 *          supplied a value. `valueSource` is that answer, and `forkClassName`
 *          is what makes editing a shared class safe rather than frightening.
 */
import { readValue, propertiesInSection, cascadeOrder, type StyleProperty, type StyleSectionId, type ValueAt, type StoredValue } from '@tangen/studio'
import type { StyleClass } from './classes'

export interface ValueOrigin {
  className: string
  value: string
}

/**
 * Which applied class supplies the effective value.
 *
 * Walks the CASCADE backwards, not the block's own list: the stylesheet is
 * global and emits each class once in name order, so the class an element
 * shows is the alphabetically later one however it was applied. Reporting any
 * other would name the class being overridden, which is worse than saying
 * nothing - see @tangen/studio-schema cascade.ts.
 */
export function valueSource(
  propertyId: string,
  applied: string[],
  classes: StyleClass[],
  at: ValueAt,
): ValueOrigin | null {
  const byName = new Map(classes.map((c) => [c.name, c]))
  const order = cascadeOrder(applied ?? [])
  for (let i = order.length - 1; i >= 0; i--) {
    const found = byName.get(order[i])
    if (!found) continue
    const value = readValue(found.props?.[propertyId], at)
    if (value !== undefined) return { className: found.name, value }
  }
  return null
}

/**
 * A free name for a fork. Strips an existing numeric suffix first, so forking
 * `card-2` gives `card-3` rather than `card-2-2`.
 */
export function forkClassName(base: string, existing: string[]): string {
  const root = String(base ?? '').replace(/-\d+$/, '') || 'style'
  const taken = new Set(existing)
  if (!taken.has(root)) return root
  for (let n = 2; n < 1000; n++) {
    const candidate = `${root}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${root}-${Date.now()}`
}

/**
 * The properties a section should show. A gated property (flex controls on a
 * block element, offsets on a static one) is hidden until it can apply - but
 * NEVER when it already holds a value, or that value becomes uneditable.
 */
export function visibleProperties(
  section: StyleSectionId,
  props: Record<string, StoredValue>,
): StyleProperty[] {
  return propertiesInSection(section).filter((p) => {
    if (!p.when) return true
    if (props?.[p.id] !== undefined) return true
    const current = readValue(props?.[p.when.id], {})
    return current !== undefined && p.when.oneOf.includes(current)
  })
}
