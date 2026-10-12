/**
 * File Name: api-key-auth.ts
 * Purpose: Validates tgn_ API key tokens against the database and provides helpers for
 * checking per-route action permissions granted to a key.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Drizzle ORM (@tangen/db apiKeys table), Redis for short-lived
 * validation cache, Node.js crypto for SHA-256 hashing.
 */
import { sanitizeApiKeyPermissions } from './api-key-permissions'
import { createHash } from 'node:crypto'
import { eq, and, isNull } from 'drizzle-orm'
import { apiKeys, identities } from '@tangen/db'
import type { ApiKeyPermissions, IdentitySummary, ActorContext, ActorIdentity } from '@tangen/types'
import { identityActor, apiKeyActor } from '../kernel/actor'

const CACHE_TTL_SECONDS = 30

export interface ValidatedApiKey {
  keyId: string
  workspaceId: string
  permissions: ApiKeyPermissions
  /** K8: the identity this key is a credential of; the request acts as it. Absent for a key that acts as itself. */
  identity?: IdentitySummary | null
}

/** The identity behind a key row: null when the key acts as itself; `false` when the identity is gone or suspended (the key is unusable). */
export async function loadKeyIdentity(db: any, key: { identityId?: string | null; workspaceId: string }): Promise<IdentitySummary | null | false> {
  if (!key.identityId) return null
  const [row] = await db.select().from(identities).where(and(eq(identities.id, key.identityId), eq(identities.workspaceId, key.workspaceId))).limit(1)
  if (!row || row.status !== 'active') return false
  return {
    id: row.id as string, workspaceId: row.workspaceId as string, kind: row.kind as IdentitySummary['kind'], name: row.name as string,
    status: row.status as IdentitySummary['status'], permissions: sanitizeApiKeyPermissions(row.permissions),
    capabilities: Array.isArray(row.capabilities) ? (row.capabilities as string[]) : [],
  }
}

/** The actor a validated key acts as: its identity when it has one, else the key itself. */
export function actorForKey(v: ValidatedApiKey, workspaceId: string, onBehalfOf?: ActorIdentity | null): ActorContext {
  return v.identity
    ? identityActor({ identity: v.identity, workspaceId, onBehalfOf })
    : apiKeyActor({ apiKeyId: v.keyId, workspaceId, permissions: v.permissions, onBehalfOf })
}

/** The id the request attributes to: the identity's when the key has one. */
export function actorIdForKey(v: ValidatedApiKey): string {
  return v.identity ? v.identity.id : v.keyId
}

function cacheKey(token: string): string {
  return `tgn:apikey:${createHash('sha256').update(token).digest('hex')}`
}

/**
 * Validates a tgn_ API key token against the DB.
 * Caches the result in Redis for CACHE_TTL_SECONDS to avoid a DB hit on every request.
 * Returns null if the token is invalid, expired, or revoked.
 * @param db - Drizzle database instance.
 * @param redis - Redis client instance; if null/undefined the cache is skipped.
 * @param token - Raw API key token string (must start with "tgn_").
 * @returns Resolved key metadata, or null when the token is not valid.
 */
export async function validateApiKey(
  db: any,
  redis: any,
  token: string,
): Promise<ValidatedApiKey | null> {
  if (!token.startsWith('tgn_')) return null

  const ck = cacheKey(token)

  // Redis cache hit
  if (redis) {
    try {
      const cached = await redis.get(ck)
      if (cached === 'invalid') return null
      if (cached) return JSON.parse(cached) as ValidatedApiKey
    } catch {
      // Redis error — fall through to DB
    }
  }

  const prefix = token.slice(0, 12)
  const keyHash = createHash('sha256').update(token).digest('hex')

  const [key] = await db
    .select()
    .from(apiKeys)
    .where(and(
      eq(apiKeys.keyPrefix, prefix),
      eq(apiKeys.keyHash, keyHash),
      isNull(apiKeys.revokedAt),
    ))
    .limit(1)

  if (!key || (key.expiresAt && key.expiresAt < new Date())) {
    // Cache negative result briefly to avoid hammering DB on invalid tokens
    if (redis) {
      try { await redis.set(ck, 'invalid', 'EX', 10) } catch { /* ignore */ }
    }
    return null
  }

  const identity = await loadKeyIdentity(db, key)
  if (identity === false) {
    if (redis) {
      try { await redis.set(ck, 'invalid', 'EX', 10) } catch { /* ignore */ }
    }
    return null
  }
  const result: ValidatedApiKey = {
    keyId: key.id as string,
    workspaceId: key.workspaceId as string,
    permissions: identity ? identity.permissions : sanitizeApiKeyPermissions(key.permissions),
    identity,
  }

  // Touch lastUsedAt on DB-validated use (fire-and-forget; the Redis cache
  // means this runs at most once per CACHE_TTL_SECONDS per key)
  try {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id))
  } catch { /* non-critical */ }

  if (redis) {
    try { await redis.set(ck, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS) } catch { /* ignore */ }
  }

  return result
}

/**
 * Resolves the key named by a verified API Playground token into the same
 * ValidatedApiKey shape as a real `tgn_` key — so custom routes get the
 * key's REAL permissions (and its real 403s) when tested from the
 * playground. Returns null if the key is missing, revoked, or expired.
 */
