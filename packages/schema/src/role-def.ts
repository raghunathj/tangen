/**
 * File Name: role-def.ts
 * Purpose: defineRole() — code-first member roles. Registered via
 *          TangenConfig.roles, they resolve in-memory on every request
 *          (no push, no drift between environments) and appear read-only
 *          in Settings → Members → Roles. Seeds may also OVERRIDE the
 *          built-in editor/viewer bundles; owner/admin are protected.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { RoleSeedDefinition } from '@tangen/types'

const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

/**
 * Validates and returns a code-defined role.
 *
 * ```ts
 * export const contentAdmin = defineRole({
 *   slug: 'site-admin',
 *   name: 'Site Admin',
 *   extends: 'editor',                         // start from a built-in
 *   permissions: { capabilities: [...] },      // override selectively
 * })
 * ```
 */
export function defineRole(def: RoleSeedDefinition): RoleSeedDefinition {
  if (!def.slug || !SLUG_PATTERN.test(def.slug)) {
    throw new Error(`defineRole: slug must be a lowercase slug (got "${def.slug}")`)
  }
  if (['owner', 'admin', 'superadmin'].includes(def.slug)) {
    throw new Error(`defineRole("${def.slug}"): owner/admin/superadmin cannot be redefined`)
  }
  if (!def.name?.trim()) {
    throw new Error(`defineRole("${def.slug}"): name is required`)
  }
  if ((def.permissions as { admin?: boolean } | undefined)?.admin) {
    throw new Error(`defineRole("${def.slug}"): roles cannot grant blanket admin`)
  }
  return def
}
