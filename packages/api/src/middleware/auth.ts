/**
 * File Name: auth.ts
 * Purpose: Elysia derive middleware that authenticates every admin API request,
 *   supporting both member JWTs and API key tokens (prefix "tgn_"), then
 *   attaches workspaceId, permissions, memberId, memberRole, and schema
 *   to the request context.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: elysia, jose, drizzle-orm, @tangen/db (apiKeys, memberEnvRoles, workspaceDomains),
 *   ../lib/workspace-boundary, ../services/schema-cache,
 *   ../gateway/route-policy (M3: which routes need a credential at all)
 */

import { createHash } from 'node:crypto'
import { Elysia } from 'elysia'
import { eq, and, isNull } from 'drizzle-orm'
import { apiKeys, workspaceDomains, members } from '@tangen/db'
import { RequestError } from '../lib/errors'
import { sanitizeApiKeyPermissions } from '../lib/api-key-permissions'
import { memberActor, apiKeyActor, identityActor, requestExecution, resolveExecutionWorkspace } from '../kernel'
import { loadKeyIdentity } from '../lib/api-key-auth'
import { projectLocalization } from '../services/i18n'
import type { ActorContext, ExecutionContext, ExecutionSource, IdentitySummary, ActorIdentity } from '@tangen/types'

// ── Env-role cache (per-process). Keyed member:env → role|null. 30s TTL keeps
// permission changes fast-ish even without explicit invalidation; the env-role
// management route calls invalidateEnvRoleCache for immediacy.
import type { ApiKeyPermissions } from '@tangen/types'
import { getSchema } from '../services/schema-cache'
import { resolveWorkspaceFromRequest, isSuperAdmin } from '../lib/workspace-boundary'
import { verifyMemberToken } from '../lib/jwt-secret'
import { verifyPlaygroundToken } from '../lib/playground-token'
import { permissionsForRole, isBuiltInRole, resolveCodeRole, compileRoleSeed, isNoAccessRole, mergeMemberGrants } from '@tangen/types'
import type { MemberPermissions, MemberGrants, Capability, ExtensionId } from '@tangen/types'
import { resolveRoutePolicy, skipsCredentialDerive } from '../gateway/route-policy'
import { resolveSiteAuthTicketIdentity } from '../realtime/site-auth'
import { gatewayContextOf } from '../gateway/request-context'
import { refuseClosedSurfaceForCredential } from '../gateway/surface-exposure'
import { roles, memberGrants } from '@tangen/db'



/** Redis key for the suspension kill-switch set by the suspend endpoint. */
export function memberSuspensionKey(memberId: string): string {
  return `tangen:member:suspended:${memberId}`
}

const ROLE_CACHE_TTL_SECONDS = 60

/** Redis cache key for a custom role's permission bundle. */
/**
 * The in-process seam a permission change fires: a role bundle rewritten, a
 * member's role or status changed. An open realtime connection listens and
 * re-checks what it holds (realtime/transport.ts). Called with a member id
 * for one member, with none for everyone.
 */
const permissionListeners = new Set<(memberId?: string) => void>()
export function onMemberPermissionsInvalidated(listener: (memberId?: string) => void): () => void {
  permissionListeners.add(listener)
  return () => { permissionListeners.delete(listener) }
}
export function invalidateMemberPermissions(memberId?: string): void {
  for (const l of permissionListeners) { try { l(memberId) } catch { /* a listener never breaks a write */ } }
}

export function roleCacheKey(workspaceId: string, slug: string): string {
  return `tangen:role:${workspaceId}:${slug}`
}

// ── Per-user additive grants (tasks/plan-per-user-grants.md) ─────────────────
// A member's authority = their role bundle + optional grants, unioned. Grants
// live in THIS deployment's database (one row per member), read redis-cached so
// the built-in-role fast path keeps costing at most one GET, and merged right
// where the role bundle resolves so every downstream check sees the union.

const GRANTS_CACHE_TTL_SECONDS = 60

/** Redis cache key for a member's stored grant row (negative results cached too). */
export function memberGrantsKey(workspaceId: string, memberId: string): string {
  return `tangen:grants:${workspaceId}:${memberId}`
}

/** Fires the same permission-invalidation seam a role/status change fires, so a
 *  grant edit is picked up within the cache window and open connections re-check. */
export function invalidateMemberGrants(redis: unknown, workspaceId: string, memberId: string): void {
  const r = redis as { del?: (k: string) => unknown } | null | undefined
  // Fire-and-forget, but catch BOTH a sync throw and an async rejection so a
  // redis hiccup can never surface as an unhandled rejection / crashed request.
  try { void Promise.resolve(r?.del?.(memberGrantsKey(workspaceId, memberId))).catch(() => {}) } catch { /* redis down → TTL still expires it */ }
  try { invalidateMemberPermissions(memberId) } catch { /* a listener never breaks the write */ }
}

