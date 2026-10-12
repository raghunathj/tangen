/**
 * Porter - Import page. Upload a .tangen-export.tar.gz, see counts and
 * schema blockers, pick publish-state and matching modes, then run the
 * import in the background.
 */

import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { AdminPage } from '@/kit'
import { adminFetch } from '@/kit'
import { useAuthStore } from '@/kit'

interface UploadState {
  bundleId: string
  counts: Record<string, number>
  sourceWorkspace: string
  blockers: { typeName: string; mismatches?: string[] }[]
}

export function PorterImportPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [upload, setUpload] = useState<UploadState | null>(null)
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState(false)
  const [statusMode, setStatusMode] = useState('preserve')
  const [identityMode, setIdentityMode] = useState('match')

  async function uploadBundle(file: File) {
    setBusy(true)
    setUpload(null)
    setStarted(false)
    try {
      const apiHost = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')
      const token = useAuthStore.getState().accessToken
      const res = await fetch(
        `${apiHost}/api/v1/sync/bundles`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/gzip', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: file,
        },
      )
      if (!res.ok) throw new Error('upload failed')
      const j = await res.json()
      setUpload({
        bundleId: j.data.bundleId,
        counts: j.data.manifest.counts ?? {},
        sourceWorkspace: j.data.manifest.workspaceId,
        blockers: j.data.validation?.blockers ?? [],
      })
    } catch { setUpload(null) } finally {
      setBusy(false)
    }
  }

  async function startImport() {
    if (!upload) return
    setBusy(true)
    try {
      await adminFetch('/sync/runs', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'import',
          bundleId: upload.bundleId,
          options: { identityMode, statusMode },
        }),
      })
      setUpload(null)
      setStarted(true)
    } catch { /* user retries */ } finally {
      setBusy(false)
    }
  }

  const base = `/${workspaceId}/extensions/porter`
  return (
    <AdminPage
      breadcrumbs={[{ label: 'Porter', href: base }, { label: 'Import' }]}
      description="Upload a bundle, validate it against this deployment, then apply in the background."
    >
    <div className="max-w-3xl space-y-6">

      <div className="rounded-lg border border-border px-4 py-3 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="file"
            accept=".gz,.tgz,application/gzip"
            disabled={busy}
            onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) uploadBundle(f) }}
            className="text-sm text-fg-muted"
          />
          {busy && <span className="text-xs text-fg-subtle animate-pulse">Working…</span>}
        </div>

        {upload && (
          <div className="space-y-3">
            <p className="text-xs text-fg-muted">
              Bundle from workspace <span className="font-medium text-fg">{upload.sourceWorkspace}</span>:{' '}
              {Object.entries(upload.counts)
                .filter(([k]) => k.startsWith('objects/'))
                .map(([k, v]) => `${v} ${k.slice(8)}`)
                .join(', ') || 'no objects'}
              {upload.counts['media/index'] ? ` · ${upload.counts['media/index']} media` : ''}
            </p>
            {upload.blockers.length > 0 ? (
              <div className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2">
                <p className="text-xs font-medium text-warning-fg">Schema out of sync - import blocked</p>
                {upload.blockers.map((b) => (
                  <p key={b.typeName} className="text-[11px] text-warning-fg">
                    {b.typeName}: {(b.mismatches ?? ['missing here']).join('; ')}
                  </p>
                ))}
              </div>
            ) : (
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="block text-xs font-medium text-fg mb-1">Publish state</label>
                  <select value={statusMode} onChange={(e) => setStatusMode(e.currentTarget.value)}
                    className="border border-border rounded-lg px-3 py-1.5 text-sm text-fg focus:outline-none focus-visible:border-focus-border">
                    <option value="preserve">Preserve existing status</option>
                    <option value="drafts">Import everything as drafts</option>
                    <option value="mirror">Mirror the bundle's status</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-fg mb-1">Matching</label>
                  <select value={identityMode} onChange={(e) => setIdentityMode(e.currentTarget.value)}
                    className="border border-border rounded-lg px-3 py-1.5 text-sm text-fg focus:outline-none focus-visible:border-focus-border">
                    <option value="match">Update by id, then by handle</option>
                    <option value="new">Create everything as new</option>
                  </select>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={startImport}
                  className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  Import into this deployment
                </button>
              </div>
            )}
          </div>
        )}

        {started && (
          <div className="rounded-lg border border-info/40 bg-info-muted px-4 py-3 text-sm text-info-fg">
            Import started in the background. Follow progress on the{' '}
            <Link to={`/${workspaceId}/extensions/porter/runs`} className="font-medium underline">Runs page</Link>.
          </div>
        )}
      </div>
    </div>
    </AdminPage>
  )
}
