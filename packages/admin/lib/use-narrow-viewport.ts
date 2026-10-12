/**
 * File Name: use-narrow-viewport.ts
 * Purpose: One answer to "is this window too narrow to spend on navigation?"
 *          (closure plan Phase 8B verification addendum). Measured, not
 *          guessed: at 390px the main sidebar took 279 of 390 and the settings
 *          sub-nav took another 208 of what was left, so the page itself was
 *          reduced to a 60px column and its content was clipped rather than
 *          merely cramped.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A window is not a preference. Nothing here is stored: a
 *          window that widens again restores whatever the user had chosen.
 *          Both navigations already have an icons-only mode, so this decides
 *          WHEN to use it and never invents a new one.
 */
import { useEffect, useState } from 'react'

/** Below this a full-width navigation column costs more than it gives. */
export const NARROW_WIDTH = 700

/** True while the window is narrower than {@link NARROW_WIDTH}. */
export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < NARROW_WIDTH)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${NARROW_WIDTH - 1}px)`)
    const onChange = () => setNarrow(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}
