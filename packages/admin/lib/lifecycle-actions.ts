/**
 * File Name: lifecycle-actions.ts
 * Purpose: The Admin's projection of the server's lifecycle action policy
 *          (GET /objects/:type/actions, GET /objects/:type/:id/actions): one
 *          hook that loads it, and pure helpers that read it. The editor's
 *          publish controls, the list's bulk menu and Studio decide nothing
 *          about availability themselves; they show what the server says.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A failed load leaves the policy null and the callers
 *          fall back to what they showed before (the bundle's grants): a
 *          broken request must never take a button away. The server still
 *          refuses honestly if a stale projection offers one.
 */
import { useCallback, useEffect, useState } from 'react'
import type { LifecycleActions, LifecycleAction, LifecycleActionId } from '@tangen/types'
import { adminFetch } from '@/lib/api'

/** True when the value is the policy shape; anything else reads as "no policy" (a fixture, a proxy error page, an older server). */
function isPolicy(actions: unknown): actions is LifecycleActions {
  return !!actions && typeof actions === 'object' && Array.isArray((actions as { actions?: unknown }).actions)
}

export function actionOf(actions: LifecycleActions | null | undefined, id: LifecycleActionId): LifecycleAction | null {
  if (!isPolicy(actions)) return null
  return actions.actions.find((a) => a.id === id) ?? null
}

/**
 * Whether an action is available. For a type-level answer (no object yet)
 * `forType` ignores the NEW blocker, so a list can ask "may this actor
 * publish objects of this type at all" before any row is chosen.
 */
export function isAvailable(actions: LifecycleActions | null | undefined, id: LifecycleActionId, opts: { forType?: boolean } = {}): boolean {
  const a = actionOf(actions, id)
  if (!a) return false
  if (a.available) return true
  return opts.forType === true && a.blockers.every((b) => b.code === 'NEW')
}

/** The reasons an action is not available, for a tooltip or a notice. */
export function reasonsFor(actions: LifecycleActions | null | undefined, id: LifecycleActionId): string[] {
  return actionOf(actions, id)?.blockers.map((b) => b.reason) ?? []
}

export interface PublishPolicyView {
  blocked: boolean
  reason?: string
  actionLabel?: string
  extensionId?: string
  /** The extension's replacement action, relative to its admin mount (the shape Studio runs). */
  action?: { label: string; path: string; method?: 'POST' | 'PATCH'; body?: Record<string, unknown> }
}

/** The publish-policy shape the editor and Studio already render, projected from the action policy. */
export function publishPolicyOfActions(actions: LifecycleActions | null | undefined): PublishPolicyView | null {
  if (!isPolicy(actions)) return null
  const publish = actionOf(actions, 'publish')
  const policy = publish?.blockers.find((b) => b.code === 'POLICY')
  if (!policy) return { blocked: false }
  const replacement = actions.actions.find((a) => a.replaces === 'publish' && a.extensionId === policy.extensionId)
  const mount = `/admin/ext/${policy.extensionId}/`
  return {
    blocked: true,
    ...(policy.reason ? { reason: policy.reason } : {}),
    actionLabel: policy.actionLabel ?? 'Save as draft',
    ...(policy.extensionId ? { extensionId: policy.extensionId } : {}),
    ...(replacement ? { action: { label: replacement.label, path: replacement.path.startsWith(mount) ? replacement.path.slice(mount.length) : replacement.path, method: replacement.method === 'PATCH' ? 'PATCH' : 'POST', ...(replacement.body ? { body: replacement.body } : {}) } } : {}),
  }
}

/** Loads the policy for a type (objectId null: a new object) or one object; re-asks when `deps` change. */
export function useLifecycleActions(typeName: string | undefined, objectId: string | null, deps: unknown[] = []): { actions: LifecycleActions | null; reload: () => Promise<void> } {
  const [actions, setActions] = useState<LifecycleActions | null>(null)
  const load = useCallback(async () => {
    if (!typeName) { setActions(null); return }
    try {
      const r = await adminFetch<{ data: LifecycleActions }>(`/objects/${typeName}/actions`, undefined, objectId ? { objectId } : undefined)
      setActions(r.data ?? null)
    } catch {
      setActions(null)   // a broken request never takes a button away
    }
  }, [typeName, objectId])
  useEffect(() => {
    let alive = true
    if (!typeName) { setActions(null); return }
    adminFetch<{ data: LifecycleActions }>(`/objects/${typeName}/actions`, undefined, objectId ? { objectId } : undefined)
      .then((r) => { if (alive) setActions(r.data ?? null) })
      .catch(() => { if (alive) setActions(null) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeName, objectId, ...deps])
  return { actions, reload: load }
}
