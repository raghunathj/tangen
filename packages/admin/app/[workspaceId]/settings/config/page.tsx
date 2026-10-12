/**
 * File Name: page.tsx
 * Purpose: Settings → Configuration: the resolved configuration of this
 *          workspace on this deployment, READ-ONLY (Stage 5). Every key with its
 *          final state, the layer and source that won, its policy, the value
 *          where the key is diagnostic, a secret as its reference and whether
 *          this deployment resolved it - and the findings boot validated
 *          with. Nothing here edits anything; nothing here ever shows a
 *          secret value, a raw variable or a connection string, because the
 *          endpoint it reads cannot produce one.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { workspaceFetch } from '@/lib/api'
import { usePageHeader } from '@/lib/page-header'
import { SettingsSection } from '@/components/settings/settings-section'

interface KeyRow {
  key: string
  state: string
  layer?: string
  source?: string
  policy?: string
  scopes?: string[]
  value?: unknown
  secret?: { secretRef: string; resolved: boolean; provider: string }
  error?: string
}
interface Finding { severity: 'error' | 'warning' | 'info'; code: string; message: string; workspace?: string; key?: string }
interface Resolved {
  role: string | null
  findings: Finding[]
  keys: KeyRow[]
}

const STATE_NOTE: Record<string, string> = {
  default: 'the platform default',
  inherited: 'inherited from a less specific layer',
  overridden: 'set at this layer',
  bound: 'bound by the deployment',
  disabled: 'switched off on purpose',
  missing: 'nothing sets it',
  invalid: 'set, but not a valid value',
}

function groupOf(key: string): string {
  if (key.startsWith('site.')) return 'site'
  if (key.startsWith('ext.')) return 'extensions'
  if (key.startsWith('integration.')) return 'integrations'
  return 'core'
}

function StateBadge({ row }: { row: KeyRow }) {
  const tone = row.state === 'missing' || row.state === 'invalid' ? 'text-danger-fg bg-danger-muted border-danger/40'
    : row.state === 'disabled' ? 'text-fg-subtle bg-surface-sunken border-border'
    : row.state === 'bound' || row.state === 'overridden' ? 'text-success-fg bg-success-muted border-success/40'
    : 'text-fg-subtle bg-surface border-border'
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium ${tone}`} title={STATE_NOTE[row.state] ?? row.state}>{row.state}</span>
}

function ValueCell({ row }: { row: KeyRow }) {
  if (row.secret) {
    return (
      <span className="font-mono text-xs">
        <span className="text-fg-subtle">ref </span>{row.secret.secretRef}
        <span className={`ml-2 rounded border px-1.5 py-0.5 text-[11px] ${row.secret.resolved ? 'text-success-fg bg-success-muted border-success/40' : 'text-warning-fg bg-warning-muted border-warning/40'}`}>
          {row.secret.resolved ? 'resolved' : 'unresolved'}
        </span>
      </span>
    )
  }
  if (row.value === undefined) return <span className="text-xs text-fg-subtle">{row.state === 'disabled' ? 'off' : 'not shown'}</span>
  return <span className="font-mono text-xs break-all">{typeof row.value === 'string' ? row.value : JSON.stringify(row.value)}</span>
}

export default function ConfigurationSettingsPage() {
  const params = useParams<{ workspaceId: string }>()
  usePageHeader({ description: 'What this deployment resolved, where each value came from, and what boot validated - read-only; a secret is only ever its reference' })
  const [data, setData] = useState<Resolved | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let alive = true
    setData(null); setError(null)
    workspaceFetch<{ data: Resolved }>(`/admin/config/resolved`)
      .then((r) => { if (alive) setData(r.data) })
      .catch((e: Error) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [])

  const groups = useMemo(() => {
    const out = new Map<string, KeyRow[]>()
    const q = filter.trim().toLowerCase()
    for (const row of data?.keys ?? []) {
      if (q && !row.key.toLowerCase().includes(q) && !(row.secret?.secretRef ?? '').toLowerCase().includes(q)) continue
      const g = groupOf(row.key)
      out.set(g, [...(out.get(g) ?? []), row])
    }
    return out
  }, [data, filter])

  if (error) return <div className="p-6 text-sm text-danger-fg" role="alert">{error}</div>
  if (!data) return <div className="p-6 text-sm text-fg-subtle" aria-busy="true">Resolving…</div>

  const errors = data.findings.filter((f) => f.severity === 'error')
  const warnings = data.findings.filter((f) => f.severity === 'warning')
  const infos = data.findings.filter((f) => f.severity === 'info')

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Boot findings"
        description="What boot validated about this deployment's configuration."
        summary={<span><span className="text-fg-subtle">role </span><span className="font-medium">{data.role ?? 'unknown'}</span></span>}
      >
        <div className="space-y-2">
          {data.findings.length === 0 && <p className="text-sm text-fg-subtle">Boot validated this deployment with no findings.</p>}
          {[...errors, ...warnings, ...infos].map((f, i) => (
            <div key={i} className={`text-sm flex gap-2 ${f.severity === 'error' ? 'text-danger-fg' : f.severity === 'warning' ? 'text-warning-fg' : 'text-fg-subtle'}`}>
              <span className="uppercase text-[11px] font-semibold w-14 shrink-0 pt-0.5">{f.severity}</span>
              <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{f.message}</span>
            </div>
          ))}
        </div>
      </SettingsSection>

      <div className="flex items-center gap-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
          placeholder="Filter keys or references"
          aria-label="Filter configuration keys"
          className="w-72 border border-border rounded-lg px-3 py-1.5 text-sm text-fg focus:outline-none focus-visible:border-focus-border"
        />
        <span className="text-xs text-fg-subtle">{data.keys.length} keys · values shown only for diagnostic keys · secrets are references</span>
      </div>

      {['core', 'site', 'integrations', 'extensions'].filter((g) => groups.has(g)).map((g) => (
        <SettingsSection key={g} title={<span className="capitalize">{g}</span>} flush>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-fg-subtle text-left">
                <tr><th className="px-5 py-2 font-medium">key</th><th className="px-3 py-2 font-medium">state</th><th className="px-3 py-2 font-medium">from</th><th className="px-3 py-2 font-medium">policy</th><th className="px-3 py-2 font-medium">value</th></tr>
              </thead>
              <tbody>
                {groups.get(g)!.map((row) => (
                  <tr key={row.key} className="border-t border-border align-top">
                    <td className="px-5 py-2 font-mono text-xs">{row.key}{row.error && <div className="text-danger-fg">{row.error}</div>}</td>
                    <td className="px-3 py-2"><StateBadge row={row} /></td>
                    <td className="px-3 py-2 text-xs text-fg-subtle">{row.source ?? '-'}{row.layer ? <span className="block">{row.layer}</span> : null}</td>
                    <td className="px-3 py-2 text-xs text-fg-subtle">{row.policy ?? '-'}</td>
                    <td className="px-3 py-2"><ValueCell row={row} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SettingsSection>
      ))}
    </div>
  )
}
