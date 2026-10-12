/**
 * File Name: public-routes.ts
 * Purpose: Mounts extension server routes that opted into `auth: 'key'` or
 *          `auth: 'public'` at /api/v1/ext/:extensionId/* (C5). Key routes
 *          resolve workspace + env from the API-key binding; public routes
 *          resolve the workspace from the X-Tangen-Workspace header (or the
 *          sole loaded workspace) - mirroring
 *          the custom-route short form. This is what lets an extension serve
 *          data to frontends (e.g. a variants extension's running
 *          experiments) without member auth.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: registered BEFORE authMiddleware (handles its own
 *          auth, like custom routes). Member routes stay on
 *          /api/v1/admin/ext (server-routes.ts). An uninstalled extension is
 *          indistinguishable from an absent route (404). Handlers can rate
 *          limit via ctx.tangen.rateLimit(key, max, windowSec).
 */
import { Elysia } from 'elysia'
import { RequestError } from '../../lib/errors'
import { validateApiKey, resolvePlaygroundKey, actorForKey, actorIdForKey, checkExtensionPermission } from '../../lib/api-key-auth'
import { verifyPlaygroundToken } from '../../lib/playground-token'
import { clientIp, getTrustedProxy, socketAddressOf } from '../../lib/client-ip'
import { RouteError } from '@tangen/types'
import { toRequestError } from './server-routes'
import { getExtensionAdminRoutes, getExtensionManifest, getExtensionServer } from '../../hooks/app-hooks-registry'
import { matchAdminRoute, extensionWiringDeps, routesAllowed, effectiveGrants } from '../../services/extension-server'
import { compileSettings } from '@tangen/types'
import { createExtensionSettings } from '../../services/extension-settings'
import { connectionsScopeFor } from '../../services/connections-scope'
import { requestIdFor } from '../../lib/internal-error'
import { REQUEST_ID_HEADER } from '../../gateway/request-context'
import { bindExtensionCtx } from '../../services/extension-server'
import { apiKeyActor } from '../../kernel/actor'
import { requireDecision } from '../../kernel/policy'
import { requestExecution } from '../../kernel/execution'
import { projectLocalization } from '../../services/i18n'
import type { ActorContext } from '@tangen/types'

const PUBLIC_SCOPE_HINT =
  'Route not resolvable - send an API key, or the X-Tangen-Workspace header (or ?workspace=) when this deployment serves more than one workspace'

function extractToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization')
  const xTangenKey = request.headers.get('X-Tangen-Key')
  return authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : xTangenKey?.trim() ?? null
}

/**
 * Which workspace a public request is for. The header is the primary form,
 * but a browser loading an ASSET - a <link rel="stylesheet">, an <img>, a
 * font - cannot send custom headers, so the workspace may also ride the query
 * string. Naming one this server does not serve is an addressing ERROR, never
 * a reason to fall back to another.
 */
export function resolvePublicWorkspace(
  projects: Array<{ workspaceId: string }>,
  header: string | null,
  query: string | undefined,
): string | null {
  const named = header || query
  if (named) return projects.some((p) => p.workspaceId === named) ? named : null
  // No name and no ambiguity: the only workspace is the obvious answer.
  return projects.length === 1 ? projects[0].workspaceId : null
}

/** `GET /api/v1/ext/<id>/settings`: the public fields of an active extension's settings (E.18), never a secret. */
async function servePublicExtensionSettings(ctx: any, extensionId: string): Promise<unknown> {
  const manifest = getExtensionManifest(extensionId)
  const deps = extensionWiringDeps()
  if (!manifest?.settings || !deps || compileSettings(manifest.settings).publicKeys().length === 0) throw new RequestError('NOT_FOUND', 'Route not found', 404)
  const projects = (ctx.workspaceProjects ?? []) as Array<{ workspaceId: string }>
  const workspaceId = resolvePublicWorkspace(projects, ctx.request.headers.get('X-Tangen-Workspace'), ctx.query?.workspace as string | undefined)
  if (!workspaceId) throw new RequestError('NOT_FOUND', PUBLIC_SCOPE_HINT, 404)
  if (!(await deps.isActive(extensionId, workspaceId))) throw new RequestError('NOT_FOUND', 'Route not found', 404)
  const key = connectionsScopeFor(workspaceId)?.key
  if (!key) throw new RequestError('NOT_FOUND', 'Route not found', 404)
  const extCtx = await deps.buildCtx(extensionId, workspaceId)
  const service = createExtensionSettings({ extensionId, manifest, server: getExtensionServer(extensionId) ?? null, store: extCtx.store, key, grants: effectiveGrants(extensionId, workspaceId) })
  ctx.set.headers['Cache-Control'] = 'no-store'
  return { data: await service.readPublic() }
}

