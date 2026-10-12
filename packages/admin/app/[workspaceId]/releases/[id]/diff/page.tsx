/**
 * File Name: page.tsx
 * Purpose: Release detail (closure plan Phase 5B, Unit 12): the review
 *          diff, the approval (who, when, checksum, frozen payload), the
 *          preflight report on demand, the last failure, the history of
 *          the release, and the action its status allows. There is no
 *          force apply: a target that changed since approval is a
 *          conflict the preflight names; re-approve to review it.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { Callout } from '@tangen/ui'
import { useParams, useNavigate } from 'react-router-dom'
import { IconArrowLeft, IconArrowRight, IconCheck } from '@tangen/icons'
import { adminFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { StatusBadge, describeAttempt, type Release } from '@/lib/releases'

interface FieldDiff { field: string; sourceValue: unknown; targetValue: unknown; changed: boolean }
interface ObjectDiff { objectId: string; typeName: string; fields: FieldDiff[] }
interface HistoryEntry { id: string; action: string; fromStatus: string | null; toStatus: string; actor: string | null; attempt: number; errorSummary: string | null; reason: string | null; startedAt: string; sourceRole: string | null; targetRole: string | null }
interface Detail {
  release: Release & { approvedChecksum?: string | null }
  items: Array<{ id: string; objectId: string; typeName: string; position?: number | null; applyOutcome?: string | null; applyError?: string | null }>
  approval: { approvedAt: string | null; approvedBy: string | null; checksum: string; frozen: boolean } | null
  history: HistoryEntry[]
}
interface PreflightCheck { code: string; ok: boolean; detail: string }

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '-'
  if (typeof v === 'object') return JSON.stringify(v, null, 2)
  return String(v)
}

function FieldRow({ entry }: { entry: FieldDiff }) {
  if (!entry.changed) return null
  return (
    <tr className="bg-surface">
      <td className="px-3 py-2 text-xs font-mono text-fg-muted whitespace-nowrap w-40 align-top">{entry.field}</td>
      <td className="px-3 py-2 text-xs text-fg font-mono align-top max-w-[280px] break-words whitespace-pre-wrap">{fmt(entry.sourceValue)}</td>
      <td className="px-3 py-2 text-center align-top"><IconArrowRight className="size-3 text-fg-subtle mx-auto mt-0.5" /></td>
      <td className="px-3 py-2 text-xs text-fg font-mono align-top max-w-[280px] break-words whitespace-pre-wrap">{fmt(entry.targetValue)}</td>
    </tr>
  )
}

export default function ReleaseDiffPage() {
  const params = useParams<{ workspaceId: string; id: string }>()
  const { workspaceId, id } = params
  const navigate = useNavigate()

  const [detail, setDetail] = useState<Detail | null>(null)
  const [diffs, setDiffs] = useState<ObjectDiff[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [preflight, setPreflight] = useState<PreflightCheck[] | null>(null)

  async function load() {
    try {
      const [d, diff] = await Promise.all([
        adminFetch<{ data: Detail }>(`/releases/${id}`),
        adminFetch<{ data: { diffs: ObjectDiff[] } }>(`/releases/${id}/diff`).catch(() => ({ data: { diffs: [] as ObjectDiff[] } })),
      ])
      setDetail(d.data)
      setDiffs(diff.data.diffs)
    } catch {
      toast.error('Failed to load the release')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [id])

  async function act(action: 'submit' | 'withdraw' | 'approve' | 'unapprove' | 'apply' | 'retry' | 'preflight') {
    if (!detail || busy) return
    setBusy(true)
    try {
      const res = await adminFetch<any>(`/releases/${id}/${action}`, { method: 'POST' })
      if (action === 'preflight') {
        setPreflight(res.data.checks)
      } else if (action === 'apply' || action === 'retry') {
        const d = describeAttempt(res)
        if (d.ok) toast.success(d.title); else toast.error(d.title, d.detail)
        if (res.stage === 'preflight' && res.preflight) setPreflight(res.preflight.checks)
      } else {
        toast.success(`Release ${action === 'submit' ? 'submitted for review' : action}d`)
      }
      await load()
    } catch (e: any) {
      toast.error(`${action} failed`, e.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="p-8 text-sm text-fg-subtle">Loading release…</div>
  if (!detail) return <div className="p-8 text-sm text-danger-fg">Release not found.</div>
  const { release, approval, history, items } = detail
  const changedCount = diffs.reduce((n, d) => n + d.fields.filter((f) => f.changed).length, 0)

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(`/${workspaceId}/releases`)} className="text-fg-subtle hover:text-fg transition"><IconArrowLeft className="size-4" /></button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-fg">{release.name}</h1>
            <StatusBadge status={release.status} />
          </div>
          <div className="flex items-center gap-1 text-xs text-fg-subtle mt-0.5">
            <span>Draft</span>
            <IconArrowRight className="size-3" />
            <span>Published</span>
            <span className="ml-2 text-fg-subtle">·</span>
            <span className="ml-2">{changedCount} field change{changedCount !== 1 ? 's' : ''} across {items.length} object{items.length !== 1 ? 's' : ''}</span>
            {typeof release.attempts === 'number' && release.attempts > 0 && <span className="ml-2">· {release.attempts} attempt{release.attempts !== 1 ? 's' : ''}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {release.status === 'draft' && <Button size="sm" isLoading={busy} onClick={() => act('submit')}>Submit for review</Button>}
          {release.status === 'in_review' && <><Button variant="secondary" size="sm" isLoading={busy} onClick={() => act('withdraw')}>Withdraw</Button><Button size="sm" isLoading={busy} onClick={() => act('approve')}>Approve</Button></>}
          {(release.status === 'approved' || release.status === 'failed') && <Button variant="secondary" size="sm" isLoading={busy} onClick={() => act('preflight')}>Preflight</Button>}
          {release.status === 'approved' && <><Button variant="secondary" size="sm" isLoading={busy} onClick={() => act('unapprove')}>Unapprove</Button><Button size="sm" isLoading={busy} onClick={() => act('apply')}>Apply release</Button></>}
          {release.status === 'failed' && <Button size="sm" isLoading={busy} onClick={() => act('retry')}>Retry</Button>}
        </div>
      </div>

      {approval && (
        <div className="mb-4 rounded-lg border border-accent/30 bg-accent-muted px-5 py-3 text-xs text-accent-fg">
          Approved {approval.approvedAt ? new Date(approval.approvedAt).toLocaleString() : ''}{approval.approvedBy ? ` by ${approval.approvedBy}` : ''}.
          {' '}Payload {approval.frozen ? 'frozen' : 'not frozen'}, checksum <span className="font-mono">{approval.checksum.slice(0, 12)}</span>.
          {release.scheduledAt && <> Scheduled for {new Date(release.scheduledAt).toLocaleString()}.</>}
          {' '}What was reviewed is what applies; the source changing later changes nothing here.
        </div>
      )}

      {release.status === 'failed' && release.failure && (
        <Callout variant="danger" className="mb-4">
          <div className="text-xs">
            <p className="font-medium">The last attempt failed at {release.failure.item?.typeName} {release.failure.item?.objectId}</p>
            <p className="mt-0.5">{release.failure.error}</p>
            <p className="mt-0.5">Items applied before it stay applied; a retry continues after them.</p>
          </div>
        </Callout>
      )}

      {preflight && (
        <Callout variant={preflight.every((c) => c.ok) ? 'success' : 'warning'} title={`Preflight ${preflight.every((c) => c.ok) ? 'passed' : 'refused'}`} className="mb-4">
          <ul className="space-y-0.5">
            {preflight.map((c) => (
              <li key={c.code} className={`text-xs font-mono ${c.ok ? 'text-success-fg' : 'text-warning-fg'}`}>{c.ok ? '✓' : '✗'} {c.code}: {c.detail}</li>
            ))}
          </ul>
        </Callout>
      )}

      {diffs.length === 0 ? (
        <p className="text-sm text-fg-subtle italic">No objects in this release.</p>
      ) : (
        <div className="space-y-6">
          {diffs.map((obj) => {
            const changedFields = obj.fields.filter((f) => f.changed)
            const item = items.find((i) => i.objectId === obj.objectId && i.typeName === obj.typeName)
            return (
              <section key={`${obj.typeName}/${obj.objectId}`} className="rounded-lg border border-border overflow-hidden">
                <div className="px-4 py-2.5 bg-surface-sunken border-b border-border flex items-center justify-between">
                  <div>
                    <span className="text-xs font-medium text-fg font-mono">{obj.typeName}</span>
                    <span className="text-xs text-fg-subtle ml-2 font-mono">{obj.objectId}</span>
                    {item?.applyOutcome && <span className={`text-xs ml-2 ${item.applyOutcome === 'failed' ? 'text-danger-fg' : 'text-success-fg'}`}>{item.applyOutcome}{item.applyError ? `: ${item.applyError}` : ''}</span>}
                  </div>
                  <span className="text-xs text-fg-subtle">{changedFields.length} change{changedFields.length !== 1 ? 's' : ''}</span>
                </div>
                {changedFields.length > 0 && (
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-3 py-1.5 text-[10px] font-semibold text-fg-subtle uppercase tracking-wide w-40">Field</th>
                        <th className="px-3 py-1.5 text-[10px] font-semibold text-fg-subtle uppercase tracking-wide">Draft</th>
                        <th className="w-6" />
                        <th className="px-3 py-1.5 text-[10px] font-semibold text-fg uppercase tracking-wide">Published (after apply)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {changedFields.map((f) => <FieldRow key={f.field} entry={f} />)}
                    </tbody>
                  </table>
                )}
              </section>
            )
          })}
          {release.status === 'applied' && (
            <div className="flex items-center gap-2 text-sm text-success-fg"><IconCheck className="size-4" />This release has been applied.</div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-fg mb-2">History</h2>
          <ol className="divide-y divide-border border border-border rounded-lg overflow-hidden">
            {history.map((h) => (
              <li key={h.id} className="px-4 py-2 text-xs flex items-center gap-3 bg-surface">
                <span className="text-fg-subtle w-36 shrink-0">{new Date(h.startedAt).toLocaleString()}</span>
                <span className="font-mono text-fg">{h.action}</span>
                <span className="text-fg-muted">{h.fromStatus ?? '-'} → {h.toStatus}{h.attempt > 0 ? ` (attempt ${h.attempt})` : ''}</span>
                {h.actor && <span className="text-fg-subtle">by {h.actor}</span>}
                {h.reason && <span className="text-fg-subtle italic">{h.reason}</span>}
                {h.errorSummary && <span className="text-danger-fg truncate">{h.errorSummary}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