export async function resolvePlaygroundKey(
  db: any,
  claims: { keyId: string; workspaceId: string },
): Promise<ValidatedApiKey | null> {
  const [key] = await db.select().from(apiKeys)
    .where(and(eq(apiKeys.id, claims.keyId), eq(apiKeys.workspaceId, claims.workspaceId), isNull(apiKeys.revokedAt)))
    .limit(1)
  if (!key || (key.expiresAt && key.expiresAt < new Date())) return null
  const identity = await loadKeyIdentity(db, key)
  if (identity === false) return null
  return {
    keyId: key.id as string,
    workspaceId: key.workspaceId as string,
    permissions: identity ? identity.permissions : key.permissions as ApiKeyPermissions,
    identity,
  }
}

/**
 * Checks whether a validated API key has permission for a specific customRoute action.
 * If no apiGroup is declared on the route, any valid key is accepted.
 * @param permissions - The ApiKeyPermissions object from a validated key.
 * @param groupId - The custom route group identifier to check against.
 * @param action - The action string to verify (e.g. "read", "write").
 * @returns True when the key grants the requested action on the given group.
 */
export function checkCustomRoutePermission(
  permissions: ApiKeyPermissions,
  groupId: string,
  action: string,
): boolean {
  const granted = permissions.customRoutes?.[groupId]
  if (!granted) return false
  return granted.includes(action)
}

/**
 * Normalizes a route's apiGroup declaration. The string shorthand references
 * a resource declared via defineApiResource(): label/description come from
 * the declaration, and a single-action resource supplies its action (multi-
 * action resources fall back to the HTTP-method-derived action). An unmatched
 * string still yields a group (label = id) so misconfiguration stays visible
 * in the API manager rather than silently un-gating the route.
 */
export function normalizeApiGroup(
  apiGroup: import('@tangen/types').RouteApiGroup | string | undefined,
  resources?: import('@tangen/types').ApiResourceDefinition[],
): import('@tangen/types').RouteApiGroup | undefined {
  if (!apiGroup) return undefined
  if (typeof apiGroup !== 'string') return apiGroup
  const resource = resources?.find((r) => r.id === apiGroup)
  if (!resource) return { id: apiGroup, label: apiGroup }
  return {
    id: resource.id,
    label: resource.label,
    ...(resource.description ? { description: resource.description } : {}),
    ...(resource.actions.length === 1 ? { action: resource.actions[0] } : {}),
  }
}

/**
 * Checks whether a key may perform an action on a declared API resource.
 * A per-item override in permissions.resources[resourceId][itemKey] replaces
 * the resource-wide grant from permissions.customRoutes[resourceId]; items
 * without an override fall back to that grant. Admin permissions always pass.
 */
export function checkResourcePermission(
  permissions: ApiKeyPermissions | { admin: true },
  resourceId: string,
  action: string,
  itemKey?: string,
): boolean {
  if ('admin' in permissions && permissions.admin) return true
  const perms = permissions as ApiKeyPermissions
  if (itemKey) {
    const override = perms.resources?.[resourceId]?.[itemKey]
    if (override) return override.includes(action)
  }
  return perms.customRoutes?.[resourceId]?.includes(action) ?? false
}


/**
 * Whether a key holds `action` under an extension's `apiKeyScope`
 * (plan-core-slimming F1): a per-item override (by id or slug) replaces the
 * global grant for that item; admin (member) permissions always pass.
 */
export function checkExtensionPermission(
  permissions: ApiKeyPermissions | { admin: true } | null | undefined,
  extensionId: string,
  action: string,
  item?: { id: string; slug?: string | null } | null,
): boolean {
  if (!permissions) return false
  if ('admin' in permissions && permissions.admin) return true
  const grant = (permissions as ApiKeyPermissions).extensions?.[extensionId]
  if (!grant) return false
  if (item) {
    const override = grant.items?.[item.id] ?? (item.slug ? grant.items?.[item.slug] : undefined)
    if (override) return override.includes(action)
  }
  return grant.actions?.includes(action) ?? false
}

/**
 * Pulls a tgn_ API key token from a request — Authorization: Bearer, the
 * X-API-Key header, or a ?key= query param (for embeds that can't set
 * headers). Member JWTs and other tokens are ignored.
 * @param request - The incoming Request (headers.get interface).
 * @param query - Parsed query params, checked for a `key` entry.
 * @returns The raw tgn_ token, or null when none is present.
 */
export function extractApiKeyToken(request: any, query?: Record<string, unknown>): string | null {
  const auth = request?.headers?.get?.('authorization')
  if (typeof auth === 'string' && auth.startsWith('Bearer tgn_')) return auth.slice(7)
  const header = request?.headers?.get?.('x-api-key')
  if (typeof header === 'string' && header.startsWith('tgn_')) return header
  const q = query?.key
  if (typeof q === 'string' && q.startsWith('tgn_')) return q
  return null
}

/**
 * Builds a Content-Security-Policy frame-ancestors directive from a form's
 * embed allowedDomains. 'self' is always included so the admin preview works.
 * @param allowedDomains - Origins allowed to iframe the embed page.
 * @returns The CSP directive value, or null when embedding is unrestricted.
 */
export function frameAncestorsHeader(allowedDomains?: string[]): string | null {
  const domains = (allowedDomains ?? [])
    .map((d) => String(d).replace(/[\r\n\s]+/g, '')) // header-injection safety
    .filter(Boolean)
  if (domains.length === 0) return null
  return `frame-ancestors 'self' ${domains.join(' ')}`
}

/**
 * Derives the default action name from an HTTP method.
 * GET → read, DELETE → delete, everything else → write
 * @param method - HTTP method string (e.g. "GET", "POST", "PUT").
 * @returns The derived action name used for permission checks.
 */
export function deriveAction(method: string): string {
  if (method === 'GET') return 'read'
  if (method === 'DELETE') return 'delete'
  return 'write'
}
