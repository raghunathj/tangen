/**
 * File Name: compose.ts
 * Purpose: THE composer. One server chain, built once, used by both entry
 *          points: `createServer` resolves every capability statically and
 *          `createServerLean` resolves only the enabled ones, and they differ
 *          in nothing else.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This file may import CORE statically and must never
 *          import an optional capability's implementation. That is the whole
 *          point of it existing: a capability reaches the chain only as a
 *          value passed in, so a lean boot that does not ask for media or
 *          search never resolves those trees. Moving the eager imports here
 *          from index.ts and calling it done would have relocated the problem
 *          rather than fixed it, which the reachability gate would then have
 *          reported as a leak.
 *
 *          `_projects` lives here because the chain owns it and startup's
 *          module-scope subscribers read it through `currentProjects()`. It is
 *          a mutable module singleton on purpose: subscribers are registered
 *          once per process, and rebinding it lets `composeServer` update what
 *          they see without re-registering and doubling every event.
 */
import { resolvedDeployments } from './config/state'
import { Elysia } from 'elysia'
import { collectCorsOrigins } from './lib/cors-origins'
import { setTrustedProxy, resolveTrustedProxy } from './lib/client-ip'
import { logCorsPosture, logCorsMode } from './lib/cors-policy'
import { gatewayPlugin, gatewayCors, resolveCorsMode, cachedDomainLookup, gatewayRateLimit, resolveRateLimitStore, setActiveRateLimitStore, gatewayRequestLimits, gatewaySurfaceExposure, assertPublicRowsExposed, installRealtimeLimits, realtimeConnectionClosed } from './gateway'
import { workspaceDomains } from '@tangen/db'
import { eq } from 'drizzle-orm'
import type { ExtensionServerCtx, WorkspaceProject } from '@tangen/types'
import { configureTangenLogging, getLogger } from '@tangen/logging'
import { db, dbPlugin } from './plugins/db'
import { getRedis, redisPlugin, redisDisabled } from './plugins/redis'
import { eventBusPlugin } from './plugins/event-bus'
import { eventBus } from './services/event-bus'
import { errorMiddleware } from './middleware/error'
import { queryMonitorPluginWith } from './plugins/query-monitor'
import { authMiddleware } from './middleware/auth'
import { realtimePlugin, getRealtimeHub, getRealtimeFanout, realtimeEnabled } from './realtime/transport'
import { onConnectionClosed, setHubGate } from './realtime/hub'
import { setPresenceGate } from './realtime/presence'
import { realtimeTicketRoute } from './realtime/ticket'
import { realtimePresenceRoute } from './realtime/presence-route'
import { deliveryRoute } from './routes/delivery'
import { previewTokenRoute } from './routes/preview/token'
import { previewObjectRoute } from './routes/preview/object'
import { previewStreamRoute } from './routes/preview/stream'
import { previewValidateRoute } from './routes/preview/validate'
import { llmsRoute } from './routes/llms'
import { loginRoute } from './routes/auth/login'
import { refreshRoute } from './routes/auth/refresh'
import { apiKeyRoutes } from './routes/api-keys/manage'
import { identityRoutes } from './routes/identities'
import { memberRoutes } from './routes/members/manage'
import { mePermissionsRoute } from './routes/members/me'
import { memberGrantsRoutes } from './routes/members/grants'
import { meProfileRoute } from './routes/members/profile'
import { memberRolesRoutes } from './routes/members/roles'
import { memberCapabilitiesRoute } from './routes/members/capabilities'
import { webhookRoutes } from './routes/webhooks/manage'
import { webhookDeliveryRoutes } from './routes/webhooks/deliveries'
import { savedViewRoutes } from './routes/saved-views/manage'
import { dashboardRoute, workspaceOverviewRoute } from './routes/dashboard/stats'
import { typesRoute } from './routes/types/list'
import { fieldOptionsRoute } from './routes/fields/options'
import { aiProvidersRoute } from './routes/ai/providers'
import { aiSurfacesRoute } from './routes/ai/surfaces'
import { aiSettingsRoute } from './routes/ai/settings'
import { aiFillRoute } from './routes/ai/fill'
import { aiGenerateRoute } from './routes/ai/generate'
import { schemaGenerateRoute } from './routes/ai/schema-generate'
import { aiChatsRoute } from './routes/ai/chats'
import { aiImageRoute } from './routes/ai/image'
import { i18nLocalesRoute } from './routes/i18n/locales'
import { i18nTranslateRoute } from './routes/i18n/translate'
import { buildBehaviorRegistry, setActiveBehaviorRegistry } from './services/field-behavior'
import { cacheFlushRoute } from './routes/cache/flush'
import { cacheStatsRoute } from './routes/cache/stats'
import { workspacesRoute } from './routes/workspaces/list'
import { workspaceAdminRoutes } from './routes/workspaces/admin'
import { workspaceMemberRoutes } from './routes/workspaces/members'
import { workspaceSetupRoute } from './routes/workspaces/setup'
import { releaseCreateRoute } from './routes/releases/create'
import { releaseDiffRoute } from './routes/releases/diff'
import { releaseApplyRoute } from './routes/releases/apply'
import { releaseListRoute } from './routes/releases/list'
import { releaseDetailRoute } from './routes/releases/detail'
import { releaseReviewRoute } from './routes/releases/review'
import { releaseLifecycleRoutes } from './routes/releases/lifecycle'
import { syncRunsRoutes } from './routes/sync/runs'
import { porterReceiveRoutes } from './routes/sync/receive'
import { extensionsListRoute } from './routes/extensions/list'
import { adminUiConfigRoute } from './routes/admin/ui-config'
import { adminConfigResolvedRoute } from './routes/admin/config-resolved'
import { schemaWriteRoute } from './routes/admin/schema-write'
import { previewConfigRoute } from './routes/admin/preview-config'
import { extensionDetailRoute } from './routes/extensions/detail'
import { workspaceAppsRoutes, installableAppsRoute } from './routes/extensions/workspace-apps'
import { workspaceFieldTypesRoute } from './routes/extensions/field-types'
import { workspaceSidebarPanelsRoute } from './routes/extensions/sidebar-panels'
import { extensionDataRoutes } from './routes/extensions/app-data'
import { extensionServerRoutes } from './routes/extensions/server-routes'
import { extensionPublicRoutes } from './routes/extensions/public-routes'
import { retiredRoutes } from './gateway/retired-routes'
import { extensionWidgetDataRoute } from './routes/extensions/widget-data'
import { connectionsRoutes } from './routes/connections/manage'
import { uiManifestRoute } from './routes/extensions/ui-manifest'
import { connectionsOAuthCallbackRoute } from './routes/connections/oauth-callback'
import { mcpRoute } from './routes/mcp'
import { knowledgeRoutes } from './routes/knowledge'
import { cronAdminRoutes } from './routes/admin/cron'
import { knowledgeAdminRoutes } from './routes/admin/knowledge'
import { playgroundRoutes } from './routes/admin/playground'
import { queryMonitorRoutes } from './routes/admin/query-monitor'
import { telemetryRoutes } from './routes/admin/telemetry'
import { toolbarQmRoutes } from './routes/toolbar'
import { playgroundCollectionRoutes } from './routes/admin/playground-collections'
import { graphqlRoute } from './routes/graphql'
import { globalsRoutes } from './routes/globals'
import { resourceObjectRoutes } from './routes/objects/resource'
import { scheduleObjectRoute } from './routes/objects/schedule'
import { queryTableRoute } from './routes/tables/query'
import { slugCheckRoute } from './routes/objects/slug-check'
import { labelsRoute } from './routes/objects/labels'
import { objectVersionsRoute } from './routes/objects/versions'
import { bulkUpdateObjectsRoute } from './routes/objects/bulk-update'
import { exportObjectsRoute } from './routes/objects/export'
import { mountCustomRoutes } from './routes/custom/router'

