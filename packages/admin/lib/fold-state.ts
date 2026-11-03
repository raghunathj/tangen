/**
 * File Name: fold-state.ts
 * Purpose: Which block and repeater cards a member has collapsed, remembered
 *          across a reload. Pure storage helpers; `use-fold-state.ts` is the
 *          React half.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: localStorage, like every other collapse state the Admin
 *          keeps (the sidebar's sections, taxonomy and rail). NOT the database:
 *          this is one person's view of one editor on one device, so a column
 *          would impose an editor's folds on everyone and would dirty the
 *          object for pure chrome.
 *
 *          Scoped by memberId - the same scoping `dashboard-prefs.ts` uses -
 *          so two people sharing a browser do not inherit each other's folds.
 *          A memberId is per (workspace, email), so it already implies the
 *          workspace and nothing else needs adding. It is not cleared on sign
 *          out: the entries hold object ids and random card keys, no titles and
 *          no content, which is the same bar the sidebar's collapse keys meet.
 *          `sidebar-recents` is the one that does need clearing, because its
 *          labels are object titles.
 *
 *          What is STORED is the collapsed set, not the expanded set, because
 *          expanded is the default. A page nobody folded costs an empty array,
 *          and a card added after a Collapse all opens expanded - which is what
 *          you want immediately after clicking Add, and what storing "is
 *          expanded" would get wrong.
 */

/** Storage key for one member's folds. The workspace is implied by the id. */
export function makeFoldKey(memberId: string): string {
  return `tangen:folds:${memberId}`
}

/**
 * How many editing surfaces one member's record remembers. The cap is the
 * point: without it this grows with every object anyone ever opens, and
 * localStorage is a ~5 MB quota shared with the rest of the Admin, so the
 * failure mode is a QuotaExceededError thrown mid-edit rather than anything
 * visible here.
 */
export const FOLD_SCOPE_LIMIT = 50

/** One editing surface: when it was last touched, and what is folded in it. */
export interface FoldScope {
  at: number
  collapsed: string[]
}

/** A member's whole record, keyed by editing surface (a route path). */
export type FoldStore = Record<string, FoldScope>

/** The `at` of the most recent scopes, keeping at most `limit` of them. */
export function pruneFolds(store: FoldStore, limit = FOLD_SCOPE_LIMIT): FoldStore {
  const scopes = Object.keys(store)
  if (scopes.length <= limit) return store
  const keep = scopes
    .sort((a, b) => (store[b]?.at ?? 0) - (store[a]?.at ?? 0))
    .slice(0, limit)
  const out: FoldStore = {}
  for (const s of keep) out[s] = store[s]!
  return out
}

/**
 * A member's record, or {} when there is none, the JSON is corrupt, or storage
 * is unavailable. Every caller renders correctly without it, so a private
 * window and a blocked-storage browser are ordinary cases rather than errors.
 */
export function readFolds(key: string, storage: Storage = localStorage): FoldStore {
  try {
    const raw = storage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: FoldStore = {}
    for (const [scope, v] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = v as { at?: unknown; collapsed?: unknown }
      if (!entry || typeof entry !== 'object' || !Array.isArray(entry.collapsed)) continue
      out[scope] = {
        at: typeof entry.at === 'number' ? entry.at : 0,
        collapsed: entry.collapsed.filter((k): k is string => typeof k === 'string'),
      }
    }
    return out
  } catch {
    return {}
  }
}

/** Writes the record, pruned. A storage that throws is not an error here. */
export function writeFolds(key: string, store: FoldStore, storage: Storage = localStorage): void {
  try {
    storage.setItem(key, JSON.stringify(pruneFolds(store)))
  } catch {
    // Quota, private mode, or a blocked store: the folds are chrome, so losing
    // them is the right outcome and must never interrupt an edit.
  }
}

/** What is folded in one surface. */
export function collapsedFor(store: FoldStore, scope: string): ReadonlySet<string> {
  return new Set(store[scope]?.collapsed ?? [])
}

/**
 * The record with one surface's collapsed set replaced and its `at` bumped, so
 * the surface just touched is the last one the cap would drop. Dropping a scope
 * that folds nothing keeps an untouched page from occupying a slot.
 */
export function setCollapsedFor(
  store: FoldStore,
  scope: string,
  collapsed: Iterable<string>,
  now = Date.now(),
): FoldStore {
  const keys = [...new Set(collapsed)].sort()
  const next: FoldStore = { ...store }
  if (keys.length === 0) delete next[scope]
  else next[scope] = { at: now, collapsed: keys }
  return next
}
