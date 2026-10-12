/**
 * File Name: capability-state.tsx
 * Purpose: What a page shows when a capability is not `on` (closure plan
 *          Phase 8B). A capability being off is not a permission problem, and
 *          saying "No permission" when an extension is simply disabled tells
 *          the user something false about their account.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Reads the Phase 8A descriptor's own reason - the
 *          server already wrote one operator-readable sentence per state, so
 *          this renders it rather than inventing a second vocabulary. The
 *          management path stays reachable: an `off` capability's whole point
 *          is that someone can turn it back on.
 */
import { useNavigate, useParams } from 'react-router-dom'
import { IconPuzzle, IconWarning } from '@tangen/icons'
import { Button } from '@/kit'
import type { CapabilityDescriptor, CapabilityStatus } from '@/lib/use-capabilities'

export interface CapabilityStateProps {
  /** What the store said. */
  status: CapabilityStatus
  /** The descriptor, when there is one - it carries the reason. */
  descriptor?: CapabilityDescriptor
  /** A human name for the surface, used when there is no descriptor at all. */
  label?: string
  /** The bootstrap read itself failed: that is an error, not an empty platform. */
  failed?: boolean
}

/**
 * The page body for a capability that is off, unavailable, unknown, or whose
 * descriptor could not be read. Returns null while loading, so a page can
 * render its own skeleton instead of flashing this.
 */
export function CapabilityState({ status, descriptor, label, failed }: CapabilityStateProps) {
  const params = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const base = `/${params.workspaceId}`
  const name = descriptor?.label ?? label ?? 'This feature'

  if (status === 'loading') return null

  if (failed) {
    return (
      <Shell
        icon={<IconWarning className="size-5 text-fg-subtle" />}
        title="We could not read this workspace's capabilities"
        body="The Admin could not load what this environment can do, so it is not showing you a guess. Try again in a moment."
        action={<Button variant="secondary" size="sm" onClick={() => window.location.reload()}>Reload</Button>}
      />
    )
  }

  if (status === 'unknown') {
    return (
      <Shell
        icon={<IconPuzzle className="size-5 text-fg-subtle" />}
        title={`${name} is not part of this server`}
        body="This build does not include it, so there is nothing to enable here."
        action={<Button variant="secondary" size="sm" onClick={() => navigate(`${base}/dashboard`)}>Back to dashboard</Button>}
      />
    )
  }

  const off = status === 'off'
  return (
    <Shell
      icon={off ? <IconPuzzle className="size-5 text-fg-subtle" /> : <IconWarning className="size-5 text-fg-subtle" />}
      title={off ? `${name} is switched off here` : `${name} cannot run here`}
      // The server already wrote the sentence; this does not paraphrase it.
      body={descriptor?.reason?.message ?? (off
        ? 'It is available on this platform and not enabled for this environment.'
        : 'Something it needs is missing in this environment.')}
      action={
        <div className="flex gap-2 justify-center">
          {/* Management stays reachable: an off capability is one someone can
              turn back on, and hiding the way there is the failure mode. */}
          {descriptor?.settings?.href && (
            <Button variant="primary" size="sm" onClick={() => navigate(`${base}/${descriptor.settings!.href}`)}>
              {off ? 'Manage' : 'View details'}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => navigate(`${base}/dashboard`)}>Back to dashboard</Button>
        </div>
      }
    />
  )
}

function Shell({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center p-12">
      <div className="text-center max-w-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-surface-hover">{icon}</div>
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        <p className="mt-1 text-sm text-fg-muted">{body}</p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  )
}
