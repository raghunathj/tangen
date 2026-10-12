/**
 * File Name: process.ts
 * Purpose: The Core capabilities a Tangen API process registers into the
 *          runtime registry, one definition per capability, with the
 *          availability and requirement rules that decide whether each
 *          STARTS (closure plan Phase 3). Boot registers them and starts the
 *          registry after the server listens; a route that creates
 *          persisted demand wakes the one it needs.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Unit 3 brought the scheduler (demand-driven: code
 *          jobs, enabled cron entries, scheduled content) and housekeeping
 *          (its own daily/hourly timers) under the registry; Unit 4 the
 *          Redis client and the four workers (task, Postgres queue, webhook
 *          delivery, forms) - the BullMQ workers depend on `redis` and are
 *          UNAVAILABLE without REDIS_URL rather than started against
 *          localhost; later units add realtime and the subscribers.
 *          Definitions only capture their dependencies; nothing here runs at
 *          import. Starters are injectable so the lifecycle is testable
 *          without a broker.
 */
import { runtimeRegistry, type RuntimeRegistry } from './registry'
import { startScheduler, schedulerDemand, hasSchedulerDemand, type SchedulerJobDeps } from '../workers/scheduler'
import { startHousekeeping, type Housekeeping, type HousekeepingDeps } from './housekeeping'
import type { EventBus } from '../services/event-bus'
import type { DbClient } from '@tangen/db'
import { sql } from 'drizzle-orm'
import { redisDisabled, getRedis, disposeRedis , redisState} from '../plugins/redis'
import { activeQueueBackend } from '../services/task-queue'
import { disposeWebhookQueue } from '../services/webhook-queue'
import { startRealtime, stopRealtime, realtimeEnabled } from '../realtime/transport'

export interface SchedulerCapabilityDeps {
  db: DbClient
  eventBus: EventBus
  jobDeps: SchedulerJobDeps
}

/** REGISTER the scheduler: it starts only when configuration or persisted demand asks for it. */
export function registerSchedulerCapability(deps: SchedulerCapabilityDeps, registry: RuntimeRegistry = runtimeRegistry): void {
  let stop: (() => void) | null = null
  registry.register({
    id: 'scheduler',
    label: 'Scheduler (scheduled publish, code jobs, cron entries)',
    kind: 'demand',
    required: async () => hasSchedulerDemand(await schedulerDemand(deps.db, deps.jobDeps.projects as never)),
    start: () => { stop ??= startScheduler(deps.db, deps.eventBus, deps.jobDeps) },
    stop: () => { stop?.(); stop = null },
  })
}

/** REGISTER housekeeping: retention, the AI-image reaper and the hourly connection health sweep, each on its own timer. */
export function registerHousekeepingCapability(deps: HousekeepingDeps, registry: RuntimeRegistry = runtimeRegistry): void {
  let handle: Housekeeping | null = null
  registry.register({
    id: 'housekeeping',
    label: 'Housekeeping (retention, AI-image reaper, connection health)',
    kind: 'core',
    start: () => { handle ??= startHousekeeping(deps) },
    stop: () => { handle?.stop(); handle = null },
  })
}

/**
 * A route that just created scheduler demand (a row scheduled to publish,
 * a cron entry enabled) calls this so the loop wakes now rather than at
 * the next boot. No-op in a process that did not register the scheduler.
 */
export function wakeScheduler(registry: RuntimeRegistry = runtimeRegistry): Promise<boolean> {
  return registry.ensureStarted('scheduler')
}

/** The one place a route wakes a capability whose demand it just created. */
export function wakeCapability(id: string, registry: RuntimeRegistry = runtimeRegistry): Promise<boolean> {
  return registry.ensureStarted(id)
}

const NEEDS_REDIS = 'needs Redis: set REDIS_URL (BullMQ delivery has no Postgres fallback)'

