/**
 * File Name: require-permission.tsx
 * Purpose: Declarative RBAC guards for admin surfaces — a No-permission
 *          state, a route/page wrapper, and an inline <IfCan> for
 *          conditional rendering. Available to site-developer extension
 *          pages (import from '@/components/require-permission').
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: decisions come from the server-resolved bundle via
 *          useCan (lib/use-can). Rules: owner/admin always pass; other
 *          members pass when their effective role is listed in
 *          access.roles or they hold access.capability.
 */
import { useParams, useNavigate } from 'react-router-dom'
import { IconLock } from '@tangen/icons'
import type { AdminAccessRule, Capability } from '@tangen/types'
import { Button } from '@/components/ui/button'
import { useCan, type MePermissions } from '@/lib/use-can'

/** Pure rule check — true when the member may use the surface. */
export function checkAdminAccess(me: MePermissions | null, access: AdminAccessRule | undefined): boolean {
  if (!access || (!access.roles?.length && !access.capability)) return true
  if (!me) return true                       // unknown → fail open; server enforces data
  if (me.capabilities === 'all') return true // owner/admin
  if (access.roles?.includes(me.effectiveRole)) return true
  if (access.capability && me.capabilities.includes(access.capability as Capability)) return true
  return false
}

/** Full-page "you don't have permission" state. */
export function NoPermission({ note }: { note?: string }) {
  const params = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  return (
    <div className="flex-1 flex items-center justify-center p-12">
      <div className="text-center max-w-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-surface-hover">
          <IconLock className="size-5 text-fg-subtle" />
        </div>
        <h2 className="text-base font-semibold text-fg">No permission</h2>
        <p className="mt-1 text-sm text-fg-muted">
          {note ?? 'Your role does not include access to this page. Ask a workspace owner if you need it.'}
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => navigate(`/${params.workspaceId}/dashboard`)}
        >
          Back to Home
        </Button>
      </div>
    </div>
  )
}

/**
 * Page wrapper — renders children only when the access rule passes,
 * otherwise the No-permission state. Use around routes/pages.
 */
export function RequirePermission({ access, children }: {
  access?: AdminAccessRule
  children: React.ReactNode
}) {
  const params = useParams()
  const { me, ready } = useCan()
  if (ready && !checkAdminAccess(me, access)) return <NoPermission />
  return <>{children}</>
}

/**
 * Inline conditional — render children only for allowed roles/capability;
 * `fallback` renders otherwise (e.g. a read-only card for viewers).
 *
 * ```tsx
 * <IfCan roles={['owner', 'admin', 'editor']} fallback={<LatestPincodes />}>
 *   <AddPincodeForm />
 * </IfCan>
 * ```
 */
export function IfCan({ roles, capability, fallback = null, children }: {
  roles?: string[]
  capability?: string
  fallback?: React.ReactNode
  children: React.ReactNode
}) {
  const params = useParams()
  const { me, ready } = useCan()
  if (!ready) return null
  return checkAdminAccess(me, { roles, capability }) ? <>{children}</> : <>{fallback}</>
}
