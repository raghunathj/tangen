/**
 * File Name: use-fold-state.tsx
 * Purpose: The hook the block and repeater editors use to own their cards'
 *          collapsed state, so it survives a reload and so one control can
 *          fold or unfold all of them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The scope is the path off `window.location`, NOT
 *          react-router's `useLocation`. A field editor must not be able to
 *          crash for want of a Router: these components render under one in
 *          the Admin, but also in Studio and in tests that call
 *          renderToString directly, and `useLocation` throws outside a Router.
 *          Reading the path directly also costs nothing here, because the
 *          scope only has to be a stable bucket - navigating away unmounts the
 *          editor, so there is no navigation to react to.
 *
 *          The scope does NOT have to identify a surface uniquely: a card key
 *          is random and therefore unique on its own, so two surfaces sharing
 *          a path would share an LRU slot, never each other's folds.
 *
 *          A PROVIDER exists because the Collapse all control sits in the
 *          field's header, which the object editor draws, while the cards sit
 *          in the editor below it. Two independent `useState` copies of the
 *          same record would not see each other's toggles, so the store is
 *          lifted once per editor screen and both read it. Without a provider
 *          the hook keeps its own copy, which is what keeps these components
 *          working standalone.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useAuthStore } from './auth'
import { makeFoldKey, readFolds, writeFolds, collapsedFor, setCollapsedFor, type FoldStore } from './fold-state'

export interface FoldState {
  isCollapsed: (key: string) => boolean
  toggle: (key: string) => void
  /** Fold or unfold every key this caller named, and nothing else. */
  setAll: (collapsed: boolean) => void
  /** True while at least one named card is open, so the control reads "Collapse all". */
  anyExpanded: boolean
}

/** The shared record plus the one way to write it. */
interface FoldStoreHandle {
  store: FoldStore
  scope: string
  commit: (scope: string, next: Iterable<string>) => void
}

const FoldContext = createContext<FoldStoreHandle | null>(null)

/** One record, read once per mount, written on every toggle. */
function useFoldStore(): FoldStoreHandle {
  const memberId = useAuthStore((s) => s.member?.memberId ?? null)
  // No window (a server render) means no scope and therefore no persistence,
  // which is the same answer the sidebar's prefs give.
  const scope = typeof window === 'undefined' ? '' : window.location.pathname
  const storeKey = memberId && scope ? makeFoldKey(memberId) : null

  // Read once per mount. A later write from another tab is not merged in on
  // purpose: the open editor's own view is the one the person is looking at,
  // and adopting a background change would fold a card under their cursor.
  const [store, setStore] = useState<FoldStore>(() => (storeKey ? readFolds(storeKey) : {}))

  const commit = useCallback((forScope: string, next: Iterable<string>) => {
    setStore((prev) => {
      const updated = setCollapsedFor(prev, forScope, next)
      if (storeKey) writeFolds(storeKey, updated)
      return updated
    })
  }, [storeKey])

  return { store, scope, commit }
}

/**
 * Shares one fold record across a screen, so a Collapse all drawn in a field's
 * header and the cards drawn below it agree. Mount it once, around the editor.
 */
export function FoldProvider({ children }: { children: React.ReactNode }) {
  const handle = useFoldStore()
  return <FoldContext.Provider value={handle}>{children}</FoldContext.Provider>
}

/**
 * `keys` is passed in rather than read from the record so Collapse all can
 * only ever touch the cards this caller is responsible for. Two editors on one
 * page (a repeater inside a block) therefore share a record without either one
 * folding the other's rows.
 */
export function useFoldState(keys: readonly string[]): FoldState {
  const shared = useContext(FoldContext)
  // Always called, so the hook order never changes; used only when this tree
  // has no provider, which is how a standalone editor keeps working.
  const own = useFoldStore()
  const { store, scope, commit } = shared ?? own

  const collapsed = useMemo(() => collapsedFor(store, scope), [store, scope])

  const isCollapsed = useCallback((key: string) => collapsed.has(key), [collapsed])

  const toggle = useCallback((key: string) => {
    const next = new Set(collapsed)
    next.has(key) ? next.delete(key) : next.add(key)
    commit(scope, next)
  }, [collapsed, commit, scope])

  const setAll = useCallback((value: boolean) => {
    const next = new Set(collapsed)
    for (const k of keys) value ? next.add(k) : next.delete(k)
    commit(scope, next)
  }, [collapsed, keys, commit, scope])

  // A key this caller did not name cannot make the control say "Collapse all":
  // a stale entry from a deleted card would otherwise keep it there.
  const anyExpanded = keys.some((k) => !collapsed.has(k))

  return { isCollapsed, toggle, setAll, anyExpanded }
}
