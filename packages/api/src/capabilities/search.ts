/**
 * File Name: search.ts
 * Purpose: The search capability: the query surface, the admin analytics and
 *          synonyms surface, the index subscriber and its background tasks.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Search is the capability that proves the `register` half
 *          of the contract is needed. Its routes were never the whole of it:
 *          `registerSearchLogTask` ran at MODULE SCOPE, so importing the server
 *          queued work whether or not anyone wanted search. Gating the routes
 *          alone would have left that in place and called the capability
 *          optional, which it would not have been.
 *
 *          The engine is built here, where the db handle exists, and reaches
 *          content routes through one decoration - `searchEngineRef` - carrying
 *          both the engine and the write hooks. That indirection is what keeps
 *          a core route from importing the search tree, which would make a
 *          gated capability statically reachable and therefore not gated.
 *
 *          Nothing here may import the implementation statically.
 */
import type { CapabilityContext, ServerCapability } from './types'
import { setContentSearchSync } from '../services/search-hooks'

/** The modules search needs. Shape shared by both resolution paths. */
export interface SearchModules {
  publicRoute: any
  adminRoute: any
  analytics: any
  synonyms: any
  recommendations: any
  pickable: any
  log: any
  engineRegistry: any
  backfill: any
  engineStatus: any
  sync: any
}

/** The lean path's resolver: the only dynamic naming of the search tree. */
export async function loadSearch(): Promise<SearchModules> {
  const publicRoute = await import('../routes/search/public')
  const adminRoute = await import('../routes/search/admin')
  const analytics = await import('../routes/admin/search-analytics')
  const synonyms = await import('../routes/admin/search-synonyms')
  const recommendations = await import('../routes/admin/search-recommendations')
  const pickable = await import('../routes/admin/search-pickable')
  const log = await import('../services/search-log')
  const engineRegistry = await import('../services/search-engine-registry')
  const backfill = await import('../services/search-backfill')
  const engineStatus = await import('../routes/admin/search-engine-status')
  const sync = await import('../services/search-sync')
  return { publicRoute, adminRoute, analytics, synonyms, recommendations, pickable, log, engineRegistry, backfill, engineStatus, sync }
}

/** What search mounts and registers. One description, both paths. */
export function searchCapability(m: SearchModules): ServerCapability {
  // The engine is resolved in `register`, which is where the db handle exists,
  // but the decoration has to be created earlier. A holder bridges the two, so
  // routes read one thing and never resolve an engine themselves.
  const engineRef: { current: unknown } = { current: null }
  // One sync object, reached two ways: routes read it off the request, and
  // non-request surfaces (the local client, the scheduler) ask for it. Building
  // it once here is what keeps them from drifting apart.
  const sync = m.sync.makeSearchSync(engineRef)
  return {
    // Both are decorated: the engine is what content search asks, and the
    // One decoration carrying both the engine and the write hooks, so a core
    // content route never imports anything from the search tree.
    decorate: (app) => app.decorate('searchEngineRef', sync),
    mountAuthenticated: (app) => app
      .use(m.publicRoute.publicSearchRoute)
      .use(m.adminRoute.adminSearchRoute),
    mountAdmin: (app) => app
      .use(m.analytics.searchAnalyticsRoute)
      .use(m.synonyms.searchSynonymsRoute)
      .use(m.recommendations.searchRecommendationsRoute)
      .use(m.pickable.searchPickableRoute)
      .use(m.engineStatus.searchEngineStatusRoute),
    // The engine is resolved once, here, and reaches the routes through the
    // decoration. No route, and no extension, builds one.
    register: (ctx: CapabilityContext) => {
      engineRef.current = m.engineRegistry.resolveSearchEngine(ctx.db)
      m.log.registerSearchLogTask(ctx.db)
      // Publish the seam for surfaces that have no request to decorate. A
      // deployment without this capability never calls it, so those surfaces
      // see null and skip search entirely.
      setContentSearchSync(sync)
    },
  }
}
