/**
 * File Name: not-found.tsx
 * Purpose: What Admin says about an address it does not have (closure plan
 *          Phase 8B, finding 8B-1). The catch-all used to `Navigate` to the
 *          workspace picker, so a typo, a stale bookmark, a deleted object's
 *          URL and a removed extension's page all ended somewhere else with
 *          no explanation - and no way to tell that anything had been wrong.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Shows the path that failed, so a bookmark or a shared
 *          link can be recognised, and offers the two ways back that always
 *          exist: this workspace's dashboard when the URL carried one, and
 *          the workspace picker. It exposes nothing internal.
 */
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { IconSearch } from '@tangen/icons'
import { Button } from '@/kit'

/**
 * The 404 body. `reason` lets a caller say something more specific - a
 * deleted object, a removed extension page - while keeping one shell.
 */
export function NotFound({ title, reason }: { title?: string; reason?: string } = {}) {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams<{ workspaceId?: string }>()
  const hasScope = Boolean(params.workspaceId)

  return (
    <div className="flex-1 flex items-center justify-center p-12">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-surface-hover">
          <IconSearch className="size-5 text-fg-subtle" />
        </div>
        <h2 className="text-base font-semibold text-fg">{title ?? 'This page does not exist'}</h2>
        <p className="mt-1 text-sm text-fg-muted">
          {reason ?? 'The address may be mistyped, or it may point at something that has been renamed or removed.'}
        </p>
        <p className="mt-2 text-xs text-fg-subtle font-mono break-all">{location.pathname}</p>
        <div className="mt-4 flex gap-2 justify-center">
          {hasScope && (
            <Button variant="primary" size="sm" onClick={() => navigate(`/${params.workspaceId}/dashboard`)}>
              Back to dashboard
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => navigate('/workspaces')}>
            All workspaces
          </Button>
        </div>
      </div>
    </div>
  )
}
