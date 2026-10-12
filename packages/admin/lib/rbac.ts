/**
 * File Name: rbac.ts
 * Purpose: The stable RBAC import surface for site & extension developers
 *          building admin pages. Everything an extension page needs to make
 *          role-aware UI decisions, in one place:
 *
 *            import { useCan, IfCan, RequirePermission } from '@/lib/rbac'
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: decisions come from the server-resolved bundle
 *          (GET /me/permissions); the UI fails open while loading — the
 *          server always enforces. Server-side equivalents for custom
 *          routes: auth:'member' + ctx.can()/requireCan() (docs/rbac.md).
 */
export {
  useCan,
  useCanStore,
  canWithBundle,
  hasCapabilityWithBundle,
  canUseExtensionWithBundle,
  allowedLocalesWithBundle,
  canWriteLocaleWithBundle,
  type MePermissions,
} from './use-can'

export {
  IfCan,
  RequirePermission,
  NoPermission,
  checkAdminAccess,
} from '@/components/require-permission'

export { checkBundle } from '@tangen/types'
export type { Capability, MemberPermissions, AdminAccessRule } from '@tangen/types'
