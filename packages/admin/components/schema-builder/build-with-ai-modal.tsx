/**
 * File Name: build-with-ai-modal.tsx
 * Purpose: SI-2 — the schema builder's inline "Build with AI". Describe a content type,
 *   component, or global (or a whole data model) → the AI drafts it. Thin briefs get
 *   clarifying questions first; a single draft loads into the builder, a set opens the
 *   review page. Self-contained (calls /admin/schema/generate directly — no universal router).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, Textarea } from '@/kit'
import { IconSparkles } from '@tangen/icons'
import { toast } from '@/lib/toast'
import { generateSchema, combineClarify, type SchemaAiKind } from '@/lib/schema-ai'

const KIND_HINT: Record<SchemaAiKind, string> = {
  type: 'A blog post with a title, rich-text body, hero image and author',
  component: 'A hero banner with a heading, subheading, image and CTA link',
  global: 'Site settings with a name, logo and social links',
}

export function BuildWithAiModal({ open, onOpenChange, kind }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  kind: SchemaAiKind
}) {
  const params = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState<'single' | 'set'>('single')
  const [busy, setBusy] = useState(false)
  const [clarify, setClarify] = useState<{ questions: string[]; brief: string } | null>(null)
  const base = `/${params.workspaceId}/schema`

  function reset() { setPrompt(''); setMode('single'); setClarify(null); setBusy(false) }

  async function run(skipClarify = false) {
    const text = prompt.trim()
    if (!text || busy) return
    // Answering clarify → fold the answer into the original brief.
    const sendPrompt = clarify ? combineClarify(clarify.brief, clarify.questions, text) : text
    setBusy(true)
    try {
      const res = await generateSchema({ prompt: sendPrompt, mode, kind, skipClarify: skipClarify || !!clarify })
      if (res.clarify) { setClarify(res.clarify); setPrompt(''); return }
      if (res.drafts) {
        onOpenChange(false); reset()
        navigate(`${base}/review`, { state: { aiDrafts: res.drafts } })
      } else if (res.draft) {
        onOpenChange(false); reset()
        const page = kind === 'component' ? 'components/new' : kind === 'global' ? 'globals/new' : 'new'
        navigate(`${base}/${page}`, { state: { aiDraft: res.draft } })
      } else {
        toast.error('Couldn’t draft that - try describing it differently.')
      }
    } catch (e) {
      toast.error('Generation failed', e instanceof Error ? e.message : undefined)
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><IconSparkles className="size-4 text-accent" /> Build with AI</DialogTitle>
          <DialogDescription>Describe what you want - you’ll review and save before anything is written.</DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4 space-y-3">
          {clarify ? (
            <div className="space-y-2">
              <p className="text-sm text-fg">A couple of questions first - or say “just build it”:</p>
              <ul className="space-y-1 text-sm text-fg-muted">
                {clarify.questions.map((q, i) => <li key={i} className="flex gap-2"><span className="text-accent">•</span>{q}</li>)}
              </ul>
            </div>
          ) : (
            kind === 'type' && (
              <div className="flex w-fit gap-1">
                <Button size="sm" variant={mode === 'single' ? 'primary' : 'secondary'} onClick={() => setMode('single')}>One type</Button>
                <Button size="sm" variant={mode === 'set' ? 'primary' : 'secondary'} onClick={() => setMode('set')}>Whole model</Button>
              </div>
            )
          )}
          <Textarea value={prompt} autoFocus rows={3}
            onChange={(e) => setPrompt(e.currentTarget.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run() }}
            placeholder={clarify ? 'Answer, or say “just build it”…' : mode === 'set' ? 'Describe the data model, e.g. “a blog with posts, authors and categories”' : KIND_HINT[kind]} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          {clarify && <Button variant="ghost" disabled={busy} onClick={() => run(true)}>Just build it</Button>}
          <Button disabled={!prompt.trim() || busy} isLoading={busy} loadingText="Thinking…" onClick={() => run()}>{clarify ? 'Continue' : 'Build'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
