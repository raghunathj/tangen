/**
 * File Name: api-keys.ts
 * Purpose: Utilities for API key status evaluation, permission modeling, and serialization between the API shape and the admin form state.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends on ApiKeyPermissions from @tangen/types. PERMISSION_RESOURCES defines the canonical list of resources shown in the key creation UI.
 */
import type { ApiKeyPermissions, RouteResourceGroup, FeatureResource } from '@tangen/types'
import { adminFetch } from './api'

/**
 * Returns true if the key has been revoked.
 * @param key - object with a revokedAt timestamp field
 * @returns whether the key's revokedAt is non-null
 */
export function isKeyRevoked(key: { revokedAt: string | null }): boolean {
  return key.revokedAt !== null
}

/**
 * Returns true if the key has a past expiry date.
 * @param key - object with an expiresAt timestamp field
 * @returns whether the expiry date is in the past
 */
export function isKeyExpired(key: { expiresAt: string | null }): boolean {
  if (!key.expiresAt) return false
  return new Date(key.expiresAt) < new Date()
}

/**
 * Derives a human-readable status label for an API key.
 * @param key - object with revokedAt and expiresAt fields
 * @returns 'Revoked', 'Expired', or 'Active'
 */
export function formatKeyStatus(key: { revokedAt: string | null; expiresAt: string | null }): 'Active' | 'Revoked' | 'Expired' {
  if (isKeyRevoked(key)) return 'Revoked'
  if (isKeyExpired(key)) return 'Expired'
  return 'Active'
}

export interface PermissionResource {
  id: string
  label: string
  actions: string[]
}

/** The platform's own key scopes; every other flat key in the editor state is an extension's id. */
const PLATFORM_SCOPES = new Set(['objects', 'media', 'search', 'globals', 'schema', 'toolbar', 'tables', 'webhooks', 'locales'])

export const PERMISSION_RESOURCES: PermissionResource[] = [
  { id: 'objects', label: 'Objects',  actions: ['read', 'read_draft', 'write', 'publish', 'delete'] },
  { id: 'media',   label: 'Media',    actions: ['read', 'write', 'delete'] },
  { id: 'search',  label: 'Search',   actions: ['read'] },
  { id: 'globals', label: 'Globals',  actions: ['read', 'write'] },
  { id: 'schema',  label: 'Schema',   actions: ['push', 'pull'] },
  { id: 'toolbar', label: 'Toolbar (performance headers)', actions: ['enable'] },
]

/** Wire types for GET /api/v1/route-resources — shared via @tangen/types. */
export type { RouteResourceGroup, FeatureResource }

/** Fetch the registered custom route API groups from the server. */
export async function fetchRouteResources(env: string | undefined): Promise<RouteResourceGroup[]> {
  if (!env) return []
  try {
    const res = await adminFetch<{ groups: RouteResourceGroup[] }>('/route-resources')
    return res.groups ?? []
  } catch {
    return []
  }
}

/** Fetch groups + features in one round-trip to /route-resources. An extension's scope appears in `features` only while it is installed. */
export async function fetchKeyResources(): Promise<{ groups: RouteResourceGroup[]; features: FeatureResource[] }> {
  try {
    const res = await adminFetch<{ groups?: RouteResourceGroup[]; features?: FeatureResource[] }>('/route-resources')
    return { groups: res.groups ?? [], features: res.features ?? [] }
  } catch {
    return { groups: [], features: [] }
  }
}

/** Fetch built-in feature resources (e.g. Forms with its per-form items). */
export async function fetchFeatureResources(env: string | undefined): Promise<FeatureResource[]> {
  if (!env) return []
  try {
    const res = await adminFetch<{ features?: FeatureResource[] }>('/route-resources')
    return res.features ?? []
  } catch {
    return []
  }
}

type ObjectAction = NonNullable<NonNullable<ApiKeyPermissions['objects']>['types']>[string][number]

