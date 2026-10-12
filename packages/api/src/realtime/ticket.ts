/**
 * File Name: ticket.ts
 * Purpose: Single-use connection tickets - the credential that opens a
 *          realtime connection, minted from a request that already carries a
 *          real one.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: R1 of tasks/plan-realtime.md (decision 2 in section 3).
 *          A browser cannot put an Authorization header on a WebSocket
 *          upgrade or an EventSource, and putting the session token in the
 *          URL would write it into every access log and proxy buffer between
 *          the tab and this process. So the connection is opened with a
 *          ticket instead: an opaque random id, minted by POST
 *          /api/v1/realtime/ticket under the normal Bearer derive, carrying
 *          the identity, workspace and environment of THAT request, valid for
 *          sixty seconds, and destroyed the moment it is redeemed. A ticket
 *          that leaks after use is worthless; one that leaks before use is
 *          worth one connection for under a minute, whose every subscription
 *          is still authorised against current permissions (authorize.ts).
 *
 *          Storage follows preview-token-store.ts: Redis when configured,
 *          the cache_entries table otherwise, and - new here - process memory
 *          when neither can take the write, because a single-process install
 *          with no Redis and a db that exposes no raw client should still be
 *          able to open a socket to itself. Redemption is atomic in every
 *          store (GETDEL, DELETE ... RETURNING, Map delete) so two tabs
 *          racing on one ticket admit exactly one. A write that fails under
 *          a configured Redis throws a 503 that names REDIS_URL, for the same
 *          reason preview tokens do: a ticket that "minted" but cannot be
 *          redeemed is strictly worse than a mint that failed.
 *
 *          R5: a site-auth member (X-Tangen-Key plus the site session JWT)
 *          mints too. The derive attaches the key's identity with
 *          `siteUserId` for this route only (realtime/site-auth.ts), and
 *          the ticket records `authMode: 'site-key'`: the permissions are
 *          the key's, the person is the site member, never an email.
 */
import { redisDisabled } from '../plugins/redis'
import { randomBytes } from 'node:crypto'
import type { Elysia } from 'elysia'
import { RequestError } from '../lib/errors'

/** How long a minted ticket may wait before it is used. */
export const TICKET_TTL_SECONDS = 60

/** What a ticket carries: everything the connection needs to know who it is. */
export interface RealtimeTicketClaims {
  v: 1
  workspaceId: string
  memberId: string | null
  apiKeyId: string | null
  /** The member's effective role at mint time; null for API keys. */
  memberRole: string | null
  /**
   * How the minting request authenticated. `site-key` (R5) is a site-auth
   * member: the X-Tangen-Key site key plus the site session JWT; the key's
   * grants are the permissions and `siteUserId` names the person.
   */
  authMode: 'member' | 'api_key' | 'site-key'
  /** The site member (auth_users.id) behind a `site-key` ticket; absent otherwise. */
  siteUserId?: string | null
  /** Epoch ms at mint; redemption re-checks the TTL against it. */
  issuedAt: number
}

/** A store that holds a ticket until it is taken, exactly once. */
export interface TicketStore {
  kind: 'memory' | 'postgres' | 'redis'
  put(key: string, json: string, ttlSeconds: number): Promise<void>
  /** Returns the stored value and removes it in one step, or null. */
  take(key: string): Promise<string | null>
}

const KEY_PREFIX = 'tangen:realtime:ticket:'
const TICKET_RE = /^rtk_[0-9a-f]{32}$/

// ── Memory store: one Map per process, shared by every instance ───────────────

const MEMORY = new Map<string, { json: string; exp: number }>()
const MEMORY_SWEEP_AT = 1000

/** Process-memory tickets; shared across instances so mint and redeem agree. */
export function memoryTicketStore(): TicketStore {
  return {
    kind: 'memory',
    async put(key, json, ttlSeconds) {
      if (MEMORY.size > MEMORY_SWEEP_AT) {
        const now = Date.now()
        for (const [k, v] of MEMORY) if (v.exp <= now) MEMORY.delete(k)
      }
      MEMORY.set(key, { json, exp: Date.now() + ttlSeconds * 1000 })
    },
    async take(key) {
      const hit = MEMORY.get(key)
      if (!hit) return null
      MEMORY.delete(key)
      return hit.exp > Date.now() ? hit.json : null
    },
  }
}

// ── Store selection ───────────────────────────────────────────────────────────

interface StoreDeps {
  redis: unknown
  db: unknown
  redisDisabled: boolean
}

/** postgres.js raw executor off a drizzle db, or null when unavailable. */
function pgExec(db: any): ((text: string, params?: unknown[]) => Promise<any[]>) | null {
  const raw = db?.$rawClient ?? db?.session?.client
  if (!raw?.unsafe) return null
  return (text: string, params?: unknown[]) => raw.unsafe(text, (params ?? []) as never)
}

const PG_UNAVAILABLE = new RequestError(
  'REALTIME_TICKET_STORE_UNAVAILABLE',
  'realtime could not store a connection ticket - the database did not take the write '
  + '(set REDIS_URL in .env to keep tickets in Redis instead)',
  503,
)

/**
 * Picks the store the process can actually use: Redis when REDIS_URL is set,
 * the cache_entries table when the db exposes a raw client, memory otherwise.
 * @param deps - The request's redis client, db and the redisDisabled flag.
 */