/** REGISTER the Redis client as infrastructure: available with REDIS_URL, connected on first command, closed at DISPOSE. */
export function registerRedisCapability(registry: RuntimeRegistry = runtimeRegistry): void {
  registry.register({
    id: 'redis',
    label: 'Redis client (queue, cache, fan-out)',
    kind: 'optional',
    availability: () => (redisState() === 'enabled' ? { available: true } : { available: false, reason: redisState() === 'disabled' ? 'Redis is switched off (redis.enabled false); Postgres fallbacks are in use' : 'REDIS_URL is not set; Postgres fallbacks are in use' }),
    // The client is lazy (Unit 2); START only makes sure it exists.
    start: () => { getRedis() },
    dispose: () => disposeRedis(),
  })
}

/** What each worker needs; the real starters come from workers/*, tests inject fakes. */
export interface WorkerStarters {
  taskWorker: () => { close(): Promise<void> } | null
  pgQueueWorker: () => { stop(): void }
  webhookWorker: () => { close(): Promise<void> }
}

export interface WorkerCapabilityDeps {
  db: DbClient
  projects: () => Array<{ formsConfig?: unknown; [k: string]: unknown }>
  starters: WorkerStarters
}

async function exists(db: DbClient, q: ReturnType<typeof sql>): Promise<boolean> {
  try {
    const r = await db.execute(q) as unknown
    return ((Array.isArray(r) ? r : (r as { rows?: unknown[] })?.rows ?? []) as unknown[]).length > 0
  } catch { return false }
}

/**
 * REGISTER the workers. Task and Postgres-queue workers follow the queue
 * backend (one of them is required, never both); webhook and form workers
 * are BullMQ-only, so they depend on `redis`, are unavailable without it,
 *          and are required only when a webhook exists -
 * the create routes wake them when demand appears later.
 */
export function registerWorkerCapabilities(deps: WorkerCapabilityDeps, registry: RuntimeRegistry = runtimeRegistry): void {
  let task: { close(): Promise<void> } | null = null
  registry.register({
    id: 'task-worker',
    label: 'Task worker (BullMQ)',
    kind: 'optional',
    dependsOn: ['redis'],
    required: () => activeQueueBackend() === 'redis',
    start: () => { task ??= deps.starters.taskWorker() },
    stop: async () => { const w = task; task = null; await w?.close() },
  })
  let pgQueue: { stop(): void } | null = null
  registry.register({
    id: 'pg-queue-worker',
    label: 'Task worker (Postgres queue)',
    kind: 'demand',
    required: () => activeQueueBackend() === 'postgres',
    start: () => { pgQueue ??= deps.starters.pgQueueWorker() },
    stop: () => { pgQueue?.stop(); pgQueue = null },
  })
  let webhooks: { close(): Promise<void> } | null = null
  registry.register({
    id: 'webhooks',
    label: 'Webhook delivery worker',
    kind: 'optional',
    dependsOn: ['redis'],
    availability: () => (redisDisabled() ? { available: false, reason: `webhook delivery ${NEEDS_REDIS}` } : { available: true }),
    required: () => exists(deps.db, sql`SELECT 1 AS one FROM webhooks LIMIT 1`),
    start: () => { webhooks ??= deps.starters.webhookWorker() },
    stop: async () => { const w = webhooks; webhooks = null; await w?.close() },
    dispose: () => disposeWebhookQueue(),
  })
}

/**
 * REGISTER realtime: mounted by the composer when a project wants it; START
 * opens the fan-out subscription; STOP closes every connection, the presence
 * sweep, the subscription and the bus listeners. Off means none of it.
 */
export function registerRealtimeCapability(deps: { projects: () => Array<{ config?: { realtime?: { enabled?: boolean } } }> }, registry: RuntimeRegistry = runtimeRegistry): void {
  registry.register({
    id: 'realtime',
    label: 'Realtime transport, presence and fan-out',
    kind: 'optional',
    required: () => realtimeEnabled(deps.projects()),
    start: () => startRealtime(),
    stop: () => stopRealtime(),
  })
}