/**
 * Converts a form's per-type action map into the ApiKeyPermissions type-override shape, omitting types with no actions selected.
 * @param overrides - map of type name to selected action strings
 * @returns a typed permissions override record, or undefined if all entries are empty
 */
export function buildTypeOverrides(
  overrides: Record<string, string[]>,
): Record<string, ObjectAction[]> | undefined {
  const result: Record<string, ObjectAction[]> = {}
  for (const [typeName, actions] of Object.entries(overrides)) {
    if (actions.length > 0) result[typeName] = actions as ObjectAction[]
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Converts an ApiKeyPermissions object from the API into a flat form-friendly state.
 * @param perms - the API permissions object
 * @returns globalActions keyed by resource name and a typeOverrides array
 */
export function permissionsToFormState(perms: ApiKeyPermissions): {
  globalActions: Record<string, string[]>
  typeOverrides: { type: string; actions: string[] }[]
  extensionOverrides: Record<string, { item: string; actions: string[] }[]>
  customRoutes: Record<string, string[]>
} {
  const globalActions: Record<string, string[]> = {}

  if (perms.objects?.actions?.length) globalActions.objects = perms.objects.actions as string[]
  if (perms.media?.actions?.length) globalActions.media = perms.media.actions as string[]
  // An extension's grants (`permissions.extensions[<id>]`) ride the same flat state under the extension's id.
  for (const [extId, grant] of Object.entries(perms.extensions ?? {})) {
    if (grant?.actions?.length) globalActions[extId] = grant.actions
  }
  if (perms.search?.actions?.length) globalActions.search = perms.search.actions as string[]
  if (perms.globals?.actions?.length) globalActions.globals = perms.globals.actions as string[]
  if (perms.schema?.actions?.length) globalActions.schema = perms.schema.actions as string[]
  if (perms.toolbar?.enabled) globalActions.toolbar = ['enable']

  const typeOverrides: { type: string; actions: string[] }[] = []
  if (perms.objects?.types) {
    for (const [typeName, actions] of Object.entries(perms.objects.types)) {
      typeOverrides.push({ type: typeName, actions: actions as string[] })
    }
  }

  // Per-item overrides of every extension scope, keyed by extension id.
  const extensionOverrides: Record<string, { item: string; actions: string[] }[]> = {}
  for (const [extId, grant] of Object.entries(perms.extensions ?? {})) {
    const rows = Object.entries(grant?.items ?? {}).map(([item, actions]) => ({ item, actions: actions as string[] }))
    if (rows.length > 0) extensionOverrides[extId] = rows
  }

  const customRoutes: Record<string, string[]> = perms.customRoutes ?? {}

  return { globalActions, typeOverrides, extensionOverrides, customRoutes }
}

/**
 * Constructs an ApiKeyPermissions object from the form's flat state for submission to the API.
 * @param form - global actions keyed by resource name
 * @param typeOverrides - optional per-type action overrides
 * @returns a structured ApiKeyPermissions object
 */
export function buildPermissionsFromForm(
  form: Record<string, string[]>,
  typeOverrides?: Record<string, string[]>,
  customRoutes?: Record<string, string[]>,
  extensionOverrides?: Record<string, Record<string, string[]>>,
): ApiKeyPermissions {
  const perms: ApiKeyPermissions = {}
  const resolvedTypes = typeOverrides ? buildTypeOverrides(typeOverrides) : undefined

  const hasGlobalActions = (form.objects?.length ?? 0) > 0
  const hasTypeOverrides = resolvedTypes != null

  if (hasGlobalActions || hasTypeOverrides) {
    perms.objects = {
      ...(hasGlobalActions ? { actions: form.objects as NonNullable<ApiKeyPermissions['objects']>['actions'] } : {}),
      ...(hasTypeOverrides ? { types: resolvedTypes } : {}),
    }
  }
  if (form.media?.length) {
    perms.media = { actions: form.media as NonNullable<ApiKeyPermissions['media']>['actions'] }
  }
  // Extension grants: every flat key that is not a platform scope is an extension id
  // (the editor only offers the ids /route-resources listed as active features).
  const extensions: NonNullable<ApiKeyPermissions['extensions']> = {}
  for (const [id, actions] of Object.entries(form)) {
    if (PLATFORM_SCOPES.has(id) || !actions?.length) continue
    extensions[id] = { actions }
  }
  for (const [id, items] of Object.entries(extensionOverrides ?? {})) {
    const kept = Object.fromEntries(Object.entries(items).filter(([, a]) => a.length > 0))
    if (Object.keys(kept).length > 0) extensions[id] = { ...(extensions[id] ?? {}), items: kept }
  }
  if (Object.keys(extensions).length > 0) perms.extensions = extensions
  if (form.search?.length) {
    perms.search = { actions: ['read'] }
  }
  if (form.globals?.length) {
    perms.globals = { actions: form.globals as NonNullable<ApiKeyPermissions['globals']>['actions'] }
  }
  if (form.schema?.length) {
    perms.schema = { actions: form.schema as NonNullable<ApiKeyPermissions['schema']>['actions'] }
  }
  if (form.toolbar?.includes('enable')) {
    perms.toolbar = { enabled: true }
  }
  if (customRoutes && Object.keys(customRoutes).some((k) => customRoutes[k].length > 0)) {
    perms.customRoutes = Object.fromEntries(
      Object.entries(customRoutes).filter(([, actions]) => actions.length > 0),
    )
  }

  return perms
}

// ─── Object-based permissions state (PermissionsEditor) ───────────────────────

/** Flat, UI-friendly view of ApiKeyPermissions — one shape for create + edit. */
export interface PermissionsFormState {
  /** Actions per system resource id (objects/media/search/schema/auth), per extension id, AND per custom-route/resource group id. */
  globalActions: Record<string, string[]>
  typeOverrides: { type: string; actions: string[] }[]
  /** Per-item overrides of an extension's scope (`permissions.extensions[<id>].items`), keyed by extension id. */
  extensionOverrides: Record<string, { item: string; actions: string[] }[]>
  /** Action grants for custom-route groups and declared resources. */
  customRoutes: Record<string, string[]>
  /** Per-item overrides for declared resources, keyed by resource id. */
  resourceOverrides: Record<string, { item: string; actions: string[] }[]>
}

/** Converts stored ApiKeyPermissions into the flat editor state. */
export function permissionsToState(perms: ApiKeyPermissions): PermissionsFormState {
  const { globalActions, typeOverrides, extensionOverrides, customRoutes } = permissionsToFormState(perms)
  const resourceOverrides: PermissionsFormState['resourceOverrides'] = {}
  for (const [resourceId, items] of Object.entries(perms.resources ?? {})) {
    resourceOverrides[resourceId] = Object.entries(items).map(([item, actions]) => ({ item, actions: actions as string[] }))
  }
  return { globalActions, typeOverrides, extensionOverrides, customRoutes, resourceOverrides }
}

/** Builds ApiKeyPermissions from the flat editor state (inverse of permissionsToState). */
export function buildPermissions(state: PermissionsFormState): ApiKeyPermissions {
  const perms = buildPermissionsFromForm(
    state.globalActions,
    state.typeOverrides.length > 0
      ? Object.fromEntries(state.typeOverrides.map((r) => [r.type, r.actions]))
      : undefined,
    state.customRoutes,
    Object.fromEntries(Object.entries(state.extensionOverrides).map(([id, rows]) => [id, Object.fromEntries(rows.map((r) => [r.item, r.actions]))])),
  )
  const resources: NonNullable<ApiKeyPermissions['resources']> = {}
  for (const [resourceId, rows] of Object.entries(state.resourceOverrides)) {
    if (rows.length === 0) continue
    resources[resourceId] = Object.fromEntries(rows.map((r) => [r.item, r.actions]))
  }
  if (Object.keys(resources).length > 0) perms.resources = resources
  return perms
}
