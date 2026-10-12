/**
 * File Name: page-title.ts
 * Purpose: A tiny override store for the browser tab title - detail pages
 *          that know their entity's real name (a flow, a form, an object)
 *          publish it here and the workspace layout composes it into
 *          document.title instead of a humanized URL segment.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Deliberately not a React context - the layout reads it
 *          via useSyncExternalStore and pages (including extension pages via
 *          @/kit) call usePageTitle. Cleared automatically on unmount so a
 *          navigation away never shows a stale name.
 */
import { useEffect, useSyncExternalStore } from 'react'

let override: string | null = null
const listeners = new Set<() => void>()

export function setPageTitle(title: string | null): void {
  if (override === title) return
  override = title
  for (const l of listeners) {
    try { l() } catch { /* listeners never break the page */ }
  }
}

export function subscribePageTitle(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export const getPageTitle = (): string | null => override

const subscribe = subscribePageTitle
const getSnapshot = getPageTitle

/** Layout-side: the current override (null when no page claimed one). */
export function usePageTitleOverride(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Page-side: publish the entity name for the tab title while mounted.
 * Pass undefined/null while loading - the layout falls back to its
 * URL-derived label until the name arrives.
 */
export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (title) setPageTitle(title)
    return () => setPageTitle(null)
  }, [title])
}
