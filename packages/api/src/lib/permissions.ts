/**
 * File Name: permissions.ts
 * Purpose: Provides runtime permission guards for object-level actions, supporting both
 * admin sessions (full access) and scoped API key permissions with per-type overrides.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types (ApiKeyPermissions), ./errors (RequestError).
 */
import type { ApiKeyPermissions } from '@tangen/types'
import { RequestError } from './errors'

export type ObjectAction = 'read' | 'read_draft' | 'write' | 'publish' | 'delete'

export type EffectivePermissions = ApiKeyPermissions | { admin: true }

/**
 * Asserts that the caller holds the required action permission for content objects.
 * Admin sessions bypass all checks; API keys are evaluated against their granted actions,
 * with per-type overrides taking precedence over the global actions list.
 * @param permissions - Effective permissions from admin session or validated API key.
 * @param action - The action being attempted (read | write | publish | delete).
 * @param typeName - Optional content-type slug for per-type permission resolution.
 * @throws RequestError(403) when the required permission is absent.
 */
export function assertObjectPermission(
  permissions: EffectivePermissions,
  action: ObjectAction,
  typeName?: string,
): void {
  if ('admin' in permissions && permissions.admin) return

  const objPerms = (permissions as ApiKeyPermissions).objects
  if (!objPerms) {
    throw new RequestError('FORBIDDEN', `Missing permission: objects:${action}`, 403)
  }

  // Per-type override takes precedence; fall back to global actions
  const override = typeName && objPerms.types?.[typeName] != null ? objPerms.types[typeName] : undefined
  const effectiveActions = override ?? objPerms.actions

  if (!effectiveActions || !effectiveActions.includes(action)) {
    throw new RequestError('FORBIDDEN', `Missing permission: objects:${action}`, 403)
  }
  // K0: the flat allow-list applies when no per-type override speaks for the
  // type - the same rule canObjectsAction (GraphQL, realtime) always applied;
  // this guard used to ignore it, so a key scoped to ['post'] could act on
  // every type through REST.
  if (!override && typeName && objPerms.allowedTypes && !objPerms.allowedTypes.includes(typeName)) {
    throw new RequestError('FORBIDDEN', `Missing permission: objects:${action} on ${typeName}`, 403)
  }
}

/**
 * Custom-table gate (K0). Keys must hold the `tables` grant (MCP always
 * enforced this; REST never did). Members whose bundle says nothing about
 * tables keep the read access they always had - a bundle that DOES name
 * `tables` is honoured for members too, so a role can restrict them.
 */
export function assertTablePermission(
  permissions: EffectivePermissions,
  action: 'read' | 'write',
  tableName: string,
  ctx: { isMember: boolean },
): void {
  if ('admin' in permissions && permissions.admin) return
  const tables = (permissions as ApiKeyPermissions).tables
  if (!tables) {
    if (ctx.isMember && action === 'read') return
    throw new RequestError('FORBIDDEN', `Missing permission: tables:${action}`, 403)
  }
  if (!tables.actions?.includes(action as never)) {
    throw new RequestError('FORBIDDEN', `Missing permission: tables:${action}`, 403)
  }
  if (tables.allowedTables && !tables.allowedTables.includes(tableName)) {
    throw new RequestError('FORBIDDEN', `Missing permission: tables:${action} on ${tableName}`, 403)
  }
}

/**
 * Media permission gate — same shape as assertObjectPermission. Admin
 * sessions bypass; otherwise permissions.media.actions must carry the action.
 */
export function assertMediaPermission(
  permissions: ApiKeyPermissions | { admin: true },
  action: 'read' | 'write' | 'delete',
  folderId?: string | null,
): void {
  if ('admin' in permissions && permissions.admin) return
  const scope = (permissions as ApiKeyPermissions).media
  if (!scope?.actions?.includes(action)) {
    throw new RequestError('FORBIDDEN', `Missing permission: media:${action}`, 403)
  }
  // `allowedFolders` was declared, validated and intersected but never
  // checked anywhere, so a key an operator scoped to one folder reached every
  // folder. Enforced the same way assertGlobalsPermission has always enforced
  // `allowedNames`. The unfiled root (null) is not on any list, so a scoped
  // key does not reach it either.
  if (scope.allowedFolders && folderId !== undefined) {
    if (folderId === null || !scope.allowedFolders.includes(folderId)) {
      throw new RequestError(
        'FORBIDDEN',
        `Key is not permitted to access media folder ${folderId === null ? '(unfiled)' : `"${folderId}"`}`,
        403,
      )
    }
  }
}

/**
 * The media folders a principal may see, for the paths that LIST or SEARCH
 * rather than name one asset.
 *
 * `null` means unrestricted. An array means exactly those folders - and the
 * unfiled root is deliberately NOT among them, matching
 * assertMediaPermission: a key scoped to a folder list was never given the
 * root. An EMPTY array therefore means "no folder at all", which a caller must
 * translate into an empty result rather than a missing filter.
 *
 * Why a scope and not an assertion: refusing a list because it would include
 * one disallowed asset makes a scoped key useless, and returning the whole
 * library makes the scope a lie. Filtering is the only answer that is both
 * usable and true.
 */
export function mediaFolderScope(
  permissions: ApiKeyPermissions | { admin: true },
): string[] | null {
  if ('admin' in permissions && permissions.admin) return null
  return (permissions as ApiKeyPermissions).media?.allowedFolders ?? null
}

/**
 * Globals permission gate. Admin sessions bypass; API keys must carry the
 * requested action under `globals.actions`, and — when `allowedNames` is set —
 * the named global must be on that list. Fails closed: a key with no globals
 * scope is denied, and `write` is never implied by `read`.
 * @param permissions - Effective permissions from admin session or API key.
 * @param action - 'read' for GET, 'write' for PUT/PATCH.
 * @param name - The global's name, when the route targets a single global.
 */
export function assertGlobalsPermission(
  permissions: ApiKeyPermissions | { admin: true },
  action: 'read' | 'write',
  name?: string,
): void {
  if ('admin' in permissions && permissions.admin) return
  const scope = (permissions as ApiKeyPermissions).globals
  if (!scope?.actions?.includes(action)) {
    throw new RequestError('FORBIDDEN', `Missing permission: globals:${action}`, 403)
  }
  if (name && scope.allowedNames && !scope.allowedNames.includes(name)) {
    throw new RequestError('FORBIDDEN', `Key is not permitted to access global "${name}"`, 403)
  }
}
