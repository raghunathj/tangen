/**
 * File Name: boot.ts
 * Purpose: The process runtime, booted in one call (closure plan Phase 3):
 *          registers every Core capability into the runtime registry with
 *          its real dependencies, wires the task runtime, the schema-cache
 *          LISTEN, the knowledge tasks and the Postgres cache, STARTs what
 *          is required, and builds the shutdown for these resources. The
 *          process entry (index.ts) calls it after the server listens; the
 *          composition matrix calls it in a child per composition.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Nothing here runs at import. `projects` is a live
 *          view (dev config reloads); `server` is whatever listens (Elysia
 *          at the composition boundary) and is only asked to stop.
 */
import { reloadContentTables } from '../services/content-tables-runtime'
import type { WorkspaceProject } from '@tangen/types'
import { getLogger } from '@tangen/logging'
import type { DbClient } from '@tangen/db'
import type { EventBus } from '../services/event-bus'
import { getRedis } from '../plugins/redis'
import { routeConfigFor } from '../config/route-config'
import { getSchema, startSchemaInvalidationListener, stopSchemaInvalidationListener } from '../services/schema-cache'
import { createLocalClient } from '../services/local-client'
import { getPausedJobs, pauseJob } from '../services/paused-jobs'
import { consecutiveFailures } from '../services/job-runs'
import { configureTaskRuntime, configureTaskDb } from '../services/task-queue'
import { configurePgCache } from '../services/cache-driver'
import { sseManager } from '../services/sse-manager'
import { startWebhookWorker } from '../workers/webhook-worker'
import { startTaskWorker } from '../workers/task-worker'
import { startPgQueueWorker } from '../workers/pg-queue-worker'
import { runtimeRegistry, type RuntimeRegistry, type StartReport } from './registry'
import { createShutdown, type ProcessShutdown } from './shutdown'
import { registerExtensionCapabilities, type ExtensionGate, type ExtensionRuntimeHost } from './extensions'
import { listRegisteredExtensionIds, getExtensionManifest } from '../hooks/app-hooks-registry'
import {
  registerSchedulerCapability, registerHousekeepingCapability, registerRealtimeCapability, registerRedisCapability, registerWorkerCapabilities,
} from './process'
import { registerTelemetryCapability } from '../telemetry/capability'
import { executionForRun } from '../kernel/run-identity'
import { projectLocalization } from '../services/i18n'
import type { JobRunRef } from '@tangen/types'
import { systemExecution } from '../storage/unsafe-storage'

const logger = getLogger(['tangen', 'api', 'boot'])

export interface BootDeps {
  db: DbClient
  eventBus: EventBus
  /** Live view of the loaded projects. */
  projects: () => WorkspaceProject[]
  /** The listening server; asked to stop at shutdown. */
  server?: { stop: (closeActiveConnections?: boolean) => Promise<unknown> | unknown } | null
  /** The extension gate (Phase 4): every registered extension becomes an `ext:<id>` capability that starts only where active. */
  extensionGate?: ExtensionGate
  /** The extension runtime host (Unit 7): onStart / onStop / onDispose per active scope. */
  extensionHost?: ExtensionRuntimeHost
}

export interface BootedRuntime {
  started: StartReport
  shutdown: ProcessShutdown
  registry: RuntimeRegistry
}

