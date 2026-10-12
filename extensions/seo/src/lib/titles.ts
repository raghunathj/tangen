/**
 * File Name: titles.ts
 * Purpose: The Titles & Meta table (plan-seo-manager-v2 V2), pure. One row
 *          per published object carrying BOTH halves of the stored payload:
 *          what visitors see now (the published snapshot) and what an editor
 *          has waiting (the draft). Tangen's publishing semantics decide the
 *          rest - an edit here writes the draft, so a row whose draft differs
 *          reads "applies on publish" rather than pretending to be live.
 *          The state an editor filters on is the state of the LIVE values.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { analyzeMetaDescLength, analyzeTitleLength, type SeoScore } from './seo-analysis'
import { pickMetadata, readStored } from './metadata'

/** The title and description of one half of the payload. */
export interface TitleValues {
  title: string | null
  description: string | null
}

export type TitleState = 'good' | 'needs-work' | 'missing'

export interface TitleRow {
  id: string
  type: string
  /** The object's own title, which is what a missing SEO title falls back to. */
  objectTitle: string | null
  /** What a visitor sees now. */
  published: TitleValues
  /** What an editor has waiting; equal to `published` when there is nothing pending. */
  draft: TitleValues
  /** True when the draft says something the published snapshot does not: it applies on publish. */
  pending: boolean
  state: TitleState
  /** The live values' checks, in the panel's words. */
  issues: string[]
}

export const TITLE_STATES: readonly TitleState[] = ['good', 'needs-work', 'missing']
/** `attention` is not a state a row has; it is every state except `good`. */
export const ATTENTION_STATE = 'attention'
export type TitleStateFilter = TitleState | typeof ATTENTION_STATE
/** Rows per page on Titles & Meta, and the server's default limit for the route. */
export const TITLES_PAGE_SIZE = 25

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || null
}
const valuesOf = (meta: { title?: string | null; description?: string | null } | null | undefined): TitleValues =>
  ({ title: text(meta?.title), description: text(meta?.description) })

const same = (a: TitleValues, b: TitleValues): boolean => a.title === b.title && a.description === b.description

/** One published object's row from its stored payload. */
export function titleRowOf(input: { id: string; type: string; title: string | null; stored: unknown; locale?: string | null }): TitleRow {
  const stored = readStored(input.stored)
  const published = valuesOf(stored.published ? pickMetadata(stored.published, input.locale ?? null) : null)
  const draft = valuesOf(pickMetadata(stored.draft, input.locale ?? null))
  const effectiveTitle = published.title ?? text(input.title) ?? ''
  const checks = [analyzeTitleLength(effectiveTitle), analyzeMetaDescLength(published.description ?? '')]
  const worst: SeoScore = checks.some((c) => c.score === 'poor') ? 'poor' : checks.some((c) => c.score === 'ok') ? 'ok' : 'good'
  const state: TitleState = !published.title && !published.description ? 'missing' : worst === 'good' ? 'good' : 'needs-work'
  return {
    id: input.id, type: input.type, objectTitle: text(input.title),
    published, draft, pending: !same(published, draft), state,
    issues: checks.filter((c) => c.score !== 'good').map((c) => c.message),
  }
}

/** The table's own filtering: by type, by the live state, and a substring of the path-free text an editor can see. */
export function filterTitleRows(rows: readonly TitleRow[], opts: { type?: string | null; state?: string | null; search?: string | null } = {}): TitleRow[] {
  const needle = (opts.search ?? '').trim().toLowerCase()
  const attention = opts.state === ATTENTION_STATE
  const state = TITLE_STATES.includes(opts.state as TitleState) ? (opts.state as TitleState) : null
  return rows.filter((r) => {
    if (opts.type && r.type !== opts.type) return false
    if (attention && r.state === 'good') return false
    if (state && r.state !== state) return false
    if (!needle) return true
    return [r.objectTitle, r.published.title, r.published.description, r.draft.title, r.draft.description, r.id]
      .some((v) => typeof v === 'string' && v.toLowerCase().includes(needle))
  })
}

export type TitleSort = 'page' | 'title' | 'state'

const STATE_ORDER: Record<TitleState, number> = { missing: 0, 'needs-work': 1, good: 2 }

/** The table's order: the page's own title, the SEO title, or the state (worst first). */
export function sortTitleRows(rows: readonly TitleRow[], opts: { sort?: TitleSort; desc?: boolean } = {}): TitleRow[] {
  const sort = opts.sort ?? 'page'
  const desc = opts.desc ?? false
  const key = (r: TitleRow): string => (sort === 'title' ? r.published.title ?? '' : `${r.objectTitle ?? r.id}`)
  const compare = (a: TitleRow, b: TitleRow): number => {
    const first = sort === 'state' ? STATE_ORDER[a.state] - STATE_ORDER[b.state] : key(a).localeCompare(key(b))
    return (desc ? -first : first) || (a.objectTitle ?? a.id).localeCompare(b.objectTitle ?? b.id)
  }
  return [...rows].sort(compare)
}

/** How many rows sit in each state, for the filter chips. */
export function countTitleStates(rows: readonly TitleRow[]): Record<TitleState, number> {
  const counts: Record<TitleState, number> = { good: 0, 'needs-work': 0, missing: 0 }
  for (const r of rows) counts[r.state] += 1
  return counts
}
