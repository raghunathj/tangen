/**
 * File Name: playground.ts
 * Purpose: API Playground admin routes — OWNER/ADMIN only. `catalog`
 *          seeds the endpoint picker; `execute` impersonates a chosen API
 *          key (one-shot HMAC token) and self-dispatches a Tangen API call
 *          so the response is exactly what that key would get in
 *          production. Same-host /api/v1 paths only (no SSRF); every
 *          execute writes a workspace_activity row attributed to the
 *          member.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { Elysia } from 'elysia'
import { randomUUID } from 'node:crypto'
import { and, eq , desc } from 'drizzle-orm'
import { apiKeys, workspaceActivity } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { mintPlaygroundToken, PLAYGROUND_HEADER } from '../../lib/playground-token'
import { isAllowedPlaygroundPath, filterRequestHeaders, buildPlaygroundCatalog } from '../../lib/playground'
import { buildDeclaredFeatureResources } from '../../routes/api-keys/manage'
import { getExtensionAdminRoutes, getExtensionManifest } from '../../hooks/app-hooks-registry'
import { extensionWiringDeps } from '../../services/extension-server'
import { requestOrigin } from '../../lib/request-origin'

const MAX_RESPONSE_BYTES = 256 * 1024

/** owner / admin / superadmin only — the impersonation surface is privileged. */
function requireAdminRole(ctx: any): void {
  if (!ctx.memberId) throw new RequestError('FORBIDDEN', 'Admin session required', 403)
  const role = String(ctx.memberRole ?? '')
  if (role !== 'owner' && role !== 'admin' && role !== 'superadmin') {
    throw new RequestError('FORBIDDEN', 'The API Playground is available to owners and admins only', 403)
  }
}

