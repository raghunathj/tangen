/**
 * File Name: ui-store.ts
 * Purpose: Cross-cutting admin UI state — currently the Gen AI host contract:
 *          pages that can open the assistant (object editor, media gallery)
 *          register an opener on mount; the TopBar button calls it and renders
 *          disabled when no page is hosting.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Zustand, no persistence — host registration is per-mount.
 */
import { create } from 'zustand'

interface UIState {
  /** Opens the current page's Gen AI surface; null when the page has none. */
  genAIHost: (() => void) | null
  setGenAIHost: (open: (() => void) | null) => void
  /** Live-preview focus mode is on — the workspace layout hides the nav sidebar so the
   *  editor+preview split owns the screen. Set by the object editor. */
  previewMode: boolean
  setPreviewMode: (on: boolean) => void
}

export const useUIStore = create<UIState>()((set) => ({
  genAIHost: null,
  setGenAIHost: (open) => set({ genAIHost: open }),
  previewMode: false,
  setPreviewMode: (on) => set({ previewMode: on }),
}))
