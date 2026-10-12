/**
 * File Name: context.ts
 * Purpose: Factory function that builds a typed RouteContext passed to every custom-route handler,
 *          including auth helpers, a local Tangen client, and a profile accessor.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types (RouteContext, SiteUser, WorkspaceProject), @tangen/db (authUsers),
 *                     site-jwt for token sign/verify, local-client for data access
 */
import { routeConfigFor } from '../../config/route-config'
import { getLogger } from '@tangen/logging'
import { RouteError, checkBundle, SiteIdentityError } from '@tangen/types'
import type { LocalProfileAccessor, RouteContext, SchemaDefinition, SiteUser, WorkspaceProject } from '@tangen/types'
import { resolveSiteUser, siteIdentityFor, siteTokenOf } from '../../kernel/site-identity'
import { createLocalClient } from '../../services/local-client'
import { checkResourcePermission } from '../../lib/api-key-auth'
import { memberActor, apiKeyActor, siteUserActor, systemActor, requestExecution, createExecution } from '../../kernel'
import { projectLocalization } from '../../services/i18n'
import { actorForKey } from '../../lib/api-key-auth'

/**
 * Builds and returns a fully-typed RouteContext for a custom-route handler invocation.
 * @param options - Request inputs (db, redis, schema, workspace/env identifiers, request, body, params) and optional project config
 * @returns A RouteContext containing tangen client, logger, auth helpers, and a profile accessor
 */
