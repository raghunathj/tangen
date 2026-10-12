/**
 * File Name: kv-editor.tsx
 * Purpose: Key/value row editor for the playground's Params and Headers —
 *          with a Postman-style Bulk Edit toggle: one `key: value` per line,
 *          `//` prefix keeps a row disabled. Shared by the REST and GraphQL
 *          tabs so both behave identically.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useState } from 'react'
import { Input } from '@/kit'
import { kvRowsToBulkText, bulkTextToKvRows, type KVRow } from '@/lib/playground'

const emptyRow = (): KVRow => ({ key: '', value: '', enabled: true })

export function KVEditor({ rows, onChange, keyPlaceholder }: {
  rows: KVRow[]
  onChange: (rows: KVRow[]) => void
  keyPlaceholder: string
}) {
  const [bulk, setBulk] = useState(false)
  const [bulkText, setBulkText] = useState('')

  const enterBulk = () => { setBulkText(kvRowsToBulkText(rows)); setBulk(true) }
  const leaveBulk = () => {
    const parsed = bulkTextToKvRows(bulkText)
    onChange(parsed.length ? [...parsed, emptyRow()] : [emptyRow()])
    setBulk(false)
  }

  const patch = (i: number, p: Partial<KVRow>) => {
    const next = rows.map((r, ri) => (ri === i ? { ...r, ...p } : r))
    // always keep one trailing empty row for quick entry
    if (next.every((r) => r.key.trim() !== '')) next.push(emptyRow())
    onChange(next)
  }
  const remove = (i: number) => {
    const next = rows.filter((_, ri) => ri !== i)
    onChange(next.length ? next : [emptyRow()])
  }

  return (
    <div className="space-y-1">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={bulk ? leaveBulk : enterBulk}
          className="text-[11px] text-accent-fg hover:underline"
        >
          {bulk ? 'Key-value edit' : 'Bulk edit'}
        </button>
      </div>

      {bulk ? (
        <div>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.currentTarget.value)}
            rows={Math.max(4, bulkText.split('\n').length + 1)}
            spellCheck={false}
            placeholder={`${keyPlaceholder}: value\n//disabled-${keyPlaceholder}: value`}
            className="w-full border border-border rounded-md px-2.5 py-1.5 text-xs font-mono text-fg bg-surface focus:outline-none focus-visible:border-focus-border"
          />
          <p className="text-[10px] text-fg-subtle mt-0.5">One <code>key: value</code> per line - prefix with <code>//</code> to keep a row but skip sending it. Applied when you switch back.</p>
        </div>
      ) : (
        rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={r.enabled}
              onChange={(e) => patch(i, { enabled: e.currentTarget.checked })}
              className="shrink-0 accent-indigo-600"
              title={r.enabled ? 'Included' : 'Excluded'}
            />
            <Input value={r.key} onChange={(e) => patch(i, { key: e.currentTarget.value })} placeholder={keyPlaceholder} className="flex-1 font-mono text-xs" />
            <Input value={r.value} onChange={(e) => patch(i, { value: e.currentTarget.value })} placeholder="value" className="flex-1 font-mono text-xs" />
            <button type="button" onClick={() => remove(i)} className="shrink-0 text-fg-subtle hover:text-danger-fg px-1 text-xs" title="Remove row">✕</button>
          </div>
        ))
      )}
    </div>
  )
}