/** The stored grant row as cached (JSON-safe). `null` = a cached "no grants". */
export interface StoredMemberGrant {
  capabilities?: string[]
  extensions?: string[]
  expiresAt?: string | null
}

/**
 * Applies expiry and drops an empty grant. Pure, so it runs on every read
 * (including a cache hit), which means an expired grant stops applying without
 * waiting for the cache to turn over. Returns undefined when there is nothing
 * to add - `mergeMemberGrants` then returns the role bundle untouched.
 */
export function activeMemberGrants(raw: StoredMemberGrant | null | undefined, now: Date = new Date()): MemberGrants | undefined {
  if (!raw) return undefined
  if (raw.expiresAt && new Date(raw.expiresAt).getTime() <= now.getTime()) return undefined
  const capabilities = (raw.capabilities ?? []) as Capability[]
  const extensions = (raw.extensions ?? []) as ExtensionId[]
  if (capabilities.length === 0 && extensions.length === 0) return undefined
  return { capabilities, extensions }
}

/**
 * Whether a member has a grant row at all - computed once at login/refresh and
 * stamped into the access token as `hasGrants`, so the per-request hot path can
 * skip the grant read entirely for the (vast majority of) members who hold none.
 * Ignores expiry: a stale row only means one wasted cached read until it is
 * cleaned up, never a wrong answer.
 */
export async function memberHasActiveGrant(db: any, workspaceId: string, memberId: string): Promise<boolean> {
  try {
    const [r] = await db.select({ m: memberGrants.memberId }).from(memberGrants)
      .where(and(eq(memberGrants.workspaceId, workspaceId), eq(memberGrants.memberId, memberId)))
      .limit(1)
    return !!r
  } catch { return false }
}

/**
 * Reads a member's stored grant row, redis-cached. Both a hit and a miss are
 * cached (a member with no grants caches `null`), so in steady state an ordinary
 * member costs one redis GET, never a DB read. Falls through to a single indexed
 * PK lookup on a cache miss or when redis is absent.
 */
export async function resolveMemberGrants(
  db: any, redis: any, workspaceId: string, memberId: string,
): Promise<StoredMemberGrant | null> {
  const key = memberGrantsKey(workspaceId, memberId)
  if (redis) {
    try { const c = await redis.get(key); if (c != null) return JSON.parse(c) as StoredMemberGrant | null } catch { /* fall through to DB */ }
  }
  let row: StoredMemberGrant | null = null
  try {
    const [r] = await db.select().from(memberGrants)
      .where(and(eq(memberGrants.workspaceId, workspaceId), eq(memberGrants.memberId, memberId)))
      .limit(1)
    if (r) row = {
      capabilities: (r.capabilities ?? []) as string[],
      extensions: (r.extensions ?? []) as string[],
      expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
    }
  } catch { row = null }
  if (redis) { try { await redis.set(key, JSON.stringify(row), 'EX', GRANTS_CACHE_TTL_SECONDS) } catch { /* ignore */ } }
  return row
}

/**
 * Resolves a member's effective role to a permission bundle, then unions any
 * per-member grants on top (additive only). Pass `memberId` to apply grants;
 * without it, or for the admin fast-path bundle, the role bundle is returned
 * unchanged. Built-in roles compile purely; custom slugs load the workspace's
 * roles table (redis-cached); unknown slugs floor to the viewer bundle.
 */
export async function resolveMemberPermissions(
  db: any,
  redis: any,
  workspaceId: string,
  role: string,
  project?: { roles?: import('@tangen/types').RoleSeedDefinition[] },
  memberId?: string | null,
  /** The token's `hasGrants` claim: `false` skips the grant read (fast path);
   *  `true`/`undefined` reads (undefined = legacy token or a non-derive caller). */
  hasGrants?: boolean,
): Promise<ApiKeyPermissions | { admin: true }> {
  const base = await resolveRoleBundle(db, redis, workspaceId, role, project)
  if (!memberId || (base as { admin?: boolean }).admin === true || hasGrants === false) return base
  const raw = await resolveMemberGrants(db, redis, workspaceId, memberId)
  return mergeMemberGrants(base as MemberPermissions, activeMemberGrants(raw)) as ApiKeyPermissions
}