export const playgroundRoutes = (app: Elysia) =>
  app
    .get('/api/v1/admin/playground/catalog', async (ctx: any) => {
      requireAdminRole(ctx)
      const { db, workspaceId, schema, workspaceProjects } = ctx
      const project = (workspaceProjects as any[])?.find((p) => p.workspaceId === workspaceId)
      let apiGroups: Array<{ id: string; label?: string; actions?: string[] }> = []
      try {
        const features = await buildDeclaredFeatureResources(project?.apiResources, { db, workspaceId }, ['forms'])
        apiGroups = features.map((f) => ({ id: f.id, label: f.label, actions: f.actions }))
      } catch { /* catalog is best-effort */ }
      const customTables = ((project?.config?.customTables ?? project?.customTables ?? []) as Array<{ name: string }>).map((t) => t.name)

      // The key routes the ACTIVE extensions serve, so they are in the picker
      // beside the core ones rather than something a developer has to know about.
      let extensions: Array<{ id: string; label?: string; routes: Array<{ method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; path: string }> }> = []
      try {
        const activeIds = await (extensionWiringDeps()?.activeIds?.(workspaceId) ?? Promise.resolve([] as string[]))
        extensions = activeIds.map((id) => {
          const manifest = getExtensionManifest(id)
          const routes = (getExtensionAdminRoutes(id) ?? [])
            .filter((r) => r.auth === 'key')
            .map((r) => ({ method: r.method, path: r.path }))
          return { id, ...(manifest?.name ? { label: manifest.name } : {}), routes }
        }).filter((e) => e.routes.length > 0)
      } catch { /* catalog is best-effort */ }

      // The member's keys for this env drive the picker — latest first; revoked
      // and expired keys can't run anything, so they don't clutter the list.
      const keys = (await db
        .select({ id: apiKeys.id, label: apiKeys.label, keyPrefix: apiKeys.keyPrefix, permissions: apiKeys.permissions, expiresAt: apiKeys.expiresAt, revokedAt: apiKeys.revokedAt, createdAt: apiKeys.createdAt })
        .from(apiKeys)
        .where(and(eq(apiKeys.workspaceId, workspaceId)))
        .orderBy(desc(apiKeys.createdAt)))
        .filter((k: any) => !k.revokedAt && !(k.expiresAt && new Date(k.expiresAt) < new Date()))

      return {
        data: {
          endpoints: buildPlaygroundCatalog({ schema, apiGroups, customTables, extensions }),
          keys: keys.map((k: any) => ({
            id: k.id, label: k.label, keyPrefix: k.keyPrefix,
            permissions: k.permissions,
            disabled: Boolean(k.revokedAt) || (k.expiresAt && new Date(k.expiresAt) < new Date()),
            reason: k.revokedAt ? 'revoked' : (k.expiresAt && new Date(k.expiresAt) < new Date()) ? 'expired' : undefined,
          })),
        },
      }
    })

    .post('/api/v1/admin/playground/execute', async (ctx: any) => {
      requireAdminRole(ctx)
      const { db, workspaceId, memberId, request, body } = ctx
      const b = (body ?? {}) as {
        keyId?: string; method?: string; path?: string
        query?: Record<string, string>; headers?: Record<string, string>; body?: unknown
      }

      // 1. Validate the chosen key belongs here and is usable
      const [key] = await db.select().from(apiKeys)
        .where(and(eq(apiKeys.id, String(b.keyId ?? '')), eq(apiKeys.workspaceId, workspaceId))).limit(1)
      if (!key) throw new RequestError('VALIDATION_ERROR', 'Unknown API key', 400)
      if (key.revokedAt) throw new RequestError('VALIDATION_ERROR', 'That API key is revoked', 400)
      if (key.expiresAt && new Date(key.expiresAt) < new Date()) throw new RequestError('VALIDATION_ERROR', 'That API key is expired', 400)

      // 2. Validate the request line
      const method = String(b.method ?? 'GET').toUpperCase()
      if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) throw new RequestError('VALIDATION_ERROR', 'Unsupported method', 422)
      let path = String(b.path ?? '')
      if (!isAllowedPlaygroundPath(path)) throw new RequestError('VALIDATION_ERROR', 'Path must be a same-host /api/v1/ route', 422)

      // Merge extra query params onto the path
      const [rawPath, rawQs] = path.split('?')
      const qs = new URLSearchParams(rawQs ?? '')
      for (const [k, v] of Object.entries(b.query ?? {})) if (v != null && v !== '') qs.set(k, String(v))
      path = qs.toString() ? `${rawPath}?${qs.toString()}` : rawPath

      // 3. One-shot impersonation token; self-dispatch on the same host
      const token = mintPlaygroundToken({ keyId: key.id, memberId, workspaceId })
      const origin = requestOrigin(request)
      const headers: Record<string, string> = {
        ...filterRequestHeaders(b.headers ?? {}),
        [PLAYGROUND_HEADER]: token,
      }
      const hasBody = method !== 'GET' && method !== 'DELETE' && b.body != null
      if (hasBody && !headers['content-type']) headers['content-type'] = 'application/json'

      const started = performance.now()
      let res: Response
      try {
        res = await fetch(`${origin}${path}`, {
          method, headers, redirect: 'manual',
          body: hasBody ? JSON.stringify(b.body) : undefined,
          signal: AbortSignal.timeout(30_000),
        })
      } catch (err) {
        throw new RequestError('PLAYGROUND_DISPATCH_FAILED', `Request failed: ${(err as Error).message}`, 502)
      }
      const ms = Math.round(performance.now() - started)

      // 4. Shape the response (safe headers, size-capped, JSON when possible)
      const text = await res.text()
      const truncated = text.length > MAX_RESPONSE_BYTES
      const raw = truncated ? text.slice(0, MAX_RESPONSE_BYTES) : text
      let json: unknown = null
      try { json = JSON.parse(raw) } catch { /* keep raw */ }
      const respHeaders: Record<string, string> = {}
      for (const [k, v] of res.headers.entries()) {
        if (['content-type', 'content-length', 'x-request-id', 'cache-control'].includes(k.toLowerCase())) respHeaders[k] = v
      }

      // 5. Audit — attributed to the member, not the key
      void db.insert(workspaceActivity).values({
        id: `act_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        workspaceId, category: 'api-keys', action: 'updated',
        actorId: memberId, actorName: 'API Playground', actorType: 'member', source: 'admin',
        objectTitle: `${method} ${rawPath} via key ${key.label}`,
      }).catch(() => { /* audit best-effort */ })

      return { data: { status: res.status, ms, truncated, headers: respHeaders, json, raw: json == null ? raw : undefined } }
    })