/** Registers the Core capabilities, starts what is required, and returns the shutdown for these resources. */
export async function bootRuntime(deps: BootDeps): Promise<BootedRuntime> {
  const db = deps.db
  const eventBus = deps.eventBus
  const makeJobCtx = async (workspaceId: string, run?: JobRunRef) => {
    const schema = await getSchema(db, getRedis())
    const project = deps.projects().find((p) => p.workspaceId === workspaceId)
    // K6: the run's execution - the actor the runner resolved (the
    // initiator's current authority, or Tangen's own with the job as the
    // reason), the initiator, and the enqueuer's correlation.
    const exec = run ? executionForRun({ workspaceId, run, localization: projectLocalization(project) }) : undefined
    const jobLog = getLogger(['tangen', 'jobs', workspaceId])
    return {
      tangen: createLocalClient({
        db, redis: getRedis(), schema, workspaceId, customTables: (project as any)?.config?.customTables,
        mail: project?.mail,
        projects: deps.projects() as never,
        exec,
      }),
      workspaceId,
      ...routeConfigFor(workspaceId),
      log: (message: string) => jobLog.info(message),
      ...(exec ? { exec } : {}),
    }
  }
  // The scheduler is demand-driven (code jobs, cron entries, scheduled
  // content) and housekeeping has its own timers; both live in the runtime
  // registry (runtime/process.ts), which starts what is required below.
  registerSchedulerCapability({
    db, eventBus,
    jobDeps: {
      // Live view over deps.projects() so dev config reloads pick up job changes
      get projects() { return deps.projects() },
      redis: getRedis(),
      makeJobCtx,
      db,
      // Admin pause/resume for code jobs (skips paused ids each pass).
      getPausedJobs: (workspaceId) => getPausedJobs(db, workspaceId),
      pauseJob: (workspaceId: string, jobId: string, reason: string) => pauseJob(db, workspaceId, jobId, null, reason),
      consecutiveFailures: (workspaceId, name, max) => consecutiveFailures(db, workspaceId, name, max),
    },
  })
  registerHousekeepingCapability({ db, redis: getRedis(), projects: () => deps.projects() })
  // Telemetry: demand-driven like every other optional capability. When it is
  // off nothing subscribes, so the emission seam stays on its free path
  // (Phase 9C, Unit 27). It starts no timer, no worker and no connection.
  registerTelemetryCapability()
  registerRealtimeCapability({ projects: () => deps.projects() as never })
  registerRedisCapability()
  registerWorkerCapabilities({
    db,
    projects: () => deps.projects() as never,
    starters: {
      taskWorker: () => startTaskWorker(),
      pgQueueWorker: () => {
        const num = (k: string) => { const n = Number(process.env[k]); return Number.isFinite(n) && n > 0 ? n : undefined }
        return startPgQueueWorker(db, { batchSize: num('TANGEN_QUEUE_BATCH'), pollMs: num('TANGEN_QUEUE_POLL_MS') })
      },
      webhookWorker: () => startWebhookWorker(db),
    },
  })

  configureTaskRuntime({
    resolveTask: (workspaceId, taskId) => {
      const project = deps.projects().find((p) => p.workspaceId === workspaceId)
      return project?.jobs?.tasks?.find((t) => t.id === taskId)
    },
    makeJobCtx,
  })
  configureTaskDb(db)
  // Schema changes arrive as a NOTIFY from push; without this the process
  // cache falls back to its TTL. Core, not a capability: every server has a
  // schema.
  void startSchemaInvalidationListener(db as never, (kind, detail) => {
    if (kind === 'unavailable') logger.warn(`schema cache: LISTEN unavailable, refreshing on TTL only (${detail ?? ''})`)
    else if (kind === 'resubscribe') logger.info('schema cache: LISTEN reconnected, cache dropped')
    // A push changed an environment's registry: the runtime tables follow it now,
    // not on the next request that happens to reload the schema.
    else if (kind === 'notify' && detail) void reloadContentTables().catch((e: unknown) => logger.warn(`content tables: refresh after a push failed: ${(e as Error).message}`))
  })
  // Knowledge embedding runs as a platform task through the durable queue
  const { registerKnowledgeTasks } = await import('../services/knowledge-sync')
  registerKnowledgeTasks(db, () => deps.projects())
  // Postgres cache fallback — caching keeps working without redis
  configurePgCache(db)

  if (deps.extensionGate) {
    registerExtensionCapabilities(runtimeRegistry, { ids: listRegisteredExtensionIds, manifest: getExtensionManifest, gate: deps.extensionGate, host: deps.extensionHost })
  }
  const started = await runtimeRegistry.start()
  // One line, not one per capability: a development boot printed nine.
  if (started.skipped.length) logger.info(`capabilities not started: ${started.skipped.map((s) => `${s.id} (${s.because})`).join(', ')}`)
  for (const s of started.skipped) logger.debug(`capability ${s.id}: ${s.because}`)
  for (const f of started.failed) logger.warn(`capability ${f.id} failed to start: ${f.error}`)
  // One shutdown path (runtime/shutdown.ts): SIGTERM/SIGINT drain the HTTP
  // server, stop and dispose every capability, close streams, the LISTEN and
  // the pool, then let the process exit because nothing holds it.
  const shutdown = createShutdown({
    server: deps.server ?? null,
    registry: runtimeRegistry,
    closeSse: () => sseManager.closeAll(),
    stopSchemaListener: () => stopSchemaInvalidationListener(db as never),
    // postgres.js: a pool with a connection still being attempted (a database
    // that is down) waits forever on a plain end(); the timeout closes it.
    closeDb: async () => {
      const raw = (db as { $rawClient?: { end?: (o?: { timeout?: number }) => Promise<void> } }).$rawClient
      if (raw?.end) return raw.end({ timeout: 2 })
      await (db as { end?: () => Promise<void> }).end?.()
    },
  })
  return { started, shutdown, registry: runtimeRegistry }
}