/** Resolves ONLY the role's bundle (no grants). The role cache lives here. */
async function resolveRoleBundle(
  db: any,
  redis: any,
  workspaceId: string,
  role: string,
  project?: { roles?: import('@tangen/types').RoleSeedDefinition[] },
): Promise<ApiKeyPermissions | { admin: true }> {
  // Code-defined roles win (and may override built-in editor/viewer);
  // owner/admin/superadmin are protected inside resolveCodeRole
  const codeRole = resolveCodeRole(project?.roles, role)
  if (codeRole) return compileRoleSeed(codeRole) as ApiKeyPermissions

  if (role === 'superadmin' || isBuiltInRole(role)) {
    return permissionsForRole(role) as ApiKeyPermissions | { admin: true }
  }

  const ck = roleCacheKey(workspaceId, role)
  if (redis) {
    try {
      const cached = await redis.get(ck)
      if (cached) return JSON.parse(cached)
    } catch { /* fall through to DB */ }
  }

  const [row] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.workspaceId, workspaceId), eq(roles.slug, role)))
    .limit(1)

  if (!row) {
    console.warn(`[rbac] unknown role "${role}" in ${workspaceId} - treating as viewer`)
    return permissionsForRole('viewer') as ApiKeyPermissions
  }

  const perms = (row.permissions ?? {}) as ApiKeyPermissions
  if (redis) {
    try { await redis.set(ck, JSON.stringify(perms), 'EX', ROLE_CACHE_TTL_SECONDS) } catch { /* ignore */ }
  }
  return perms
}

/**
 * Strips the port from a Host header value and lowercases the result.
 * @param host - Raw Host header string (e.g. "example.com:3000")
 * @returns Hostname without the port (e.g. "example.com")
 */
export function extractHostDomain(host: string): string {
  return host.split(':')[0].toLowerCase()
}

async function resolveWorkspaceByDomain(host: string, db: any): Promise<string | null> {
  const domain = extractHostDomain(host)
  if (!domain || domain === 'localhost') return null
  const [row] = await db
    .select()
    .from(workspaceDomains)
    .where(eq(workspaceDomains.domain, domain))
    .limit(1)
  return row?.workspaceId ?? null
}


class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * Elysia plugin that derives auth context for every request that reaches it.
 *
 * M3 of tasks/plan-gateway.md: whether a credential is required is now read
 * from the Gateway's ROUTE-POLICY TABLE rather than from five URL prefixes
 * compared inside this function. `public` and `self-authenticating` rows step
 * aside exactly as those prefixes did - the site-auth mount (X-Tangen-Key,
 * enforced by siteKeyMiddleware), the GraphiQL shell, the porter receive
 * surface, the extension key/public mount whose dispatch() checks each route
 * itself, and published delivery artifacts a browser fetches with no key.
 * Everything else authenticates below, unchanged.
 *
 * What moved is WHERE the decision is read, not the decision: the security
 * posture of a route stops being a property of its NAME, and a route that
 * needs no platform credential has to say so in the table, with a written
 * reason a reviewer can read. See gateway-m3-auth-parity.test.ts, which
 * replays a representative request per row through the old prefix list and
 * through this lookup and requires the same answer.
 */
export const authMiddleware = (app: Elysia) =>
  app.derive(async (ctx: any) => {
    const { request, workspaceProjects } = ctx
    const route = resolveRoutePolicy(request.method, new URL(request.url).pathname)
    const derived = await deriveCredential(ctx, route)
    // The surface scope's `access` floor (plan 22.3): a category the
    // credential's workspace or environment switched off is refused with the
    // same uniform 404 the Gateway's pre-auth hook answers, now that the
    // credential has named a workspace the request itself did not.
    refuseClosedSurfaceForCredential({
      projects: workspaceProjects ?? [],
      route,
      workspaceId: derived.workspaceId,
    })
    // K1: the execution rides beside the old decorations. Every credentialed
    // request has one; the decorations are what the routes still read.
    return { ...derived, exec: executionFor(ctx, route, derived) }
  })

/**
 * One ExecutionContext for one credentialed request (kernel plan §11): the
 * actor from the credential the derive step resolved, the Gateway's request
 * id, the workspace the execution runs in, the locale from `?locale=`.
 * A public or self-authenticating row carries no credential and no execution.
 */
