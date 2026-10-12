/**
 * File Name: new-page-dialog.tsx
 * Purpose: Create a page without leaving Studio - pick what kind, name it,
 *          optionally start from a saved template, and land in the editor.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: No new create path. It uses the SAME objects create
 *          endpoint the editor and the generate flow use, then writes any
 *          starting blocks through the normal draft save - so review,
 *          revisions and permissions behave exactly as they do everywhere
 *          else. Validation lives in lib/new-page.ts (pure, tested).
 */
import { useCallback, useEffect, useState } from 'react'
import type { FieldDefinition } from '@tangen/types'
import { Button, Dialog, DialogContent, DialogHeader, DialogBody, DialogTitle, DialogFooter, Input, Spinner } from '@/kit'
import { adminFetch } from '@/lib/api'
import { buildCreateBody, buildUpdateBody } from '@/lib/editor'
import { slugify } from '@/lib/editor'
import { planNewPage, type StudioTypeLike } from '../lib/new-page'
import { patchDraft } from '../lib/save'
import type { StudioPreset } from '../lib/presets'

interface NewPageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  types: StudioTypeLike[]
  onCreated: (typeName: string, id: string) => void
}

export function NewPageDialog({ open, onOpenChange, types, onCreated }: NewPageDialogProps) {
  const [typeName, setTypeName] = useState('')
  const [title, setTitle] = useState('')
  const [templateId, setTemplateId] = useState('')
  /** Blank means "derive from the name" - see planNewPage. */
  const [slug, setSlug] = useState('')
  const [presets, setPresets] = useState<StudioPreset[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setSlug('')
    setTypeName((t) => t || types[0]?.type || '')
    adminFetch<{ data: StudioPreset[] }>('/admin/ext/studio/presets')
      .then((r) => setPresets(r.data ?? []))
      .catch(() => setPresets([]))   // templates are a nicety, never a blocker
  }, [open, types])

  const create = useCallback(async () => {
    const template = presets.find((p) => p.id === templateId)?.block
    const planned = planNewPage({ typeName, title, slug, template }, { types })
    if (!planned.ok) { setError(planned.error); return }
    const { plan } = planned

    setBusy(true)
    setError(null)
    try {
      const typeRes = await adminFetch<{ data: { fields: FieldDefinition[] } }>(`/types/${plan.typeName}`)
      const fields = typeRes.data.fields ?? []
      const created = await adminFetch<{ data: { id: string } }>(`/objects/${plan.typeName}`, {
        method: 'POST',
        // Slug rides top-level, like title - the API resolves collisions by
        // appending -1, -2, so the page always lands somewhere valid.
        body: JSON.stringify({ ...buildCreateBody(plan.typeName, plan.title, {}, fields), slug: plan.slug }),
      })
      // Starting blocks ride the editor's own save path, so the new page is
      // a perfectly ordinary draft with a real revision.
      if (plan.blocks.length > 0) {
        const body = buildUpdateBody(plan.title, { [plan.blocksField]: plan.blocks }, fields) as unknown as Record<string, unknown>
        await patchDraft(adminFetch as never, { type: plan.typeName, id: created.data.id, body })
      }
      onOpenChange(false)
      setTitle(''); setTemplateId('')
      onCreated(plan.typeName, created.data.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the page')
    } finally {
      setBusy(false)
    }
  }, [typeName, title, templateId, presets, types, onCreated, onOpenChange])

  const inputCls = 'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New page</DialogTitle></DialogHeader>
        <DialogBody className="space-y-4">
          {types.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Kind of page</label>
              <select value={typeName} onChange={(e) => setTypeName(e.target.value)} className={inputCls}>
                {types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1">Name</label>
            <Input
              autoFocus
              value={title}
              placeholder="Spring campaign"
              onChange={(e) => setTitle((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void create() }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1">Web address</label>
            <div className="flex items-center gap-1">
              <span className="text-xs text-fg-subtle shrink-0">/</span>
              <Input
                value={slug}
                placeholder={slugify(title) || 'page-address'}
                onChange={(e) => setSlug((e.target as HTMLInputElement).value)}
              />
            </div>
            <p className="mt-1 text-[11px] text-fg-subtle">
              Leave blank to use the name. If this address is taken, a number is added.
            </p>
          </div>
          {presets.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Start from</label>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={inputCls}>
                <option value="">Blank page</option>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => { void create() }} disabled={busy}>
            {busy ? <><Spinner className="size-3.5" /> Creating…</> : 'Create page'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
