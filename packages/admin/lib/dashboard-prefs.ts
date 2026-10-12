/**
 * File Name: dashboard-prefs.ts
 * Purpose: Helpers to persist, load, merge, and apply per-user dashboard layout preferences
 *          (widget order and column spans) to localStorage.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Reads/writes to the Web Storage API (localStorage by default); key is scoped
 *                     to workspaceId, env, and memberId to support multi-workspace sessions.
 */
export type ColSpan = 1 | 2 | 3
export type RowSpan = 1 | 2 | 3

export interface DashboardPrefs {
  order: string[]
  colSpans: Record<string, ColSpan>
  /** Optional for backward compat — prefs stored before row spans existed */
  rowSpans?: Record<string, RowSpan>
}

/** A widget as far as span defaults are concerned — id plus optional type. */
export interface SpannableWidget {
  id: string
  type?: string
}

/**
 * Bento-box default spans by widget type: wide/tall content widgets claim the
 * space their content needs so the grid packs densely instead of leaving
 * single-column holes next to tall cards.
 */
export function defaultSpans(widget: SpannableWidget): { colSpan: ColSpan; rowSpan: RowSpan } {
  switch (widget.type) {
    case 'content-overview': return { colSpan: 2, rowSpan: 2 }
    case 'activity':         return { colSpan: 1, rowSpan: 2 }
    case 'table':            return { colSpan: 2, rowSpan: 1 }
    case 'stat-group':       return { colSpan: 2, rowSpan: 1 }
    default:                 return { colSpan: 1, rowSpan: 1 }
  }
}

/**
 * Constructs the localStorage key for a member's dashboard preferences.
 * @param workspaceId - The active workspace identifier
 * @param env - The environment slug (e.g. "production", "staging")
 * @param memberId - The authenticated member's ID
 * @returns A namespaced key string
 */
export function makePrefsKey(workspaceId: string, memberId: string): string {
  return `tangen:dashboard-prefs:${workspaceId}:${memberId}`
}

/**
 * Reads and parses dashboard preferences from storage; returns null on missing or malformed data.
 * @param key - Storage key produced by makePrefsKey
 * @param storage - Web Storage instance to read from (defaults to localStorage)
 * @returns Parsed DashboardPrefs, or null when not found or unparseable
 */
export function getPrefs(key: string, storage: Storage = localStorage): DashboardPrefs | null {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as DashboardPrefs
  } catch {
    return null
  }
}

/**
 * Serializes and writes dashboard preferences to storage; silently swallows quota and access errors.
 * @param key - Storage key produced by makePrefsKey
 * @param prefs - Preferences object to persist
 * @param storage - Web Storage instance to write to (defaults to localStorage)
 */
export function setPrefs(key: string, prefs: DashboardPrefs, storage: Storage = localStorage): void {
  try {
    storage.setItem(key, JSON.stringify(prefs))
  } catch {
    // quota exceeded or private browsing — silently ignore
  }
}

/**
 * Merge stored preferences with the live widget list.
 * - Stored colSpans win over defaults
 * - Widgets not in stored order keep their server order at the end
 */
export function mergePrefs(
  widgets: SpannableWidget[],
  stored: DashboardPrefs | null,
): DashboardPrefs {
  const colSpans: Record<string, ColSpan> = {}
  const rowSpans: Record<string, RowSpan> = {}
  for (const w of widgets) {
    const defaults = defaultSpans(w)
    colSpans[w.id] = stored?.colSpans?.[w.id] ?? defaults.colSpan
    rowSpans[w.id] = stored?.rowSpans?.[w.id] ?? defaults.rowSpan
  }
  const order = stored?.order?.filter((id) => widgets.some((w) => w.id === id)) ?? []
  return { order, colSpans, rowSpans }
}

/**
 * Apply preferences to the widget list:
 * - Returns widgets in stored order, appending any not in the order at the end
 * - Attaches `colSpan` to each widget
 */
export function applyPrefs<T extends SpannableWidget>(
  widgets: T[],
  prefs: DashboardPrefs | null,
): Array<T & { colSpan: ColSpan; rowSpan: RowSpan }> {
  const colSpans = prefs?.colSpans ?? {}
  const rowSpans = prefs?.rowSpans ?? {}
  const order = prefs?.order ?? []

  const byId = new Map(widgets.map((w) => [w.id, w]))
  const ordered: T[] = []

  for (const id of order) {
    const w = byId.get(id)
    if (w) { ordered.push(w); byId.delete(id) }
  }
  // Remaining widgets (not in stored order) preserve server order
  for (const w of widgets) {
    if (byId.has(w.id)) ordered.push(w)
  }

  return ordered.map((w) => {
    const defaults = defaultSpans(w)
    return {
      ...w,
      colSpan: (colSpans[w.id] ?? defaults.colSpan) as ColSpan,
      rowSpan: (rowSpans[w.id] ?? defaults.rowSpan) as RowSpan,
    }
  })
}
