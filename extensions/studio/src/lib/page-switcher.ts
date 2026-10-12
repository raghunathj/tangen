/**
 * File Name: page-switcher.ts
 * Purpose: The top-bar page switcher's list - every page Studio can open,
 *          grouped by content type, searchable, narrowed by a type pill,
 *          with the current one marked and the current TYPE named.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Studio is a full-viewport takeover, so leaving the page
 *          you are on means leaving the tool. Jumping between pages from the
 *          bar is what stops a builder feeling like a one-page editor.
 */
import type { StudioType } from './model'

/** Shown for a page with no title - it still has to be reachable. */
export const UNTITLED = 'Untitled'

export interface SwitcherPage {
  id: string
  title: string
  type: string
  status: string
  updatedAt: string | null
  /** The page being edited right now. */
  current: boolean
}

export interface SwitcherGroup {
  type: string
  label: string
  pages: SwitcherPage[]
}

interface Options {
  query?: string
  currentType?: string
  currentId?: string
  /** Keep one type's pages only - the home screen's type pills, in the bar. */
  typeFilter?: string
}

type RawRow = { id?: unknown; title?: unknown; status?: unknown; updated_at?: unknown }

function toPage(raw: unknown, type: string, current?: string): SwitcherPage | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as RawRow
  // No id means no URL to navigate to - listing it would be a dead row.
  if (typeof row.id !== 'string' || row.id === '') return null
  return {
    id: row.id,
    title: typeof row.title === 'string' && row.title.trim() !== '' ? row.title : UNTITLED,
    type,
    status: typeof row.status === 'string' ? row.status : 'draft',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    current: row.id === current,
  }
}

/**
 * Builds the grouped list. The current page's type leads: switching WITHIN a
 * type is the common case, and burying it under another type's pages is the
 * switcher failing at its main job.
 */
export function pageGroups(
  types: StudioType[],
  rowsByType: Record<string, unknown[]>,
  { query, currentType, currentId, typeFilter }: Options,
): SwitcherGroup[] {
  const needle = (query ?? '').trim().toLowerCase()

  const groups: SwitcherGroup[] = []
  for (const t of currentTypeFirst(types, currentType)) {
    if (typeFilter && t.type !== typeFilter) continue
    const rows = rowsByType[t.type]
    if (!Array.isArray(rows)) continue

    const pages = rows
      .map((r) => toPage(r, t.type, t.type === currentType ? currentId : undefined))
      .filter((p): p is SwitcherPage => p !== null)

    // A type-name match keeps the WHOLE group: that is how you reach "all the
    // landing pages" without knowing any of their titles.
    const typeMatches = needle !== '' && t.label.toLowerCase().includes(needle)
    const visible = needle === '' || typeMatches
      ? pages
      : pages.filter((p) => p.title.toLowerCase().includes(needle))

    if (visible.length === 0) continue
    groups.push({ type: t.type, label: t.label, pages: visible })
  }
  return groups
}

/** The current page's type leads - switching within a type is the common case. */
function currentTypeFirst(types: StudioType[], currentType?: string): StudioType[] {
  return currentType
    ? [...types].sort((a, b) => Number(b.type === currentType) - Number(a.type === currentType))
    : types
}

export interface SwitcherPill {
  type: string
  label: string
  /** Pages that could be opened - rows with an id. */
  count: number
  current: boolean
}

/**
 * One pill per Studio type, the current type first, each counting the pages
 * it holds. A type whose rows have not loaded counts zero rather than
 * vanishing: the pill is how you reach the type at all.
 */
export function switcherPills(
  types: StudioType[],
  rowsByType: Record<string, unknown[]>,
  currentType?: string,
): SwitcherPill[] {
  return currentTypeFirst(types, currentType).map((t) => {
    const rows = rowsByType[t.type]
    const count = Array.isArray(rows) ? rows.filter((r) => toPage(r, t.type) !== null).length : 0
    return { type: t.type, label: t.label, count, current: t.type === currentType }
  })
}

/**
 * Which KIND of page is open, for the bar to say beside the title. Null when
 * the type is unknown, so the bar shows nothing rather than a guess.
 */
export function currentTypeLabel(types: StudioType[], currentType: string | undefined): string | null {
  if (!currentType) return null
  return types.find((t) => t.type === currentType)?.label ?? null
}