import type { CapabilityContext, ServerCapabilities, ServerCapability } from './capabilities/types'
import { runtimeRegistry } from './runtime/registry'
import { mailAvailability, knowledgeAvailability, knowledgeWanted, aiAvailability, aiWanted, mcpAvailability, mcpWanted } from './runtime/availability'

/**
 * The projects the most recently composed server was given. Startup registers
 * its subscribers once, at module scope, and reads this rather than capturing
 * a list that would go stale on the next compose (tests build many servers).
 */
let _projects: WorkspaceProject[] = []
export function currentProjects(): WorkspaceProject[] { return _projects }

/**
 * The options a workspace's config declared for one extension.
 *
 * The single lookup every extension context uses. It existed inline in
 * `index.ts` against a second, never-assigned project array, so `ctx.options`
 * was always undefined and four shipped extensions silently ran on defaults.
 * Scoped by workspace: the same extension id in two workspaces gets its own
 * options, and an unknown workspace gets nothing rather than the first match.
 */
export function extensionOptionsFor(
  projects: WorkspaceProject[],
  workspaceId: string,
  extensionId: string,
): Record<string, unknown> | undefined {
  return projects
    .find((p) => p.workspaceId === workspaceId)
    ?.extensions?.find((e) => e.id === extensionId)
    ?.options as Record<string, unknown> | undefined
}

