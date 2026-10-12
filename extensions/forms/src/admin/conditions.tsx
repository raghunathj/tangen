/**
 * File Name: conditions.tsx
 * Purpose: "Only when..." rules: the pure translation between a stored
 *          `showIf` (one condition or an and/or group) and editable rows, and
 *          the one editor every surface uses for them (a field, a step, a
 *          confirmation, a notification, a routing rule).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { IconPlus, IconTrash } from '@tangen/icons'
import { Button, Input, Select, SelectItem, Text } from '@/kit'
import type { FieldOperator, FormField, FormFieldCondition, ShowIf } from '../contract'

export interface ConditionRows { logic: 'and' | 'or'; rows: FormFieldCondition[] }

function flatten(showIf: ShowIf): FormFieldCondition[] {
  if (!('logic' in showIf)) return [showIf]
  return showIf.conditions.flatMap((c) => flatten(c as ShowIf))
}

export function showIfToRows(showIf: ShowIf | undefined): ConditionRows {
  if (!showIf) return { logic: 'and', rows: [] }
  if (!('logic' in showIf)) return { logic: 'and', rows: [showIf] }
  return { logic: showIf.logic, rows: flatten(showIf) }
}

export function rowsToShowIf(logic: 'and' | 'or', rows: FormFieldCondition[]): ShowIf | undefined {
  const valid = rows.filter((r) => r.field)
  if (valid.length === 0) return undefined
  if (valid.length === 1) return valid[0]
  return { logic, conditions: valid }
}

const OPERATORS: { value: FieldOperator; label: string }[] = [
  { value: 'equals', label: 'is' },
  { value: 'not_equals', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is filled' },
]
const HAS_VALUE = new Set(['equals', 'not_equals', 'contains', 'not_contains'])

export function ConditionEditor({ showIf, candidateFields, onChange, disabled, addLabel = 'Add a rule' }: {
  showIf: ShowIf | undefined
  candidateFields: FormField[]
  onChange: (showIf: ShowIf | undefined) => void
  disabled?: boolean
  addLabel?: string
}) {
  // Local rows keep a just-added empty row on screen while it is filled in.
  const initial = showIfToRows(showIf)
  const [logic, setLogic] = useState<'and' | 'or'>(initial.logic)
  const [rows, setRows] = useState<FormFieldCondition[]>(initial.rows)
  const externalKey = JSON.stringify(showIf ?? null)
  useEffect(() => {
    const next = showIfToRows(showIf)
    setLogic(next.logic)
    setRows((cur) => [...next.rows, ...cur.filter((r) => !r.field)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalKey])

  const commit = (nextLogic: 'and' | 'or', nextRows: FormFieldCondition[]) => {
    setLogic(nextLogic)
    setRows(nextRows)
    onChange(rowsToShowIf(nextLogic, nextRows))
  }
  const setRow = (i: number, patch: Partial<FormFieldCondition>) => commit(logic, rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  return (
    <div className="space-y-2">
      {rows.length > 1 && (
        <div className="flex items-center gap-2">
          <Text variant="help" as="span">Match</Text>
          <Select value={logic} onValueChange={(v: string) => commit(v as 'and' | 'or', rows)} disabled={disabled}>
            <SelectItem value="and">every rule</SelectItem>
            <SelectItem value="or">any rule</SelectItem>
          </Select>
        </div>
      )}
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Select value={row.field || '__none'} onValueChange={(v: string) => setRow(i, { field: v === '__none' ? '' : v })} disabled={disabled}>
              <SelectItem value="__none">Choose a field</SelectItem>
              {candidateFields.map((f) => <SelectItem key={f.id} value={f.name}>{f.label}</SelectItem>)}
            </Select>
          </div>
          <div className="w-36 shrink-0">
            <Select value={row.operator} onValueChange={(v: string) => setRow(i, { operator: v as FieldOperator })} disabled={disabled}>
              {OPERATORS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </Select>
          </div>
          {HAS_VALUE.has(row.operator) && (
            <div className="w-32 shrink-0">
              <Input value={String(row.value ?? '')} onChange={(e) => setRow(i, { value: e.currentTarget.value })} placeholder="Value" disabled={disabled} />
            </div>
          )}
          <Button size="xs" variant="ghost" aria-label="Remove rule" disabled={disabled} onClick={() => commit(logic, rows.filter((_, idx) => idx !== i))}>
            <IconTrash className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button size="xs" variant="ghost" icon={<IconPlus className="size-3.5" />} disabled={disabled || candidateFields.length === 0}
        onClick={() => commit(logic, [...rows, { field: '', operator: 'equals', value: '' }])}>
        {addLabel}
      </Button>
    </div>
  )
}
