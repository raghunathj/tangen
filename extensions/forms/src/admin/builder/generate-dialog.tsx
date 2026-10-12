/**
 * File Name: generate-dialog.tsx
 * Purpose: "Describe the form": a brief in, a definition out, through the
 *          extension's own generate route (which uses the workspace's AI).
 *          The result is shown as a summary before it is applied, and it is
 *          applied to the builder unsaved - nothing is written until Save.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useState } from 'react'
import { IconSparkles } from '@tangen/icons'
import { Button, Callout, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Textarea, toast } from '@/kit'
import type { FormField, FormStep } from '../../contract'
import { formsApi } from '../api'

export interface GeneratedDefinition { name?: string; fields?: FormField[]; steps?: FormStep[]; settings?: Record<string, unknown> }

export function GenerateDialog({ open, onOpenChange, current, onApply }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The builder's current definition; when it has fields the brief edits it. */
  current: GeneratedDefinition | null
  onApply: (def: GeneratedDefinition) => void
}) {
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<GeneratedDefinition | null>(null)
  const editing = Boolean(current && Array.isArray(current.fields) && current.fields.length > 0)

  async function generate() {
    if (brief.trim().length < 3) return
    setBusy(true)
    try {
      const r = await formsApi.generate({ prompt: brief.trim(), mode: editing ? 'edit' : 'create', ...(editing ? { current } : {}) })
      setResult(r.definition as GeneratedDefinition)
    } catch (e) {
      toast.error('Could not generate the form', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  function close() { onOpenChange(false); setResult(null); setBrief('') }

  const fieldCount = result?.fields?.length ?? 0
  const stepCount = result?.steps?.length ?? 0

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Change this form with AI' : 'Describe the form'}</DialogTitle>
          <DialogDescription>{editing ? 'Say what should change. The current fields are the starting point.' : 'Say what it collects and from whom. You get a draft to edit, nothing is saved yet.'}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Textarea autoFocus rows={4} value={brief} onChange={(e) => setBrief(e.currentTarget.value)}
            placeholder={editing ? 'Add a phone field and make company optional' : 'A request-a-demo form: name, business email, company size, and what they want to see'}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void generate() }} />
          {result && (
            <Callout variant="success" title={`${result.name ?? 'Form'}: ${fieldCount} field${fieldCount === 1 ? '' : 's'}${stepCount > 0 ? `, ${stepCount} steps` : ''}`}>
              {(result.fields ?? []).slice(0, 8).map((f) => f.label).join(' · ')}{fieldCount > 8 ? ' …' : ''}
            </Callout>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          {result
            ? <Button onClick={() => { onApply(result); close() }}>{editing ? 'Apply changes' : 'Use this draft'}</Button>
            : <Button icon={<IconSparkles className="size-3.5" />} isLoading={busy} disabled={brief.trim().length < 3} onClick={generate}>Generate</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