async function dispatch(ctx: any, method: 'GET' | 'POST' | 'PATCH' | 'DELETE') {
  const { db, redis, request } = ctx
  const extensionId = String(ctx.params.extensionId)

  // E.18: the settings the manifest marks `public` - core's to serve, read-only, to the workspace the request names.
  if (method === 'GET' && String(ctx.params['*'] ?? '') === 'settings') return servePublicExtensionSettings(ctx, extensionId)

  // Only routes that opted into key/public auth exist on this mount.
  const routes = getExtensionAdminRoutes(extensionId)
    ?.filter((r) => r.auth === 'key' || r.auth === 'public')
  const deps = extensionWiringDeps()
  if (!routes?.length || !deps) throw new RequestError('NOT_FOUND', 'Route not found', 404)

  const rel = String(ctx.params['*'] ?? '')
  const match = matchAdminRoute(routes, method, rel)
  if (!match) throw new RequestError('NOT_FOUND', 'Route not found', 404)

  let workspaceId: string
  let apiKeyId: string | undefined
  let keyPermissions: unknown
  let actor: ActorContext

  if (match.route.auth === 'key') {
    // The API Playground impersonates a key by id with a one-shot token and
    // sends no Authorization header (the same path custom routes already
    // honour), so a key route is reachable from the Playground and answers
    // that key's REAL result - its 200, its 403 - rather than "API key
    // required".
    const playgroundHeader = request.headers.get('X-Tangen-Playground') as string | null
    let validated: Awaited<ReturnType<typeof validateApiKey>> | null = null
    if (playgroundHeader) {
      const claims = verifyPlaygroundToken(playgroundHeader)
      if (!claims) throw new RequestError('UNAUTHORIZED', 'Invalid or expired playground token', 401)
      validated = await resolvePlaygroundKey(db, claims)
      if (!validated) throw new RequestError('UNAUTHORIZED', 'Playground key not found or revoked', 401)
    } else {
      const token = extractToken(request)
      if (!token?.startsWith('tgn_')) {
        throw new RequestError('UNAUTHORIZED', 'API key required', 401)
      }
      validated = await validateApiKey(db, redis, token)
    }
    if (!validated) throw new RequestError('UNAUTHORIZED', 'Invalid or revoked API key', 401)
    workspaceId = validated.workspaceId
    // K7: a key route runs as the key, with the key's grants (they used to be
    // discarded here); K8: as the key's identity when it has one.
    apiKeyId = actorIdForKey(validated)
    keyPermissions = validated.permissions
    actor = actorForKey(validated, workspaceId)
    if (match.route.capability) {
      requireDecision(actor, { kind: 'capability', capability: match.route.capability })
    }
  } else {
    // public: explicit workspace header, or the sole loaded workspace - the
    // same resolution rules the custom route short form documents.
    const projects = (ctx.workspaceProjects ?? []) as Array<{ workspaceId: string }>
    const resolved = resolvePublicWorkspace(
      projects,
      request.headers.get('X-Tangen-Workspace'),
      ctx.query?.workspace as string | undefined,
    )
    if (!resolved) throw new RequestError('NOT_FOUND', PUBLIC_SCOPE_HINT, 404)
    workspaceId = resolved
    // K7: a public route carries only what its handler is declared to do -
    // by default reading published content - never the framework's authority.
    actor = apiKeyActor({ apiKeyId: `ext:${extensionId}:public`, workspaceId, permissions: match.route.authority ?? { objects: { actions: ['read'] } } })
  }

  // Uninstalled ⇒ indistinguishable from an absent route
  if (!(await deps.isActive(extensionId, workspaceId))) {
    throw new RequestError('NOT_FOUND', 'Route not found', 404)
  }

  const headers: Record<string, string> = {}
  request.headers.forEach((value: string, key: string) => { headers[key.toLowerCase()] = value })

  const project = ((ctx.workspaceProjects ?? []) as Array<{ workspaceId: string }>).find((p) => p.workspaceId === workspaceId)
  const exec = requestExecution({ request, requestId: requestIdFor(ctx), workspaceId, actor, localization: projectLocalization(project), source: match.route.auth === 'key' ? 'rest' : 'extension' })
  const handlerCtx = bindExtensionCtx(await deps.buildCtx(extensionId, workspaceId), exec)
  const requestId = exec.id
  ctx.set.headers[REQUEST_ID_HEADER.toLowerCase()] ??= requestId
  try {
    // E.2: a key or public route mounts only under routes:key / routes:public.
    if (!routesAllowed(extensionId, workspaceId, match.route.auth === 'public' ? 'public' : 'key')) throw new RequestError('NOT_FOUND', 'Route not found', 404)
    return await match.route.handler(
    {
      params: match.params,
      query: (ctx.query ?? {}) as Record<string, string>,
      body: ctx.body,
      requestId,
      ...(apiKeyId ? { apiKeyId } : {}),
      ...(apiKeyId ? { keyCan: (action: string, item?: { id: string; slug?: string | null }) => checkExtensionPermission(keyPermissions as never, extensionId, action, item) } : {}),
      headers,
      // The caller's address as the Gateway sees it (trusted proxies honoured), for a public route's own rate or dedupe rules.
      ip: clientIp(request, getTrustedProxy(), socketAddressOf(ctx)) ?? undefined,
      url: request.url,
    },
    handlerCtx,
    )
  } catch (err) {
    // An extension's RouteError becomes the platform envelope (its code and fieldErrors lifted), as on the member mount.
    if (err instanceof RouteError) throw toRequestError(err, extensionId)
    throw err
  }
}

export const extensionPublicRoutes = (app: Elysia) =>
  app
    .get('/api/v1/ext/:extensionId/*', (ctx: any) => dispatch(ctx, 'GET'))
    .post('/api/v1/ext/:extensionId/*', (ctx: any) => dispatch(ctx, 'POST'))
    .patch('/api/v1/ext/:extensionId/*', (ctx: any) => dispatch(ctx, 'PATCH'))
    .delete('/api/v1/ext/:extensionId/*', (ctx: any) => dispatch(ctx, 'DELETE'))
    // A route declared with path '' answers at the bare prefix too.
    .get('/api/v1/ext/:extensionId', (ctx: any) => dispatch(ctx, 'GET'))
    .post('/api/v1/ext/:extensionId', (ctx: any) => dispatch(ctx, 'POST'))
    .patch('/api/v1/ext/:extensionId', (ctx: any) => dispatch(ctx, 'PATCH'))
    .delete('/api/v1/ext/:extensionId', (ctx: any) => dispatch(ctx, 'DELETE'))
