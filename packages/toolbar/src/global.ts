/**
 * File Name: global.ts
 * Purpose: Entry for the no-bundler build (dist/toolbar.global.js) - a plain
 *          <script src> drop-in exposing window.TangenToolbar for HTML/jQuery
 *          era sites. Ships the SDK's createClient from the SAME bundle so
 *          client requests and the toolbar share one observe registry
 *          (separate bundles would split module state - the 0.1.4 lesson).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Built WITHOUT --packages external (standalone,
 *          web-vitals + sdk inlined). ESM/bundler users ignore this file.
 */
import { mountToolbar, unmountToolbar, buildEditUrl } from './core'
import { reportPage, reportNoPage } from './page'
import { readSsrTimings } from './ssr'
import { createClient, observeRequests } from '@tangen/sdk'

declare global {
  interface Window {
    TangenToolbar?: typeof api
  }
}

const api = {
  mountToolbar,
  unmountToolbar,
  reportPage,
  reportNoPage,
  buildEditUrl,
  readSsrTimings,
  /** The Tangen SDK client, observe-wired to this toolbar. */
  createClient,
  observeRequests,
}

if (typeof window !== 'undefined') {
  window.TangenToolbar = api
}
