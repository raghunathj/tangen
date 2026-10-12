/**
 * Porter - Send to another instance. The sender half of the gatekeeper
 * flow: pick an exported bundle, enter the receiver's URL and the one-time
 * code its owner just generated, and the archive streams over in
 * sha256-confirmed chunks. Progress lives on the Runs page; a dropped
 * connection resumes from the last confirmed chunk on re-run.
 */

import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { AdminPage } from '@/kit'
import { adminFetch } from '@/kit'

interface RunRow {
  id: string
  kind: string
  status: string
  scope?: { bundleId?: string } | null
  createdAt: string
}

const INPUT = 'w-full min-w-0 rounded-lg border border-border px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus-visible:border-focus-border focus:outline-none'

export function PorterSendPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const base = `/${workspaceId}/extensions/porter`
  const [bundles, setBundles] = useState<{ bundleId: string; label: string }[]>([])
  const [bundleId, setBundleId] = useState('')
  const [receiverUrl, setReceiverUrl] = useState('')
  const [code, setCode] = useState('')
  const [starting, setStarting] = useState(false)
  const [startedRunId, setStartedRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    adminFetch<{ data: RunRow[] }>('/sync/runs')
      .then((r) => {
        const exports = (r.data ?? [])
          .filter((run) => run.kind === 'export' && run.status === 'completed' && run.scope?.bundleId)
          .map((run) => ({
            bundleId: run.scope!.bundleId!,
            label: `${run.scope!.bundleId} - exported ${new Date(run.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
          }))
        setBundles(exports)
        if (exports[0]) setBundleId(exports[0].bundleId)
      })
      .catch(() => {})
  }, [workspaceId])

  async function startSend() {
    if (!bundleId) return
    setStarting(true)
    setError(null)
    try {
      const res = await adminFetch<{ data: { id: string } }>('/sync/runs', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'remote_send',
          bundleId,
          receiverUrl: receiverUrl.trim(),
          code: code.trim(),
        }),
      })
      setStartedRunId(res.data.id)
    } catch (e: any) {
      setError(e?.message ?? 'Could not start the transfer.')
    } finally {
      setStarting(false)
    }
  }

  const disabled = starting || !bundleId || !receiverUrl.trim() || !code.trim() || !!startedRunId

  return (
    <AdminPage
      breadcrumbs={[{ label: 'Porter', href: base }, { label: 'Send to another instance' }]}
      description="Stream an exported bundle to another Tangen instance using its owner's one-time receive code."
    >
      <div className="max-w-3xl space-y-6">
        {startedRunId && (
          <div className="rounded-xl border border-info/40 bg-info-muted px-4 py-3 text-sm text-info-fg">
            <p className="font-medium">Transfer started</p>
            <p className="mt-0.5 text-xs text-info-fg">
              The archive is streaming in confirmed chunks. Watch progress on the{' '}
              <Link to={base + '/runs'} className="font-medium underline">Runs page</Link> - if the
              connection drops, re-running resumes from the last confirmed chunk.
            </p>
          </div>
        )}
        {error && <p className="rounded-xl border border-danger/40 bg-danger-muted px-4 py-3 text-sm text-danger-fg">{error}</p>}

        <section className="rounded-xl border border-border bg-surface shadow-sm">
          <div className="border-b border-border bg-surface-sunken px-4 py-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">What to send</h2>
          </div>
          <div className="space-y-3 p-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-fg">Exported bundle</label>
              {bundles.length > 0 ? (
                <select value={bundleId} onChange={(e) => setBundleId(e.currentTarget.value)} className={INPUT}>
                  {bundles.map((b) => (
                    <option key={b.bundleId} value={b.bundleId}>{b.label}</option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-fg-muted">
                  No completed exports yet.{' '}
                  <Link to={base + '/export'} className="font-medium text-accent-fg hover:underline">Export data first</Link>,
                  then come back here to send it.
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface shadow-sm">
          <div className="border-b border-border bg-surface-sunken px-4 py-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">Where to send it</h2>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-fg">Receiver URL</label>
              <input value={receiverUrl} onChange={(e) => setReceiverUrl(e.currentTarget.value)}
                placeholder="https://cms.example.com" className={INPUT} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg">One-time code</label>
              <input value={code} onChange={(e) => setCode(e.currentTarget.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX" className={`${INPUT} font-mono tracking-widest`} />
              <p className="mt-1 text-[11px] leading-snug text-fg-subtle">
                The receiving workspace's owner generates this on their Porter → Receive page. It
                works once and expires in 15 minutes.
              </p>
            </div>
          </div>
        </section>

        <button
          type="button"
          onClick={startSend}
          disabled={disabled}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {starting ? 'Checking the code…' : 'Start transfer'}
        </button>
      </div>
    </AdminPage>
  )
}
