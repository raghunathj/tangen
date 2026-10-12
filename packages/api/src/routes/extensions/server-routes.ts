/**
 * File Name: server-routes.ts
 * Purpose: Mounts extension-contributed admin API routes at
 *          /api/v1/admin/ext/:extensionId/* — member-session auth, 404
 *          while the extension is uninstalled, per-route RBAC capability.
 *          This is how an extension (e.g. Flows) ships its own CRUD API
 *          without touching core route files.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Dispatch + param extraction live in
 *          services/extension-server.ts (pure, unit-tested); the ctx
 *          builder comes from the boot wiring (extensionWiringDeps).
 */
import { Elysia } from 'elysia'
import { RouteError } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { requireCapability } from '../../lib/member-access'
import { getExtensionAdminRoutes, getExtensionManifest, extensionUiBundlePath } from '../../hooks/app-hooks-registry'
import { serveExtensionUiBundle } from './ui-manifest'
import { serveExtensionSettings } from './settings'
import { routesAllowed } from '../../services/extension-server'
import { matchAdminRoute, extensionWiringDeps, makeActAsRole, makeCanWriteLocale } from '../../services/extension-server'
import { projectLocalization } from '../../services/i18n'
import { requestIdFor } from '../../lib/internal-error'
import { REQUEST_ID_HEADER } from '../../gateway/request-context'
import { bindExtensionCtx } from '../../services/extension-server'
import { evaluateAdminAccess } from '../../kernel/admin-access'
import { actorFromContext } from '../../kernel/actor'

/**
 * Normalises whatever a route handler threw into the platform's error type.
 *
 * Only two classes may choose a status: the platform's own `RequestError`, and
 * `RouteError`, which is the public one an extension author imports from
 * `@tangen/cms` precisely so a handler can answer `400` instead of `500`.
 *
 * Everything else is an accident, and an accident's message is not safe to
 * show: before Stage G9 this boundary had no catch at all, so a stray `Error`
 * put its own text - filesystem paths included - into the client's response.
 * Those become the platform's existing redacted INTERNAL response, unchanged.
 * Which extension failed goes to the server log, where an operator can see it
 * and a caller cannot.
 *
 * `instanceof`, not duck-typing: a thrown object that merely looks like a
 * RouteError must not get to pick its own HTTP status.
 */
export function toRequestError(err: unknown, _extensionId?: string): RequestError {
  if (err instanceof RequestError) return err
  if (err instanceof RouteError) {
    // An extension may name its error: `details.code` and `details.fieldErrors`
    // become the envelope's own (plan-core-slimming F2), the rest stays details.
    const d = err.details && typeof err.details === 'object' && !Array.isArray(err.details) ? (err.details as Record<string, unknown>) : null
    const code = typeof d?.code === 'string' ? d.code : err.status >= 500 ? 'INTERNAL' : 'EXTENSION_ERROR'
    const fieldErrors = d?.fieldErrors && typeof d.fieldErrors === 'object' ? (d.fieldErrors as Record<string, string>) : undefined
    const rest = d ? Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'code' && k !== 'fieldErrors')) : undefined
    const details = rest && Object.keys(rest).length > 0 ? ('details' in rest && Object.keys(rest).length === 1 ? rest.details : rest) : d ? undefined : err.details
    return new RequestError(code, err.message, err.status, fieldErrors, details)
  }
  return new RequestError('INTERNAL', 'Internal server error', 500)
}

