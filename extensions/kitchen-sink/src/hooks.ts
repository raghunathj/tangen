import type { ContentHooks } from '@tangen/cms'

const EXT_ID = 'kitchen-sink'
/** Well-known extension-data key the dashboard widget reads. */
const WIDGET_KEY = '__widget__'

/**
 * Content hooks — the server-side lifecycle of every content write. This file
 * demonstrates the three things hooks typically do:
 *
 *   1. Persist panel data (afterChange → ctx.extensionData) so the editor's
 *      sidebar panel round-trips its state.
 *   2. Maintain extension-owned aggregates (the widget counter) — the
 *      dashboard widget's dataPath serves whatever lives under '__widget__'.
 *   3. Clean up after deletes so extension_data never holds orphans.
 *
 * Rules of the road:
 *   - Hooks run in-band with the save: keep them fast; push slow work to a
 *     background task via ctx.enqueue?.(taskId, payload).
 *   - Throwing from beforeChange aborts the write — only do that for real
 *     validation failures.
 *   - Extension hooks run before site hooks, in install order.
 */
export const kitchenSinkHooks: ContentHooks = {
  afterChange: async (ctx) => {
    // 1. Persist our panel's in-flight data. The editor keys it by EXTENSION
    //    id (one panel-data bag per extension), never by panel id (2026-09-13:
    //    'sink-notes' here meant the scratch notes never saved).
    const notes = ctx.panelData?.[EXT_ID]
    if (notes) {
      await ctx.extensionData.set(EXT_ID, ctx.objectId, notes)
    }

    // 2. Bump the activity counter the dashboard widget displays
    const current = (await ctx.extensionData.get(EXT_ID, WIDGET_KEY)) as { value?: number } | null
    await ctx.extensionData.set(EXT_ID, WIDGET_KEY, {
      value: (current?.value ?? 0) + 1,
      lastType: ctx.typeName,
      lastOperation: ctx.operation,
    })
  },

  afterDelete: async (ctx) => {
    // 3. No orphaned rows
    await ctx.extensionData.delete(EXT_ID, ctx.objectId)
  },
}
