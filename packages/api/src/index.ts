/**
 * File Name: index.ts
 * Purpose: Entry point for the Tangen API server. Assembles the Elysia application by
 * registering all plugins, middleware, route handlers, event-bus subscribers, and
 * background workers, then exports the server factory and a default singleton instance.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, @tangen/logging, @tangen/types, @tangen/db.
 * Module-level subscriber registration runs once per process; project-aware subscribers
 * read the composed project list through currentProjects() so a rebuilt server refreshes context
 * without re-registering.
 */
import { setHookSettingsFactory } from './hooks/runner'
import { resolveProcessDatabaseUrl } from './lib/process-database'
import { Elysia } from 'elysia'
import { collectCorsOrigins } from './lib/cors-origins'
import { setTrustedProxy, resolveTrustedProxy } from './lib/client-ip'
import { logCorsPosture, logCorsMode } from './lib/cors-policy'
import { gatewayPlugin, gatewayCors, resolveCorsMode, cachedDomainLookup, gatewayRateLimit, resolveRateLimitStore, setActiveRateLimitStore, gatewayRequestLimits, gatewaySurfaceExposure, assertPublicRowsExposed, installRealtimeLimits, realtimeConnectionClosed } from './gateway'
import { workspaceDomains } from '@tangen/db'
import { eq } from 'drizzle-orm'
import { assertJwtSecretConfigured } from './lib/jwt-secret'
import type { ExtensionServerCtx, WorkspaceProject } from '@tangen/types'
import { configureTangenLogging, getLogger } from '@tangen/logging'
import { db, dbPlugin, databaseUrl } from './plugins/db'
import { resolveDeployment, validateProjectDeployment, deploymentRefusal, logDeploymentFindings, type ResolvedDeployment, type DeploymentFinding } from './config/deployment'
import { setResolvedDeployments, setDeploymentFindings, resolvedFor } from './config/state'
import { envSecretProvider, isNoAccessRole, connectorOAuthEnvNames, connectorOAuthSecretKeys } from '@tangen/types'
import { installExecFromDb, listInstalls } from './services/extension-install-state'
import { getRedis, redisDisabled , configureRedis } from './plugins/redis'
import { eventBusPlugin } from './plugins/event-bus'
import { errorMiddleware } from './middleware/error'
import { queryMonitorPluginWith } from './plugins/query-monitor'
import { authMiddleware } from './middleware/auth'
import { realtimePlugin, getRealtimeHub, getRealtimeFanout } from './realtime/transport'
import { onConnectionClosed, setHubGate } from './realtime/hub'
import { setPresenceGate } from './realtime/presence'
import { logConnectionClosed } from './gateway/connection-log'
import { realtimeTicketRoute } from './realtime/ticket'
import { realtimePresenceRoute } from './realtime/presence-route'
import { registerExtensionRealtimeChannels } from './realtime/extension-channels'
import { eventBus } from './services/event-bus'
import { registerAuditLogSubscriber } from './subscribers/audit-log'
import { registerCacheInvalidationSubscriber } from './subscribers/cache-invalidation'
import { registerSearchLogTask } from './services/search-log'
import { registerSseBroadcastSubscriber } from './subscribers/sse-broadcaster'
import { sseManager } from './services/sse-manager'
import { publicSearchRoute } from './routes/search/public'
import { adminSearchRoute } from './routes/search/admin'
import { mediaUploadRoute } from './routes/media/upload'
import { mediaLocalizeRoutes } from './routes/media/localize'
import { mediaTransformRoute } from './routes/media/transform'
import { mediaServeRoute } from './routes/media/serve'
import { mediaStaticRoute } from './routes/media/static'
import { mediaListRoute, mediaAssetDetailRoute } from './routes/media/list'
import { mediaUpdateRoute } from './routes/media/update'
import { mediaDeleteRoute } from './routes/media/delete'
import { mediaFoldersRoute } from './routes/media/folders'
import { deliveryRoute } from './routes/delivery'
import { previewTokenRoute } from './routes/preview/token'
import { previewObjectRoute } from './routes/preview/object'
import { previewStreamRoute } from './routes/preview/stream'
import { previewValidateRoute } from './routes/preview/validate'
import { llmsRoute } from './routes/llms'
import { loginRoute } from './routes/auth/login'
import { refreshRoute } from './routes/auth/refresh'
import { apiKeyRoutes } from './routes/api-keys/manage'
import { memberRoutes } from './routes/members/manage'
import { mePermissionsRoute } from './routes/members/me'
import { meProfileRoute } from './routes/members/profile'
import { memberRolesRoutes } from './routes/members/roles'
import { memberCapabilitiesRoute } from './routes/members/capabilities'
import { webhookRoutes } from './routes/webhooks/manage'
import { webhookDeliveryRoutes } from './routes/webhooks/deliveries'
import { savedViewRoutes } from './routes/saved-views/manage'
import { registerWebhookDispatcherSubscriber } from './subscribers/webhook-dispatcher'
import { registerWorkspaceActivitySubscriber } from './subscribers/workspace-activity'
import { dashboardRoute } from './routes/dashboard/stats'
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
import { syncRunsRoutes } from './routes/sync/runs'
import { porterReceiveRoutes } from './routes/sync/receive'
import { registerPorterRunTask, resolvePorterStorage } from './services/migration-run-worker'
import { contentTables } from '@tangen/db/content-tables'
import { extensionsListRoute } from './routes/extensions/list'
import { adminUiConfigRoute } from './routes/admin/ui-config'
import { schemaWriteRoute } from './routes/admin/schema-write'
import { previewConfigRoute } from './routes/admin/preview-config'
import { searchAnalyticsRoute } from './routes/admin/search-analytics'
import { searchSynonymsRoute } from './routes/admin/search-synonyms'
import { searchRecommendationsRoute } from './routes/admin/search-recommendations'
import { searchPickableRoute } from './routes/admin/search-pickable'
import { extensionDetailRoute } from './routes/extensions/detail'
import { workspaceAppsRoutes, installableAppsRoute } from './routes/extensions/workspace-apps'
import { workspaceFieldTypesRoute } from './routes/extensions/field-types'
import { workspaceSidebarPanelsRoute } from './routes/extensions/sidebar-panels'
import { extensionDataRoutes } from './routes/extensions/app-data'
import { extensionServerRoutes } from './routes/extensions/server-routes'
import { extensionPublicRoutes } from './routes/extensions/public-routes'
import { wireExtensionServers, resetExtensionWiring, createExtensionStore, createExtensionEmitters, workspaceRoleSlugs, extensionExecution, gateExtensionCtx, effectiveGrants, expandOptionGrants } from './services/extension-server'
import { createExtensionHttp, narrowSecrets } from './services/extension-http'
import { createConnectionsStore } from './services/connections'
import { createExtensionConnections } from './services/extension-connections'
import { setConnectionsScope } from './services/connections-scope'
import { createExtensionSettings } from './services/extension-settings'
import { listAiProviders } from './services/ai/registry'
import { deriveConnectionsKey } from './lib/sealed'
import { resolveJwtSecret } from './lib/jwt-secret'
import { contributions as registryContributions, contribute as registryContribute, withdrawContributions } from './kernel/contributions'
import { provideService, getService, instantiateService, serviceValue } from './kernel/services'
import { dispatchExecution } from './kernel/intersect'
import { registerFilter, applyFilter, declareFilterPoint } from './kernel/filters'
import { syncDeclaredExtensionVersions } from './services/extension-install-state'
import { migrationDbFromDrizzle } from '@tangen/db'
import { deploymentProcessWarnings } from './lib/production-defaults'
import { deploymentRole } from './lib/deployment-role'
import { createExtensionGate, declaredExtensionAdoption, projectScopes, extensionCapabilityId } from './runtime/extensions'
import { createExtensionHost } from './runtime/extension-host'
import { workspaceInstalledApps } from '@tangen/db'
import { extensionWidgetDataRoute } from './routes/extensions/widget-data'
import { mcpRoute } from './routes/mcp'
import { knowledgeRoutes } from './routes/knowledge'
import { cronAdminRoutes } from './routes/admin/cron'
import { knowledgeAdminRoutes } from './routes/admin/knowledge'
import { playgroundRoutes } from './routes/admin/playground'
import { queryMonitorRoutes } from './routes/admin/query-monitor'
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
import { runtimeRegistry } from './runtime/registry'
import { bootRuntime } from './runtime/boot'
import { listenOptions, describeListenFailure } from './runtime/listen'
import { getPausedJobs, pauseJob } from './services/paused-jobs'
import { consecutiveFailures } from './services/job-runs'
import { startWebhookWorker } from './workers/webhook-worker'
import { startTaskWorker } from './workers/task-worker'
import { configureTaskRuntime, configureTaskDb, activeQueueBackend, enqueueTask } from './services/task-queue'
import { startPgQueueWorker } from './workers/pg-queue-worker'
import { configurePgCache } from './services/cache-driver'
import { getSchema, startSchemaInvalidationListener, stopSchemaInvalidationListener } from './services/schema-cache'
import { loadSchemaFromDb, onSchemaLoaded } from './services/schema-process-cache'
import { rebuildContentTables, contentTablesSchemaLoaded } from './services/content-tables-runtime'
import { reconcileMembers } from './services/members-reconcile'
import { resolveSchemaComponentRefs } from '@tangen/schema'
import { makeExtensionAI } from './services/extension-ai'
import { createLocalClient } from './services/local-client'
import { loadWorkspacesFromRoot } from './services/workspace-loader'
import { loadExtensionServers, listRegisteredExtensionIds, getExtensionServer, getExtensionManifest, getExtensionMigrations, setExtensionActivity, setExtensionGrantsResolver } from './hooks/app-hooks-registry'
import { setRealtimeExtensionActivity } from './realtime/authorize'
import { customWebhookEventIds } from '@tangen/types'
import { webhookTriggerCatalog } from './services/webhook-trigger-catalog'
import { loadSiteFieldTypes, registerSiteFieldType } from './services/site-field-types'
import { mountCustomRoutes } from './routes/custom/router'
import { printBanner } from './banner'
import { join } from 'node:path'
import { setStorageProjectsProvider, setStorageProvidersScope, knownStorageAdapters, resolveStorage } from './services/storage'
import { readMediaAsset } from './services/media-read'
import { resolveDeliveryProvider } from './services/delivery-store'
import { composeServer, currentProjects, extensionOptionsFor } from './compose'
import type { ServerCapabilities } from './capabilities/types'
import { mediaCapability } from './capabilities/media'
import { searchCapability } from './capabilities/search'
import * as mediaStaticMod from './routes/media/static'
import * as mediaTransformMod from './routes/media/transform'
import * as mediaServeMod from './routes/media/serve'
import * as mediaUploadMod from './routes/media/upload'
import * as mediaLocalizeMod from './routes/media/localize'
import * as mediaListMod from './routes/media/list'
import * as mediaUpdateMod from './routes/media/update'
import * as mediaDeleteMod from './routes/media/delete'
import * as mediaFoldersMod from './routes/media/folders'
import * as mediaIngestMod from './services/media-ingest'
import * as searchPublicMod from './routes/search/public'
import * as searchAdminMod from './routes/search/admin'
import * as searchAnalyticsMod from './routes/admin/search-analytics'
import * as searchSynonymsMod from './routes/admin/search-synonyms'
import * as searchRecommendationsMod from './routes/admin/search-recommendations'
import * as searchPickableMod from './routes/admin/search-pickable'
import * as searchLogMod from './services/search-log'
import * as searchEngineRegistryMod from './services/search-engine-registry'
import * as searchBackfillMod from './services/search-backfill'
import * as searchEngineStatusMod from './routes/admin/search-engine-status'
import * as searchSyncMod from './services/search-sync'

