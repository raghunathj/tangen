/**
 * File Name: titles.ts
 * Purpose: The Titles & Meta table's server side (plan-seo-manager-v2 V2):
 *          the published objects with both halves of their stored SEO, and
 *          the edit an editor makes there. The edit writes the DRAFT through
 *          the same codec the panel writes through, so Tangen's publishing
 *          semantics hold - the live snapshot changes when the object is
 *          published, never because a table row was saved.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionServerCtx } from '@tangen/cms'
import { publishedObjects, sitemapTypes } from './artifacts'
import { readStored, writeDraft } from '../lib/metadata'
import { countTitleStates, filterTitleRows, sortTitleRows, titleRowOf, TITLES_PAGE_SIZE, type TitleRow, type TitleSort, type TitleState } from '../lib/titles'

/** The scan's ceiling, the health report's: a table over a bounded set beats an unbounded one. */
export const TITLES_SCAN_LIMIT = 20_000
const STORE_PAGE = 1000

export interface TitlesView {
  rows: TitleRow[]
  total: number
  scanned: number
  counts: Record<TitleState, number>
  types: string[]
}

/** Every published object with its stored SEO, filtered and paged. */
export async function readTitles(ctx: ExtensionServerCtx, opts: { type?: string | null; state?: string | null; search?: string | null; limit?: number; offset?: number; locale?: string | null; sort?: TitleSort; desc?: boolean } = {}): Promise<TitlesView> {
  const objects: Array<{ id: string; type: string; title: string | null }> = []
  scan: for await (const page of publishedObjects(ctx, sitemapTypes(ctx))) {
    for (const o of page) {
      objects.push({ id: o.id, type: o.type, title: o.title ?? null })
      if (objects.length >= TITLES_SCAN_LIMIT) break scan
    }
  }
  // One pass over the store rather than a read per object.
  const wanted = new Set(objects.map((o) => o.id))
  const stored = new Map<string, unknown>()
  for (let offset = 0; ; offset += STORE_PAGE) {
    const rows = await ctx.store.list('', { limit: STORE_PAGE, offset })
    for (const row of rows) if (wanted.has(row.key)) stored.set(row.key, row.data)
    if (rows.length < STORE_PAGE) break
  }
  const all = objects.map((o) => titleRowOf({ id: o.id, type: o.type, title: o.title, stored: stored.get(o.id), locale: opts.locale ?? null }))
  const filtered = sortTitleRows(filterTitleRows(all, opts), opts)
  const offset = Math.max(0, Math.floor(opts.offset ?? 0))
  const limit = Math.max(1, Math.min(Math.floor(opts.limit ?? TITLES_PAGE_SIZE), 100))
  return {
    rows: filtered.slice(offset, offset + limit),
    total: filtered.length,
    scanned: all.length,
    counts: countTitleStates(all),
    types: [...new Set(all.map((r) => r.type))].sort(),
  }
}

export type TitleWrite = { ok: true; row: TitleRow } | { ok: false; reason: string }

/**
 * Writes a title and description onto the object's DRAFT. The published
 * snapshot is left exactly as it is: it changes when the object is published,
 * which is what the row tells the editor. `null` clears a field.
 */
export async function writeTitle(ctx: ExtensionServerCtx, input: { id: string; type?: string; title?: string | null; description?: string | null; locale?: string | null }): Promise<TitleWrite> {
  const id = String(input.id ?? '').trim()
  if (!id) return { ok: false, reason: 'id is required' }
  if (input.locale) return { ok: false, reason: 'Per-locale values are edited in the object\'s SEO panel, where the locale switcher lives.' }
  const current = readStored(await ctx.store.get(id))
  const base = { ...current.draft.base }
  if (input.title !== undefined) {
    const t = typeof input.title === 'string' ? input.title.trim() : ''
    if (t) base.title = t; else delete base.title
  }
  if (input.description !== undefined) {
    const d = typeof input.description === 'string' ? input.description.trim() : ''
    if (d) base.description = d; else delete base.description
  }
  // writeDraft REPLACES the draft, so it carries every locale and every other field through.
  const next = writeDraft(current, { ...current.draft, base })
  await ctx.store.put(id, next as unknown as Record<string, unknown>)
  return {
    ok: true,
    row: titleRowOf({ id, type: String(input.type ?? ''), title: null, stored: next }),
  }
}
