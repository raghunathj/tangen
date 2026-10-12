/**
 * File Name: router.ts
 * Purpose: Dynamically mounts user-defined custom API routes from WorkspaceProject
 *          config. Each route is reachable three ways:
 *            1. /api/v1/custom/{workspaceId}/{env}/{path}  — explicit form (canonical
 *               for webhooks and any caller that cannot carry Tangen credentials)
 *            2. /api/v1/custom/{path}                      — short form; workspace and
 *               env resolve from the API key binding, site-JWT claims, or the
 *               X-Tangen-Workspace header
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, @tangen/types (WorkspaceProject, RouteError), @tangen/logging,
 *                     schema-cache for per-request schema resolution, context.ts for RouteContext
 */
import { Elysia } from 'elysia'
import type { WorkspaceProject, CustomRoute, SiteUser } from '@tangen/types'
import { RouteError } from '@tangen/types'
import { getLogger } from '@tangen/logging'
import { getSchema } from '../../services/schema-cache'
import { buildRouteContext } from './context'
import { validateApiKey, checkCustomRoutePermission, deriveAction, normalizeApiGroup, resolvePlaygroundKey } from '../../lib/api-key-auth'
import { verifyPlaygroundToken } from '../../lib/playground-token'
import { eq, and } from 'drizzle-orm'
import { verifyMemberToken } from '../../lib/jwt-secret'
import { resolveMemberPermissions, memberSuspensionKey } from '../../middleware/auth'
import { SiteIdentityError } from '@tangen/types'
import { resolveSiteUser, resolveSiteUserAcross } from '../../kernel/site-identity'
import { registerRoutePolicy, clearDynamicRoutePolicies } from '../../gateway/dynamic-policies'
import { narrowAccess } from '../../gateway/resolve-config'
import { internalErrorResponse, requestIdFor } from '../../lib/internal-error'
import { REQUEST_ID_HEADER } from '../../gateway/request-context'
import type { AccessMode } from '@tangen/types'

const logger = getLogger(['tangen', 'custom'])

function errorResponse(set: any, status: number, message: string, details?: unknown, extra?: { code: string; id: string }) {
  set.status = status
  return { error: { status, message, ...(details !== undefined && { details }), ...(extra ?? {}) } }
}

function extractToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization')
  const xTangenKey = request.headers.get('X-Tangen-Key')
  return authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : xTangenKey?.trim() ?? null
}

/**
 * Runs a custom route for a resolved workspace project + env slug: env whitelist,
 * the route's auth guard, then the handler. Shared by all three URL forms.
 */
