/**
 * File Name: extension-page-gate.tsx
 * Purpose: Route wrapper for extension-contributed admin pages — the page
 *          only renders when the extension is installed + active in the
 *          workspace, the member's extension allow-list permits it, and the
 *          page's access rule passes. Uninstalling an extension makes its
 *          pages (and nav) vanish without a rebuild.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Capability state comes from the Phase 8A descriptor
 *          (`ext:<id>` in the one Admin capability store), NOT from a private
 *          installed-boolean: this gate used to answer with `installed:
 *          true/false`, which could not tell disabled from
 *          enabled-but-not-loaded, and rendered a capability being off as
 *          "No permission" - telling the user something false about their
 *          account (closure plan Phase 8B, finding 8B-2). Permission is still
 *          asked separately, and still wins.
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { AdminAccessRule } from '@tangen/types'
import { adminFetch } from '@/lib/api'
import { useCan } from '@/lib/rbac'
import { RequirePermission, NoPermission } from '@/components/require-permission'
import { useCapabilities, extensionCapabilityId } from '@/lib/use-capabilities'
import { guardSurface } from '@/lib/capability-guard'
import { CapabilityState } from '@/components/capability-state'

const installedCache = new Map<string, Promise<Set<string>>>()

function fetchInstalledIds(workspaceId: string): Promise<Set<string>> {
  const key = `${workspaceId}`
  let hit = installedCache.get(key)
  if (!hit) {
    hit = adminFetch<{ data?: Array<{ id: string }> }>('/extensions')
      .then((res) => new Set((res.data ?? []).map((e) => e.id)))
      .catch(() => {
        installedCache.delete(key)   // transient failure - retry on next mount
        return new Set<string>()
      })
    installedCache.set(key, hit)
  }
  return hit
}

/**
 * Is an extension installed in the current workspace/env? null while
 * resolving. Lets core surfaces (e.g. list-view actions contributed by an
 * extension's feature area) follow install state.
 */
export function useExtensionInstalled(extensionId: string): boolean | null {
  const params = useParams<{ workspaceId: string }>()
  const [installed, setInstalled] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    setInstalled(null)
    fetchInstalledIds(params.workspaceId!)
      .then((ids) => { if (!cancelled) setInstalled(ids.has(extensionId)) })
    return () => { cancelled = true }
  }, [params.workspaceId, extensionId])
  return installed
}

/** Test/HMR hook — clears the per-session installed-extensions cache. */
export function resetExtensionInstalledCache(): void {
  installedCache.clear()
}

export function ExtensionPageGate({ extensionId, access, children }: {
  extensionId: string
  access?: AdminAccessRule
  children: React.ReactNode
}) {
  const params = useParams<{ workspaceId: string }>()
  const { canUseExtension, ready } = useCan()
  const caps = useCapabilities(params.workspaceId)
  const id = extensionCapabilityId(extensionId)
  const descriptor = caps.get(id)

  // Two questions, asked separately, in the order the guard settles them:
  // authorization first, then whether the capability can do anything here.
  const permitted = ready ? canUseExtension(extensionId) : undefined
  const outcome = guardSurface({
    status: caps.status(id),
    kind: 'feature',
    permitted,
    descriptor,
    failed: caps.failed,
  })

  if (outcome.show) return <RequirePermission access={access}>{children}</RequirePermission>
  if (outcome.because === 'denied') return <NoPermission />
  if (outcome.because === 'loading') return null           // brief; avoids a flash
  return <CapabilityState status={caps.status(id)} descriptor={descriptor} label={extensionId} failed={caps.failed} />
}
