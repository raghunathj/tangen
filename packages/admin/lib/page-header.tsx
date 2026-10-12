/**
 * File Name: page-header.tsx
 * Purpose: The declarative page-header system — pages (and site-developer
 *          custom views) describe their chrome once and the workspace layout
 *          renders it in the secondary bar: breadcrumbs/title (+icon), a
 *          grayed short description, a center slot (e.g. a search input),
 *          right-side actions, and an optional tabs row with per-tab actions.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Zustand (same pattern as auth/locale/ui stores). Pages
 *          without a config keep the automatic route breadcrumbs — adopting
 *          the system is opt-in per page. Actions from `usePageHeaderActions`
 *          overlay a layout-owned config (e.g. forms tabs + per-tab actions).
 */
import { useEffect } from 'react'
import { create } from 'zustand'

export interface HeaderCrumb {
  label: string
  href?: string
  icon?: React.ReactNode
}

export interface HeaderTab {
  id: string
  label: string
  /** Drawn before the label (16px), the way the benchmark's tabs carry one. */
  icon?: React.ReactNode
  /** Link-style tab (router-driven, e.g. forms sub-pages). Omit for state tabs. */
  href?: string
  /** A count after the label (members, permissions). */
  badge?: number
}

export interface PageHeaderConfig {
  /** Full breadcrumb override; omit to keep the automatic route breadcrumbs. */
  breadcrumbs?: HeaderCrumb[]
  /** Shorthand for a single-crumb title. */
  title?: string
  icon?: React.ReactNode
  /** A small element rendered right after the breadcrumb name (e.g. a settings pencil). */
  titleAdornment?: React.ReactNode
  /** Short grayed info rendered after the crumbs (truncated). */
  description?: string
  /** Right-side CTAs (e.g. New post, Upload). */
  actions?: React.ReactNode
  /** Center slot (e.g. a compact search input). */
  center?: React.ReactNode
  /** Second row of tabs under the breadcrumb bar. */
  tabs?: HeaderTab[]
  /** Right side of the tabs row (e.g. a search input). */
  tabsRight?: React.ReactNode
  /** Renders skeleton placeholders until the page's data is ready. */
  loading?: boolean
  /** Active tab id for state tabs (href tabs derive from the route). */
  activeTab?: string
  onTabChange?: (id: string) => void
}

/** A list's selection, shown in the header after the crumbs ("4 selected")
 *  with a way to clear it; the bulk actions themselves portal into
 *  `#page-selection`, before the page's own actions. */
export interface PageHeaderSelection {
  count: number
  onClear?: () => void
}

interface PageHeaderState {
  config: PageHeaderConfig | null
  /** Actions overlay — wins over config.actions (per-tab actions from child pages). */
  actionsOverlay: React.ReactNode | null
  selection: PageHeaderSelection | null
  /** The header's live `#page-selection` element (null while the header shows its skeleton). */
  selectionSlot: HTMLElement | null
  setConfig: (config: PageHeaderConfig | null) => void
  setActionsOverlay: (actions: React.ReactNode | null) => void
  setSelection: (selection: PageHeaderSelection | null) => void
  setSelectionSlot: (el: HTMLElement | null) => void
}

export const usePageHeaderStore = create<PageHeaderState>()((set) => ({
  config: null,
  actionsOverlay: null,
  selection: null,
  selectionSlot: null,
  setConfig: (config) => set({ config }),
  setActionsOverlay: (actions) => set({ actionsOverlay: actions }),
  setSelection: (selection) => set({ selection: selection && selection.count > 0 ? selection : null }),
  setSelectionSlot: (el) => set((s) => (s.selectionSlot === el ? s : { selectionSlot: el })),
}))

/** Publishes a list's selection to the header while the list is mounted. */
export function usePageHeaderSelection(count: number, onClear?: () => void): void {
  useEffect(() => {
    usePageHeaderStore.getState().setSelection({ count, onClear })
    return () => usePageHeaderStore.getState().setSelection(null)
  }, [count, onClear])
}

/** Effective actions: an overlay from a child page beats the base config's. */
export function resolveHeaderActions(
  config: PageHeaderConfig | null,
  overlay: React.ReactNode | null,
): React.ReactNode | null {
  return overlay ?? config?.actions ?? null
}

/**
 * Declares the page's header chrome. Set on mount and whenever `deps` change;
 * cleared on unmount so configs never leak across routes.
 */
export function usePageHeader(config: PageHeaderConfig, deps: unknown[] = []): void {
  useEffect(() => {
    usePageHeaderStore.getState().setConfig(config)
    return () => usePageHeaderStore.getState().setConfig(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/**
 * Actions-only overlay for pages living under a layout that owns the header
 * (e.g. a forms sub-page contributing "New form" while the layout owns tabs).
 */
export function usePageHeaderActions(actions: React.ReactNode, deps: unknown[] = []): void {
  useEffect(() => {
    usePageHeaderStore.getState().setActionsOverlay(actions)
    return () => usePageHeaderStore.getState().setActionsOverlay(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
