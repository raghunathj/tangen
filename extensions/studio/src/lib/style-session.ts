/**
 * File Name: style-session.ts
 * Purpose: The two decisions a style edit makes before it writes - which
 *          breakpoint the current preview width means, and which class
 *          receives the value.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The width boundaries MUST agree with the emitter's
 *          media queries. An edit made at 800px that landed in a query
 *          covering only 767px and below would appear to do nothing, and the
 *          designer would have no way to tell why.
 */
import type { Breakpoint, StyleState } from '@tangen/studio'
import { winningClass } from '@tangen/studio'
import { autoClassName, classUsage, classesOf, normalizeClassName, targetsPart, type StyleClass } from './classes'

/** Widest pixel width each breakpoint's query still covers. */
export const TABLET_MAX = 1023
export const MOBILE_MAX = 767

/**
 * The breakpoint a preview width belongs to. A personal custom width is a
 * viewing aid, not a new breakpoint - it still resolves to one of the three
 * the stylesheet actually has.
 */
export function breakpointForWidth(width: number | null | undefined): Breakpoint {
  // Fluid (no width) is the desktop base - the widest thing the canvas shows.
  if (typeof width !== 'number' || !Number.isFinite(width)) return 'base'
  if (width <= MOBILE_MAX) return 'mobile'
  if (width <= TABLET_MAX) return 'tablet'
  return 'base'
}

export type EditTarget =
  | { action: 'edit'; name: string }
  /** Applying an existing class to a block that has none. `usage` is how many
   *  blocks already wear it, so the panel can say so BEFORE the first edit. */
  | { action: 'reuse'; name: string; usage: number }
  | { action: 'mint'; name: string }

/**
 * Which class an edit writes to.
 *
 * An element with classes gets the one that WINS. The stylesheet is global
 * and emits each class once in name order, so that is the alphabetically
 * later of the classes the element wears - not the last one applied, which
 * the stylesheet has no way to know. Writing to any other class produces a
 * value the winner immediately overrides: an edit that appears to do nothing,
 * which is precisely what a designer reported. See cascade.ts.
 *
 * An element with NO class reuses the class for its role when one exists.
 * Minting instead is how class explosion happens by construction: styling
 * four sections in a row produced .section, .section-2, .section-3,
 * .section-4, which is the exact Webflow failure Studio set out to avoid.
 *
 * Reuse on its own would trade that for Webflow's other complaint - silently
 * restyling every instance - so the target carries the usage count and the
 * panel says "3 uses" before the edit rather than after the surprise.
 */
export function classForEditing(
  block: Record<string, unknown> | null | undefined,
  classes: StyleClass[],
  opts?: { blocks?: unknown },
): EditTarget | null {
  if (!block || typeof block !== 'object') return null

  // Only untargeted classes style the root. A class aimed at a Style Part
  // is worn by the block too - that is how the runtime finds it - but it
  // compiles under a scoped name and says nothing about the root, so it
  // can neither win the root's cascade nor be the class the root edits.
  const known = new Set(classes.filter((c) => !c.target).map((c) => c.name))
  const applied = classesOf(block).filter((name) => known.has(name))
  const winner = winningClass(applied)
  if (winner) return { action: 'edit', name: winner }

  // The name this block's ROLE would take if nothing existed yet. When a class
  // already has it, that class is the one to reuse.
  const role = autoClassName(String(block._type ?? ''), [])
  if (known.has(role)) {
    return { action: 'reuse', name: role, usage: classUsage(opts?.blocks ?? [], role) }
  }

  return { action: 'mint', name: role }
}

/**
 * Which class a Style Part edit writes to.
 *
 * A part has its own class, because a class's target is set once: the root
 * class cannot be aimed at the button after the fact without moving every
 * block's root styling at a stroke. So the panel's target switch resolves
 * to a SECOND class the block wears, aimed at that part of that Block type,
 * and the rules are the root's: edit the one worn, reuse the one the root
 * class already has (with its usage count, so "3 uses" is said before the
 * edit), mint otherwise. The derived name (`cta-button`) keeps the pair
 * readable in the stylesheet; when that name is taken by a class aimed
 * elsewhere the next free one is used rather than retargeting it.
 */
export function classForPart(
  block: Record<string, unknown> | null | undefined,
  classes: StyleClass[],
  opts: { blockType: string; part: string; baseName: string; blocks?: unknown },
): EditTarget | null {
  if (!block || typeof block !== 'object') return null

  const forPart = classes.filter((c) => targetsPart(c, opts.blockType, opts.part))
  const worn = new Set(classesOf(block))
  const applied = forPart.filter((c) => worn.has(c.name)).map((c) => c.name)
  const winner = winningClass(applied)
  if (winner) return { action: 'edit', name: winner }

  const derived = normalizeClassName(`${opts.baseName}-${opts.part}`)
  if (forPart.some((c) => c.name === derived)) {
    return { action: 'reuse', name: derived, usage: classUsage(opts.blocks ?? [], derived) }
  }

  const taken = classes.map((c) => c.name)
  return { action: 'mint', name: autoClassName(derived, taken) }
}

/** Kit blocks that render something the keyboard can land on. */
const FOCUSABLE = new Set(['kit.buttons', 'kit.form'])

/** Preset widths the breakpoint buttons offer, so the label can stay short. */
const PRESET_WIDTH: Record<string, number> = { mobile: 375, tablet: 768 }

/**
 * The states worth offering for a block. Hover applies to anything; focus
 * only means something on an element focus can reach, and a control that can
 * never do anything is how a panel earns distrust.
 *
 * A state that already HOLDS a value is always offered - hiding it would make
 * that value uneditable.
 */
export function statesFor(
  blockType: string,
  props: Record<string, unknown> | null | undefined,
): StyleState[] {
  const out: StyleState[] = ['normal', 'hover']
  if (FOCUSABLE.has(String(blockType ?? ''))) return [...out, 'focus']

  const values = props && typeof props === 'object' ? Object.values(props) : []
  const hasFocus = values.some((v) => !!v && typeof v === 'object' && 'focus' in (v as object))
  return hasFocus ? [...out, 'focus'] : out
}

/**
 * What the breakpoint chip says. A personal preview width resolves to one of
 * the three real breakpoints, which surprises people - naming the width
 * alongside it connects the label to what they actually chose.
 */
export function breakpointLabel(breakpoint: Breakpoint, width: number | null | undefined): string {
  const name = breakpoint === 'base' ? 'Desktop' : breakpoint === 'tablet' ? 'Tablet' : 'Mobile'
  if (typeof width !== 'number' || !Number.isFinite(width)) return name
  return PRESET_WIDTH[breakpoint] === width ? name : `${name} · ${width}px`
}