export function buildRouteContext(options: {
  db: any
  redis: any
  schema: SchemaDefinition
  workspaceId: string
  request: Request
  body: unknown
  params: Record<string, string>
  workspaceProject?: WorkspaceProject
  /** Pre-resolved site user from the auth guard — skips JWT re-verification in requireAuth() */
  resolvedUser?: SiteUser
  /** Validated API key from the router's auth guard (auth 'key'/'any' with a tgn_ token) */
  apiKey?: { keyId: string; permissions: import('@tangen/types').ApiKeyPermissions; identity?: import('@tangen/types').IdentitySummary | null }
  /** Authenticated admin-panel member (auth 'member' routes) */
  member?: { id: string; role: string; permissions: import('@tangen/types').MemberPermissions | { admin: true } }
  /** The route's resolved apiGroup id — binds ctx.hasPermission to a resource */
  apiGroupId?: string
}): RouteContext {
  const { db, redis, schema, workspaceId, request, body, params, workspaceProject, resolvedUser, apiKey, apiGroupId, member } = options
  const { config, secrets, integration } = routeConfigFor(workspaceId)

  const url = new URL(request.url)
  const query: Record<string, string> = {}
  for (const [k, v] of url.searchParams.entries()) {
    query[k] = v
  }

  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })

  const logger = getLogger(['tangen', 'custom', workspaceId])

  // K1: the route's execution, from whichever credential the router resolved.
  const actor = member
    ? memberActor({ memberId: member.id, role: member.role, workspaceId, permissions: member.permissions })
    : apiKey
      ? actorForKey(apiKey, workspaceId, resolvedUser ? { kind: 'site_user', id: String((resolvedUser as { id: unknown }).id) } : null)
      : resolvedUser
        ? siteUserActor({ userId: String((resolvedUser as { id: unknown }).id), workspaceId })
        : null
  const exec = actor
    ? requestExecution({ request, workspaceId, actor, localization: projectLocalization(workspaceProject), source: member ? 'admin' : apiKey ? 'rest' : 'site' })
    : null
  // K7: `ctx.tangen` is bound. A member or a key gets a client that does what
  // they may; site code acting for a site user or for nobody keeps the
  // site's own authority (it is the site, deployed with the site), attributed
  // to the framework with the site user as the initiator.
  const clientExec = member || apiKey
    ? exec!
    : createExecution({
        kind: 'request', source: 'site', workspaceId,
        actor: systemActor({ workspaceId, reason: 'route' }),
        initiator: resolvedUser ? { kind: 'site_user', id: String((resolvedUser as { id: unknown }).id) } : null,
        correlationId: exec?.correlationId ?? null,
      })
  const tangen = createLocalClient({
    db, redis, schema, workspaceId, customTables: (workspaceProject as any)?.config?.customTables,
    // Workspace mail: config/mail.ts wins; forms mail config is the fallback
    mail: workspaceProject?.mail,
    // C1: custom-route writes run content hooks like the REST routes do
    projects: workspaceProject ? [workspaceProject as never] : undefined,
    exec: clientExec,
  })

  // _currentUser: undefined = not yet resolved, null = resolved but not authenticated
  // Pre-populated by the auth guard when auth:'user' or auth:'any' succeeds
  let _currentUser: SiteUser | null | undefined = resolvedUser ?? undefined

  async function requireAuth(): Promise<SiteUser> {
    if (_currentUser !== undefined) {
      if (!_currentUser) throw new RouteError(401, 'Authentication required')
      return _currentUser
    }
    // The workspace's site identity provider decides (tasks/plan-core-slimming.md S1).
    const token = siteTokenOf(request.headers)
    if (!token) {
      _currentUser = null
      throw new RouteError(401, 'Authentication required')
    }
    let user: SiteUser | null
    try {
      user = await resolveSiteUser({ workspaceId, token, headers: request.headers })
    } catch (err) {
      _currentUser = null
      if (err instanceof SiteIdentityError) throw new RouteError(err.status, err.message)
      throw err
    }
    if (!user) {
      _currentUser = null
      throw new RouteError(401, 'Authentication required')
    }
    _currentUser = user
    return user
  }

  async function requireRole(role: string | string[]): Promise<SiteUser> {
    const user = await requireAuth()
    const allowed = Array.isArray(role) ? role : [role]
    if (!allowed.includes(user.role)) {
      throw new RouteError(403, `Role '${allowed.join(' or ')}' required`)
    }
    return user
  }

  async function requireIdentified(): Promise<SiteUser> {
    const user = await requireAuth()
    if (user.isAnonymous) throw new RouteError(403, 'Anonymous users cannot access this resource')
    return user
  }

  async function requireOwner(
    ownerId: string | null | undefined,
    options?: { adminRoles?: string[] },
  ): Promise<SiteUser> {
    const user = await requireIdentified()
    const adminRoles = options?.adminRoles ?? ['admin']
    if (user.id === ownerId || adminRoles.includes(user.role)) return user
    throw new RouteError(403, 'You do not have permission to access this resource')
  }

  // The profile lives with the identity provider's user directory; a provider
  // without one (a pure token verifier) says so instead of pretending.
  const directory = async () => {
    const users = (await siteIdentityFor(workspaceId))?.users
    if (!users) throw new RouteError(501, 'The site identity provider has no user directory')
    return users
  }
  const profile: LocalProfileAccessor = {
    async get(userId: string) {
      const user = await (await directory()).get(userId)
      return { name: user?.name ?? null, profileMeta: (user?.profileMeta as Record<string, unknown> | undefined) ?? {} }
    },
    async update(userId: string, data: { name?: string | null; profileMeta?: Record<string, unknown> }) {
      const users = await directory()
      if (!users.update) throw new RouteError(501, 'The site identity provider does not update profiles')
      await users.update(userId, data)
    },
  }

  return {
    body,
    query,
    params,
    headers,
    tangen,
    logger,
    workspaceId,
    config,
    secrets,
    integration,
    profile,

    // Site tokens are the identity provider's kind (tasks/plan-core-slimming.md S4):
    // sign asks the workspace's provider and 501s when it only verifies; verify
    // resolves through the same seam and answers the user's claims, or null.
    sign: async (payload, ttl) => {
      const provider = await siteIdentityFor(workspaceId)
      if (!provider?.sign) throw new RouteError(501, provider ? 'The site identity provider does not sign tokens' : 'No site identity provider is installed')
      return provider.sign(payload, ttl)
    },
    verify: async (token) => {
      try {
        const user = await resolveSiteUser({ workspaceId, token, headers: request.headers })
        return user ? { ...(user.claims ?? {}), sub: user.id, workspaceId, email: user.email, role: user.role, isAnonymous: user.isAnonymous } : null
      } catch (err) {
        if (err instanceof SiteIdentityError) return null
        throw err
      }
    },

    apiKey: apiKey ?? null,
    member: member ?? null,
    exec,
    can(action: string, resource: 'objects' | 'media' | 'forms' | 'search' | 'schema' = 'objects', item?: string): boolean {
      return checkBundle(member?.permissions ?? null, action, resource, item)
    },
    requireCan(action: string, resource: 'objects' | 'media' | 'forms' | 'search' | 'schema' = 'objects', item?: string): void {
      if (!checkBundle(member?.permissions ?? null, action, resource, item)) {
        throw new RouteError(403, `Your role cannot ${action} ${item ?? resource}`)
      }
    },
    requireMemberCapability(capability: import('@tangen/types').Capability): void {
      const p = member?.permissions as { admin?: boolean; capabilities?: string[] } | undefined
      if (p?.admin === true) return
      if (p?.capabilities?.includes(capability)) return
      throw new RouteError(403, `This action requires the ${capability} permission`)
    },
    hasPermission(action: string, itemKey?: string): boolean {
      if (!apiGroupId) {
        logger.warn('ctx.hasPermission() called on a route without an apiGroup - always false')
        return false
      }
      if (!apiKey) return false
      return checkResourcePermission(apiKey.permissions, apiGroupId, action, itemKey)
    },

    get currentUser() { return _currentUser ?? null },
    requireAuth,
    requireRole,
    requireIdentified,
    requireOwner,
  }
}