export function executionFor(ctx: any, route: { id: string }, derived: Record<string, unknown>): ExecutionContext | undefined {
  const workspaceId = derived.workspaceId as string | undefined
  if (!workspaceId) return undefined
  const memberId = derived.memberId as string | null | undefined
  const apiKeyId = derived.apiKeyId as string | null | undefined
  let actor: ActorContext
  let source: ExecutionSource
  if (memberId) {
    actor = memberActor({ memberId, role: derived.memberRole as string | null, workspaceId, permissions: derived.permissions as never })
    source = 'admin'
  } else if (apiKeyId) {
    const playgroundMemberId = derived.playgroundMemberId as string | undefined
    const siteUserId = derived.siteUserId as string | undefined
    const onBehalfOfMemberId = derived.onBehalfOfMemberId as string | null | undefined
    const identity = derived.identity as IdentitySummary | null | undefined
    const onBehalfOf: ActorIdentity | null = playgroundMemberId ? { kind: 'member', id: playgroundMemberId }
      : siteUserId ? { kind: 'site_user', id: siteUserId }
      : onBehalfOfMemberId ? { kind: 'member', id: onBehalfOfMemberId } : null
    // K8: a credential of an identity acts as the identity.
    actor = identity
      ? identityActor({ identity, workspaceId, onBehalfOf })
      : apiKeyActor({ apiKeyId, workspaceId, permissions: derived.permissions, onBehalfOf })
    source = route.id === 'graphql' ? 'graphql' : route.id === 'mcp' ? 'mcp' : 'rest'
  } else {
    return undefined
  }
  const project = ((ctx.workspaceProjects ?? []) as any[]).find((p: any) => p.workspaceId === workspaceId)
  return requestExecution({
    request: ctx.request as Request,
    requestId: gatewayContextOf(ctx)?.requestId ?? null,
    workspaceId, actor, source,
    localization: projectLocalization(project),
  })
}

/**
 * Resolves the credential, or nothing at all for a row that needs none. The
 * body of the derive since M3, unchanged; split out so the exposure check
 * above reads one result rather than guarding three return paths.
 */
