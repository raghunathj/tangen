/**
 * File Name: vars-panel.tsx
 * Purpose: The {{variable}} set editor shared by the REST and GraphQL rails —
 *          name/value rows with secret masking, saved per member per env via
 *          the playground variables endpoint. Rows carry STABLE ids (never
 *          keyed by the name being typed), so inputs keep focus across
 *          keystrokes; parent vars state stays live for send-time
 *          interpolation while editing.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { adminFetch, Button, Input, Text, toast } from '@/kit'
import { IconLock, IconEye } from '@tangen/icons'

export interface VarDef { value: string; secret?: boolean }

interface Row { id: string; name: string; value: string; secret?: boolean }

const rid = () => Math.random().toString(36).slice(2, 10)
const rowsFromVars = (vars: Record<string, VarDef>): Row[] => [
  ...Object.entries(vars).map(([name, d]) => ({ id: rid(), name, value: d.value, secret: d.secret })),
  { id: rid(), name: '', value: '' },
]
const varsFromRows = (rows: Row[]): Record<string, VarDef> =>
  Object.fromEntries(rows.filter((r) => r.name.trim()).map((r) => [r.name.trim(), { value: r.value, ...(r.secret ? { secret: true } : {}) }]))

export function VarsPanel({ vars, onVarsChange }: {
  vars: Record<string, VarDef>
  onVarsChange: (vars: Record<string, VarDef>) => void
}) {
  const [rows, setRows] = useState<Row[]>(() => rowsFromVars(vars))
  const [dirty, setDirty] = useState(false)

  // External updates (the async initial fetch, the other tab's save) replace
  // the rows only while the editor is pristine — never mid-typing.
  useEffect(() => {
    if (!dirty) setRows(rowsFromVars(vars))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vars])

  const apply = (next: Row[]) => {
    // always keep one trailing empty row for quick entry
    if (next.every((r) => r.name.trim() !== '')) next = [...next, { id: rid(), name: '', value: '' }]
    setRows(next)
    setDirty(true)
    onVarsChange(varsFromRows(next))   // interpolation stays live while editing
  }
  const patch = (id: string, p: Partial<Row>) => apply(rows.map((r) => (r.id === id ? { ...r, ...p } : r)))
  const remove = (id: string) => {
    const next = rows.filter((r) => r.id !== id)
    apply(next.length ? next : [{ id: rid(), name: '', value: '' }])
  }

  const save = async () => {
    try {
      const clean = varsFromRows(rows)
      await adminFetch('/admin/playground/variables', { method: 'PUT', body: JSON.stringify({ vars: clean }) })
      onVarsChange(clean)
      setDirty(false)
      setRows(rowsFromVars(clean))
      toast.success('Variables saved')
    } catch (e) { toast.error('Could not save variables', (e as Error).message) }
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-2">
      <Text variant="help">Use {'{{name}}'} in paths, params, headers, bodies, or GraphQL queries/variables. Values stay private to you and are filled in only when you hit Send.</Text>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-1.5">
            <Input value={r.name} onChange={(e) => patch(r.id, { name: e.currentTarget.value })} placeholder="name" className="flex-1 font-mono text-xs" />
            <Input
              type={r.secret ? 'password' : 'text'}
              value={r.value}
              onChange={(e) => patch(r.id, { value: e.currentTarget.value })}
              placeholder="value"
              className="flex-1 font-mono text-xs"
              disabled={r.name.trim() === ''}
            />
            <button
              type="button"
              title={r.secret ? 'Secret - click to show as plain text' : 'Mark secret (masked)'}
              onClick={() => r.name.trim() && patch(r.id, { secret: !r.secret })}
              className={clsx('px-1', r.secret ? 'text-warning-fg' : 'text-fg-subtle hover:text-fg')}
            >
              {r.secret ? <IconLock className="size-3.5" /> : <IconEye className="size-3.5" />}
            </button>
            <button type="button" onClick={() => r.name.trim() && remove(r.id)} className="text-fg-subtle hover:text-danger-fg px-1 text-xs" title="Remove">✕</button>
          </div>
        ))}
      </div>
      <Button size="sm" onClick={save} disabled={!dirty}>Save variables</Button>
    </div>
  )
}