async function dispatch(ctx: any, method: 'GET' | 'POST' | 'PATCH' | 'DELETE') {
  const { memberId, workspaceId } = ctx
  if (!memberId) throw new RequestError('FORBIDDEN', 'Admin session required', 403)

  const extensionId = String(ctx.params.extensionId)
  // K7.1: typed manifest settings are served by core, not the extension - but
  // only when the manifest declares them; an extension without a definition
  // keeps its own `settings` route, if it has one.
  if (String(ctx.params['*'] ?? '') === 'settings' && (method === 'GET' || method === 'POST') && getExtensionManifest(extensionId)?.settings) {
    return serveExtensionSettings(ctx, method, extensionId)
  }
  // K7.3: the built Admin bundle is core's to serve when the manifest registered one.
  if (String(ctx.params['*'] ?? '') === 'ui.js' && method === 'GET' && extensionUiBundlePath(extensionId)) {
    return serveExtensionUiBundle(ctx, extensionId)
  }
  // This mount serves MEMBER routes only — key/public entries live on
  // /api/v1/ext/:extensionId/* (public-routes.ts) and 404 here.
  const routes = getExtensionAdminRoutes(extensionId)
    ?.filter((r) => (r.auth ?? 'member') === 'member')
  const deps = extensionWiringDeps()
  if (!routes?.length || !deps) throw new RequestError('NOT_FOUND', 'Route not found', 404)
  // E.2: member routes mount only under routes:member.
  if (!routesAllowed(extensionId, workspaceId, 'member')) throw new RequestError('NOT_FOUND', 'Route not found', 404)

  // Uninstalled ⇒ indistinguishable from an absent route
  if (!(await deps.isActive(extensionId, workspaceId))) {
    throw new RequestError('NOT_FOUND', 'Route not found', 404)
  }

  const rel = String(ctx.params['*'] ?? '')
  const match = matchAdminRoute(routes, method, rel)
  if (!match) throw new RequestError('NOT_FOUND', 'Route not found', 404)

  if (match.route.capability) {
    requireCapability({ permissions: ctx.permissions, memberId }, match.route.capability as never)
  }
  // K7: the page rule this route backs, decided here with the Admin's semantics.
  if (match.route.access) {
    const verdict = evaluateAdminAccess(match.route.access, actorFromContext(ctx))
    if (!verdict.allow) throw new RequestError('FORBIDDEN', verdict.reason ?? 'Forbidden', 403)
  }

  // K7: the extension's ctx is bound to THIS request's execution - ctx.tangen
  // does what the member may, never more (invariant 8).
  const handlerCtx = bindExtensionCtx(await deps.buildCtx(extensionId, workspaceId), ctx.exec ?? null)
  const can = (capability: string): boolean => {
    try { requireCapability({ permissions: ctx.permissions, memberId }, capability as never); return true }
    catch { return false }
  }
  // The auth middleware already resolved this against the env override, so
  // forwarding it verbatim is what makes a per-env role win here too.
  const memberRole = (ctx.memberRole ?? null) as string | null
  // A translate-only role must not write base content through an extension
  // route either; the default language comes from the workspace's own config.
  const project = (ctx.workspaceProjects as Array<{ workspaceId?: string }> | undefined)
    ?.find((p) => p.workspaceId === workspaceId)
  const defaultLocale = projectLocalization(project)?.defaultLocale
  // The correlation id the Gateway assigned, echoed on the response so a
  // handler's log lines and the client's error id name the same request.
  const requestId = requestIdFor(ctx)
  ctx.set.headers[REQUEST_ID_HEADER.toLowerCase()] ??= requestId
  try {
    return await match.route.handler(
      {
        params: match.params, query: (ctx.query ?? {}) as Record<string, string>, body: ctx.body, requestId,
        memberId, can, memberRole, actAsRole: makeActAsRole(memberRole),
        canWriteLocale: makeCanWriteLocale({ memberId, permissions: ctx.permissions }, defaultLocale),
      },
      handlerCtx,
    )
  } catch (err) {
    // Only a DELIBERATE error is translated here. Anything else is rethrown
    // untouched so the platform's existing internal-error path runs exactly as
    // it did before: it generates the id, echoes it in the header, redacts the
    // message and logs the original. Re-implementing that would be a second
    // 500 path to keep in step with the first.
    if (err instanceof RouteError) throw toRequestError(err, extensionId)
    throw err
  }
}

export const extensionServerRoutes = (app: Elysia) =>
  app
    .get('/api/v1/admin/ext/:extensionId/*', (ctx: any) => dispatch(ctx, 'GET'))
    .post('/api/v1/admin/ext/:extensionId/*', (ctx: any) => dispatch(ctx, 'POST'))
    .patch('/api/v1/admin/ext/:extensionId/*', (ctx: any) => dispatch(ctx, 'PATCH'))
    .delete('/api/v1/admin/ext/:extensionId/*', (ctx: any) => dispatch(ctx, 'DELETE'))
    // A route declared with path '' answers at the bare prefix too (the Forms list is GET /admin/ext/forms).
    .get('/api/v1/admin/ext/:extensionId', (ctx: any) => dispatch(ctx, 'GET'))
    .post('/api/v1/admin/ext/:extensionId', (ctx: any) => dispatch(ctx, 'POST'))
    .patch('/api/v1/admin/ext/:extensionId', (ctx: any) => dispatch(ctx, 'PATCH'))
    .delete('/api/v1/admin/ext/:extensionId', (ctx: any) => dispatch(ctx, 'DELETE'))
