/**
 * File Name: classes.ts
 * Purpose: The style-class model - naming, usage, reuse, duplicate detection
 *          and safe rename.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This is where Webflow's class explosion is prevented or
 *          inherited. Its cause is FEAR: editing a shared class is scary
 *          because the blast radius is invisible, so forking always feels
 *          safer and thousands of near-duplicates accumulate one rational
 *          decision at a time.
 *
 *          Three answers live here. `classUsage` makes the blast radius
 *          countable BEFORE an edit. `findReusable` offers an existing class
 *          instead of minting a near-duplicate. `duplicateGroups` finds the
 *          copies that got made anyway. `unusedClasses` closes the loop -
 *          and because the stylesheet is generated per environment, an
 *          unused class need never be emitted, which turns explosion from a
 *          performance problem into a tidiness one.
 */
import type { StoredValue } from '@tangen/studio'
import type { AnyInteraction } from '@tangen/studio-schema'
import { MAX_CLASS_NAME, normalizeClassName } from '@tangen/studio-schema'
import { STUDIO_WRAPPER_PROP } from './wrapper'

// The name rule moved to the contract package with WF-S10: Porter re-checks
// an incoming `class:` row with the same slugifier before it writes one, and
// the platform may not import extension code. Re-exported so the extension's
// own imports are unchanged.
export { MAX_CLASS_NAME, normalizeClassName }

export interface StyleClass {
  id: string
  /** The CSS selector, without the dot. Unique per environment. */
  name: string
  /**
   * Property id -> value. A value is a plain string, or an object carrying
   * per-breakpoint and per-state overrides (see @tangen/studio style-value).
   * Both dimensions live in the VALUE rather than in parallel class variants,
   * so a class is one thing regardless of how many widths it answers for.
   */
  props: Record<string, StoredValue>
  /** The raw-CSS escape hatch; part of a class's IDENTITY for merging. */
  custom?: string
  /** The Tier 1 Interaction this class animates with, if any. */
  interaction?: AnyInteraction | null
  /**
   * The Block part this class is aimed at. Absent is an ordinary workspace
   * class that styles whatever root wears it. Set ONCE, when the class is
   * created: the compiler emits a targeted class under a scoped name keyed
   * by this, so retargeting would move every block's styling at a stroke.
   */
  target?: ClassTarget
  createdAt: string
  updatedAt: string
  /** Opaque version token, minted on every write. Sent back on save so a
   *  colleague's edit is refused rather than silently overwritten - a
   *  timestamp cannot do this, two saves can share a millisecond. */
  rev?: string
}

/** Where a targeted class lands: a Block type and one of its parts, or its root. */
export interface ClassTarget {
  blockType: string
  kind: 'root' | 'part' | 'internal'
  part?: string
}

/** Whether a class is aimed at exactly this part of this Block type. */
export function targetsPart(cls: { target?: ClassTarget }, blockType: string, part: string): boolean {
  const t = cls.target
  return !!t && t.kind === 'part' && t.blockType === blockType && t.part === part
}

type Block = Record<string, unknown> | null | undefined

/** Slot names a block may nest children under - the tree walk follows these. */
export const CHILD_SLOTS = ['children', 'col1', 'col2', 'col3', 'itemTemplate', 'emptyState', 'errorState']

/**
 * A name for a newly minted class, from the block's ROLE rather than its
 * instance. A number is appended only when the role name is genuinely taken -
 * this is exactly where "Heading 2 copy 3" would otherwise begin.
 */
