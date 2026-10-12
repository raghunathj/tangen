/**
 * File Name: auto-form.tsx
 * Purpose: <AutoForm> — render a validated form from an array of field
 *          definitions in one call. Pairs FieldControl (renders any field
 *          type), the FormSection/FormRow/FormFooter layout, and the same
 *          client validation the content editor uses. Drop it on any extension
 *          or app admin page to collect + validate data without hand-wiring
 *          each input. Submit is called only when validation passes; server
 *          errors can be merged back in via the `errors` prop.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Part of the stable @/kit surface. Field defs use the
 *          same shape as content-object fields (label, fieldType, config,
 *          required) — see docs/fields.md.
 */
import { useState, type ReactNode } from 'react'
import type { FieldDefinition } from '@tangen/types'
import { FieldControl } from '@/components/fields/field-control'
import { validateFields } from '@/lib/editor'
import { Button } from '@tangen/ui'
import { FormSection, FormRow, FormFooter } from './form'

export interface AutoFormProps {
  /** The fields to render — same shape as content-object fields. */
  fields: FieldDefinition[]
  /** Current values, keyed by field name (controlled). */
  value: Record<string, unknown>
  /** Called with the next values whenever a field changes. */
  onChange: (next: Record<string, unknown>) => void
  /** Called with the values once validation passes. May be async. */
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>
  env: string
  workspaceId: string
  /** Section title (omit for a bare, card-less form). */
  title?: ReactNode
  description?: ReactNode
  submitLabel?: string
  cancelLabel?: string
  onCancel?: () => void
  /** External busy state (disables the submit button + shows a spinner). */
  busy?: boolean
  /** Server/external errors to display, keyed by field name. Merged with local. */
  errors?: Record<string, string>
}

export function AutoForm({
  fields, value, onChange, onSubmit, workspaceId,
  title, description, submitLabel = 'Save', cancelLabel = 'Cancel', onCancel,
  busy = false, errors: externalErrors,
}: AutoFormProps) {
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const errors = { ...localErrors, ...externalErrors }

  function setField(name: string, v: unknown) {
    onChange({ ...value, [name]: v })
    if (localErrors[name]) setLocalErrors((e) => { const n = { ...e }; delete n[name]; return n })
  }

  async function handleSubmit() {
    // Reuse the content editor's validator; strip the content-only __title rule
    // since a standalone form has no system title field.
    const errs = validateFields('-', value, fields)
    delete errs.__title
    setLocalErrors(errs)
    if (Object.keys(errs).length > 0) return
    setSubmitting(true)
    try { await onSubmit(value) } finally { setSubmitting(false) }
  }

  const rows = fields.map((f) => (
    <FormRow key={f.name} label={f.label} htmlFor={f.name} required={f.required} help={f.helpText} error={errors[f.name]}>
      <FieldControl
        field={f}
        value={value[f.name]}
        onChange={(v) => setField(f.name, v)}
        workspaceId={workspaceId}
      />
    </FormRow>
  ))

  return (
    <form onSubmit={(e) => { e.preventDefault(); void handleSubmit() }} noValidate>
      {title !== undefined
        ? <FormSection title={title} description={description}>{rows}</FormSection>
        : <div className="space-y-4">{rows}</div>}
      <FormFooter>
        {onCancel && <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting || busy}>{cancelLabel}</Button>}
        <Button type="submit" isLoading={submitting || busy}>{submitLabel}</Button>
      </FormFooter>
    </form>
  )
}
