/**
 * File Name: permissions.ts
 * Purpose: API-key grant checks for MCP tools — pure predicates over
 *          ApiKeyPermissions mirroring how the public routes gate access
 *          (objects actions + allowedTypes + per-type overrides; media
 *          actions; the new tables section).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types. MCP layers these ON TOP of the
 *          mcp:false exposure filters — both must pass.
 */
import type { ApiKeyPermissions } from '@tangen/types'

/** Can this key perform `action` on objects of `typeName`? */
export function keyCanObjects(
  permissions: ApiKeyPermissions | undefined,
  action: 'read' | 'write',
  typeName: string,
): boolean {
  const objects = permissions?.objects
  if (!objects) return false
  // Per-type override replaces the global action list for that type
  const override = objects.types?.[typeName]
  if (override) return (override as string[]).includes(action)
  if (!objects.actions?.includes(action as never)) return false
  if (objects.allowedTypes && !objects.allowedTypes.includes(typeName)) return false
  return true
}

/** Can this key read media? */
export function keyCanMedia(permissions: ApiKeyPermissions | undefined): boolean {
  return permissions?.media?.actions?.includes('read') ?? false
}

/**
 * Knowledge audiences this key may retrieve. FAIL CLOSED: keys see only
 * 'public' unless the grant explicitly lists 'internal'.
 */
export function keySearchAudiences(permissions: ApiKeyPermissions | undefined): string[] {
  const audiences = permissions?.search?.audiences
  return audiences && audiences.length > 0 ? audiences : ['public']
}

/** Can this key read a custom table? */
export function keyCanTable(
  permissions: ApiKeyPermissions | undefined,
  tableName: string,
): boolean {
  const tables = permissions?.tables
  if (!tables?.actions?.includes('read')) return false
  if (tables.allowedTables && !tables.allowedTables.includes(tableName)) return false
  return true
}
