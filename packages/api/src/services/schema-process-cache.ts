/**
 * File Name: schema-process-cache.ts
 * Purpose: The schema loader and the in-process cache in front of it: process
 *          cache, then Redis when configured, then PostgreSQL - plus the LISTEN
 *          that lets a push in another process empty it. ONE registry per
 *          database (tasks/remove-environments-programme.md): the cache holds
 *          one schema, and every workspace of this deployment reads it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This is the module that does the work; `schema-cache.ts`
 *   is the façade every caller imports. They are separate because several
 *   suites `mock.module` the façade, and Bun's module mocks are process-global.
 *   A push writes the registry in one transaction and sends
 *   pg_notify(SCHEMA_CHANNEL) AFTER that transaction commits; the listener
 *   bumps the generation so a load that began before the commit can never
 *   become the cached truth.
 */
import type { Redis } from 'ioredis'
import type { DbClient } from '@tangen/db'
import { objectTypes, fields, schemaCacheKey, SCHEMA_CHANNEL } from '@tangen/db'
import type { SchemaDefinition, FieldType } from '@tangen/types'

export const SCHEMA_HIT_KEY = () => 'tangen:stats:schema:hits'
export const SCHEMA_MISS_KEY = () => 'tangen:stats:schema:misses'
const CACHE_TTL = 300
export const SCHEMA_CACHE_KEY = () => schemaCacheKey()

interface TypeRow {
  id: string
  name: string
  label: string
  plural?: string | null
  singleton: boolean
  disabled?: boolean
  localized?: boolean
  adminConfig: unknown
  schemaVersion: number
  previousNames: string[] | null
  providedBy?: string | null
}

interface FieldRow {
  typeId: string
  name: string
  label: string
  fieldType: string
  config: unknown
  required: boolean
  position: number
  previousNames: string[] | null
}

/** The registry as PostgreSQL holds it: every type and field of this database. */
export async function loadSchemaFromDb(db: DbClient): Promise<SchemaDefinition> {
  const [typeRows, fieldRows] = await Promise.all([
    db.select().from(objectTypes),
    db.select().from(fields),
  ])
  return buildSchemaDefinition(typeRows, fieldRows)
}

const loadedHooks = new Set<(schema: SchemaDefinition) => void>()
/** Runs after every load that becomes the cached truth (boot, a refill after a push). */
export function onSchemaLoaded(fn: (schema: SchemaDefinition) => void): () => void {
  loadedHooks.add(fn)
  return () => { loadedHooks.delete(fn) }
}
function notifyLoaded(schema: SchemaDefinition): void {
  for (const fn of loadedHooks) { try { fn(schema) } catch { /* a listener never breaks a load */ } }
}

export function buildSchemaDefinition(types: TypeRow[], fieldRows: FieldRow[]): SchemaDefinition {
  return {
    types: types.map((t) => ({
      id: t.id,
      name: t.name,
      label: t.label,
      ...(t.plural ? { plural: t.plural } : {}),
      singleton: t.singleton,
      ...(t.disabled ? { disabled: true } : {}),
      ...(t.localized ? { localized: true } : {}),
      ...(t.providedBy ? { providedBy: t.providedBy } : {}),
      admin: (t.adminConfig as SchemaDefinition['types'][number]['admin']) ?? {},
      fields: fieldRows
        .filter((f) => f.typeId === t.id)
        .sort((a, b) => a.position - b.position)
        .map((f) => {
          const config = (f.config as Record<string, unknown>) ?? {}
          return {
            name: f.name,
            label: f.label,
            helpText: (config.admin as any)?.helpText as string | undefined,
            fieldType: f.fieldType as FieldType,
            config,
            previousName: (f.previousNames ?? []),
            required: f.required,
            ...((f as { disabled?: boolean }).disabled ? { disabled: true } : {}),
          }
        }),
    })),
  }
}

// ── The process cache ─────────────────────────────────────────────────────────

export const PROCESS_CACHE_TTL_MS = 60_000

interface Entry { schema: SchemaDefinition; loadedAt: number; gen: number }
let entry: Entry | null = null
let inflight: Promise<SchemaDefinition> | null = null
let generation = 0
let bypassRedis = false
const stats = { hits: 0, misses: 0, loads: 0, invalidations: 0, ttlExpiries: 0, loadFailures: 0 }
let now: () => number = () => Date.now()