async function executeCustomRoute(
  project: WorkspaceProject,
  route: CustomRoute,
  ctx: any,
): Promise<unknown> {
  const { db, redis, params, request, body, set } = ctx
  const customParams = params ?? {}
  const workspaceId = project.workspaceId

  try {
    const rawToken = extractToken(request)
    const { auth } = route
    const apiGroup = normalizeApiGroup(route.apiGroup, project.apiResources)
    const requiredAction = apiGroup?.action ?? deriveAction(route.method)

    if (typeof auth === 'function') {
      const schema = await getSchema(db, redis)
      const routeCtx = buildRouteContext({
        db, redis, schema, workspaceId,
        request, body, params: customParams as Record<string, string>,
        workspaceProject: project,
        apiGroupId: apiGroup?.id,
      })
      await auth(routeCtx)
      return await route.handler(routeCtx)
    }

    if (auth === 'key' || auth === 'any') {
      // API Playground impersonation — a verified one-shot token resolves to
      // the named key and runs through the SAME permission checks, so a
      // playground call to a custom route gets the key's real 403/200.
      const playgroundHeader = request.headers.get('X-Tangen-Playground')
      if (playgroundHeader) {
        const claims = verifyPlaygroundToken(playgroundHeader)
        if (!claims) return errorResponse(set, 401, 'Invalid or expired playground token')
        const validated = await resolvePlaygroundKey(db, claims)
        if (!validated) return errorResponse(set, 401, 'Playground key not found or revoked')
        if (validated.workspaceId !== workspaceId) return errorResponse(set, 403, 'API key does not belong to this workspace')
        if (apiGroup && !checkCustomRoutePermission(validated.permissions, apiGroup.id, requiredAction)) {
          return errorResponse(set, 403, 'API key does not have permission for this resource')
        }
        const schema = await getSchema(db, redis)
        return await route.handler(buildRouteContext({
          db, redis, schema, workspaceId,
          request, body, params: customParams as Record<string, string>,
          workspaceProject: project,
          apiKey: { keyId: validated.keyId, permissions: validated.permissions },
          apiGroupId: apiGroup?.id,
        }))
      }
      if (rawToken?.startsWith('tgn_')) {
        const validated = await validateApiKey(db, redis, rawToken)
        if (!validated) {
          return errorResponse(set, 401, 'Invalid or revoked API key')
        }
        if (validated.workspaceId !== workspaceId) {
          return errorResponse(set, 403, 'API key does not belong to this workspace')
        }
        if (apiGroup) {
          if (!checkCustomRoutePermission(validated.permissions, apiGroup.id, requiredAction)) {
            return errorResponse(set, 403, 'API key does not have permission for this resource')
          }
        }
        const schema = await getSchema(db, redis)
        const routeCtx = buildRouteContext({
          db, redis, schema, workspaceId,
          request, body, params: customParams as Record<string, string>,
          workspaceProject: project,
          apiKey: { keyId: validated.keyId, permissions: validated.permissions },
          apiGroupId: apiGroup?.id,
        })
        return await route.handler(routeCtx)
      }

      if (auth === 'key') {
        return errorResponse(set, 401, 'Authentication required')
      }
    }

    if (auth === 'member') {
      // Admin-panel member sessions — the RBAC surface for extension endpoints
      if (!rawToken || rawToken.startsWith('tgn_')) {
        return errorResponse(set, 401, 'Member authentication required')
      }
      let payload: any
      try {
        payload = await verifyMemberToken(rawToken)
      } catch {
        return errorResponse(set, 401, 'Invalid or expired member token')
      }
      if (payload.workspaceId !== workspaceId && payload.role !== 'superadmin') {
        return errorResponse(set, 401, 'Token does not match this workspace')
      }
      const mId = payload.sub as string
      // Suspension kill-switch (same semantics as the admin middleware)
      if (redis && mId) {
        let suspended = false
        try { suspended = Boolean(await redis.get(memberSuspensionKey(mId))) } catch { /* fail open */ }
        if (suspended) return errorResponse(set, 401, 'Account suspended')
      }
      const mRole = payload.role as string
      const memberPermissions = await resolveMemberPermissions(db, redis, workspaceId, mRole, project, mId)

      const schema = await getSchema(db, redis)
      const routeCtx = buildRouteContext({
        db, redis, schema, workspaceId,
        request, body, params: customParams as Record<string, string>,
        workspaceProject: project,
        apiGroupId: apiGroup?.id,
        member: { id: mId, role: mRole, permissions: memberPermissions },
      })
      return await route.handler(routeCtx)
    }

    if (auth === 'user' || auth === 'any') {
      // The workspace's site identity provider says who the end user is
      // (tasks/plan-core-slimming.md S1): Tangen Auth, or Supabase / Firebase /
      // Clerk through an extension. This route never reads a token itself.
      if (!rawToken || rawToken.startsWith('tgn_')) {
        return errorResponse(set, 401, 'Authentication required')
      }
      let user: SiteUser | null
      try {
        user = await resolveSiteUser({ workspaceId, token: rawToken, headers: request.headers })
      } catch (err) {
        if (err instanceof SiteIdentityError) return errorResponse(set, err.status, err.message)
        throw err
      }
      if (!user) return errorResponse(set, 401, 'Authentication required')
      const schema = await getSchema(db, redis)
      const routeCtx = buildRouteContext({
        db, redis, schema, workspaceId,
        request, body, params: customParams as Record<string, string>,
        workspaceProject: project,
        apiGroupId: apiGroup?.id,
        resolvedUser: user,
      })
      return await route.handler(routeCtx)
    }

    // No branch matched — the route declares no recognized auth mode. Fail loud:
    // silently returning 200 here would leave the route unguarded and broken.
    return errorResponse(set, 500, 'Route has no valid auth configuration - set auth to "key", "user", "any", or a guard function')

  } catch (err) {
    if (err instanceof RouteError) {
      return errorResponse(set, err.status, err.message, err.details)
    }
    // The same INTERNAL contract as the global handler (lib/internal-error.ts):
    // redacted on a production-like deployment, an id in body and header, the
    // diagnosis in the log under that id. A custom route is a site
    // developer's code and the one place a stray exception is likeliest.
    const id = requestIdFor(undefined)
    let path: string | undefined
    try { path = new URL(request.url).pathname } catch { path = undefined }
    const internal = internalErrorResponse(err, { id, method: request.method, path, route: 'custom' })
    set.headers[REQUEST_ID_HEADER.toLowerCase()] ??= id
    return errorResponse(set, 500, internal.error.message, undefined, { code: internal.error.code, id })
  }
}

