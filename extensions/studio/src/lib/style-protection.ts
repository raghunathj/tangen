/**
 * File Name: style-protection.ts
 * Purpose: The ownership model as the Style PANEL meets it - which controls a
 *          protected Block refuses, and the reason a designer is shown.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The compiler has enforced this since `compileStyles`:
 *          an out-of-bounds declaration never reaches a stylesheet. That
 *          makes the boundary real, and it makes the panel's silence a bug -
 *          a designer set a value, it saved, and the page did not move, which
 *          is indistinguishable from the control being broken.
 *
 *          Nothing here decides anything. Every answer comes from
 *          `styleAccess` in @tangen/studio-schema, so the panel and the
 *          compiler cannot drift into refusing different things or explaining
 *          the same refusal two ways. This module only supplies the two
 *          arguments the panel knows and the schema does not: that the scope
 *          is `workspace` (a class is workspace-global) and where the class
 *          lands - the block's public `root` by default (a class lands on
 *          the element the renderer stamps), or the Style Part the panel's
 *          target switch has chosen, in which case the part's own property
 *          list is what the schema answers from. A part is offered only
 *          because the Block's author declared it; the panel never invents
 *          one.
 *
 *          A declaration is READ defensively. It arrives from workspace
 *          config, which is data, and a malformed one must read as Open
 *          rather than as a protection nobody can satisfy.
 */
import {
  styleAccess, exposedParts, type BlockProtection, type StyleAccess, type StylePart, type StyleTarget,
} from '@tangen/studio-schema'

const LEVELS = new Set(['open', 'guided', 'locked'])

/** One Style Part declaration, or null when it is not one. */
function readPart(value: unknown): StylePart | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const properties = (value as { properties?: unknown }).properties
  if (properties === undefined) return {}
  if (!Array.isArray(properties)) return {}
  return { properties: properties.filter((p): p is string => typeof p === 'string') }
}

/**
 * The protection a component definition declares, or undefined for none.
 *
 * Undefined means Open: a Block opts IN to protection, so an absent or
 * unreadable declaration must never turn into a Block nobody can style.
 */
export function blockProtection(def: unknown): BlockProtection | undefined {
  const raw = (def as { protection?: unknown } | null | undefined)?.protection
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const level = (raw as { level?: unknown }).level
  if (typeof level !== 'string' || !LEVELS.has(level)) return undefined

  const partsRaw = (raw as { parts?: unknown }).parts
  if (!partsRaw || typeof partsRaw !== 'object' || Array.isArray(partsRaw)) {
    return { level: level as BlockProtection['level'] }
  }
  const parts: Record<string, StylePart> = {}
  for (const [name, value] of Object.entries(partsRaw as Record<string, unknown>)) {
    const part = readPart(value)
    if (part) parts[name] = part
  }
  return { level: level as BlockProtection['level'], parts }
}

const ROOT: StyleTarget = { kind: 'root' }

/**
 * Whether this property may be styled on this block, and why not.
 *
 * A class is workspace-global, which is the one argument the panel always
 * knows. Where it lands is the other: the Block's public root by default
 * (a class lands on the element the renderer stamps), or a declared Style
 * Part when the panel's target switch says so - and then the allowed set is
 * the part's own list, which is the schema's decision as before.
 */
export function propertyAccess(
  protection: BlockProtection | undefined,
  propertyId: string,
  target: StyleTarget = ROOT,
): StyleAccess {
  return styleAccess({
    protection,
    scope: 'workspace',
    target,
    propertyId,
  })
}

/** The subset of these properties this block refuses. For tests and audits. */
export function refusedProperties(
  protection: BlockProtection | undefined,
  propertyIds: readonly string[],
  target: StyleTarget = ROOT,
): string[] {
  return propertyIds.filter((id) => !propertyAccess(protection, id, target).allowed)
}

/**
 * The changes a write may keep. A refusal costs ONE property, never the
 * batch: losing four good declarations because a fifth was out of bounds
 * would be worse than the problem being solved.
 */
export function allowedChanges(
  protection: BlockProtection | undefined,
  changes: Record<string, string>,
  target: StyleTarget = ROOT,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [id, value] of Object.entries(changes ?? {})) {
    if (propertyAccess(protection, id, target).allowed) out[id] = value
  }
  return out
}

/** One entry of the panel's target switch. */
export interface PartTarget {
  part: string
  label: string
}

/**
 * The Style Parts the panel can offer beside the root: every part the
 * declaration exposes except `root` itself, in declaration order, so the
 * switch reads the way the author listed them. Empty on an Open Block - it
 * has no parts, because everything on it is reachable already.
 */
export function partTargets(protection: BlockProtection | undefined): PartTarget[] {
  return exposedParts(protection)
    .filter((part) => part !== 'root')
    .map((part) => ({ part, label: part.charAt(0).toUpperCase() + part.slice(1).replace(/[-_]+/g, ' ') }))
}

/**
 * The provenance line under the class picker: which class the edit lands
 * on, and which part of the Block when it is not the root. "on .card (button
 * part)" is the difference between styling the group and styling its
 * buttons, and a designer switching targets should see it move.
 */
export function targetLabel(className: string, part: string | null | undefined): string {
  return part ? `on .${className} (${part} part)` : `on .${className}`
}
