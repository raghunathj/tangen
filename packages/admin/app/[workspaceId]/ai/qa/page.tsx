/**
 * File Name: page.tsx
 * Purpose: AI → Q&A — the curated-answer manager. Pairs are embedded into
 *          the knowledge index on save (source_kind 'qa', score-boosted at
 *          retrieval) so a vetted answer beats raw content. Each pair
 *          carries its retrieval audience; disabling keeps the row but
 *          removes its chunks.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Writes gated by manage:settings (route-enforced too).
 *          Embedding runs through the jobs queue — a just-saved pair
 *          answers searches after the embed run completes.
 */
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  usePageHeader, adminFetch, useCan,
  Button, Badge, Input, Select, SelectItem, Text, Callout, InlineCode,
  DataList, useKitQuery, fromAdminRoute, useConfirm, toast,
  Sheet, SheetContent, SheetHeader, SheetBody, SheetTitle, SheetFooter,
  type DataListColumn,
} from '@/kit'

interface QaRow {
  id: string
  question: string
  answer: string
  audience: 'public' | 'internal'
  enabled: boolean
  updatedAt?: string
}

const emptyDraft = { question: '', answer: '', audience: 'public' as 'public' | 'internal', enabled: true }

export default function AiQaPage() {
  const { hasCapability } = useCan()
  const canManage = hasCapability('manage:settings' as never)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<QaRow | null>(null)
  const [search, setSearch] = useState('')
  const [prefill, setPrefill] = useState('')
  const { confirm, confirmDialog } = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()

  // One-click curation from Insights: /ai/qa?question=… opens the editor prefilled
  useEffect(() => {
    const question = searchParams.get('question')
    if (question) {
      setPrefill(question)
      setEditing(null)
      setEditorOpen(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  usePageHeader({ title: 'Q&A', description: 'Curated answers - embedded into the knowledge index and boosted at retrieval' })

  const q = useKitQuery<QaRow>(fromAdminRoute('/admin/knowledge/qa'), { initialPageSize: 25 })

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    try {
      await fn()
      toast.success(okMsg)
      q.refetch()
    } catch (e) {
      toast.error('Failed', (e as Error).message)
    }
  }

  const columns: DataListColumn<QaRow>[] = [
    {
      key: 'question', header: 'Question',
      cell: (r) => (
        <div>
          <p className="font-medium text-fg">{r.question}</p>
          <p className="text-xs text-fg-subtle truncate max-w-[380px]">{r.answer}</p>
        </div>
      ),
    },
    {
      key: 'audience', header: 'Audience',
      cell: (r) => <Badge variant={r.audience === 'internal' ? 'warning' : 'neutral'}>{r.audience}</Badge>,
    },
    {
      key: 'enabled', header: 'Status',
      cell: (r) => <Badge variant={r.enabled ? 'success' : 'neutral'}>{r.enabled ? 'Live' : 'Disabled'}</Badge>,
    },
    {
      key: 'ops', header: '',
      cell: (r) => canManage ? (
        <div className="flex gap-1.5 justify-end">
          <Button size="xs" variant="ghost" onClick={() => act(
            () => adminFetch(`/admin/knowledge/qa/${r.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !r.enabled }) }),
            r.enabled ? 'Disabled - chunks will be removed' : 'Enabled - embedding queued',
          )}>{r.enabled ? 'Disable' : 'Enable'}</Button>
          <Button size="xs" variant="ghost" onClick={() => { setEditing(r); setEditorOpen(true) }}>Edit</Button>
          <Button size="xs" variant="ghost" onClick={async () => {
            if (await confirm({ title: 'Delete this Q&A pair?', description: r.question, variant: 'destructive' })) {
              act(() => adminFetch(`/admin/knowledge/qa/${r.id}`, { method: 'DELETE' }), 'Deleted')
            }
          }}>Delete</Button>
        </div>
      ) : null,
    },
  ]

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-6 space-y-4">
      <Callout variant="info" title="Curated answers outrank raw content">
        Pairs are embedded through the jobs queue and score-boosted at retrieval; <InlineCode>/ask</InlineCode> cites
        them as curated answers. Internal pairs stay invisible to keys without the internal audience grant.
      </Callout>
      <DataList<QaRow>
        columns={columns}
        rows={q.rows}
        rowKey={(r) => r.id}
        page={q.query.page}
        pageSize={q.query.pageSize}
        total={q.total}
        onPageChange={q.setPage}
        search={search}
        searchPlaceholder="Search questions and answers…"
        onSearchChange={(v) => { setSearch(v); q.setSearch(v) }}
        loading={q.loading}
        emptyState={{ title: 'No Q&A pairs yet', description: 'Add the answers your assistant should always get right.' }}
        toolbarRight={canManage
          ? <Button size="sm" onClick={() => { setEditing(null); setEditorOpen(true) }}>Add Q&A</Button>
          : undefined}
      />
      {editorOpen && (
        <QaEditor
          initial={editing}
          prefillQuestion={prefill}
          onClose={() => { setEditorOpen(false); setPrefill('') }}
          onSaved={() => { setEditorOpen(false); setPrefill(''); q.refetch() }}
        />
      )}
      {confirmDialog}
      </div>
    </div>
  )
}

function QaEditor({ initial, prefillQuestion, onClose, onSaved }: {
  initial: QaRow | null
  prefillQuestion?: string
  onClose: () => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState(initial
    ? { question: initial.question, answer: initial.answer, audience: initial.audience, enabled: initial.enabled }
    : { ...emptyDraft, question: prefillQuestion ?? '' })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!draft.question.trim() || !draft.answer.trim()) {
      toast.error('Question and answer are both required')
      return
    }
    setSaving(true)
    try {
      if (initial) {
        await adminFetch(`/admin/knowledge/qa/${initial.id}`, { method: 'PATCH', body: JSON.stringify(draft) })
      } else {
        await adminFetch('/admin/knowledge/qa', { method: 'POST', body: JSON.stringify(draft) })
      }
      toast.success(initial ? 'Saved - re-embedding queued' : 'Added - embedding queued')
      onSaved()
    } catch (e) {
      toast.error('Save failed', (e as Error).message)
      setSaving(false)
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{initial ? 'Edit Q&A pair' : 'New Q&A pair'}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div className="space-y-4">
            <Input
              label="Question"
              value={draft.question}
              onChange={(e) => { const question = e.currentTarget.value; setDraft((d) => ({ ...d, question })) }}
              placeholder="How do refunds work?"
            />
            <div>
              <label className="block text-sm font-medium text-fg mb-1.5">Answer</label>
              <textarea
                value={draft.answer}
                onChange={(e) => { const answer = e.currentTarget.value; setDraft((d) => ({ ...d, answer })) }}
                rows={5}
                placeholder="The exact answer the assistant should give…"
                className="w-full border border-border rounded-md px-2.5 py-1.5 text-sm text-fg bg-surface focus:outline-none focus-visible:border-focus-border resize-y"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-fg mb-1.5">Audience</label>
                <Select value={draft.audience} onValueChange={(v) => setDraft((d) => ({ ...d, audience: v as 'public' | 'internal' }))}>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="internal">Internal only</SelectItem>
                </Select>
              </div>
              <div className="flex items-end pb-1.5">
                <label className="flex items-center gap-2 text-sm text-fg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => { const enabled = e.currentTarget.checked; setDraft((d) => ({ ...d, enabled })) }}
                    className="rounded border-border"
                  />
                  Enabled
                </label>
              </div>
            </div>
            <Text variant="help">Internal pairs answer only callers holding the internal audience grant (and the admin playground).</Text>
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} isLoading={saving}>{initial ? 'Save' : 'Add'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
