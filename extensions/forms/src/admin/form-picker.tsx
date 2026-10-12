/**
 * File Name: form-picker.tsx
 * Purpose: The editor input for the `form` field type: pick one of the
 *          workspace's forms, see whether it is live, and be told when it is
 *          not - a draft form on a published page accepts nothing.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { Badge, Select, SelectItem, Skeleton } from '@/kit'
import { formsApi, type FormRow } from './api'

export function FormPickerInput({ value, onChange, readOnly }: { value: unknown; onChange: (v: unknown) => void; readOnly?: boolean }) {
  const [forms, setForms] = useState<FormRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    formsApi.list().then((r) => { if (!cancelled) setForms(r) }).catch(() => { if (!cancelled) setError('Could not load the forms') })
    return () => { cancelled = true }
  }, [])
  if (error) return <p className="text-ui-sm text-danger-fg">{error}</p>
  if (!forms) return <Skeleton variant="text" />
  if (forms.length === 0) return <p className="text-ui-sm text-fg-subtle">No forms yet. Create one under Forms first.</p>
  const current = String(value ?? '')
  const selected = forms.find((f) => f.id === current || f.slug === current)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Select value={selected?.id ?? '__none'} disabled={readOnly} onValueChange={(v: string) => onChange(v === '__none' ? null : v)}>
          <SelectItem value="__none">Choose a form</SelectItem>
          {forms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}{f.isLive ? '' : ' (draft)'}</SelectItem>)}
        </Select>
        {selected && <Badge variant={selected.isLive ? 'success' : 'warning'}>{selected.isLive ? 'Live' : 'Draft'}</Badge>}
      </div>
      {selected && !selected.isLive && <p className="text-ui-xs text-warning-fg">This form is a draft: it accepts nothing until it is published.</p>}
    </div>
  )
}
