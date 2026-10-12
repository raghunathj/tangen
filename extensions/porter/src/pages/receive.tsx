/**
 * Porter - Receive data. The gatekeeper front door: the OWNER of this
 * workspace generates a single-use code here and reads it to whoever is
 * sending; the sender enters this instance's URL + the code on their Send
 * page and the transfer flows in. Codes live 15 minutes, are single-use,
 * revocable, and grant write-in only - never admin access.
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { AdminPage } from '@/kit'
import { adminFetch } from '@/kit'

interface ActiveCode {
  id: string
  expiresAt: string
  createdAt: string
  createdBy: string | null
}

function minutesLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000))
}

export function PorterReceivePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const base = `/${workspaceId}/extensions/porter`
  const [codes, setCodes] = useState<ActiveCode[]>([])
  const [fresh, setFresh] = useState<{ id: string; code: string; expiresAt: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const loadCodes = useCallback(async () => {
    try {
      const res = await adminFetch<{ data: ActiveCode[] }>('/sync/receive/codes')
      setCodes(res.data ?? [])
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? 'Only the workspace owner can manage receive codes.')
    }
  }, [])

  useEffect(() => { loadCodes() }, [loadCodes])

  async function generate() {
    setGenerating(true)
    setCopied(false)
    try {
      const res = await adminFetch<{ data: { id: string; code: string; expiresAt: string } }>('/sync/receive/codes', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      setFresh(res.data)
      loadCodes()
    } catch (e: any) {
      setError(e?.message ?? 'Could not generate a code.')
    } finally {
      setGenerating(false)
    }
  }

  async function revoke(id: string) {
    try {
      await adminFetch(`/sync/receive/codes/${id}/revoke`, { method: 'POST' })
      if (fresh?.id === id) setFresh(null)
      loadCodes()
    } catch { /* refresh shows truth */ }
  }

  return (
    <AdminPage
      breadcrumbs={[{ label: 'Porter', href: base }, { label: 'Receive data' }]}
      description="Generate a one-time code so another Tangen instance can send data INTO this deployment."
    >
      <div className="max-w-3xl space-y-6">
        {error && (
          <p className="rounded-xl border border-warning/40 bg-warning-muted px-4 py-3 text-sm text-warning-fg">{error}</p>
        )}

        <section className="rounded-xl border border-border bg-surface shadow-sm">
          <div className="border-b border-border bg-surface-sunken px-4 py-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">One-time receive code</h2>
          </div>
          <div className="space-y-4 p-5">
            {fresh ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-lg border border-border bg-surface-sunken px-4 py-3 font-mono text-2xl font-semibold tracking-widest text-fg">
                    {fresh.code}
                  </span>
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard?.writeText(fresh.code); setCopied(true) }}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-sunken"
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-fg-muted">
                  Valid for {minutesLeft(fresh.expiresAt)} more minutes, single use. Read it to the sender:
                  on their instance they open Porter, choose Send to another instance, and enter this
                  instance's URL plus the code. It grants write-in only - never admin access - and you
                  can revoke it below at any time.
                </p>
              </div>
            ) : (
              <p className="text-sm text-fg-muted">
                No code on screen. Generate one when the sender is ready - it expires in 15 minutes and
                works exactly once.
              </p>
            )}
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {generating ? 'Generating…' : fresh ? 'Generate a new code' : 'Generate code'}
            </button>
          </div>
        </section>

        {codes.length > 0 && (
          <section className="rounded-xl border border-border bg-surface shadow-sm">
            <div className="border-b border-border bg-surface-sunken px-4 py-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">Active codes</h2>
            </div>
            <ul className="divide-y divide-border">
              {codes.map((c) => (
                <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="text-fg-muted">
                    Expires in {minutesLeft(c.expiresAt)} min
                    <span className="ml-2 font-mono text-[11px] text-fg-subtle">{c.id}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => revoke(c.id)}
                    className="text-xs font-medium text-danger-fg hover:text-danger-fg"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-xs text-fg-subtle">
          Incoming transfers appear on the <Link to={base + '/runs'} className="font-medium text-accent-fg hover:underline">Runs page</Link> the
          moment the sender starts - watch progress and cancel from there.
        </p>
      </div>
    </AdminPage>
  )
}