// Gateway M6 (Realtime R5 prep): one access-log record per closed realtime
// connection. Module scope, so a process subscribes once however many apps
// createServer builds (tests build many).
//
// The project list itself lives in compose.ts and is read through
// `currentProjects()`. A second copy used to be declared here and never
// assigned, so every consumer below silently saw an empty array.

let _processServicesRegistered = false

/**
 * The process-wide event subscribers, connection hooks and the Porter run
 * task. Registered when a server is composed, exactly once per process -
 * never at import (closure plan Phase 3, Unit 2): importing this module
 * constructs no client, subscribes nothing and registers no task.
 */
export function registerProcessServices(): void {
  if (_processServicesRegistered) return
  _processServicesRegistered = true
  registerBuiltinPorterProviders()
  onConnectionClosed(logConnectionClosed)
  // Realtime R5, the Gateway half: the close releases the connection gauges.
  // Subscribed once here; the gate itself is installed per createServer.
  onConnectionClosed(realtimeConnectionClosed)

  // Subscribers are module-level singletons — registered once at process start.
  // project-aware subscribers use a mutable reference so createServer() can update
  // it without re-registering (which would cause duplicate events).

  registerAuditLogSubscriber(eventBus, db)
  registerCacheInvalidationSubscriber(eventBus, getRedis())
  // Porter background runs: ledger storage under the reserved __porter slug
  // (same resolution the results routes use); content tables from the registry.
  registerPorterRunTask({
    db,
    storage: resolvePorterStorage(undefined),
    tables: contentTables as Record<string, any>,
    eventBus,
    redis: getRedis(),
    // table:* sync providers resolve from the workspace's customTables config
    projectFor: (workspaceId) => currentProjects().find((p) => p.workspaceId === workspaceId) as never,
  })
  registerSseBroadcastSubscriber(eventBus, sseManager)
  registerWebhookDispatcherSubscriber(
    eventBus,
    db,
    (workspaceId) => {
      const project = currentProjects().find((p) => p.workspaceId === workspaceId)
      return (project?.config as { webhooks?: { maxConsecutiveFailures?: number } } | undefined)?.webhooks?.maxConsecutiveFailures ?? 10
    },
    // Custom triggers a workspace may deliver — site config + installed extensions.
    (workspaceId) => {
      const project = currentProjects().find((p) => p.workspaceId === workspaceId)
      return customWebhookEventIds(webhookTriggerCatalog(project as never))
    },
  )
  registerWorkspaceActivitySubscriber(eventBus, db, getRedis(), (workspaceId) => {
    const project = currentProjects().find((p) => p.workspaceId === workspaceId)
    return project?.config?.dashboard?.activity
  })
}