export function autoClassName(blockType: string, existing: string[]): string {
  const role = normalizeClassName(String(blockType ?? '').replace(/^kit\./, '')) || 'element'
  const taken = new Set(existing)
  if (!taken.has(role)) return role
  for (let n = 2; n < 1000; n++) {
    const candidate = `${role}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${role}-${Date.now()}`
}

/** The classes applied to one block. */
export function classesOf(block: Block): string[] {
  const bag = block?.[STUDIO_WRAPPER_PROP]
  if (!bag || typeof bag !== 'object') return []
  const list = (bag as Record<string, unknown>).classes
  return Array.isArray(list) ? list.filter((c): c is string => typeof c === 'string') : []
}

/** The block with exactly these classes; an empty list removes the key. */
export function withClasses(block: Record<string, unknown>, classes: string[]): Record<string, unknown> {
  const bag = block[STUDIO_WRAPPER_PROP]
  const inner = bag && typeof bag === 'object' ? { ...(bag as Record<string, unknown>) } : {}
  if (classes.length > 0) inner.classes = classes
  else delete inner.classes
  const next = { ...block }
  if (Object.keys(inner).length > 0) next[STUDIO_WRAPPER_PROP] = inner
  else delete next[STUDIO_WRAPPER_PROP]
  return next
}

/** Applies a class, never duplicating it. */
export function withClass(block: Record<string, unknown>, name: string): Record<string, unknown> {
  const current = classesOf(block)
  return current.includes(name) ? block : withClasses(block, [...current, name])
}

/** Removes a class from one block. */
export function withoutClass(block: Record<string, unknown>, name: string): Record<string, unknown> {
  return withClasses(block, classesOf(block).filter((c) => c !== name))
}

/** Visits every block in the tree, at any depth. */
export function walkBlocks(blocks: unknown, visit: (block: Record<string, unknown>) => void): void {
  walk(blocks, visit)
}

function walk(blocks: unknown, visit: (block: Record<string, unknown>) => void): void {
  if (!Array.isArray(blocks)) return
  for (const entry of blocks) {
    if (!entry || typeof entry !== 'object') continue
    const block = entry as Record<string, unknown>
    visit(block)
    for (const slot of CHILD_SLOTS) walk(block[slot], visit)
  }
}

/** How many elements carry this class - the blast radius of editing it. */
export function classUsage(blocks: unknown, name: string): number {
  let count = 0
  walk(blocks, (b) => { if (classesOf(b).includes(name)) count++ })
  return count
}

/** Every class name referenced anywhere in the tree. */
export function usedClassNames(blocks: unknown): Set<string> {
  const names = new Set<string>()
  walk(blocks, (b) => { for (const c of classesOf(b)) names.add(c) })
  return names
}

/** Classes nothing references - safe to reap, and never worth emitting. */
export function unusedClasses(classes: StyleClass[], blocks: unknown): StyleClass[] {
  const used = usedClassNames(blocks)
  return classes.filter((c) => !used.has(c.name))
}

/** A stable, order-independent identity for a set of props plus custom CSS. */
function identity(props: Record<string, StoredValue>, custom?: string): string {
  const entries = Object.entries(props ?? {}).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify([entries, custom ?? ''])
}

/**
 * An existing class that would do instead of minting a new one: the SAME
 * props, already applied to a block of the same type. Same-type matters -
 * reusing `body` on a heading because the font sizes happen to agree would
 * couple two things that only look alike.
 */
export function findReusable(
  classes: StyleClass[],
  props: Record<string, StoredValue>,
  opts: { blocks: unknown; blockType: string },
): StyleClass | null {
  const wanted = identity(props)
  const onType = new Set<string>()
  walk(opts.blocks, (b) => {
    if (b._type === opts.blockType) for (const c of classesOf(b)) onType.add(c)
  })
  return classes.find((c) => onType.has(c.name) && identity(c.props, c.custom) === wanted) ?? null
}

/**
 * Groups of classes that are provably the same thing - the copy-2/copy-3 that
 * got made anyway. Classes with no props are skipped: they are not duplicates,
 * they are empty.
 */
export function duplicateGroups(classes: StyleClass[]): StyleClass[][] {
  const byIdentity = new Map<string, StyleClass[]>()
  for (const c of classes) {
    if (Object.keys(c.props ?? {}).length === 0) continue
    const key = identity(c.props, c.custom)
    const group = byIdentity.get(key)
    if (group) group.push(c)
    else byIdentity.set(key, [c])
  }
  return [...byIdentity.values()].filter((g) => g.length > 1)
}

/**
 * Rewrites every reference to a class, at every depth. Renaming without this
 * is exactly how pages silently lose their styling - the class survives, the
 * elements pointing at it do not.
 */
export function renameClassInBlocks(blocks: unknown, from: string, to: string): unknown {
  if (!Array.isArray(blocks)) return blocks
  let changed = false

  const rewrite = (list: unknown[]): unknown[] => list.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry
    const block = entry as Record<string, unknown>
    let next = block
    if (classesOf(block).includes(from)) {
      changed = true
      next = withClasses(block, classesOf(block).map((c) => (c === from ? to : c)))
    }
    for (const slot of CHILD_SLOTS) {
      const child = next[slot]
      if (!Array.isArray(child)) continue
      const rewritten = rewrite(child)
      if (rewritten !== child) next = next === block ? { ...block, [slot]: rewritten } : { ...next, [slot]: rewritten }
    }
    return next
  })

  const out = rewrite(blocks)
  // Identity is preserved when nothing matched, so callers can skip a save.
  return changed ? out : blocks
}
