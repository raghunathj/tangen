/**
 * File Name: sidebar-prefs.ts
 * Purpose: Pure, testable helpers behind the sidebar's scaling features —
 *          collapsible sections, pinned favourites, auto-recents, in-section
 *          filtering, and per-section overflow ("More…"). All operate on plain
 *          data (arrays/sets) so they unit-test without a DOM; the React layer
 *          in sidebar.tsx wraps them with localStorage persistence.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** A pinned / recent nav entry — the minimum to render and de-dupe by target. */
export interface NavRef {
  to: string
  label: string
  icon?: string
}

// ── Collapsed sections (a set of section keys) ───────────────────────────────

/** Toggle a key in a set, returning a new set (immutable for React state). */
export function toggleInSet(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set)
  next.has(key) ? next.delete(key) : next.add(key)
  return next
}

// ── Pinned favourites (user-curated, ordered) ────────────────────────────────

export function isPinned(pins: readonly NavRef[], to: string): boolean {
  return pins.some((p) => p.to === to)
}

/** Pin if absent, unpin if present. New array; pin appends to the end. */
export function togglePinned(pins: readonly NavRef[], item: NavRef): NavRef[] {
  return isPinned(pins, item.to)
    ? pins.filter((p) => p.to !== item.to)
    : [...pins, { to: item.to, label: item.label, icon: item.icon }]
}

// ── Recents (auto-tracked, most-recent-first, capped) ────────────────────────

/**
 * Record a visit: moves `item` to the front, de-dupes by `to`, caps the list.
 * Returns the same reference when nothing changed (already at the front) so
 * callers can skip a re-render.
 */
export function pushRecent(recents: readonly NavRef[], item: NavRef, cap = 5): NavRef[] {
  if (recents[0]?.to === item.to) return recents as NavRef[]
  const without = recents.filter((r) => r.to !== item.to)
  return [{ to: item.to, label: item.label, icon: item.icon }, ...without].slice(0, cap)
}

// ── In-section filter ────────────────────────────────────────────────────────

/** Case-insensitive substring filter over `label`. Empty query → unchanged. */
export function filterByLabel<T extends { label: string }>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return items as T[]
  return items.filter((i) => i.label.toLowerCase().includes(q))
}

// ── Overflow ("More…") ───────────────────────────────────────────────────────

/**
 * Split a list into the first `limit` visible items and the folded tail.
 * `limit <= 0` disables folding (everything visible). One extra item over the
 * limit is kept visible rather than hidden behind "More (1)".
 */
export function splitOverflow<T>(items: readonly T[], limit: number): { visible: T[]; overflow: T[] } {
  if (limit <= 0 || items.length <= limit + 1) return { visible: items as T[], overflow: [] }
  return { visible: items.slice(0, limit), overflow: items.slice(limit) }
}
