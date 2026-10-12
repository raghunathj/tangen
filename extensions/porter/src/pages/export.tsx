/**
 * Porter - Export page. Scoped background exports of this deployment's workspace
 * into a sealed bundle; the finished archive downloads from the Runs page.
 */

import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { AdminPage } from '@/kit'
import { adminFetch } from '@/kit'

export function PorterExportPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [status, setStatus] = useState('')
  const [labels, setLabels] = useState('')
  const [since, setSince] = useState('')
  const [includeContent, setIncludeContent] = useState(true)
  const [includeMedia, setIncludeMedia] = useState(true)
  const [providers, setProviders] = useState<{ key: string; label: string; extensionId: string | null; count: number }[]>([])
  const [checkedProviders, setCheckedProviders] = useState<Set<string>>(new Set())
  const [starting, setStarting] = useState(false)
  const [started, setStarted] = useState(false)

  // syncProvider entries: extension data that can ride along (definitions
  // only). Providers whose extension is not installed are filtered out.
  useEffect(() => {
    Promise.all([
      adminFetch<{ data: { key: string; label: string; extensionId: string | null; count: number }[] }>(
        '/sync/providers').catch(() => ({ data: [] })),
      adminFetch<{ data?: { id: string }[] }>('/extensions').catch(() => ({ data: [] })),
    ]).then(([prov, exts]) => {
      const installed = new Set((exts.data ?? []).map((e) => e.id))
      setProviders((prov.data ?? []).filter((p) => !p.extensionId || installed.has(p.extensionId)))
    })
  }, [])

  async function startExport() {
    setStarting(true)
    setStarted(false)
    try {
      const scope: Record<string, unknown> = {}
      if (status) scope.status = status
      const labelList = labels.split(',').map((l) => l.trim()).filter(Boolean)
      if (labelList.length > 0) scope.labels = labelList
      if (since) scope.updatedSince = new Date(since).toISOString()
      if (!includeContent) scope.types = ['__none__']
      if (includeMedia) scope.mediaAll = true
      if (checkedProviders.size > 0) scope.providers = [...checkedProviders]
      await adminFetch('/sync/runs', {
        method: 'POST',
        body: JSON.stringify({ kind: 'export', scope }),
      })
      setStarted(true)
    } catch { /* user retries */ } finally {
      setStarting(false)
    }
  }

  const disabled = starting || (!includeContent && !includeMedia && checkedProviders.size === 0)
  const base = `/${workspaceId}/extensions/porter`

  return (
    <AdminPage
      breadcrumbs={[{ label: 'Porter', href: base }, { label: 'Export' }]}
      description="Pick the data types to export, scope them, and package everything into a portable archive."
    >
    <div className="max-w-4xl space-y-6">

      {/* What to export */}
      <section className="rounded-xl border border-border">
        <div className="border-b border-border bg-surface-sunken px-4 py-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">What to export</h2>
        </div>
        <div className="divide-y divide-border">
          <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
            <input type="checkbox" checked={includeContent} onChange={(e) => setIncludeContent(e.currentTarget.checked)} className="mt-0.5 accent-indigo-600" />
            <span>
              <span className="block text-sm font-medium text-fg">Content objects</span>
              <span className="mt-0.5 block text-xs text-fg-muted">Every content type with translations and labels. Filters below apply.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
            <input type="checkbox" checked={includeMedia} onChange={(e) => setIncludeMedia(e.currentTarget.checked)} className="mt-0.5 accent-indigo-600" />
            <span>
              <span className="block text-sm font-medium text-fg">Media</span>
              <span className="mt-0.5 block text-xs text-fg-muted">The whole media library with file bytes, including unattached assets.</span>
            </span>
          </label>
          {providers.map((p) => (
            <label key={p.key} className="flex cursor-pointer items-start gap-3 px-4 py-3">
              <input
                type="checkbox"
                checked={checkedProviders.has(p.key)}
                onChange={(e) => {
                  const next = new Set(checkedProviders)
                  e.currentTarget.checked ? next.add(p.key) : next.delete(p.key)
                  setCheckedProviders(next)
                }}
                className="mt-0.5 accent-indigo-600"
              />
              <span>
                <span className="block text-sm font-medium text-fg">{p.label}</span>
                <span className="mt-0.5 block text-xs text-fg-muted">
                  {(p.count ?? 0).toLocaleString()} here. Definitions only - submissions and run history stay put.
                </span>
              </span>
            </label>
          ))}
          {providers.length === 0 && (
            <div className="flex items-start gap-3 px-4 py-3 opacity-60">
              <input type="checkbox" disabled className="mt-0.5" />
              <span className="block text-xs text-fg-muted">Extensions with sync providers add their own export entries here.</span>
            </div>
          )}
        </div>
      </section>

      {/* Filters */}
      <section className="rounded-xl border border-border">
        <div className="border-b border-border bg-surface-sunken px-4 py-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">Filters</h2>
        </div>
        <div className="flex flex-wrap items-end gap-4 px-4 py-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg">Status (content)</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.currentTarget.value)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-fg focus-visible:border-focus-border focus:outline-none"
            >
              <option value="">Any status</option>
              <option value="published">Published only</option>
              <option value="draft">Drafts only</option>
            </select>
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium text-fg">Labels (comma separated)</label>
            <input
              value={labels}
              onChange={(e) => setLabels(e.currentTarget.value)}
              placeholder="release-q3, launch"
              className="w-full rounded-lg border border-border px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus-visible:border-focus-border focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-fg">Changed since</label>
            <input
              type="date"
              value={since}
              onChange={(e) => setSince(e.currentTarget.value)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-fg focus-visible:border-focus-border focus:outline-none"
            />
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={startExport}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {starting ? 'Starting…' : 'Export this deployment'}
          </button>
        </div>
      </section>

      {started && (
        <div className="rounded-lg border border-info/40 bg-info-muted px-4 py-3 text-sm text-info-fg">
          Export started in the background. Follow progress and download the bundle on the{' '}
          <Link to={`/${workspaceId}/extensions/porter/runs`} className="font-medium underline">Runs page</Link>.
        </div>
      )}
    </div>
    </AdminPage>
  )
}
