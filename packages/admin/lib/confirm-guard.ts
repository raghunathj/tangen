/**
 * File Name: confirm-guard.ts
 * Purpose: Session-scoped switch for the two-step delete guards — "don't ask again"
 *   pauses confirmations until the page reloads (module state resets with it).
 *
 * Author: Raghunath J
 * License: MIT
 */
let paused = false
export const confirmationsPaused = (): boolean => paused
export const pauseConfirmations = (): void => { paused = true }
