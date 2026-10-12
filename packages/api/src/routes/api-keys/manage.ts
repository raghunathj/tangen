/**
 * File Name: manage.ts
 * Purpose: Elysia route handlers for creating, listing, updating, and revoking API keys,
 *          plus supporting helpers for payload validation and key generation.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, Drizzle ORM, @tangen/db (apiKeys), @tangen/types (ApiKeyPermissions)
 */
import { Elysia } from 'elysia'
import { randomBytes, createHash } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { apiKeys, identities } from '@tangen/db'
import type { ApiKeyPermissions, WorkspaceProject, RouteResourceGroup, FeatureResource, ApiResourceDefinition, ApiResourceItemsContext } from '@tangen/types'
import { deriveAction } from '../../lib/api-key-auth'
import { requireCapability } from '../../lib/member-access'
import { RequestError } from '../../lib/errors'
import { assertApiKeyPermissions } from '../../lib/api-key-permissions'
import { resolveActorId } from '../../lib/actor'
import { getExtensionManifest, getExtensionServer } from '../../hooks/app-hooks-registry'
import { extensionWiringDeps } from '../../services/extension-server'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateApiKeyPayload {
  label: string
  permissions: ApiKeyPermissions
  expiresAt?: Date
  /** K8: the identity this key is a credential of; the key then carries no grants of its own. */
  identityId?: string
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Validates and normalises the raw request body into a typed CreateApiKeyPayload.
 * @param body - The raw, untyped request body from Elysia context
 * @returns A validated CreateApiKeyPayload
 */
export function buildCreateApiKeyPayload(body: unknown): CreateApiKeyPayload {
  const b = body as Record<string, unknown>
  const label = (b?.label as string | undefined)?.trim()

  if (!label) throw new RequestError('VALIDATION_ERROR', 'label is required', 422)

  // Every action is checked against the catalogue: an unknown one is a 422,
  // not a row that a reader later ignores (lib/api-key-permissions.ts).
  const permissions = assertApiKeyPermissions(b?.permissions)
  const expiresAtRaw = b?.expiresAt as string | undefined
  const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : undefined

  return { label, permissions, expiresAt }
}

/**
 * Generates a cryptographically random API key and returns the raw value, display prefix, and SHA-256 hash.
 * @returns An object with the raw key (shown once to the caller), a 12-character display prefix, and a SHA-256 hash for DB storage
 */
export function deriveKeyParts(): { raw: string; keyPrefix: string; keyHash: string } {
  const raw = `tgn_${randomBytes(32).toString('hex')}`
  const keyPrefix = raw.slice(0, 12)
  const keyHash = createHash('sha256').update(raw).digest('hex')
  return { raw, keyPrefix, keyHash }
}

function assertAdmin(permissions: ApiKeyPermissions | { admin: true }, memberId?: string | null): void {
  requireCapability({ permissions, memberId }, 'manage:apiKeys')
}

export type { RouteResourceGroup, FeatureResource }

/**
 * Scans registered CustomRoutes for apiGroup declarations, deduplicates by group id,
 * and derives action names from HTTP methods when no explicit action is declared.
 */
export function buildRouteResourceGroups(
  routes: WorkspaceProject['routes'],
  declaredIds: string[] = [],
): RouteResourceGroup[] {
  const groups = new Map<string, RouteResourceGroup>()
  const declared = new Set(declaredIds)

  for (const route of routes ?? []) {
    if (!route.apiGroup) continue
    const g = typeof route.apiGroup === 'string'
      ? { id: route.apiGroup, label: route.apiGroup }   // unmatched shorthand stays visible
      : route.apiGroup
    const { id, label, description, action } = g
    // A declared resource supersedes inline groups with the same id
    if (declared.has(id)) continue
    const resolvedAction = action ?? deriveAction(route.method)

    if (!groups.has(id)) {
      groups.set(id, { id, label, description, actions: [resolvedAction] })
    } else {
      const g = groups.get(id)!
      if (!g.actions.includes(resolvedAction)) g.actions.push(resolvedAction)
    }
  }

  return Array.from(groups.values())
}


/**
 * The API key grants of the extensions ACTIVE in a workspace, as feature
 * resources (plan-core-slimming F1): the manifest's `apiKeyScope` names the
 * actions, the server's `apiKeyScopeItems` the items a key may be scoped to.
 * A failing items loader yields an empty list, never a 500.
 */
export async function buildExtensionFeatureResources(workspaceId: string): Promise<FeatureResource[]> {
  const deps = extensionWiringDeps()
  if (!deps?.activeIds) return []
  const active = await deps.activeIds(workspaceId).catch(() => [] as string[])
  const out: FeatureResource[] = []
  for (const extensionId of active) {
    const scope = getExtensionManifest(extensionId)?.apiKeyScope
    if (!scope) continue
    let items: FeatureResource['items'] = []
    const loader = getExtensionServer(extensionId)?.apiKeyScopeItems
    if (scope.items && loader) {
      try {
        const ctx = await deps.buildCtx(extensionId, workspaceId)
        items = (await loader(ctx)).map((i) => ({ id: i.id, name: i.name, ...(i.slug ? { slug: i.slug } : {}) }))
      } catch (err) {
        console.warn(`[api-keys] extension '${extensionId}' apiKeyScopeItems failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    out.push({ id: extensionId, extensionId, label: scope.label, description: scope.description, actions: scope.actions.map((a) => a.id), items })
  }
  return out
}

/**
 * Resolves site-declared ApiResourceDefinitions into FeatureResources for the
 * API manager. Item loaders run against { db, workspaceId }; a loader failure
 * logs a warning and yields an empty item list — the manager never 500s
 * because one extension misbehaves. Ids an active extension's apiKeyScope
 * already uses are skipped with a warning.
 */
export async function buildDeclaredFeatureResources(
  defs: ApiResourceDefinition[] | undefined,
  ctx: ApiResourceItemsContext,
  reservedIds: string[] = [],
): Promise<FeatureResource[]> {
  const reserved = new Set(reservedIds)
  const features: FeatureResource[] = []
  for (const def of defs ?? []) {
    if (reserved.has(def.id)) {
      console.warn(`[api-resources] "${def.id}" is reserved by a built-in feature - declaration skipped`)
      continue
    }
    let items: FeatureResource['items'] = []
    if (def.items) {
      try {
        items = await def.items(ctx)
      } catch (err) {
        console.warn(`[api-resources] items loader for "${def.id}" failed:`, err)
      }
    }
    features.push({
      id: def.id,
      label: def.label,
      ...(def.description ? { description: def.description } : {}),
      actions: def.actions,
      items,
    })
  }
  return features
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * Elysia plugin that mounts CRUD endpoints for API key management under /api/v1/api-keys.
 * @param app - The Elysia application instance
 * @returns The Elysia instance with api-key routes registered
 */
export const apiKeyRoutes = (app: Elysia) =>
  app
    .post('/api/v1/api-keys', async (ctx: any) => {
      const { body, db, workspaceId, apiKeyId, permissions, set } = ctx
      assertAdmin(permissions, ctx.memberId)

      const payload = buildCreateApiKeyPayload(body)
      const { raw, keyPrefix, keyHash } = deriveKeyParts()
      const id = `key_${randomBytes(6).toString('hex')}`

      // K8: a credential of an identity holds no grants of its own - the identity's speak.
      const identityId = typeof (body as { identityId?: unknown })?.identityId === 'string' ? String((body as { identityId: string }).identityId) : null
      if (identityId) {
        const [identity] = await db.select({ id: identities.id, status: identities.status }).from(identities)
          .where(and(eq(identities.id, identityId), eq(identities.workspaceId, workspaceId))).limit(1)
        if (!identity) throw new RequestError('NOT_FOUND', 'Identity not found in this workspace', 404)
      }

      await db.insert(apiKeys).values({
        id,
        workspaceId,
        label: payload.label,
        keyPrefix,
        keyHash,
        permissions: identityId ? {} : payload.permissions,
        expiresAt: payload.expiresAt ?? null,
        createdBy: resolveActorId(ctx.memberId, apiKeyId),   // K0: the member who minted it, never null for a session
        identityId,
      })

      set.status = 201
      return {
        id,
        key: raw,
        label: payload.label,
        workspaceId,
        permissions: identityId ? {} : payload.permissions,
        expiresAt: payload.expiresAt ?? null,
        identityId,
      }
    })

    .get('/api/v1/api-keys', async (ctx: any) => {
      const { db, workspaceId, permissions } = ctx
      assertAdmin(permissions, ctx.memberId)

      const rows = await db.select().from(apiKeys).where(eq(apiKeys.workspaceId, workspaceId))

      return {
        data: rows.map((k: any) => ({
          id: k.id,
          workspaceId: k.workspaceId,
          label: k.label,
          keyPrefix: k.keyPrefix,
          permissions: k.permissions,
          expiresAt: k.expiresAt,
          createdAt: k.createdAt,
          createdBy: k.createdBy,
          identityId: k.identityId ?? null,
          lastUsedAt: k.lastUsedAt,
          revokedAt: k.revokedAt,
        })),
      }
    })

    .patch('/api/v1/api-keys/:id', async (ctx: any) => {
      const { body, db, workspaceId, permissions, params } = ctx
      assertAdmin(permissions, ctx.memberId)

      const b = body as Record<string, unknown>
      const newPermissions = assertApiKeyPermissions(b?.permissions)

      await db
        .update(apiKeys)
        .set({ permissions: newPermissions })
        .where(and(eq(apiKeys.id, params.id), eq(apiKeys.workspaceId, workspaceId)))

      return { id: params.id, permissions: newPermissions }
    })

    .delete('/api/v1/api-keys/:id', async (ctx: any) => {
      const { db, workspaceId, permissions, params, set } = ctx
      assertAdmin(permissions, ctx.memberId)

      await db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, params.id), eq(apiKeys.workspaceId, workspaceId)))

      set.status = 204
      return null
    })

    .get('/api/v1/route-resources', async (ctx: any) => {
      const { db, workspaceId, permissions, workspaceProjects } = ctx
      assertAdmin(permissions, ctx.memberId)

      const projects: WorkspaceProject[] = workspaceProjects ?? []
      const project = projects.find((p) => p.workspaceId === workspaceId)
      const routes = project?.routes ?? []

      const fromExtensions = await buildExtensionFeatureResources(workspaceId)
      const declared = await buildDeclaredFeatureResources(
        project?.apiResources, { db, workspaceId }, fromExtensions.map((f) => f.id),
      )

      return {
        groups: buildRouteResourceGroups(routes, [...declared, ...fromExtensions].map((f) => f.id)),
        features: [...fromExtensions, ...declared],
      }
    })
