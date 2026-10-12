/**
 * File Name: capabilities.ts
 * Purpose: Capability implication (kernel plan §6): a held capability
 *          implies the ones extensions declared it implies, expanded once
 *          and to a fixed point. A pure rule over a list, keyed on nothing
 *          about who holds it - `decide` supplies the actor.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { Capability } from '@tangen/types'
import { extensionCapabilityImplications } from '../hooks/app-hooks-registry'

/** Core implications (none today; extensions declare theirs in the manifest). */
const IMPLIED_BY: Partial<Record<Capability, Capability[]>> = {}

function implicationMap(): Record<string, string[]> {
  const merged: Record<string, string[]> = {}
  for (const [implied, declaring] of Object.entries(IMPLIED_BY)) {
    if (declaring?.length) merged[implied] = [...declaring]
  }
  for (const [implied, declaring] of Object.entries(extensionCapabilityImplications())) {
    merged[implied] = [...(merged[implied] ?? []), ...declaring]
  }
  return merged
}

export function expandCapabilities(held: Capability[]): Capability[] {
  const out = new Set<string>(held)
  const map = implicationMap()
  let changed = true
  while (changed) {
    changed = false
    for (const [implied, declaring] of Object.entries(map)) {
      if (out.has(implied)) continue
      if (declaring.some((d) => out.has(d))) {
        out.add(implied)
        changed = true
      }
    }
  }
  return [...out] as Capability[]
}
