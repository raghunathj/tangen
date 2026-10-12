/**
 * File Name: page.tsx
 * Purpose: Releases list (closure plan Phase 5B, Unit 12, redefined by the
 *          environment removal programme): the six v1 statuses (draft, in
 *          review, approved, applying, applied, failed) with the action each
 *          allows, a create dialog that gathers a named set of objects, and
 *          the outcome of an apply attempt shown as the API reports it
 *          (preflight refused, applied, failed). A release publishes its
 *          approved drafts IN PLACE: approval freezes them, apply publishes
 *          them here. Nothing moves between deployments - that is Porter.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { IconPlus, IconGitBranch } from '@tangen/icons'
import { StatusBadge, describeAttempt, type Release } from '@/lib/releases'
import { adminFetch, ApiError } from '@/lib/api'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription, DialogClose,
} from '@/components/ui/dialog'

function fmt(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function CreateReleaseDialog({ onCreated }: { onCreated: (r: Release) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [objectIds, setObjectIds] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() { setName(''); setObjectIds(''); setError(null) }

  async function handleCreate() {
    const ids = objectIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
    if (!name.trim()) { setError('Name is required'); return }
    if (ids.length === 0) { setError('Enter at least one object ID'); return }
    setSaving(true); setError(null)
    try {
      const res = await adminFetch<Release>('/releases', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), objectIds: ids }),
      })
      setOpen(false); reset()
      onCreated({ ...res, createdAt: res.createdAt ?? new Date().toISOString(), appliedAt: null })
      toast.success(`Release "${name.trim()}" created`)
    } catch (e: any) {
      setError(e.message ?? 'Failed to create release')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button size="sm" icon={<IconPlus className="size-[15px]" />} onClick={() => { reset(); setOpen(true) }}>
        New release
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create release</DialogTitle>
            <DialogDescription className="mt-1">
              A reviewable set of drafts that publish together. Approval freezes them; apply publishes them here.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-fg mb-1">Release name <span className="text-danger-fg">*</span></label>
              <input type="text" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="v1.2 - Homepage update" autoFocus
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25" />
            </div>
            <div>
              <label className="block text-xs font-medium text-fg mb-1">Object IDs <span className="text-danger-fg">*</span></label>
              <textarea rows={3} value={objectIds} onChange={(e) => setObjectIds(e.currentTarget.value)} placeholder="obj_abc123, obj_def456"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-fg font-mono focus:outline-none focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25 resize-none" />
              <p className="mt-1 text-xs text-fg-subtle">Comma or space-separated object IDs to include in this release. An object belongs to at most one open release.</p>
            </div>
            {error && <p className="text-xs text-danger-fg">{error}</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="secondary" size="sm">Cancel</Button></DialogClose>
            <Button variant="primary" size="sm" isLoading={saving} onClick={handleCreate}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default function ReleasesPage() {
  const params = useParams<{ workspaceId: string }>()
  const { workspaceId} = params
  const navigate = useNavigate()

  const [releases, setReleases] = useState<Release[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const r = await adminFetch<{ data: Release[] }>('/releases')
      setReleases(r.data)
    } catch {
      toast.error('Failed to load releases')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  /** One lifecycle action; the list row is refreshed from the API afterwards. */
  async function act(release: Release, action: 'submit' | 'withdraw' | 'approve' | 'unapprove' | 'apply' | 'retry' | 'schedule' | 'unschedule') {
    if (busy) return
    let body: Record<string, unknown> | undefined
    if (action === 'schedule') {
      const at = window.prompt('Apply at (ISO date-time, e.g. 2026-09-01T10:00:00Z)')
      if (!at) return
      if (Number.isNaN(new Date(at).getTime())) { toast.error('That is not a date-time'); return }
      body = { scheduledAt: new Date(at).toISOString() }
    }
    setBusy(release.id)
    try {
      const res = await adminFetch<any>(`/releases/${release.id}/${action}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined })
      if (action === 'apply' || action === 'retry') {
        const d = describeAttempt(res)
        if (d.ok) toast.success(`Release "${release.name}" applied`)
        else toast.error(d.title, d.detail)
      } else {
        toast.success(`Release "${release.name}": ${action === 'submit' ? 'submitted for review' : action === 'schedule' ? `scheduled for ${new Date(body!.scheduledAt as string).toLocaleString()}` : action}`)
      }
      const fresh = await adminFetch<{ data: { release: Release } }>(`/releases/${release.id}`)
      setReleases((prev) => prev.map((r) => (r.id === release.id ? { ...r, ...fresh.data.release } : r)))
    } catch (e: any) {
      const detail = e instanceof ApiError && e.details && typeof e.details === 'object' && 'preflight' in (e.details as object)
        ? ((e.details as { preflight: { checks: Array<{ code: string; ok: boolean; detail: string }> } }).preflight.checks.filter((c) => !c.ok).map((c) => `${c.code}: ${c.detail}`).join('; '))
        : undefined
      toast.error(e.message ?? `${action} failed`, detail)
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <div className="p-8 text-fg-muted text-sm">Loading releases…</div>

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <IconGitBranch className="w-5 h-5 text-fg-muted" />
          <h1 className="text-xl font-semibold text-fg">Releases</h1>
        </div>
        <CreateReleaseDialog onCreated={(r) => setReleases((prev) => [r, ...prev])} />
      </div>

      {releases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2 rounded-xl border border-dashed border-border">
          <IconGitBranch className="size-8 text-fg-subtle" />
          <p className="text-sm text-fg-subtle">No releases yet.</p>
          <p className="text-xs text-fg-subtle">Create a release to review and publish a set of drafts together.</p>
        </div>
      ) : (
        <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
          {releases.map((release) => {
            const isBusy = busy === release.id
            return (
              <div key={release.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-surface hover:bg-surface-sunken">
                {/* The actions wrap under the release rather than off the
                    window when there is no room for both on one line. */}
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-fg">{release.name}</span>
                    <StatusBadge status={release.status} />
                    {release.scheduledAt && release.status === 'approved' && (
                      <span className="text-xs text-accent-fg">scheduled {new Date(release.scheduledAt).toLocaleString()}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-fg-muted">
                    {typeof release.itemCount === 'number' && <span>{release.itemCount} {release.itemCount === 1 ? 'object' : 'objects'}</span>}
                    <span className="ml-2">Created {fmt(release.createdAt)}</span>
                    {release.appliedAt && <span>· Applied {fmt(release.appliedAt)}</span>}
                    {release.status === 'failed' && release.failure?.error && <span className="text-danger-fg">· {release.failure.item?.typeName} {release.failure.item?.objectId}: {release.failure.error}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => navigate(`/${workspaceId}/releases/${release.id}/diff`)}>Details</Button>
                  {release.status === 'draft' && <Button size="sm" isLoading={isBusy} onClick={() => act(release, 'submit')}>Submit for review</Button>}
                  {release.status === 'in_review' && (
                    <>
                      <Button variant="secondary" size="sm" isLoading={isBusy} onClick={() => act(release, 'withdraw')}>Withdraw</Button>
                      <Button size="sm" isLoading={isBusy} onClick={() => act(release, 'approve')}>Approve</Button>
                    </>
                  )}
                  {release.status === 'approved' && (
                    <>
                      <Button variant="secondary" size="sm" isLoading={isBusy} onClick={() => act(release, 'unapprove')}>Unapprove</Button>
                      {release.scheduledAt
                        ? <Button variant="secondary" size="sm" isLoading={isBusy} onClick={() => act(release, 'unschedule')}>Unschedule</Button>
                        : <Button variant="secondary" size="sm" isLoading={isBusy} onClick={() => act(release, 'schedule')}>Schedule</Button>}
                      <Button size="sm" isLoading={isBusy} onClick={() => act(release, 'apply')}>Apply</Button>
                    </>
                  )}
                  {release.status === 'failed' && <Button size="sm" isLoading={isBusy} onClick={() => act(release, 'retry')}>Retry</Button>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
