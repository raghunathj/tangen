/**
 * File Name: server.ts
 * Purpose: The SEO extension's server contributions (closure plan Phase 9A) -
 *          referenced from `tangen.extension.ts` as `server: './src/server.ts'`.
 *          Everything here is gated by the platform on the extension being
 *          ACTIVE in the resolved workspace x environment, so a disabled SEO
 *          serves nothing and hooks nothing.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { defineExtensionServer } from '@tangen/cms'
import { seoContentHooks } from './hooks'
import { readStored, writeDraft } from './lib/metadata'
import { seoRoutes } from './server/routes'
import { armAnalyticsSync, runAnalyticsSyncTask, syncAfterSettingsChange, SYNC_TASK } from './server/analytics-sync'

export default defineExtensionServer({
  contentHooks: seoContentHooks,
  // The panel-data contract (SEO Manager slice 1): the panel emits a scoped bag,
  // the store holds { schemaVersion, draft, published? }, and this is the ONLY
  // transform between them - the same functions the afterChange hook uses.
  panelDataCodec: {
    read: (stored) => readStored(stored).draft as unknown as Record<string, unknown>,
    write: (current, panel) => writeDraft(readStored(current), panel) as unknown as Record<string, unknown>,
  },
  adminRoutes: seoRoutes,
  // V3: the Search Console connector; core owns the OAuth flow and the tokens.

  // V4: the daily Search Console sync is a platform task, not a timer of our
  // own; it runs under the extension's authority because no member asked for it.
  tasks: [{
    name: SYNC_TASK.split(':').pop()!,
    description: 'Brings the last days of Search Console data into the extension store',
    runAs: 'extension',
    handler: runAnalyticsSyncTask,
  }],

  // Arms the chain for this workspace; a new generation retires the last one.
  onStart: async (ctx) => { await armAnalyticsSync(ctx, { delaySeconds: 60 }).catch(() => undefined) },

  // An operator just chose the Google connection or the Search Console
  // property: sync now rather than leaving the Analytics page reciting a
  // failure the save already fixed (the user, 2026-09-20). Enqueued, so the
  // Save button does not wait on Google.
  onSettingsChange: async (ctx, { changed }) => { await syncAfterSettingsChange(ctx, changed) },
})
