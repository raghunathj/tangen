/**
 * File Name: hooks.ts
 * Purpose: What the SEO extension does when content changes (closure plan
 *          Phase 9A, Units 2 and 18): validates the editor's write instead of
 *          storing it verbatim, keeps its own PUBLISHED snapshot, and retires
 *          the cached artifacts that write invalidated.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The extension keeps its own published snapshot because
 *          `extension_data.published_data` - the column whose comment promises
 *          exactly this - has no writer anywhere in the platform (Phase 9A
 *          finding 9A-3). Relying on it would have been relying on nothing.
 */
import type { ContentHooks } from '@tangen/cms'
import { readStored, writeDraft, promoteToPublished, clearPublished } from './lib/metadata'
import { ARTIFACT_VERSION_KEY, nextVersion } from './server/artifacts'

const SEO_ID = 'seo'

type HookCtx = {
  objectId: string
  panelData?: Record<string, unknown>
  statusChange?: { from: string; to: string }
  extensionData: {
    get(id: string, objectId: string): Promise<Record<string, unknown>>
    set(id: string, objectId: string, data: Record<string, unknown>): Promise<void>
    delete(id: string, objectId: string): Promise<void>
  }
}

/**
 * Retires every cached artifact by moving the version they are keyed under.
 *
 * A hook has no `ExtensionServerCtx`, but `extensionData` and `ctx.store` are
 * the same table with the same key - the store's key IS `object_id` - so the
 * hook writes the version row directly. Best-effort: a cache must never fail
 * a save, and the TTL still bounds a miss.
 */
async function retireArtifacts(ctx: HookCtx): Promise<void> {
  try {
    const current = await ctx.extensionData.get(SEO_ID, ARTIFACT_VERSION_KEY)
    await ctx.extensionData.set(SEO_ID, ARTIFACT_VERSION_KEY, { v: nextVersion(current) })
  } catch { /* the TTL still bounds it */ }
}

export const seoContentHooks: ContentHooks = {
  afterChange: async (rawCtx) => {
    const ctx = rawCtx as unknown as HookCtx
    const panel = ctx.panelData?.[SEO_ID]
    const published = ctx.statusChange?.to === 'published'
    const unpublished = ctx.statusChange && ctx.statusChange.to !== 'published' && ctx.statusChange.from === 'published'
    if (!panel && !ctx.statusChange) return

    const current = readStored(await ctx.extensionData.get(SEO_ID, ctx.objectId))
    // The editor's write reaches the DRAFT and only the draft: a client that
    // sends a `published` key is ignored, not trusted.
    let next = panel ? writeDraft(current, panel) : current
    if (published) next = promoteToPublished(next)
    else if (unpublished) next = clearPublished(next)

    await ctx.extensionData.set(SEO_ID, ctx.objectId, next as unknown as Record<string, unknown>)
    // Metadata, publication and unpublication all change what a sitemap and a
    // page's tags say, so all three retire the artifacts.
    await retireArtifacts(ctx)
  },

  afterDelete: async (rawCtx) => {
    const ctx = rawCtx as unknown as HookCtx
    await ctx.extensionData.delete(SEO_ID, ctx.objectId)
    await retireArtifacts(ctx)
  },
}
