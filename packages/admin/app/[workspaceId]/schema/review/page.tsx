/**
 * File Name: page.tsx (schema/review)
 * Purpose: MS-4 — review a SET of AI-generated schemas before saving. Reads the drafts
 *   from router state (the assistant's schema.create_set handoff), lists each with its
 *   fields + relation targets, lets you remove any, then "Save All" writes the whole set
 *   via the batch endpoint (one push) and polls the result. Nothing is written until Save All.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { Badge, Button, Callout } from '@/kit'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { IconChevronDown, IconChevronRight, IconTrash, IconStack, IconX } from '@tangen/icons'
import { toast } from '@/lib/toast'
import { saveSchemaBatch, waitForPush, notifyTypesChanged } from '@/lib/schema-save'
import { usePageHeader } from '@/lib/page-header'
import { PushOverlay } from '@/components/schema-builder/push-overlay'

interface DraftField { name: string; label: string; fieldType: string; config?: Record<string, any> }
interface Draft { kind: 'type' | 'component' | 'global'; name: string; label: string; description?: string; icon?: string; fields: DraftField[] }

const KIND_LABEL: Record<string, string> = { type: 'Content type', component: 'Component', global: 'Global' }

function DraftCard({ draft, onRemove }: { draft: Draft; onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <Button size="xs" variant="ghost" className="size-6 shrink-0 p-0" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen((o) => !o)} icon={open ? <IconChevronDown className="size-4" /> : <IconChevronRight className="size-4" />} />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-fg">{draft.label}</span>
          <span className="ml-2 font-mono text-xs text-fg-subtle">{draft.name}</span>
        </div>
        <Badge variant="neutral">{KIND_LABEL[draft.kind]}</Badge>
        <span className="text-ui-xs text-fg-subtle">{draft.fields.length} fields</span>
        <Button size="xs" variant="ghost" className="size-6 shrink-0 p-0 text-fg-subtle hover:text-danger-fg" title="Remove from set" aria-label="Remove from set" onClick={onRemove} icon={<IconTrash className="size-4" />} />
      </div>
      {open && (
        <div className="border-t border-border divide-y divide-border">
          {draft.fields.length === 0 ? (
            <p className="px-4 py-2 text-xs text-fg-subtle italic">No custom fields</p>
          ) : draft.fields.map((f) => (
            <div key={f.name} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="w-36 font-mono text-xs text-fg-muted truncate">{f.name}</span>
              <span className="w-28 text-xs text-fg-subtle">{f.fieldType}</span>
              {f.config?.targetType && <span className="text-xs text-pink-600">→ {f.config.targetType}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function SchemaReviewPage() {
  const params = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const initial = (useLocation().state as { aiDrafts?: Draft[] } | null)?.aiDrafts
  const [drafts, setDrafts] = useState<Draft[]>(initial ?? [])
  const [saving, setSaving] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)
  const back = () => navigate(`/${params.workspaceId}/schema`)

  // Reached directly (no drafts) → bounce back to Schema.
  useEffect(() => { if (!initial) back() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!initial) return null

  async function saveAll() {
    if (drafts.length === 0) return
    setSaving(true); setPushError(null)
    try {
      const res = await saveSchemaBatch(drafts)
      toast.success(`Saved ${drafts.length} schemas`)
      const outcome = await waitForPush(res.pushId)
      if (outcome.status === 'ok') notifyTypesChanged()
      if (outcome.status === 'ok') { toast.success('Applied (pushed)'); back() }
      else if (outcome.status === 'failed') { setPushError(outcome.output || 'Push failed - check the schemas and try again.'); toast.error('Saved to code, but push failed') }
      else toast.error('Still pushing - check the schema list in a moment')
    } catch (e) {
      toast.error('Save failed', e instanceof Error ? e.message : undefined)
    } finally { setSaving(false) }
  }

  usePageHeader({
    breadcrumbs: [
      { label: 'Schema', href: `/${params.workspaceId}/schema` },
      { label: 'Review set' },
    ],
    actions: (
      <Button size="sm" onClick={saveAll} disabled={saving || drafts.length === 0} isLoading={saving} loadingText="Saving…">Save all ({drafts.length})</Button>
    ),
  }, [saving, drafts.length])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PushOverlay show={saving} label={`Applying ${drafts.length} schema${drafts.length === 1 ? '' : 's'}…`} />
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-3">
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <IconStack className="size-4 text-accent" />
            AI drafted {drafts.length} related schema{drafts.length === 1 ? '' : 's'} - review, remove any you don’t want, then Save all (one push).
          </div>
          {pushError && (
            <Callout variant="danger" title="Push failed - written to code but not applied" actions={<Button size="xs" variant="ghost" onClick={() => setPushError(null)} aria-label="Dismiss" icon={<IconX className="size-3.5" />} />}>
              <pre className="mt-2 max-h-40 overflow-auto rounded bg-surface p-2 text-[11px] whitespace-pre-wrap">{pushError}</pre>
            </Callout>
          )}
          {drafts.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface px-6 py-10 text-center text-sm text-fg-muted">All drafts removed. <Button variant="ghost" size="xs" className="text-accent-fg" onClick={back}>Back to Schema</Button></div>
          ) : (
            drafts.map((d, i) => <DraftCard key={d.name} draft={d} onRemove={() => setDrafts((prev) => prev.filter((_, j) => j !== i))} />)
          )}
        </div>
      </div>
    </div>
  )
}