async function deriveCredential(ctx: any, route: ReturnType<typeof resolveRoutePolicy>): Promise<Record<string, unknown> & { workspaceId?: string | null }> {
    const { request, db, redis, workspaceProjects } = ctx
    const url = new URL(request.url)
    // The row the Gateway already resolved for this request (one lookup per
    // request, on the shared context). Resolved again only when the Gateway
    // plugin is not in the chain, which is every unit test that mounts this
    // middleware on a bare Elysia app.
    const access = gatewayContextOf(ctx)?.accessMode ?? route.access
    if (skipsCredentialDerive(access)) {
      return {}
    }

    const registeredProjects = workspaceProjects ?? []

    // API Playground path — a one-shot HMAC token (minted only inside the
    // role-gated execute route) impersonates a key by id, so the request
    // gets that key's REAL permissions/behavior. No Authorization header.
    const playgroundHeader = request.headers.get('X-Tangen-Playground') as string | null
    if (playgroundHeader) {
      const claims = verifyPlaygroundToken(playgroundHeader)
      if (!claims) throw new AuthError('Invalid or expired playground token')
      const [key] = await db
        .select().from(apiKeys)
        .where(and(eq(apiKeys.id, claims.keyId), eq(apiKeys.workspaceId, claims.workspaceId), isNull(apiKeys.revokedAt)))
        .limit(1)
      if (!key) throw new AuthError('Playground key not found or revoked')
      if (key.expiresAt && key.expiresAt < new Date()) throw new AuthError('Playground key expired')
      const schema = await getSchema(db, redis)
      const asIdentity = await identityDecorations(db, key)
      return {
        workspaceId: key.workspaceId as string,
        ...asIdentity,
        memberId: null as string | null,
        memberRole: null as string | null,
        // Marks the request as a playground execution (audit attributes it to the member)
        playgroundMemberId: claims.memberId,
        schema,
      }
    }

    const authHeader = request.headers.get('Authorization') as string | null
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AuthError('Missing or invalid Authorization header')
    }

    const token = authHeader.slice(7).trim()

    // Realtime R5: on the ticket row ONLY, a site-auth member (the X-Tangen-Key
    // site key plus the site session JWT as Bearer) is an identity - the key's
    // grants with the member named - so a logged-in site user can subscribe to
    // what the site may read. Every other row still sees no credential here.
    const siteKey = request.headers.get('X-Tangen-Key') as string | null
    if (route.id === 'realtime-ticket' && siteKey && !token.startsWith('tgn_')) {
      return resolveSiteAuthTicketIdentity({ db, redis, projects: registeredProjects, keyHeader: siteKey.trim(), token, headers: request.headers })
    }

    // Member JWT path - tokens don't start with the API key prefix "tgn_".
    // verifyMemberToken refuses a site-auth session (it carries an audience)
    // whatever key it was signed with: a site user is never a member here.
    if (!token.startsWith('tgn_')) {
      let payload: any
      try {
        payload = await verifyMemberToken(token)
      } catch {
        throw new AuthError('Invalid or expired access token')
      }

      const workspaceId = payload.workspaceId as string
      const host = request.headers.get('Host') ?? ''
      let requestedWs = resolveWorkspaceFromRequest(request.headers, registeredProjects)
      if (!requestedWs) requestedWs = await resolveWorkspaceByDomain(host, db)
      const jwtRole = payload.role as string
      // K1: the execution runs in exactly one workspace. A superadmin naming
      // another workspace runs THERE (the explicit cross-workspace flag);
      // anyone else naming another workspace is refused.
      const execWorkspaceId = resolveExecutionWorkspace({
        credentialWorkspaceId: workspaceId, requestedWorkspaceId: requestedWs, superadmin: isSuperAdmin(jwtRole),
      }).workspaceId

      const schema = await getSchema(db, redis)

      const memberId = payload.sub as string
      const memberRole = jwtRole
      if (isNoAccessRole(memberRole) && !isSuperAdmin(jwtRole)) throw new AuthError('No access to this workspace')

      // Suspension kill-switch — flag set by the suspend endpoint, O(1),
      // takes effect immediately without waiting out the JWT
      if (redis && memberId) {
        let suspended = false
        try { suspended = Boolean(await redis.get(memberSuspensionKey(memberId))) } catch { /* redis down → fail open */ }
        if (suspended) throw new AuthError('Account suspended')
      }

      return {
        workspaceId: execWorkspaceId,
        // RBAC: members carry their role's resolved bundle — only
        // owner/admin/superadmin keep the blanket admin fast path
        permissions: await resolveMemberPermissions(
          db, redis, execWorkspaceId, memberRole,
          registeredProjects.find((p: any) => p.workspaceId === execWorkspaceId),
          memberId,
          // hasGrants stamped at login/refresh: false skips the grant read.
          (payload as { hasGrants?: boolean }).hasGrants,
        ) as ApiKeyPermissions,
        apiKeyId: null as unknown as string,
        memberId,
        memberRole,
        schema,
      }
    }

    // API key path
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

    if (!key) throw new AuthError('Invalid API key')
    if (key.expiresAt && key.expiresAt < new Date()) throw new AuthError('API key expired')

    // Touch lastUsedAt (fire-and-forget — never blocks or fails the request)
    db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id))
      .then(() => {}, () => {})

    const workspaceId = key.workspaceId as string
    const host = request.headers.get('Host') ?? ''
    let requestedWs = resolveWorkspaceFromRequest(request.headers, registeredProjects)
    if (!requestedWs) requestedWs = await resolveWorkspaceByDomain(host, db)
    resolveExecutionWorkspace({ credentialWorkspaceId: workspaceId, requestedWorkspaceId: requestedWs, superadmin: false })

    const schema = await getSchema(db, redis)
    const asIdentity = await identityDecorations(db, key)
    // K8: an agent may say which member it acts for. Attribution and audit
    // record the member; the agent's own authority is what decides.
    const onBehalfOf = request.headers.get(ON_BEHALF_OF_HEADER)
    let onBehalfOfMemberId: string | null = null
    if (onBehalfOf) {
      if (asIdentity.identity?.kind !== 'agent') throw new AuthError('Only an agent identity may act on behalf of a member')
      const [member] = await db.select({ id: members.id }).from(members)
        .where(and(eq(members.id, onBehalfOf.trim()), eq(members.workspaceId, workspaceId))).limit(1)
      if (!member) throw new AuthError('The member named by X-Tangen-On-Behalf-Of is not in this workspace')
      onBehalfOfMemberId = member.id as string
    }

    return {
      workspaceId,
      ...asIdentity,
      memberId: null as string | null,
      memberRole: null as string | null,
      onBehalfOfMemberId,
      schema,
    }
  }

/** The member an agent acts for, by id. */
export const ON_BEHALF_OF_HEADER = 'X-Tangen-On-Behalf-Of'

/**
 * K8: the decorations a credential produces. A key of an identity acts AS
 * the identity: `apiKeyId` (the name every route reads for the non-member
 * actor) is the identity's id, `credentialId` the key's, `permissions` the
 * identity's grants, `identity` the record. A key of its own stays a key.
 */
async function identityDecorations(db: any, key: { id: string; workspaceId: string; identityId?: string | null; permissions: unknown }) {
  const identity = await loadKeyIdentity(db, key)
  if (identity === false) throw new AuthError('The identity behind this API key is suspended or gone')
  return {
    permissions: identity ? identity.permissions : sanitizeApiKeyPermissions(key.permissions),
    apiKeyId: identity ? identity.id : key.id as string,
    credentialId: key.id as string,
    identity,
  }
}
