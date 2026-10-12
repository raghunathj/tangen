/**
 * File Name: query-builder-panel.tsx
 * Purpose: The Query Builder - the rail surface for a selected kit.loop:
 *          pick a collection, build filter rows, sort, limit, and preview
 *          the real result count before anyone publishes.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Every decision comes from lib/query-builder.ts (pure,
 *          unit-tested); this file is presentation plus the preview fetch.
 *          The preview calls the platform's OWN objects query endpoint with
 *          the exact body the loop stores - what the author sees here is
 *          what the site's resolver will get, not an approximation.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminFetch } from '@/lib/api'
import {
  OPERATORS, operatorsForFieldType, rowsToQuery, queryToRows,
  type FilterRow,
} from '../lib/query-builder'
import type { SourceField } from '../lib/binding'

interface QueryBuilderPanelProps {
  /** Collections the loop may query. */
  types: Array<{ name: string; label?: string }>
  /** Fields of the currently chosen collection. */
  sourceFields: SourceField[]
  block: Record<string, unknown>
  onChange: (prop: string, value: unknown) => void
}

export function QueryBuilderPanel({ types, sourceFields, block, onChange }: QueryBuilderPanelProps) {
  const source = typeof block.source === 'string' ? block.source : ''
  const fieldTypes = useMemo(
    () => Object.fromEntries(sourceFields.map((f) => [f.name, f.fieldType])),
    [sourceFields],
  )
  const rows = useMemo(() => queryToRows(block.query), [block.query])

  const writeRows = useCallback((next: FilterRow[]) => {
    onChange('query', rowsToQuery(next, fieldTypes))
  }, [onChange, fieldTypes])

  const setRow = (i: number, patch: Partial<FilterRow>) =>
    writeRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  // ── Preview: the REAL endpoint, the REAL body ────────────────────────────
  const [preview, setPreview] = useState<{ total: number | null; error: string | null; loading: boolean }>(
    { total: null, error: null, loading: false },
  )
  const body = useMemo(() => {
    const sortField = typeof block.sortField === 'string' ? block.sortField : ''
    return {
      status: 'published',
      query: block.query && typeof block.query === 'object' ? block.query : {},
      ...(sortField ? { sort: { field: sortField, direction: block.sortDirection === 'asc' ? 'asc' : 'desc' } } : {}),
      limit: typeof block.limit === 'number' && block.limit > 0 ? block.limit : 10,
    }
  }, [block.query, block.sortField, block.sortDirection, block.limit])

  useEffect(() => {
    if (!source) { setPreview({ total: null, error: null, loading: false }); return }
    let alive = true
    setPreview((p) => ({ ...p, loading: true }))
    const t = setTimeout(() => {
      adminFetch<{ data: unknown[]; meta?: { total?: number } }>(
        `/objects/${source}/query`, { method: 'POST', body: JSON.stringify(body) },
      )
        .then((r) => { if (alive) setPreview({ total: r.meta?.total ?? r.data?.length ?? 0, error: null, loading: false }) })
        .catch((e) => { if (alive) setPreview({ total: null, error: e?.message || 'Query failed', loading: false }) })
    }, 400)
    return () => { alive = false; clearTimeout(t) }
  }, [source, body])

  const inputCls = 'w-full rounded border border-border bg-surface px-2 py-1 text-xs text-fg'

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-fg-muted mb-1">Collection</label>
        <select value={source} onChange={(e) => onChange('source', e.target.value)} className={inputCls}>
          <option value="">Choose a collection</option>
          {types.map((t) => <option key={t.name} value={t.name}>{t.label || t.name}</option>)}
        </select>
      </div>

      {source && (
        <>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-fg-muted">Filters</span>
              <button
                type="button"
                onClick={() => writeRows([...rows, { field: sourceFields[0]?.name ?? '', op: 'eq', value: '' }])}
                className="text-[11px] font-medium text-accent-fg hover:underline"
              >
                Add filter
              </button>
            </div>
            {rows.length === 0 ? (
              <p className="text-[11px] text-fg-subtle">No filters - every published record matches.</p>
            ) : (
              <div className="space-y-1.5">
                {rows.map((row, i) => {
                  const allowed = operatorsForFieldType(fieldTypes[row.field] ?? 'text')
                  return (
                    <div key={i} className="space-y-1 rounded border border-border p-1.5">
                      <div className="flex gap-1">
                        <select value={row.field} onChange={(e) => setRow(i, { field: e.target.value })} className={inputCls}>
                          {sourceFields.map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
                        </select>
                        <button
                          type="button"
                          title="Remove filter"
                          onClick={() => writeRows(rows.filter((_, j) => j !== i))}
                          className="shrink-0 px-1.5 text-xs text-fg-subtle hover:text-red-600"
                        >
                          x
                        </button>
                      </div>
                      <select value={row.op} onChange={(e) => setRow(i, { op: e.target.value })} className={inputCls}>
                        {OPERATORS.filter((o) => allowed.includes(o.value))
                          .map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      {row.op !== 'exists' && (
                        <input
                          type="text"
                          value={row.value}
                          placeholder={row.op === 'in' || row.op === 'nin' ? 'Comma-separated' : 'Value'}
                          onChange={(e) => setRow(i, { value: e.target.value })}
                          className={inputCls}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex gap-1">
            <div className="flex-1">
              <label className="block text-xs font-medium text-fg-muted mb-1">Sort by</label>
              <select
                value={typeof block.sortField === 'string' ? block.sortField : ''}
                onChange={(e) => onChange('sortField', e.target.value)}
                className={inputCls}
              >
                <option value="">Default</option>
                {sourceFields.map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
              </select>
            </div>
            <div className="w-24">
              <label className="block text-xs font-medium text-fg-muted mb-1">Order</label>
              <select
                value={block.sortDirection === 'asc' ? 'asc' : 'desc'}
                onChange={(e) => onChange('sortDirection', e.target.value)}
                className={inputCls}
              >
                <option value="desc">Newest</option>
                <option value="asc">Oldest</option>
              </select>
            </div>
          </div>

          <div className="rounded border border-border bg-surface-sunken px-2 py-1.5 text-[11px]">
            {preview.loading && <span className="text-fg-subtle">Checking...</span>}
            {!preview.loading && preview.error && <span className="text-red-600">{preview.error}</span>}
            {!preview.loading && !preview.error && preview.total !== null && (
              <span className="text-fg-muted">
                {preview.total} published {preview.total === 1 ? 'record' : 'records'} match
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