/** Every dynamic policy row a custom route owns is named under this prefix. */
const CUSTOM_POLICY_PREFIX = 'custom:'

/**
 * What the Gateway may assume about a caller before one of these routes runs.
 *
 * `key` and `member` demand a credential the PLATFORM issues, so they are
 * `authenticated`. `user` and `any` accept a site-auth session the platform's
 * own auth chain knows nothing about, and a guard function checks whatever its
 * author decided - all three are `self-authenticating`: the Gateway steps
 * aside and this file's own branches below do the checking. An unrecognised
 * declaration gets the restrictive answer, matching the 500 executeCustomRoute
 * already answers such a route with.
 * @param auth - The route's declared auth posture.
 * @returns The access mode for its policy row.
 */
export function accessForCustomRoute(auth: CustomRoute['auth']): AccessMode {
  if (typeof auth === 'function') return 'self-authenticating'
  if (auth === 'key' || auth === 'member') return 'authenticated'
  if (auth === 'user' || auth === 'any') return 'self-authenticating'
  return 'authenticated'
}

/** The written reason a self-authenticating row must carry, per posture. */
function reasonForCustomRoute(auth: CustomRoute['auth']): string {
  if (typeof auth === 'function') return "Custom route with its own auth guard function; the guard IS the check, and it throws RouteError to reject."
  if (auth === 'user') return 'Custom route declaring auth \'user\': a site credential is the credential and the workspace\'s site identity provider verifies it.'
  if (auth === 'any') return 'Custom route declaring auth \'any\': an API key or a site-auth session, whichever arrives, verified by this route.'
  if (auth === 'key') return 'Custom route declaring auth \'key\': a platform API key is required.'
  if (auth === 'member') return 'Custom route declaring auth \'member\': an admin member session is required.'
  return 'Custom route with an unrecognised auth declaration; treated as the most restrictive answer that can still be served.'
}

/**
 * Registers the policy rows for one custom route, one per URL form it mounts
 * on. All three share an id because they are one route: the access log should
 * name the route, not the shape of the URL that reached it.
 * @param workspaceId - Owning workspace.
 * @param route - The declared route.
 * @param patterns - The mounted path patterns.
 */
function registerCustomRoutePolicy(workspaceId: string, route: CustomRoute, patterns: string[]): void {
  const access = accessForCustomRoute(route.auth)
  for (const path of patterns) {
    registerRoutePolicy({
      id: `${CUSTOM_POLICY_PREFIX}${workspaceId}:${route.method}:${route.path}`,
      match: { method: route.method, path, exact: true },
      access,
      category: 'custom',
      reason: reasonForCustomRoute(route.auth),
      workspace: 'required',
    })
  }
}

const EXPLICIT_FORM_HINT =
  'Route not resolvable - supply a workspace-scoped credential, the X-Tangen-Workspace header, ' +
  'or call the explicit form /api/v1/custom/{workspaceId}/... instead'

interface ShortFormCandidate {
  project: WorkspaceProject
  route: CustomRoute
}

/**
 * Resolves which workspace + env a short-form request targets, then executes.
 * Resolution order: API key binding → site-JWT claims → X-Tangen-Workspace
 * header → sole-candidate fallback. Unresolvable → 404 with guidance.
 */
