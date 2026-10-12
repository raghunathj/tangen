/**
 * File Name: class-usage.ts
 * Purpose: Class usage across EVERY page of an environment, and rewriting
 *          references when classes merge.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `classUsage` in classes.ts counts the page the editor
 *          has open, which is the right answer for "how many elements does
 *          this edit change" and the wrong one for "may this class be
 *          deleted". A class worn by nothing on this page may style forty
 *          elements on another, and deleting it would unstyle them the next
 *          time the stylesheet publishes. So housekeeping counts the whole
 *          environment, per element AND per page, and shows both before
 *          anything is removed: the element count is the blast radius, the
 *          page count is how many pages will need publishing again.
 *
 *          Pure module - the server scans pages and calls `usageAcrossPages`;
 *          the editor rewrites its open draft with `mergeReferences` so the
 *          tree on screen matches what the server rewrote underneath it.
 */
import { classesOf, withClasses, walkBlocks, CHILD_SLOTS } from './classes'

/** How many elements wear a class, and on how many pages. */
export interface ClassUsage {
  elements: number
  pages: number
}

/** One page's block regions, as the scan sees them. */
export interface PageBlocks {
  id: string
  /** Every component-field region of the page; each is a block list. */
  regions: unknown[]
}

/** Usage by class name. A class nobody wears is absent. */
export function usageAcrossPages(pages: PageBlocks[]): Record<string, ClassUsage> {
  const out: Record<string, ClassUsage> = {}
  for (const page of pages) {
    const onThisPage = new Set<string>()
    for (const region of page.regions) {
      walkBlocks(region, (block) => {
        for (const name of classesOf(block)) {
          const entry = (out[name] ??= { elements: 0, pages: 0 })
          entry.elements += 1
          onThisPage.add(name)
        }
      })
    }
    for (const name of onThisPage) out[name].pages += 1
  }
  return out
}

export interface MergeResult {
  blocks: unknown
  changed: boolean
  /** Elements whose class list was rewritten. */
  elements: number
}

/**
 * Every reference to a removed class becomes a reference to the keeper, at
 * every depth, never leaving the keeper twice on one element. Returns the
 * SAME tree when nothing changed, so a caller can skip the write.
 */
export function mergeReferences(blocks: unknown, remove: string[], into: string): MergeResult {
  const removed = new Set(remove)
  let elements = 0

  const rewrite = (list: unknown): unknown => {
    if (!Array.isArray(list)) return list
    let changed = false
    const next = list.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry
      let block = entry as Record<string, unknown>
      const current = classesOf(block)
      if (current.some((c) => removed.has(c))) {
        const rewritten: string[] = []
        for (const c of current) {
          const name = removed.has(c) ? into : c
          if (!rewritten.includes(name)) rewritten.push(name)
        }
        block = withClasses(block, rewritten)
        elements += 1
      }
      for (const slot of CHILD_SLOTS) {
        if (!(slot in block)) continue
        const child = rewrite(block[slot])
        if (child !== block[slot]) block = { ...block, [slot]: child }
      }
      if (block !== entry) changed = true
      return block
    })
    return changed ? next : list
  }

  const out = rewrite(blocks)
  return { blocks: out, changed: out !== blocks, elements }
}
