/**
 * File Name: releases.tsx
 * Purpose: What the Releases pages share (closure plan Phase 5B, Unit 12):
 *          the six v1 statuses and their badge, the forward path by role,
 *          and the one-line description of an apply
 *          attempt as the API reports it.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { IconCheck, IconClock, IconAlert } from '@tangen/icons'
import { Badge } from '@/components/ui/badge'

export type ReleaseStatus = 'draft' | 'in_review' | 'approved' | 'applying' | 'applied' | 'failed'

export interface Release {
  id: string
  name: string
  itemCount?: number
  status: ReleaseStatus
  createdAt: string
  appliedAt: string | null
  approvedAt?: string | null
  approvedBy?: string | null
  scheduledAt?: string | null
  attempts?: number
  failure?: { item?: { typeName: string; objectId: string }; error?: string } | null
}

export const STATUS_LABEL: Record<ReleaseStatus, string> = {
  draft: 'Draft', in_review: 'In review', approved: 'Approved', applying: 'Applying', applied: 'Applied', failed: 'Failed',
}

export function StatusBadge({ status }: { status: ReleaseStatus | string }) {
  const s = status as ReleaseStatus
  const cls: Record<ReleaseStatus, string> = {
    draft: 'bg-gray-100 text-gray-700', in_review: 'bg-blue-100 text-blue-700', approved: 'bg-indigo-100 text-indigo-700',
    applying: 'bg-amber-100 text-amber-700', applied: 'bg-emerald-100 text-emerald-700', failed: 'bg-red-100 text-red-700',
  }
  const Icon = s === 'applied' ? IconCheck : s === 'failed' ? IconAlert : IconClock
  return (
    <Badge className={`${cls[s] ?? 'bg-gray-100 text-gray-700'} inline-flex items-center gap-1`}>
      <Icon className="w-3 h-3" />
      {STATUS_LABEL[s] ?? status}
    </Badge>
  )
}

/** A short line for an apply attempt's outcome, from the API's response. */
export function describeAttempt(res: { applied: boolean; stage: string; preflight?: { checks: Array<{ code: string; ok: boolean; detail: string }> } | null; failure?: { item?: { typeName: string; objectId: string }; error?: string } | null }): { ok: boolean; title: string; detail?: string } {
  if (res.applied) return { ok: true, title: 'Release applied' }
  if (res.stage === 'preflight') {
    const failing = res.preflight?.checks.filter((c) => !c.ok) ?? []
    return { ok: false, title: 'Preflight refused the application', detail: failing.map((c) => `${c.code}: ${c.detail}`).join('; ') }
  }
  return { ok: false, title: 'Application failed', detail: res.failure ? `${res.failure.item?.typeName ?? ''} ${res.failure.item?.objectId ?? ''}: ${res.failure.error ?? ''}`.trim() : undefined }
}