async function dispatchShortForm(candidates: ShortFormCandidate[], ctx: any): Promise<unknown> {
  const { db, redis, request, set, query } = ctx
  const rawToken = extractToken(request)

  // 1. API key — carries both workspace and env
  if (rawToken?.startsWith('tgn_')) {
    const validated = await validateApiKey(db, redis, rawToken)
    if (!validated) return errorResponse(set, 401, 'Invalid or revoked API key')
    const candidate = candidates.find((c) => c.project.workspaceId === validated.workspaceId)
    if (!candidate) return errorResponse(set, 404, 'No such route in your workspace')
    return executeCustomRoute(candidate.project, candidate.route, ctx)
  }

  // 2. A site credential - the workspace whose identity provider accepts it
  if (rawToken) {
    const hit = await resolveSiteUserAcross(candidates.map((c) => c.project.workspaceId), { token: rawToken, headers: request.headers })
    if (hit) {
      const candidate = candidates.find((c) => c.project.workspaceId === hit.workspaceId)!
      return executeCustomRoute(candidate.project, candidate.route, ctx)
    }
    return errorResponse(set, 401, 'Invalid or expired token')
  }

  // 3. Explicit header scope
  const headerWs = request.headers.get('X-Tangen-Workspace')
  if (headerWs) {
    const candidate = candidates.find((c) => c.project.workspaceId === headerWs)
    if (!candidate) return errorResponse(set, 404, 'No such route in that workspace')
    return executeCustomRoute(candidate.project, candidate.route, ctx)
  }

  // 4. Sole candidate — unambiguous without any scope signal
  if (candidates.length === 1) {
    const { project, route } = candidates[0]
    return executeCustomRoute(project, route, ctx)
  }

  return errorResponse(set, 404, EXPLICIT_FORM_HINT)
}

/**
 * Returns an Elysia plugin that dynamically registers every route declared in each
 * WorkspaceProject under all three URL forms.
 * @param projects - Array of workspace project configs whose routes should be mounted
 * @returns An Elysia plugin function that attaches the custom routes and returns the updated app
 */
export function mountCustomRoutes(projects: WorkspaceProject[]): (app: Elysia) => Elysia {
  return (app: Elysia) => {
    // method+path → all workspaces defining it (for the short form's dispatcher)
    const shortForm = new Map<string, ShortFormCandidate[]>()
    // Mounting IS the declaration: the Gateway's policy table cannot know these
    // paths in advance, and a route left on the restrictive fallback is a route
    // the table describes wrongly (gateway/dynamic-policies.ts). Rows are
    // REPLACED rather than appended so a second server in one process does not
    // inherit the first one's routes.
    clearDynamicRoutePolicies(CUSTOM_POLICY_PREFIX)

    for (const project of projects) {
      const { workspaceId, routes = [] } = project

      for (const route of routes) {
        const normalizedPath = route.path.startsWith('/') ? route.path : '/' + route.path

        const explicitHandler = (ctx: any) => executeCustomRoute(project, route, ctx)
        // The canonical explicit form. The `/api/v1/x/…` alias it used to
        // carry alongside was retired in Phase 6A: one URL per custom route.
        app.route(route.method, `/api/v1/custom/${workspaceId}${normalizedPath}`, explicitHandler)
        registerCustomRoutePolicy(workspaceId, route, [
          `/api/v1/custom/${workspaceId}${normalizedPath}`,
        ])

        // Short form is reserved from paths that would shadow the explicit form
        if (normalizedPath.split('/')[1]?.startsWith('wsp_')) {
          logger.warn(`Custom route path "${normalizedPath}" starts with a wsp_ segment - short form not mounted`)
          continue
        }
        const key = `${route.method} ${normalizedPath}`
        const list = shortForm.get(key) ?? []
        list.push({ project, route })
        shortForm.set(key, list)
      }
    }

    for (const [key, candidates] of shortForm) {
      const [method, path] = [key.slice(0, key.indexOf(' ')), key.slice(key.indexOf(' ') + 1)]
      app.route(method, `/api/v1/custom${path}`, (ctx: any) => dispatchShortForm(candidates, ctx))
      // One short-form URL, several workspaces: dispatchShortForm picks the
      // workspace from the credential, so the row must describe the STRICTEST
      // posture any candidate could impose. narrowAccess folds them; a route
      // may only ever move toward restriction (plan section 22.3).
      const access = candidates.reduce<AccessMode>(
        (strictest, c) => narrowAccess(strictest, accessForCustomRoute(c.route.auth)),
        'public',
      )
      const declaring = candidates.find((c) => accessForCustomRoute(c.route.auth) === access) ?? candidates[0]
      registerRoutePolicy({
        id: `${CUSTOM_POLICY_PREFIX}${method}:${path}`,
        match: { method, path: `/api/v1/custom${path}`, exact: true },
        access,
        category: 'custom',
        reason: reasonForCustomRoute(declaring.route.auth),
        workspace: 'required',
      })
    }

    return app
  }
}