/**
 * Capabilities whose `register` has already run in this process.
 *
 * Registration is process-scoped and composition is not: tests build many
 * servers, and the subscribers this replaces were at module scope precisely so
 * that a second `createServer` did not subscribe a second time and double
 * every event. Keyed by id, so the guard survives a capability being handed in
 * as a fresh object each compose.
 */
const registered = new Set<string>()

/** Runs a capability's process-wide setup exactly once. */
function registerOnce(id: string, cap: ServerCapability | undefined, ctx: CapabilityContext): void {
  if (!cap?.register || registered.has(id)) return
  registered.add(id)
  void cap.register(ctx)
}

/** Test seam: forget what has been registered, for a suite that rebuilds the world. */
export function resetCapabilityRegistrations(): void { registered.clear() }

/**
 * The composable capabilities, as facts in the runtime registry: media and
 * search are mounted or switched off by the composition; mail and knowledge
 * have no runtime service of their own but an availability an operator
 * must be able to read. Registered once per process; a later compose
 * only updates the enabled/mounted facts.
 */
function recordComposedCapabilities(projects: WorkspaceProject[], caps: ServerCapabilities): void {
  const composable: Array<{ id: 'media' | 'search'; label: string; cap: ServerCapability | undefined }> = [
    { id: 'media', label: 'Media library and image handling', cap: caps.media },
    { id: 'search', label: 'Content search', cap: caps.search },
  ]
  for (const { id, label, cap } of composable) {
    if (!runtimeRegistry.has(id)) {
      runtimeRegistry.register({ id, label, kind: 'optional', availability: cap?.availability ? () => cap.availability!() : undefined })
    }
    runtimeRegistry.setEnabled(id, cap !== undefined)
    if (cap) runtimeRegistry.markMounted(id)
  }
  if (!runtimeRegistry.has('mail')) {
    runtimeRegistry.register({ id: 'mail', label: 'Outbound mail', kind: 'optional', availability: () => mailAvailability(currentProjects() as never) })
  }
  if (!runtimeRegistry.has('ai')) {
    runtimeRegistry.register({
      id: 'ai', label: 'Content AI', kind: 'optional',
      availability: () => aiAvailability(resolvedDeployments()),
      required: () => aiWanted(currentProjects() as never),
    })
    runtimeRegistry.markMounted('ai')
  }
  if (!runtimeRegistry.has('mcp')) {
    runtimeRegistry.register({
      id: 'mcp', label: 'MCP (Model Context Protocol)', kind: 'optional',
      availability: () => mcpAvailability(currentProjects() as never),
      required: () => mcpWanted(currentProjects() as never),
    })
    runtimeRegistry.markMounted('mcp')
  }
  if (!runtimeRegistry.has('knowledge')) {
    runtimeRegistry.register({
      // Knowledge embeds through an AI provider (routes/knowledge.ts resolves
      // a provider key before it can index or answer), so it is no better off
      // than AI is. Recorded rather than left for a reader to discover.
      id: 'knowledge', label: 'Knowledge (RAG)', kind: 'optional', dependsOn: ['ai'],
      availability: () => knowledgeAvailability(currentProjects() as never, (text) => {
        const raw = (db as any).$rawClient ?? (db as any).session?.client
        return raw?.unsafe ? raw.unsafe(text) : Promise.resolve([])
      }),
      required: () => knowledgeWanted(currentProjects() as never),
    })
    runtimeRegistry.markMounted('knowledge')
  }
}