/**
 * Constructs and returns a fully-wired Elysia server instance.
 * Public routes are registered before authMiddleware; all subsequent routes require a
 * valid session token or API key resolved by that middleware.
 * @param projects - Workspace project configs used by project-aware routes and subscribers.
 * @returns A configured Elysia application (not yet listening).
 */
// Public seam for extensions/site servers: register how YOUR data moves
// with Porter (docs/porter.md). Call at module scope in src/server.ts.
export { registerPorterProvider, type PorterProvider } from './services/porter-providers'
import { registerBuiltinPorterProviders } from './services/porter-providers'
import { resolveRecordedActor } from './kernel/resolve-actor'
import { createExecution } from './kernel/execution'
import { signerFor } from './lib/extension-sign'

/**
 * The full server: every capability resolved statically, so this stays
 * synchronous for every existing embedder and test.
 *
 * It is the COMPATIBILITY path. A lean deployment should use
 * `createServerLean` (server-lean.ts), which resolves only what it enables and
 * then calls the very same composer: the two differ in module resolution and
 * in nothing else.
 */
export function createServer(projects: WorkspaceProject[] = []) {
  registerProcessServices()
  return composeServer(projects, fullCapabilities())
}

/** Every capability, from the modules this file already imported. */
function fullCapabilities(): ServerCapabilities {
  return {
    media: mediaCapability({
      ingest: mediaIngestMod,
      staticRoute: mediaStaticMod, transform: mediaTransformMod, serve: mediaServeMod,
      upload: mediaUploadMod, localize: mediaLocalizeMod, list: mediaListMod,
      update: mediaUpdateMod, del: mediaDeleteMod, folders: mediaFoldersMod,
    }),
    search: searchCapability({
      publicRoute: searchPublicMod, adminRoute: searchAdminMod,
      analytics: searchAnalyticsMod, synonyms: searchSynonymsMod,
      recommendations: searchRecommendationsMod, pickable: searchPickableMod,
      log: searchLogMod,
      engineRegistry: searchEngineRegistryMod, backfill: searchBackfillMod,
      engineStatus: searchEngineStatusMod, sync: searchSyncMod,
    }),
  }
}

