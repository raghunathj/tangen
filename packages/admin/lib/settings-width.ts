/**
 * File Name: settings-width.ts
 * Purpose: The Settings column is 900px on purpose (the user's calls of
 *          2026-09-07 and 2026-09-08), and that is right for a page of cards.
 *          A page whose content is a TABLE is a different shape: schedules and
 *          run history have six columns of dates, ids and statuses, and at
 *          900px they wrap into something nobody can scan (the user,
 *          2026-09-20).
 *
 *          So a page opts in, rather than the column changing for everyone: one
 *          store, set by the page while it is mounted and cleared when it
 *          leaves, so nothing leaks to the next page.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect } from 'react'
import { create } from 'zustand'

export type SettingsWidth = 'default' | 'wide'

interface SettingsWidthState {
  width: SettingsWidth
  set: (width: SettingsWidth) => void
}

export const useSettingsWidthStore = create<SettingsWidthState>()((set) => ({
  width: 'default',
  set: (width) => set({ width }),
}))

/** Widen the settings column while this page is mounted. */
export function useSettingsWidth(width: SettingsWidth): void {
  const set = useSettingsWidthStore((s) => s.set)
  useEffect(() => {
    set(width)
    return () => set('default')
  }, [set, width])
}

/** The column's class for a width. One place, so the layout and a test agree. */
export const settingsColumnClass = (width: SettingsWidth): string =>
  width === 'wide' ? 'mx-auto w-full max-w-[1400px] px-6 pt-7 pb-[120px]' : 'mx-auto w-full max-w-[900px] px-6 pt-7 pb-[120px]'