export function makeTicketStore({ redis, db, redisDisabled }: StoreDeps): TicketStore {
  if (redisDisabled) {
    const exec = pgExec(db)
    if (!exec) return memoryTicketStore()
    return {
      kind: 'postgres',
      async put(key, json, ttlSeconds) {
        await exec(
          `INSERT INTO cache_entries (key, value, tags, stored_at, expires_at)
           VALUES ($1, $2, '{}', now(), now() + ($3 || ' seconds')::interval)
           ON CONFLICT (key) DO UPDATE SET value = $2, stored_at = now(),
             expires_at = now() + ($3 || ' seconds')::interval`,
          [key, json, String(Math.max(1, Math.floor(ttlSeconds)))],
        ).catch(() => { throw PG_UNAVAILABLE })
      },
      async take(key) {
        const rows = await exec(
          `DELETE FROM cache_entries WHERE key = $1 AND expires_at > now() RETURNING value`,
          [key],
        ).catch(() => [])
        return rows[0] ? String(rows[0].value) : null
      },
    }
  }

  const client = redis as { set: Function; getdel?: Function; multi?: Function }
  const down = (cause: unknown) => new RequestError(
    'REALTIME_TICKET_STORE_UNAVAILABLE',
    `realtime could not reach Redis for a connection ticket (REDIS_URL is set but the server did not answer: `
    + `${cause instanceof Error ? cause.message : String(cause)}) - start Redis or unset REDIS_URL to use the Postgres fallback`,
    503,
  )
  return {
    kind: 'redis',
    async put(key, json, ttlSeconds) {
      try {
        await client.set(key, json, 'EX', ttlSeconds)
      } catch (e) {
        throw down(e)
      }
    },
    async take(key) {
      try {
        if (typeof client.getdel === 'function') {
          return ((await client.getdel(key)) as string | null) ?? null
        }
        // Redis < 6.2: GET and DEL in one transaction is still one winner.
        const [[, value]] = await client.multi!().get(key).del(key).exec()
        return (value as string | null) ?? null
      } catch (e) {
        throw down(e)
      }
    },
  }
}

// ── Mint and redeem ───────────────────────────────────────────────────────────

/**
 * Mints a ticket for the given claims.
 * @returns The opaque ticket and the seconds it stays valid.
 */
export async function mintTicket(
  store: TicketStore,
  claims: RealtimeTicketClaims,
  opts: { ttlSeconds?: number } = {},
): Promise<{ ticket: string; expiresIn: number }> {
  const ttl = opts.ttlSeconds ?? TICKET_TTL_SECONDS
  const ticket = `rtk_${randomBytes(16).toString('hex')}`
  await store.put(KEY_PREFIX + ticket, JSON.stringify(claims), ttl)
  return { ticket, expiresIn: ttl }
}

/**
 * Redeems a ticket: removes it from the store and returns its claims, or null
 * when it is unknown, malformed, already used, or past its TTL.
 */
export async function redeemTicket(store: TicketStore, ticket: string): Promise<RealtimeTicketClaims | null> {
  if (typeof ticket !== 'string' || !TICKET_RE.test(ticket)) return null
  const json = await store.take(KEY_PREFIX + ticket)
  if (!json) return null
  let claims: RealtimeTicketClaims
  try {
    claims = JSON.parse(json) as RealtimeTicketClaims
  } catch {
    return null
  }
  if (claims.v !== 1 || !claims.workspaceId) return null
  if (typeof claims.issuedAt !== 'number' || claims.issuedAt + TICKET_TTL_SECONDS * 1000 < Date.now()) return null
  return claims
}

/**
 * Builds claims from the auth derive's context. The client sends nothing:
 * workspace, environment and identity are what the request proved.
 * @throws RequestError 400 when the request named no environment.
 */
export function claimsFromContext(ctx: {
  workspaceId?: string | null
  memberId?: string | null
  apiKeyId?: string | null
  memberRole?: string | null
  /** R5: set by the derive for a site-auth member on the ticket route. */
  siteUserId?: string | null
}): RealtimeTicketClaims {
  if (!ctx.workspaceId) throw new RequestError('REALTIME_NO_WORKSPACE', 'realtime tickets need a workspace', 400)
  const memberId = ctx.memberId ?? null
  const apiKeyId = ctx.apiKeyId ?? null
  if (!memberId && !apiKeyId) throw new RequestError('UNAUTHORIZED', 'realtime tickets need an authenticated caller', 401)
  const siteUserId = !memberId && apiKeyId ? (ctx.siteUserId ?? null) : null
  return {
    v: 1,
    workspaceId: ctx.workspaceId,
    memberId,
    apiKeyId: memberId ? null : apiKeyId,
    memberRole: memberId ? (ctx.memberRole ?? null) : null,
    authMode: memberId ? 'member' : siteUserId ? 'site-key' : 'api_key',
    ...(siteUserId ? { siteUserId } : {}),
    issuedAt: Date.now(),
  }
}

// ── Process-wide store and the route ──────────────────────────────────────────

let configured: TicketStore | null = null

/** Installs the store the transport redeems against; the route mints into the same one. */
export function configureTicketStore(store: TicketStore | null): void {
  configured = store
}

/** The store for a request: the configured one, else built from the request's clients. */
export function ticketStoreFor(ctx: { redis?: unknown; db?: unknown }): TicketStore {
  if (configured) return configured
  return makeTicketStore({ redis: ctx.redis, db: ctx.db, redisDisabled: redisDisabled() })
}

/**
 * POST /api/v1/realtime/ticket - mounted after authMiddleware, so `ctx` is the
 * derive's verdict on who is asking. Answers `{ data: { ticket, expiresIn } }`.
 */
export const realtimeTicketRoute = (opts: { store?: TicketStore } = {}) => (app: Elysia) =>
  app.post('/api/v1/realtime/ticket', async (ctx: any) => {
    const claims = claimsFromContext(ctx)
    const store = opts.store ?? ticketStoreFor(ctx)
    const minted = await mintTicket(store, claims)
    return { data: minted }
  })
