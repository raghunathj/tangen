/**
 * File Name: data-panel.ts
 * Purpose: The Data panel's model - the workspace's collections with their
 *          live published counts, whether a loop may be inserted on this
 *          page, and a fresh kit.loop bound to the collection that was
 *          dragged onto the canvas.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The one panel Webflow has not got. A marketer who
 *          reaches for "the posts" should land a listing that already shows
 *          them, so a dropped collection binds the loop's source AND seeds
 *          its item template with a heading bound to `title` (the one field
 *          every type has) - a loop that renders nothing until someone finds
 *          the binding picker would be a control that appears to work and
 *          does nothing. Counts come from the Studio server route
 *          (GET collections), read through the content client the runtime
 *          already provides; no core route is added.
 */
import { makeBinding } from './binding'
import { allowedChildTypes } from './drop'

/** The Builder Kit's loop block - the only thing a collection becomes. */
export const LOOP_TYPE = 'kit.loop'
/** Seeded into the item template when the loop's slot allows it. */
const HEADING_TYPE = 'kit.heading'

export interface CollectionRow {
  type: string
  label: string
  /** Published entries right now; null when the count could not be read. */
  published: number | null
  /** Why the count is null (a table not pushed yet), else null. */
  note: string | null
}

/** The server's rows, read defensively - one junk row must not blank the panel. */
export function collectionRowsFrom(raw: unknown): CollectionRow[] {
  if (!Array.isArray(raw)) return []
  const out: CollectionRow[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const row = r as { type?: unknown; label?: unknown; published?: unknown; note?: unknown }
    if (typeof row.type !== 'string' || row.type === '') continue
    out.push({
      type: row.type,
      label: typeof row.label === 'string' && row.label.trim() !== '' ? row.label : row.type,
      published: typeof row.published === 'number' && Number.isFinite(row.published) ? row.published : null,
      note: typeof row.note === 'string' && row.note !== '' ? row.note : null,
    })
  }
  return out
}

/** The count badge: honest about a count it does not have. */
export function publishedLabel(published: number | null): string {
  if (published === null) return 'Count unavailable'
  return `${published.toLocaleString('en-US')} published`
}

export function searchCollections(rows: CollectionRow[], query: string): CollectionRow[] {
  const needle = (query ?? '').trim().toLowerCase()
  if (needle === '') return rows
  return rows.filter((r) => r.label.toLowerCase().includes(needle) || r.type.toLowerCase().includes(needle))
}

interface DefLike {
  name: string
  label?: string
  fields?: Array<{ name: string; fieldType: string; config?: { components?: Array<{ name?: string } | string> } }>
}

/**
 * Whether a loop may be inserted here at all: the slot's vocabulary decides,
 * exactly as a drop does. A page without the kit (or a slot that forbids
 * loops) gets the reason, so the panel can say it instead of offering tiles
 * that do nothing.
 */
export function loopAvailability(defs: DefLike[]): { ok: true; def: DefLike } | { ok: false; reason: string } {
  const def = (defs ?? []).find((d) => d && d.name === LOOP_TYPE)
  if (def) return { ok: true, def }
  return { ok: false, reason: 'This page does not allow a Loop block here, so a collection cannot be placed. Enable the Builder Kit on this field, or select a spot that takes one.' }
}

export interface CollectionRef {
  type: string
  label: string
}

/**
 * A freshly built kit.loop, bound to the collection. Returns a NEW block:
 * `source` set, the block named after the collection (so the navigator reads
 * "Blog posts", not "Loop"), and the item template seeded with a heading
 * bound to `title` when the loop's slot allows one. The input is never
 * mutated.
 */
export function bindLoopToCollection(
  block: Record<string, unknown>,
  collection: CollectionRef,
  opts: { defs: DefLike[]; mintKey: () => string },
): Record<string, unknown> {
  if (block?._type !== LOOP_TYPE) throw new Error(`Only a ${LOOP_TYPE} block can be bound to a collection`)
  const allowed = allowedChildTypes(LOOP_TYPE, opts.defs as never, [])
  const template: Array<Record<string, unknown>> = allowed.includes(HEADING_TYPE)
    ? [{ _type: HEADING_TYPE, _key: opts.mintKey(), text: makeBinding('title'), level: 'h3' }]
    : []
  return {
    ...block,
    source: collection.type,
    _label: collection.label,
    itemTemplate: template,
  }
}
