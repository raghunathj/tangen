/**
 * Porter - Home. The hub: pick what you want to move (cards, gated by which
 * extensions are enabled), then a glance at recent runs. Matrixify-style:
 * clear operations first, history right under them.
 */

import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { AdminPage } from '@/kit'
import { adminFetch } from '@/kit'
import { DynamicIcon } from '@/kit'
import type { PorterRun } from '@/lib/porter-runs'
import { isRunActive, runCountsLine, progressPercent } from '@/lib/porter-runs'

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'Queued',    cls: 'bg-surface-sunken text-fg-muted border-border' },
  running:   { label: 'Running',   cls: 'bg-info-muted text-info-fg border-info/40' },
  completed: { label: 'Completed', cls: 'bg-success-muted text-success-fg border-success/40' },
  failed:    { label: 'Failed',    cls: 'bg-danger-muted text-danger-fg border-danger/40' },
  cancelled: { label: 'Cancelled', cls: 'bg-warning-muted text-warning-fg border-warning/40' },
}

const KIND_LABEL: Record<string, string> = {
  export: 'Export', import: 'Import',
  remote_send: 'Send to instance', remote_receive: 'Receive from instance',
}

function fmtWhen(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function ActionCard({ to, icon, title, description, soon }: {
  to?: string
  icon: string
  title: string
  description: string
  soon?: boolean
}) {
  const body = (
    <div className={`group rounded-xl border border-border bg-surface px-5 py-4 flex items-start gap-4 transition-colors ${soon ? 'opacity-60' : 'hover:border-accent hover:shadow-sm cursor-pointer'}`}>
      <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-fg-muted group-hover:text-accent-fg">
        <DynamicIcon name={icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="block text-sm font-semibold text-fg">{title}</span>
          {soon && (
            <span className="rounded-full border border-border bg-surface-sunken px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
              Soon
            </span>
          )}
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-fg-muted">{description}</span>
      </span>
    </div>
  )
  if (soon || !to) return body
  return <Link to={to} className="block">{body}</Link>
}

export function PorterHomePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const base = `/${workspaceId}/extensions/porter`
  const [runs, setRuns] = useState<PorterRun[]>([])

  useEffect(() => {
    adminFetch<{ data: PorterRun[] }>('/sync/runs')
      .then((r) => setRuns((r.data ?? []).slice(0, 4)))
      .catch(() => {})
  }, [])

  return (
    <AdminPage
      title="Porter"
      description="Move data safely: out as portable bundles, into another deployment, and back in."
    >
      <div className="max-w-4xl space-y-10">
        <section>
          <h2 className="mb-3 text-sm font-medium text-fg">What do you want to move?</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <ActionCard
              to={base + '/export'}
              icon="RiDownloadCloud2Line"
              title="Export data"
              description="Package content, media and extension data into a portable .tangen-export.tar.gz."
            />
            <ActionCard
              to={base + '/import'}
              icon="RiUploadCloud2Line"
              title="Import data"
              description="Upload a bundle, validate it against this deployment, review, then apply in the background."
            />
            <ActionCard
              to={base + '/send'}
              icon="RiSendPlaneLine"
              title="Send to another instance"
              description="Stream an exported bundle to another Tangen admin using its owner's one-time receive code."
            />
            <ActionCard
              to={base + '/receive'}
              icon="RiInboxArrowDownLine"
              title="Receive from another instance"
              description="Generate a single-use gatekeeper code so another instance can send data into this deployment."
            />
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-fg">Recent runs</h2>
            <Link to={base + '/runs'} className="text-xs font-medium text-accent-fg hover:underline">
              View all runs
            </Link>
          </div>
          {runs.length === 0 ? (
            <p className="rounded-xl border border-border px-4 py-6 text-center text-sm text-fg-subtle">
              Nothing has moved yet. Start with an export above.
            </p>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {runs.map((run) => {
                const meta = STATUS_META[run.status] ?? STATUS_META.pending
                const countsLine = runCountsLine(run)
                return (
                  <Link key={run.id} to={base + '/runs'} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-sunken/50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {KIND_LABEL[run.kind] ?? run.kind}
                        {run.scope?.typeName ? ` · ${run.scope.typeName}` : ''}
                        {run.totalItems > 0 ? ` · ${run.totalItems} ${run.totalItems === 1 ? 'item' : 'items'}` : ''}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-fg-subtle">
                        {fmtWhen(run.createdAt)}
                        {countsLine && <> · {countsLine}</>}
                      </span>
                    </span>
                    {isRunActive(run) && (
                      <span className="w-24 shrink-0">
                        <span className="block h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                          <span className="block h-full rounded-full bg-accent transition-all" style={{ width: `${progressPercent(run)}%` }} />
                        </span>
                      </span>
                    )}
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium ${meta.cls}`}>
                      {meta.label}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </AdminPage>
  )
}