export function composeServer(projects: WorkspaceProject[] = [], caps: ServerCapabilities = {}) {
  _projects = projects
  // Process-wide capability setup, before the chain: the search indexer used
  // to be registered by importing this module, which made search mandatory in
  // everything but name.
  const capCtx: CapabilityContext = { db, redis: getRedis(), eventBus, projects: () => _projects }
  // Tangen Auth as the deployment's site identity provider (tasks/plan-core-slimming.md S1); an extension's provider replaces it in S4.
  // Realtime mounts only when a project wants it (config `realtime.enabled`,
  // default true); off means no route, no hub, no subscriber, no sweep.
  const realtimeOn = realtimeEnabled(projects)
  registerOnce('media', caps.media, capCtx)
  registerOnce('search', caps.search, capCtx)
  recordComposedCapabilities(projects, caps)
  // Build the behavior overlay once — decorated for routes, and set as the
  // active singleton so the local client (custom routes) shares it
  const behaviorRegistry = buildBehaviorRegistry(projects)
  setActiveBehaviorRegistry(behaviorRegistry)
  // Restrict CORS to the origins declared in workspace environment configs.
  // No declared origins: permissive in development (bare dev setups, tests),
  // CLOSED in production/staging - the old fallthrough reflected any Origin
  // with credentials on, which is the opposite of an allow-list (CF-1).
  const corsOrigins = collectCorsOrigins(projects)
  logCorsPosture(corsOrigins)
  // M4: CORS is decided per request, after the workspace is known, by the
  // Gateway's own layer (gateway/cors.ts). The union above is what observe
  // mode still answers with, and what the Query Monitor exposes timing to.
  const corsMode = resolveCorsMode()
  logCorsMode(corsMode)
  const rateLimitStore = resolveRateLimitStore({ redis: redisDisabled() ? undefined : getRedis(), db })
  // The two attempt limiters that used to be in-process Maps (workspace
  // setup, the Porter gatekeeper) count in this store too, so a lockout
  // holds across processes.
  setActiveRateLimitStore(rateLimitStore)
  getLogger(['tangen', 'api', 'gateway', 'rate-limit']).info(
    `rate-limit counters: ${rateLimitStore.kind}${rateLimitStore.distributed ? '' : ' (one process only)'}; enforcement follows gateway.rateLimit.enabled per workspace, default observe`,
  )
  // Realtime R5 (the Gateway half): connection ceilings and the message
  // budget, resolved per workspace and counted in the same store; the hub
  // asks through its one gate and knows no policy. Observe-first (D-6).
  const realtimeGate = installRealtimeLimits({ store: rateLimitStore, projects: () => _projects })
  setHubGate(realtimeGate)
  setPresenceGate(realtimeGate.presence)
  const lookupDomain = cachedDomainLookup(async (domain) => {
    const [row] = await db.select().from(workspaceDomains).where(eq(workspaceDomains.domain, domain)).limit(1)
    return (row as { workspaceId?: string } | undefined)?.workspaceId ?? null
  })
  // Who sits in front of this process (CF-3). Operator-owned and read once:
  // absent means forwarding headers are ignored entirely rather than trusted.
  setTrustedProxy(resolveTrustedProxy(projects))
  // Split into two typed halves: Elysia accumulates a deeper type per .use(), and
  // ~100 in one chain hits TS2589 ("excessively deep"). Casting the intermediate to
  // plain Elysia flattens the accumulated type so the second half starts fresh. Same
  // instance throughout — middleware (auth) ordering is unchanged, and route handlers
  // read `ctx: any` so the erased decorator types don't matter.
  const server0 = (new Elysia()
    // Tangen Core Gateway (M1): request context, request id, access log.
    // Deliberately inert - it decides nothing. Registered first so its
    // onRequest precedes everything, and before the Query Monitor plugin
    // because it opens the shared RequestEntry the monitor would otherwise
    // open for itself. No middleware order below this line changes.
    .use(gatewayPlugin())
    .use(gatewayCors({ projects: () => _projects, lookupDomain, mode: corsMode }))
    // M6: a body over the resolved cap is refused with 413 before it is parsed.
    .use(gatewayRequestLimits({ projects: () => _projects, lookupDomain }))
    // 22.3: a surface a workspace or environment switched off
    // (gateway.apiExposure) answers one uniform 404 before a credential is
    // read; the auth derive repeats the check once the credential names a
    // workspace the request itself did not.
    .use(gatewaySurfaceExposure({ projects: () => _projects, lookupDomain }))
    // M5: budgets are counted on every limited route and written to the
    // X-RateLimit-* headers; enforcement is per resolved policy and OFF until
    // a scope sets gateway.rateLimit.enabled (D-6: observe first).
    .use(gatewayRateLimit({ store: rateLimitStore, projects: () => _projects, lookupDomain }))
    .use(errorMiddleware)
    // Query Monitor: per-request SQL capture (dev tool; inert unless enabled).
    // Before dbPlugin so onRequest opens the capture ahead of everything.
    .use(queryMonitorPluginWith({ corsOrigins }))
    .use(dbPlugin)
    .use(redisPlugin())
    .use(eventBusPlugin)
    // Attach registered workspace projects and search service to server state
    .decorate('workspaceProjects', projects)
    .use((app: any) => caps.search?.decorate?.(app) ?? app)
    // Behavior overlay — field-level functions (hooks, dynamic options,
    // validators) extracted from in-process code schemas
    .decorate('behaviorRegistry', behaviorRegistry)
    // Custom developer routes — public (developers handle their own auth via ctx.sign/ctx.verify)
    .use(mountCustomRoutes(projects))
    // Public routes — registered before any derive middleware so they remain unprotected
    .get('/api/health', async (ctx: any) => {
      // Liveness by default (static, probe-safe); readiness on ?deep=1 - pings
      // Postgres and configured Redis, 503 when either is down (finding #10).
      const { healthResponse } = await import('./routes/system/health')
      const res = await healthResponse(ctx.query?.deep === '1', { db, redis: ctx.redis ?? getRedis() })
      if (!res.ok) ctx.set.status = 503
      return res.body
    })
    // Public AI-context bundles (/llms.txt, /llms-full.txt) — generated from docs/
    .use(deliveryRoute)
    .use(llmsRoute)
    .use(workspaceSetupRoute)
    .use(loginRoute)
    .use(refreshRoute)
    .use((app: any) => caps.media?.mountPublic?.(app) ?? app)
    .use(previewObjectRoute)
    // Extension key/public routes (auth 'key' | 'public') — handle their own
    // auth like custom routes, so they mount before authMiddleware
    // E.16: retired external URL forms fail on purpose (410 with the replacement), ahead of anything that could shadow them.
    .use(retiredRoutes)
    .use(extensionPublicRoutes)
    // K6.2: the OAuth callback for connections. The provider's redirect carries
    // no member session; the state and the nonce sealed on the pending row
    // authenticate it, so it mounts before authMiddleware.
    .use(connectionsOAuthCallbackRoute)
    // Realtime R1: the WebSocket route and its SSE fallback. Both rows are
    // self-authenticating (the single-use ticket is the credential), so they
    // mount before the Bearer derive; the ticket route mounts after it.
    // Realtime R3: presence timing from the first project that sets `realtime.presence`.
    .use((app: any) => realtimeOn
      ? realtimePlugin({ redis: redisDisabled() ? undefined : getRedis(), db, redisDisabled: redisDisabled(), projects: () => _projects, presence: projects.find((p) => p.config?.realtime?.presence)?.config?.realtime?.presence })(app)
      : app)
    // Protected routes — authMiddleware derive runs for all routes registered after this point
    .use(authMiddleware)
    // Realtime R1: mints the single-use connection ticket from the derive's verdict.
    .use((app: any) => (realtimeOn ? realtimeTicketRoute()(app) : app))
    // Realtime R4: the HTTP presence route, so a client on the SSE fallback
    // publishes presence instead of only watching. Addressed by connection
    // id; a connection owned by another process is reached over the same one
    // infrastructure channel (realtime/presence-route.ts).
    .use((app: any) => (realtimeOn ? realtimePresenceRoute({ hub: getRealtimeHub, fanout: getRealtimeFanout })(app) : app))
    .use(workspacesRoute)
    .use(workspaceAdminRoutes)
    .use(workspaceMemberRoutes)
    .use(releaseCreateRoute)
    .use(releaseDiffRoute)
    .use(releaseApplyRoute)
    .use(releaseListRoute)
    .use(releaseDetailRoute)
    .use(releaseReviewRoute)
    .use(releaseLifecycleRoutes)
    .use(syncRunsRoutes)
    .use(porterReceiveRoutes)
    .use(extensionsListRoute)
    .use(adminUiConfigRoute)
    .use(adminConfigResolvedRoute)
    .use(schemaWriteRoute)
    .use(previewConfigRoute)
    .use((app: any) => caps.search?.mountAdmin?.(app) ?? app)
    .use(extensionDetailRoute)
    .use(workspaceAppsRoutes)
    .use(installableAppsRoute)
    .use(workspaceFieldTypesRoute)
    .use(workspaceSidebarPanelsRoute)
    .use(extensionDataRoutes)
    .use(extensionServerRoutes)
    .use(extensionWidgetDataRoute)) as unknown as Elysia

  const server = server0
    .use(mcpRoute)
    .use(knowledgeRoutes)
    .use(cronAdminRoutes)
    .use(playgroundRoutes)
    .use(connectionsRoutes)
    .use(uiManifestRoute)
    .use(queryMonitorRoutes)
    .use(telemetryRoutes)
    .use(toolbarQmRoutes)
    .use(playgroundCollectionRoutes)
    .use(graphqlRoute)
    .use(knowledgeAdminRoutes)
    .use(globalsRoutes)
    .use(apiKeyRoutes)
    .use(identityRoutes)
    .use(dashboardRoute(projects))
    .use(workspaceOverviewRoute)
    .use(memberRoutes)
    .use(mePermissionsRoute)
    .use(memberGrantsRoutes)
    .use(meProfileRoute)
    .use(memberRolesRoutes)
    .use(memberCapabilitiesRoute)
    .use(webhookRoutes)
    .use(webhookDeliveryRoutes)
    .use(savedViewRoutes)
    .use(typesRoute)
    .use(fieldOptionsRoute)
    .use(aiProvidersRoute)
    .use(aiSurfacesRoute)
    .use(aiSettingsRoute)
    .use(aiFillRoute)
    .use(aiGenerateRoute)
    .use(schemaGenerateRoute)
    .use(aiChatsRoute)
    .use(aiImageRoute)
    .use(i18nLocalesRoute)
    .use(i18nTranslateRoute)
    .use(cacheFlushRoute)
    .use(cacheStatsRoute)
    .use(queryTableRoute)
    .use(slugCheckRoute)
    .use(labelsRoute)
    .use(objectVersionsRoute)
    // Resource-style routes (/objects/{type}...) — includes the dispatcher that
    // replaces the legacy GET /objects/:id registration (same URL pattern).
    .use(resourceObjectRoutes(projects))
    .use(bulkUpdateObjectsRoute(projects))
    .use(exportObjectsRoute)
    .use(scheduleObjectRoute)
    .use((app: any) => caps.search?.mountAuthenticated?.(app) ?? app)
    .use((app: any) => caps.media?.mountAuthenticated?.(app) ?? app)
    .use(previewTokenRoute)
    .use(previewValidateRoute)
    .use(previewStreamRoute)

  // 22.2, authored source: a public row that requires a workspace, in a
  // category that workspace switched off, is a contradiction refused at boot
  // by name. After the chain, so the developer's own custom routes (registered
  // as dynamic rows while mounting) are held to the same rule as delivery.
  assertPublicRowsExposed(projects)

  return server
}