export function schemaProcessCacheStats(): typeof stats & { entries: number } {
  return { ...stats, entries: entry ? 1 : 0 }
}

/** Forget the cached schema; the next read goes to PostgreSQL, past Redis. */
export function invalidateSchema(): void {
  stats.invalidations++
  generation++
  entry = null
  inflight = null
  bypassRedis = true
}

export function invalidateAllSchema(): void { invalidateSchema() }

export function __resetSchemaCacheForTests(clock?: () => number): void {
  entry = null; inflight = null; generation = 0; bypassRedis = false
  for (const k of Object.keys(stats)) (stats as Record<string, number>)[k] = 0
  now = clock ?? (() => Date.now())
}

// ── LISTEN: a push elsewhere empties this process ─────────────────────────────

const listening = new WeakSet<object>()
const listeners = new WeakMap<object, { unlisten?: () => Promise<unknown> }>()

export async function stopSchemaInvalidationListener(db: { $rawClient?: object }): Promise<void> {
  const raw = db?.$rawClient
  if (!raw) return
  const l = listeners.get(raw)
  listeners.delete(raw)
  listening.delete(raw)
  if (l?.unlisten) { try { await l.unlisten() } catch { /* connection already gone */ } }
}

export async function startSchemaInvalidationListener(
  db: { $rawClient?: { listen?: (c: string, fn: (payload: string) => void, onlisten?: () => void) => Promise<unknown> } },
  onEvent?: (kind: 'notify' | 'resubscribe' | 'unavailable', detail?: string) => void,
): Promise<boolean> {
  const raw = db?.$rawClient
  if (typeof raw?.listen !== 'function') { onEvent?.('unavailable', 'driver has no listen'); return false }
  if (listening.has(raw)) return true
  listening.add(raw)
  let subscribed = 0
  try {
    const handle = await raw.listen(
      SCHEMA_CHANNEL,
      () => { invalidateSchema(); onEvent?.('notify') },
      () => { if (subscribed++ > 0) { invalidateSchema(); onEvent?.('resubscribe') } },
    )
    listeners.set(raw, (handle ?? {}) as { unlisten?: () => Promise<unknown> })
    return true
  } catch (e) {
    listening.delete(raw)
    onEvent?.('unavailable', (e as Error).message)
    return false
  }
}

/**
 * The schema of this database: process cache, then Redis, then PostgreSQL.
 * One in-flight load at a time; a failed load is not cached and the next
 * caller retries.
 */
export async function getSchema(db: DbClient, redis: Redis): Promise<SchemaDefinition> {
  if (entry) {
    if (now() - entry.loadedAt < PROCESS_CACHE_TTL_MS) { stats.hits++; return entry.schema }
    stats.ttlExpiries++
    entry = null
  }
  stats.misses++
  if (inflight) return inflight

  const gen = generation
  const load = loadSchema(db, redis)
    .then((schema) => {
      // Store only into the generation this load began in. If a push committed
      // and its notification bumped the generation while we were loading, what
      // we hold may be the pre-commit schema; serve it to the callers that were
      // already waiting, but never let it become the cached truth.
      if (generation === gen) { entry = { schema, loadedAt: now(), gen }; notifyLoaded(schema) }
      return schema
    })
    .catch((e) => { stats.loadFailures++; throw e })
    .finally(() => { if (inflight === load) inflight = null })
  inflight = load
  return load
}

async function loadSchema(db: DbClient, redis: Redis): Promise<SchemaDefinition> {
  stats.loads++
  const key = SCHEMA_CACHE_KEY()
  const skipRedis = bypassRedis
  bypassRedis = false

  if (!skipRedis) {
    // Redis cache - 500 ms hard timeout so a slow or down Redis never blocks a request
    const cached = await Promise.race([
      redis.get(key),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 500)),
    ]).catch(() => null)
    if (cached) {
      try { redis.incr(SCHEMA_HIT_KEY()).catch(() => {}) } catch {}
      return JSON.parse(cached) as SchemaDefinition
    }
  }
  try { redis.incr(SCHEMA_MISS_KEY()).catch(() => {}) } catch {}
  const schema = await loadSchemaFromDb(db)
  await redis.set(key, JSON.stringify(schema), 'EX', CACHE_TTL).catch(() => {})
  return schema
}
