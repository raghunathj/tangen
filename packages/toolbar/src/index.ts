/**
 * File Name: index.ts
 * Purpose: Public entry point for @tangen/toolbar - the floating Tangen
 *          toolbar site frontends mount to see page vitals, SDK request
 *          timings, console errors and jump into editing the current page.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Framework-agnostic core (Shadow DOM, SSR-safe).
 *          React users: import { TangenToolbar, TangenPage } from
 *          '@tangen/toolbar/react'.
 */
export { mountToolbar, unmountToolbar, buildEditUrl } from './core'
export { reportPage, reportNoPage } from './page'
export { readSsrTimings, SSR_TIMINGS_TAG_ID } from './ssr'
export type { ReportPageOpts } from './page'
export type { ToolbarConfig } from './core'
export type { ToolbarState, ToolbarRequest, PageIdentity, ConsoleEntry, VitalSample, CwvRating } from './state'