// There is deliberately NO module-scope `export const app = createServer([])`
// here any more. It built a whole second server as a side effect of importing
// this module - the one that actually serves is created in `startServer()`
// below, from the loaded projects - so nothing ever used it and every import
// paid for it. Measured on 2026-08-27: removing it took the import cost of
// this module from 184 MB to 159 MB of RSS.
//
// It also made capability gating impossible in principle: any future
// `createServer(projects, { media: false })` would still have paid for media,
// because the eager singleton above it had already mounted everything.
//
// A caller that wants a default instance calls `createServer([])` itself.

/** Upserts the workspace row of each project so the Admin lists it before the first push. */
async function seedWorkspacesFromProjects(dbConn: typeof db, projects: WorkspaceProject[]): Promise<void> {
  const { workspaces } = await import('@tangen/db')
  for (const project of projects) {
    const wsId = project.workspaceId
    const wsSlug = wsId.replace(/^wsp_/, '').replace(/_/g, '-')
    await dbConn.insert(workspaces as any).values({ id: wsId, name: project.name ?? wsSlug, slug: wsSlug }).onConflictDoNothing()
  }
}

export type App = typeof app

if (import.meta.main) {
  configureTangenLogging()
  const log = getLogger(['tangen', 'api'])

  // Fail the boot immediately (not on first request) when production is
  // missing JWT_SECRET — a misconfigured deploy must never come up.
  assertJwtSecretConfigured()

  // Keep the DB schema current before serving, so pulling a new @tangen/db
  // without running `db:migrate` can't 500 the API. The migrations are the ONE
  // path that evolves the system schema; the floor below is derived from them
  // and runs only when the migrator did not, as a best-effort fallback.
  // Opt-out via TANGEN_SKIP_MIGRATE=1.
  if (process.env.TANGEN_SKIP_MIGRATE !== '1') {
    let migrated = false
    const processDatabaseUrl = ((): string | undefined => { try { return resolveProcessDatabaseUrl(process.env) } catch { return undefined } })()
    if (processDatabaseUrl) {
      try {
        const { runMigrations } = await import('@tangen/db/migrate')
        await runMigrations(processDatabaseUrl)
        migrated = true
      } catch (err) {
        log.warn(`auto-migrate skipped (${(err as Error).message}) - run \`db:migrate\` to reconcile; the derived schema floor runs instead`)
      }
    }
    if (!migrated) {
      try {
        const { ensureSystemColumns } = await import('@tangen/db')
        const raw = (db as any).$rawClient ?? (db as any).session?.client
        if (raw?.unsafe) await ensureSystemColumns((text: string) => raw.unsafe(text))
      } catch (err) {
        log.warn(`system schema floor skipped: ${(err as Error).message}`)
      }
    }
  }

  // Resolution order (each tier only runs if the previous returned nothing):
  //   1. TANGEN_WORKSPACE_DIR env var (explicit, always correct for packaged installs)
  //   2. process.cwd() — correct when the CLI runs from the user's project root
  //   3. Monorepo dev fallback: three dirs up from this file (packages/api/src → project root)
  //
  // Within each directory, workspaces are discovered from the canonical layout:
  // app/workspaces/index.ts registry + app/workspaces/<slug>/workspace.config.ts.
  const workspaceDir =
    process.env.TANGEN_WORKSPACE_DIR ??
    process.cwd()
  let projects = await loadWorkspacesFromRoot(join(workspaceDir, 'app'))
  if (projects.length === 0) {
    const devFallback = join(import.meta.dir, '../../..')
    if (devFallback !== workspaceDir) {
      projects = await loadWorkspacesFromRoot(join(devFallback, 'app'))
    }
  }
  if (projects.length === 0) {
    log.warn('No workspaces found - set TANGEN_WORKSPACE_DIR or run from your project root')
  }


  await loadExtensionServers(projects)

  const extExec = (text: string, params?: unknown[]) => {
    const raw = (db as any).$rawClient ?? (db as any).session?.client
    return raw.unsafe(text, (params ?? []) as never)
  }
  resetExtensionWiring()
  setConnectionsScope(null)
  // K7.1 / E.7: one construction of an extension's typed settings for a
  // workspace - the server ctx and every content hook read through it.
  const settingsFor = (extensionId: string, workspaceId: string) => createExtensionSettings({
    extensionId, manifest: getExtensionManifest(extensionId)!, server: getExtensionServer(extensionId) ?? null,
    store: createExtensionStore(extExec, extensionId, workspaceId), key: connectionsKeyFor(resolvedFor(workspaceId)),
    grants: effectiveGrants(extensionId, workspaceId),
  })
  setHookSettingsFactory(settingsFor)
  // The installation truth is the per-environment row (Phase 4): boot adopts
  // the code-declared extensions where no row exists, then ONE gate answers
  // "active here?" for the event/task wiring, every extension route and every
  // ctx's bound hasExtension. docs/architecture/extension-lifecycle.md.
  // A declaration makes an extension available; installing and enabling are
  // explicit, per deployment (tangen extension install). Boot only teaches an
  // installed row from before versions which version it holds.
  try {
    const learned = await syncDeclaredExtensionVersions(extExec, declaredExtensionAdoption(projects))
    if (learned > 0) log.info(`extensions: ${learned} installed row${learned === 1 ? '' : 's'} learned the declared version`)
  } catch (err) {
    log.warn(`extensions: version sync skipped: ${err instanceof Error ? err.message : String(err)}`)
  }
  const extensionGate = createExtensionGate(extExec, {
    scopes: () => projectScopes(currentProjects()),
    role: () => deploymentRole(),
    manifests: () => Object.fromEntries(listRegisteredExtensionIds().flatMap((id) => { const m = getExtensionManifest(id); return m ? [[id, m]] : [] })),
    capability: (id) => runtimeRegistry.availabilityOf(id),
    migrations: getExtensionMigrations,
  })
  // K8.2: storage providers follow activation - a disabled extension's adapter is never built; unknown (not yet settled) counts every loaded server.
  setStorageProvidersScope((workspaceId) => {
    const ids = listRegisteredExtensionIds().filter((id) => extensionGate.activeSync(id, workspaceId) !== false)
    return new Set(ids)
  })
  const extensionActive = (extensionId: string, workspaceId: string) => extensionGate.isActive(extensionId, workspaceId)

  // ONE resolved deployment per workspace × environment (plan-config-resolver
  // section 6), over the registry of Core, the site and the registered
  // extensions; validated by the same primitives Doctor reads. An error
  // refuses the boot; a production process never finds out on its first
  // request. Nothing resolves at request time.
  {
    const resolved: ResolvedDeployment[] = []
    const findings: DeploymentFinding[] = []
    const installExec = installExecFromDb(db)
    for (const project of projects) {
      const installedOptions: Record<string, Record<string, unknown>> = {}
      let activeExtensions: string[] = []
      try {
        for (const row of await listInstalls(installExec, { workspaceId: project.workspaceId })) {
          installedOptions[String(row.extensionId)] = (row.options ?? {}) as Record<string, unknown>
        }
        // Declared ≠ installed ≠ enabled ≠ active: only an extension ACTIVE in
        // this workspace - the gate's answer: installed, enabled, permitted by
        // its manifest, requirements met, schema in place - can require a
        // credential of it. A row boot adoption wrote where the migrations
        // never ran is not activation.
        activeExtensions = await extensionGate.activeIds(project.workspaceId)
      } catch { /* a database without the table yet (first bootstrap): no installed options */ }
      const deployment = resolveDeployment({ project, manifestOf: (id) => getExtensionManifest(id) ?? undefined, installedOptions, activeExtensions })
      findings.push(...validateProjectDeployment({ project, deployment, replicas: Number(process.env.TANGEN_REPLICAS ?? 1), knownStorageAdapters: knownStorageAdapters(project.workspaceId) }))
      resolved.push(deployment)
    }
    logDeploymentFindings(findings, { error: (m) => log.error(m), warning: (m) => log.warn(m), info: (m) => log.info(m) })
    const refusal = deploymentRefusal(findings)
    if (refusal) throw new Error(refusal)
    setResolvedDeployments(resolved)
    setDeploymentFindings(findings)
    // Redis is a deployment binding: one client per process, enabled unless an
    // environment this process serves switched it off; the URL is the deployment's secret.
    configureRedis({ enabled: resolved.every((r) => r.get<boolean>('redis.enabled') !== false), url: resolved[0]?.secrets.get('redis.url') ?? envSecretProvider().read('REDIS_URL') })
  }
  // Realtime R4: every manifest's `realtime.channels` becomes subscribable
  // and publishable; a malformed declaration throws here, naming the
  // extension, rather than opening or closing a channel by accident.
  registerExtensionRealtimeChannels(projects)
  await loadSiteFieldTypes()
  setStorageProjectsProvider(() => currentProjects())

  // Extension server surface v2 — events + tasks + admin routes get a rich
  // ctx (store over extension_data, tangen client, queue). Active =
  // installed and enabled in the request's environment (Phase 4).
  // The synchronous seams: realtime subscriptions and custom field type validation.
  setExtensionActivity((id, ws) => extensionGate.activeSync(id, ws))
  // K5.2a: the approval record, so an extension binds to what was granted, not only what it asked for.
  setExtensionGrantsResolver((id, ws) => extensionGate.grantsSync(id, ws))
  setRealtimeExtensionActivity((id, ws) => extensionGate.activeSync(id, ws))
  // Hoisted (not inline in the deps object) so registry entries can hand a
  // host extension a LAZY builder for another extension's ctx — how Flows
  // runs a contributed action with the contributor's store/identity/emit.
  /** The deployment's connections key: `connections.encryptionKey` (TANGEN_CONNECTIONS_KEY), else derived from the member session secret so development needs no extra variable. */
  const connectionsKeyFor = (deployment: { secrets: { get(name: string): string | undefined } } | undefined) =>
    deriveConnectionsKey(deployment?.secrets.get('connections.encryptionKey') ?? envSecretProvider().read('TANGEN_CONNECTIONS_KEY') ?? resolveJwtSecret())
  // K6.2: one connections scope per workspace - the store under the deployment's
  // key, the active extensions (whose connectors are offered), and the URLs the
  // OAuth flow needs. The Settings routes, the pre-auth callback and every
  // extension ctx resolve through it.
  const connectionsScope = (workspaceId: string) => ({
    store: createConnectionsStore(extExec, { workspaceId, key: connectionsKeyFor(resolvedFor(workspaceId)) }),
    key: connectionsKeyFor(resolvedFor(workspaceId)),
    activeIds: () => extensionGate.activeIds(workspaceId).catch(() => [] as string[]),
    publicUrl: resolvedFor(workspaceId)?.get<string>('server.url') || undefined,
    adminUrl: resolvedFor(workspaceId)?.get<string>('admin.url') || undefined,
    // B2: resource pages are cached through the platform's own cache driver.
    redis: getRedis(),
    // The operator's OAuth app for a provider, supplied once by the
    // deployment instead of pasted into a form. Tangen ships no client
    // credentials of its own; this is only where the operator's are read.
    oauthClient: (provider: string) => {
      const deployment = resolvedFor(workspaceId)
      const keys = connectorOAuthSecretKeys(provider)
      const names = connectorOAuthEnvNames(provider)
      const env = envSecretProvider()
      return {
        clientId: deployment?.secrets.get(keys.clientId) ?? env.read(names.clientId),
        clientSecret: deployment?.secrets.get(keys.clientSecret) ?? env.read(names.clientSecret),
      }
    },
  })
  setConnectionsScope(connectionsScope)
  const buildExtensionCtx = async (extensionId: string, workspaceId: string): Promise<ExtensionServerCtx> => {
    const schema = await getSchema(db, getRedis())
    const project = currentProjects().find((p) => p.workspaceId === workspaceId)
    // The registry a host extension sees (Flows contributions, Porter) holds
    // only the extensions ACTIVE in this scope: a disabled extension leaves
    // no action, trigger or provider behind (Phase 4, Unit 6).
    const activeHere = new Set(await extensionGate.activeIds(workspaceId).catch(() => [] as string[]))
    // K1.2: the extension's grants when its manifest declares them, Tangen's authority otherwise.
    const ownExec = extensionExecution(extensionId, workspaceId)
    // K5.2a: the effective grants - recorded ∩ declared, or the manifest's required when unreviewed; empty for a manifest that declares none (E.14).
    const declaredGrants = effectiveGrants(extensionId, workspaceId)
    const deployment = resolvedFor(workspaceId)
    // K1.4: a platform-wide secret key answers a grants-declaring extension only under secrets:<name>.
    const platformSecrets = deployment?.scopedSecrets([])
    // K1.5: facilities follow the grants (db, ai, resolveActor, enqueue, emit).
    return gateExtensionCtx({
      extensionId, workspaceId, options: deployment?.extensionOptions(extensionId) ?? extensionOptionsFor(currentProjects(), workspaceId, extensionId),
      secrets: narrowSecrets(deployment?.scopedSecrets([`ext.${extensionId}.secret`, `ext.${extensionId}`]), {
        extensionId, grants: declaredGrants, isPlatformKey: (name) => platformSecrets?.has(name) ?? false,
      }),
      // E.2: `network:option(<path>)` grants resolve against the install options here, where they are known.
      http: createExtensionHttp({ extensionId, workspaceId, grants: expandOptionGrants(declaredGrants, deployment?.extensionOptions(extensionId) ?? extensionOptionsFor(currentProjects(), workspaceId, extensionId)) }),
      // K6.1: connections - the operator's credentials as an authed client, host-bound to the connector, gated by connections:<connector>.
      connections: createExtensionConnections({
        exec: ownExec,
        store: connectionsScope(workspaceId).store,
        activeIds: activeHere,
      }),
      // The loaded workspace config (workspace.config.ts as resolved at boot)
      // so an extension can read site-declared settings it defines a config
      // key for (e.g. Studio's `studio.tokens`). Handed as a loose record -
      // extensions parse defensively by contract.
      workspaceConfig: () => (project as { config?: Record<string, unknown> } | undefined)?.config,
      // K7: the extension's own execution (lifecycle hooks, store work); every
      // surface that serves a caller rebinds this ctx to that caller's.
      exec: ownExec,
      tangen: createLocalClient({
        db, redis: getRedis(), schema, workspaceId, customTables: (project as any)?.config?.customTables,
        mail: (project as any)?.mail,
        projects: currentProjects() as never,
        exec: ownExec,
      }),
      store: createExtensionStore(extExec, extensionId, workspaceId),
      // A MAC for data this extension keeps where a member can write it.
      sign: signerFor(extensionId),
      // K7.1: typed manifest settings - defaults, the operator's saved values, secrets opened here only.
      ...(getExtensionManifest(extensionId)?.settings ? { settings: { get: () => settingsFor(extensionId, workspaceId).get() } } : {}),
      // The deployment's handle for an extension's OWN tables (plan-core-slimming F1).
      db,
      // K6: work that runs later on someone's behalf (a flow as its owner)
      // re-resolves that person's CURRENT authority and gets a client bound
      // to the execution it runs in.
      resolveActor: async (actorId: string, opts?: { kind?: never; source?: never; initiator?: never; correlationId?: string | null; causationId?: string | null; locale?: never }) => {
        const r = await resolveRecordedActor(db, getRedis(), { workspaceId, actorId, project: project as never })
        if (!r.ok) return r
        // The execution comes back MINTED, so clientFor accepts it. An
        // extension cannot build one: that is what stops a forged authority
        // being handed to a client (see kernel/execution.ts).
        return {
          ...r,
          exec: createExecution({
            kind: opts?.kind ?? 'job', source: opts?.source ?? 'extension', workspaceId, actor: r.actor,
            initiator: opts?.initiator ?? ownExec.actor.identity,
            correlationId: opts?.correlationId ?? ownExec.correlationId,
            causationId: opts?.causationId ?? ownExec.id,
            locale: opts?.locale,
          }),
        }
      },
      clientFor: (exec) => createLocalClient({
        db, redis: getRedis(), schema, workspaceId, customTables: (project as any)?.config?.customTables,
        mail: (project as any)?.mail, projects: currentProjects() as never, exec,
      }),
      // The environment's semantic ROLE (Phase 5A), which an extension cannot
      // read for itself: `environmentRoleOf` is internal and the slug is
      // exactly what Phase 5A forbids inferring from. Read per call - roles
      // are set once and this is not a hot path.
      deploymentRole: () => deploymentRole(),
      // The deployment's public API URL, for links an extension prints back to itself.
      publicUrl: () => (resolvedFor(workspaceId)?.get<string>('server.url') || undefined)?.replace(/\/$/, ''),
      // Where published artifacts go: the platform table by default, a bucket
      // when the workspace's `studio.delivery` says so. Resolved here rather
      // than by the extension because the backend is platform config and the
      // public delivery route reads the same resolver.
      delivery: resolveDeliveryProvider({ project, workspaceId, exec: extExec }),
      // Resolved types (component name refs expanded) - what GET /types serves.
      // Resolution failure (an unknown ref) degrades to the raw types: an
      // extension reading the vocabulary beats a 500 mid-request.
      types: () => {
        try {
          return resolveSchemaComponentRefs(
            (schema?.types ?? []) as never,
            ((project as { components?: unknown[] } | undefined)?.components ?? []) as never,
          ) as never
        } catch {
          return (schema?.types ?? []) as never
        }
      },
      // S3: an asset's bytes through the workspace's storage adapter, under media:read (gated below).
      media: { read: (mediaId) => readMediaAsset({ workspaceId, exec: extExec as never, storage: resolveStorage(project as never) }, mediaId) },
      ai: makeExtensionAI({
        db, workspaceId, project: project as never,
        // K8.1: the open provider registry - built-ins plus what the extensions active here contribute.
        providers: () => listAiProviders({ workspaceId, activeIds: activeHere, config: ((project as { ai?: unknown; config?: { ai?: unknown } } | undefined)?.ai ?? (project as { config?: { ai?: unknown } } | undefined)?.config?.ai) as never, secrets: deployment?.secrets }),
      }),
      memberRoles: async (memberIds) => {
        const rows = await extExec(`SELECT id, role FROM members WHERE workspace_id = $1`, [workspaceId]).catch(() => [] as Array<Record<string, unknown>>)
        const wanted = memberIds && memberIds.length > 0 ? new Set(memberIds) : null
        const out: Record<string, string> = {}
        for (const row of rows as Array<Record<string, unknown>>) {
          const id = String(row.id ?? '')
          if (!id || (wanted && !wanted.has(id))) continue
          const role = String(row.role ?? '')
          if (role && !isNoAccessRole(role)) out[id] = role
        }
        return out
      },
      roles: async () => workspaceRoleSlugs(
        ((project as any)?.roles ?? []) as Array<{ slug?: unknown }>,
        await extExec(`SELECT slug FROM roles WHERE workspace_id = $1`, [workspaceId])
          .catch(() => [] as Array<{ slug?: unknown }>) as Array<{ slug?: unknown }>,
      ),
      enqueue: (taskId, payload, opts) => enqueueTask({ taskId, workspaceId, payload, delaySeconds: opts?.delaySeconds }),
      registry: () => listRegisteredExtensionIds()
        .filter((id) => activeHere.has(id))
        .map((id) => ({
          id,
          server: (getExtensionServer(id) ?? {}) as Record<string, unknown>,
          ctx: () => buildExtensionCtx(id, workspaceId),
        })),
      // K2.1: the contribution registry, scoped to the extensions active here.
      contributions: ((point: string, opts?: { except?: string }) => registryContributions(point, {
        activeIds: activeHere, except: opts?.except, workspaceId, ctxFor: (id) => buildExtensionCtx(id, workspaceId),
      })) as never,
      // A runtime contribution is scoped to the workspace this ctx serves; the host withdraws it when the scope stops.
      contribute: (point, items) => registryContribute(extensionId, point, items, { workspaceId }),
      // K4.1: filters - register for this scope, apply one of the extension's own points, declare one.
      filters: {
        register: (registration) => registerFilter(extensionId, registration as never, { workspaceId }),
        apply: (point, value, o) => applyFilter(point, value, { workspaceId, activeIds: activeHere, scope: o?.scope, context: o?.context, ctxFor: (id) => buildExtensionCtx(id, workspaceId) }),
        declare: (def) => { declareFilterPoint(def, extensionId) },
      },
      // K3.1: typed services, scoped like contributions; `get` sees the active providers here.
      services: {
        provide: (ref, impl) => provideService(extensionId, ref, impl, { workspaceId }),
        get: (ref) => {
          const resolved = getService(ref, { workspaceId, activeIds: activeHere })
          // A factory is CALLED here: handing a consumer the factory is how
          // "service.query is not a function" happened four modules away.
          return (resolved ? serviceValue(resolved) : undefined) as never
        },
        // B1: the probe. `get` already answers undefined, so this is sugar -
        // but it is the sugar that makes "degrade honestly" a one-liner
        // instead of a dangling variable nobody reads.
        has: (ref) => getService(ref, { workspaceId, activeIds: activeHere }) !== undefined,
        resolve: (ref) => getService(ref, { workspaceId, activeIds: activeHere }) as never,
        // K3.2: a factory service is instantiated under provider ∩ caller, with a client bound to that execution.
        dispatch: async (ref, { as }) => {
          const resolved = getService(ref, { workspaceId, activeIds: activeHere })
          if (!resolved) return undefined
          const providerCtx = await buildExtensionCtx(resolved.extensionId, workspaceId)
          const exec = dispatchExecution(providerCtx.exec!, as)
          return instantiateService(resolved, { exec, tangen: providerCtx.clientFor?.(exec), caller: as.actor.onBehalfOf ?? as.actor.identity }) as never
        },
      },
      // `emit` namespaces (ext:<id>:<name>); `emitPlatform` is the allow-listed
      // way Studio announces its publish lifecycle under the platform type
      // the realtime bridge keys on.
      ...createExtensionEmitters({ extensionId, workspaceId }),
      hasExtension: (id) => extensionActive(id, workspaceId),
      log: (message) => log.info(`[ext:${extensionId}] ${message}`),
    }, ownExec)
  }
  // The runtime host: onStart / onStop / onDispose per active scope, driven
  // by the registry at boot and shutdown and by the admin routes in between.
  const extensionHost = createExtensionHost({
    gate: extensionGate, scopes: () => projectScopes(currentProjects()), server: getExtensionServer, buildCtx: buildExtensionCtx,
    wake: (id) => runtimeRegistry.ensureStarted(extensionCapabilityId(id)),
  })
  wireExtensionServers({
    exec: extExec,
    isActive: extensionActive,
    host: extensionHost,
    lifecycle: {
      exec: extExec, migrationDb: () => migrationDbFromDrizzle(db), gate: extensionGate, host: extensionHost,
      manifest: getExtensionManifest,
      manifests: () => Object.fromEntries(listRegisteredExtensionIds().flatMap((id) => { const m = getExtensionManifest(id); return m ? [[id, m]] : [] })),
      migrations: getExtensionMigrations, server: getExtensionServer, buildCtx: buildExtensionCtx,
      capability: (id) => runtimeRegistry.availabilityOf(id),
      // K8.6: the uninstall ledger - connections revoked under the deployment key, the event announced.
      connectionsKey: (workspaceId) => connectionsKeyFor(resolvedFor(workspaceId)),
      bus: eventBus,
    },
    activeIds: (workspaceId) => extensionGate.activeIds(workspaceId),
    invalidate: () => extensionGate.invalidate(),
    buildCtx: buildExtensionCtx,
  })

  // Seed all configured environments into the DB so the admin env switcher
  // shows every env from tangen.config.ts on startup — not just pushed ones.
  await seedWorkspacesFromProjects(db, projects).catch(() => {})

  // Desired membership (Stage 3 D): app/config/members.ts converges into the
  // environments this process serves. Adds, activates, deactivates, re-roles;
  // never deletes a person, never touches a credential.
  for (const project of projects) {
    if (!project.membersDesired?.length) continue
    try {
      const r = await reconcileMembers(db, { workspaceId: project.workspaceId, desired: project.membersDesired, deploymentRole: deploymentRole() })
      if (r.applied > 0) log.info(`members: desired state applied for ${project.slug ?? project.workspaceId} (${r.created} created without a credential, ${r.applied} change${r.applied === 1 ? '' : 's'})`)
    } catch (err) {
      log.warn(`members: desired state not applied for ${project.slug ?? project.workspaceId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // The deployment role is the one process-level safety signal (stage R1).
  log.info(`deployment role: ${deploymentRole()}`)
  for (const w of deploymentProcessWarnings({ role: deploymentRole(), nodeEnv: process.env.NODE_ENV, cookieSecureOverride: process.env.TANGEN_COOKIE_SECURE })) log.warn(w)

  // The content tables this process serves: built from the one registry of
  // the database it holds; a schema load anywhere rebuilds them.
  onSchemaLoaded(contentTablesSchemaLoaded)
  await rebuildContentTables({
    projects,
    loadSchema: () => loadSchemaFromDb(db),
    log: (m) => log.info(m),
  })

  const port = Number(process.env.PORT ?? 3000)
  const server = createServer(projects)

  // Pre-warm the connection pool: a fresh connection pays connect + catalog-
  // cache warm-up (~30-50ms per query, Query Monitor finding) - burst pages
  // hit several cold connections at once without this. Fire-and-forget.
  Promise.all(Array.from({ length: 5 }, () => {
    const raw = (db as any)?.$rawClient
    return raw ? raw.unsafe('select 1').catch(() => {}) : Promise.resolve()
  })).catch(() => {})
  try {
    server.listen(listenOptions(port))
  } catch (err) {
    throw new Error(describeListenFailure(port, err))
  }

  // Seed search index in background — fire-and-forget so startup is not blocked

  // Generic background work — defineTask/defineScheduledJob handlers resolved
  // from the loaded configs; JobContext mirrors the custom-route tangen surface.
  const runtime = await bootRuntime({ db, eventBus, projects: () => currentProjects(), server, extensionGate, extensionHost })
  printBanner({
    port,
    projects,
    workers: runtime.started.started,
  })
  // One shutdown path (runtime/shutdown.ts): SIGTERM/SIGINT drain the HTTP
  // server, stop and dispose every capability, close streams, the LISTEN and
  // the pool, then let the process exit because nothing holds it.
  runtime.shutdown.installSignalHandlers()
}
