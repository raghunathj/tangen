/**
 * File Name: generate-dialog.tsx
 * Purpose: The "Generate page" dialog - a brief becomes a whole draft page.
 *   Two modes: 'new' (Studio home - pick a type, name the page, generate,
 *   create a NEW draft through the normal objects create endpoint, write the
 *   blocks through the editor's own save path, then navigate to Studio) and
 *   'current' (Studio editor - generate, then the marketer explicitly
 *   chooses Replace all sections / Add below). Provider failures surface as
 *   a readable message inside the dialog, never a blank spinner.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Generation result is ALWAYS a draft - publish stays
 *   the normal gated flow.
 */
import { useEffect, useState } from 'react'
import type { FieldDefinition } from '@tangen/types'
import {
  Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
  Input, Select, SelectItem, Spinner,
} from '@/kit'
import { adminFetch } from '@/lib/api'
import { buildCreateBody, buildUpdateBody } from '@/lib/editor'
import { patchDraft } from '../lib/save'
import type { StudioType } from '../lib/model'

export interface GeneratedPayload {
  blocks: Array<Record<string, unknown>>
  provider?: string
  model?: string
}

export interface GenerateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 'new': pick a type + create a draft; 'current': fill the open draft. */
  mode: 'new' | 'current'
  /** Studio-eligible types ('new' mode). */
  types?: StudioType[]
  /** The open page's type ('current' mode). */
  typeName?: string
  /** The region being edited - the AI must see THAT region's components. */
  field?: string | null
  /** Whether the open draft already has sections ('current' mode copy). */
  hasSections?: boolean
  /** 'new' mode: called with the created draft to navigate into Studio. */
  onCreated?: (typeName: string, id: string) => void
  /** 'current' mode: apply the generated blocks after the explicit choice. */
  onApply?: (blocks: Array<Record<string, unknown>>, how: 'replace' | 'append') => void
}

type Phase =
  | { name: 'input' }
  | { name: 'generating' }
  | { name: 'creating' }
  | { name: 'ready'; payload: GeneratedPayload }

export function GenerateDialog({
  open, onOpenChange, mode, types, typeName, field, hasSections, onCreated, onApply,
}: GenerateDialogProps) {
  const [pickedType, setPickedType] = useState<string>('')
  const [title, setTitle] = useState('')
  const [brief, setBrief] = useState('')
  const [phase, setPhase] = useState<Phase>({ name: 'input' })
  const [error, setError] = useState<string | null>(null)

  // Fresh start every open; default the type picker to the first eligible type.
  useEffect(() => {
    if (!open) return
    setPhase({ name: 'input' })
    setError(null)
    setBrief('')
    setTitle('')
    setPickedType((cur) => cur || types?.[0]?.type || '')
  }, [open, types])

  const busy = phase.name === 'generating' || phase.name === 'creating'
  const targetType = mode === 'new' ? pickedType : (typeName ?? '')
  const canGenerate = !busy && brief.trim().length > 0 && targetType.length > 0
    && (mode === 'current' || title.trim().length > 0)

  async function generate(): Promise<GeneratedPayload | null> {
    setError(null)
    setPhase({ name: 'generating' })
    try {
      const res = await adminFetch<{ data: GeneratedPayload }>('/admin/ext/studio/generate', {
        method: 'POST',
        body: JSON.stringify({ typeName: targetType, brief: brief.trim(), field: field ?? undefined }),
      })
      return res.data
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed - try again')
      setPhase({ name: 'input' })
      return null
    }
  }

  /** 'new' mode: generate, create the draft, write the blocks, navigate. */
  async function generateIntoNewDraft() {
    const payload = await generate()
    if (!payload) return
    setPhase({ name: 'creating' })
    try {
      const st = types?.find((t) => t.type === targetType)
      const typeRes = await adminFetch<{ data: { fields: FieldDefinition[] } }>(`/types/${targetType}`)
      const fields = typeRes.data.fields ?? []
      // The NORMAL create endpoint - a plain draft, nothing Studio-specific.
      const created = await adminFetch<{ data: { id: string } }>(`/objects/${targetType}`, {
        method: 'POST',
        body: JSON.stringify(buildCreateBody(targetType, title.trim(), {}, fields)),
      })
      // Blocks land through the editor's own save path (a real revision).
      if (st?.blocksField) {
        const body = buildUpdateBody(title.trim(), { [st.blocksField]: payload.blocks }, fields) as unknown as Record<string, unknown>
        await patchDraft(adminFetch as never, { type: targetType, id: created.data.id, body })
      }
      onOpenChange(false)
      onCreated?.(targetType, created.data.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the draft')
      setPhase({ name: 'input' })
    }
  }

  /** 'current' mode: generate, then wait for the explicit Replace/Add choice. */
  async function generateForCurrent() {
    const payload = await generate()
    if (!payload) return
    setPhase({ name: 'ready', payload })
  }

  function apply(how: 'replace' | 'append') {
    if (phase.name !== 'ready') return
    onApply?.(phase.payload.blocks, how)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'new' ? 'Generate a page' : 'Generate sections'}</DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-3">
          {mode === 'new' && (
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Page type</label>
              <Select value={pickedType} onValueChange={(v: string) => setPickedType(v)}>
                {(types ?? []).map((t) => (
                  <SelectItem key={t.type} value={t.type}>{t.label}</SelectItem>
                ))}
              </Select>
            </div>
          )}
          {mode === 'new' && (
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Page title</label>
              <Input
                placeholder="Spring launch"
                value={title}
                onChange={(e) => setTitle((e.target as HTMLInputElement).value)}
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1">Brief</label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={4}
              placeholder="Describe the page: who it is for, what it offers, the action you want visitors to take."
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="mt-1 text-[11px] text-fg-subtle">
              Sections and copy are drafted from your brief using the sections this page type allows. Nothing is published.
            </p>
          </div>

          {error && (
            <p className="text-xs text-red-600" role="alert">{error}</p>
          )}

          {busy && (
            <Spinner
              size="sm"
              label={phase.name === 'creating' ? 'Creating the draft…' : 'Generating sections…'}
            />
          )}

          {phase.name === 'ready' && (
            <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2.5">
              <p className="text-sm font-medium text-fg">
                {phase.payload.blocks.length === 1
                  ? '1 section ready'
                  : `${phase.payload.blocks.length} sections ready`}
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">
                {hasSections
                  ? 'Choose how to add them to the draft. Replacing removes the current sections from the draft (the live page is untouched until you publish).'
                  : 'Add them to the draft to review in Studio.'}
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="mt-4">
          {phase.name === 'ready' ? (
            <>
              <Button variant="secondary" onClick={() => setPhase({ name: 'input' })}>Back</Button>
              {hasSections && (
                <Button variant="secondary" onClick={() => apply('replace')}>Replace all sections</Button>
              )}
              <Button onClick={() => apply('append')}>{hasSections ? 'Add below' : 'Add to draft'}</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                disabled={!canGenerate}
                onClick={() => { void (mode === 'new' ? generateIntoNewDraft() : generateForCurrent()) }}
              >
                {busy ? 'Working…' : 'Generate'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
