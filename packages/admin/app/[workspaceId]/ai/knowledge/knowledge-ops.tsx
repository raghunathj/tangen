/**
 * File Name: knowledge-ops.tsx
 * Purpose: The knowledge retrieval playground - admin test-search with the
 *          audience selector (all/public/internal), a streaming Ask tester
 *          (tokens render live over SSE with citations), plus the queued
 *          Reindex trigger. Rendered by AI → Knowledge.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useRef, useState } from 'react'
import { adminFetch, adminFetchStream, Button, toast } from '@/kit'
import { readSSEStream } from '@/lib/sse-client'

interface SearchHit { sourceGroup: string; title: string | null; snippet: string; audience?: string; score: number }
interface AskCitation { ref: number; title: string | null; sourceGroup: string; snippet: string; score: number }

export function KnowledgeOps() {
  const [query, setQuery] = useState('')
  const [audience, setAudience] = useState('all')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  // Ask tester state - answer streams in token by token
  const [answer, setAnswer] = useState<string | null>(null)
  const [citations, setCitations] = useState<AskCitation[]>([])
  const [askNote, setAskNote] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const askAbort = useRef<AbortController | null>(null)

  const search = async () => {
    if (!query.trim()) return
    setBusy(true)
    setAnswer(null); setCitations([]); setAskNote(null)
    try {
      const r = await adminFetch<{ data: SearchHit[] }>(
        '/admin/knowledge/search', { method: 'POST', body: JSON.stringify({ query, audience }) },
      )
      setHits(r.data)
    } catch (e) {
      toast.error('Search failed', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const ask = async () => {
    if (!query.trim() || asking) return
    setAsking(true)
    setHits(null); setAnswer(''); setCitations([]); setAskNote(null)
    const controller = new AbortController()
    askAbort.current = controller
    try {
      const res = await adminFetchStream('/admin/knowledge/ask', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({ query, audience }),
      })
      for await (const ev of readSSEStream(res)) {
        if (ev.event === 'meta') {
          setCitations((ev.data?.citations ?? []) as AskCitation[])
          if (ev.data?.note) setAskNote(String(ev.data.note))
        } else if (ev.event === 'delta') {
          const text = String(ev.data?.text ?? '')
          setAnswer(a => (a ?? '') + text)
        } else if (ev.event === 'error') {
          throw new Error(String(ev.data?.message ?? 'Ask failed'))
        }
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        toast.error('Ask failed', (e as Error).message)
        setAnswer(null)
      }
    } finally {
      setAsking(false)
      askAbort.current = null
    }
  }

  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void search() }}
          placeholder="Test a semantic search or ask a question…"
          className="flex-1 border border-border rounded-md px-2.5 py-1.5 text-sm text-fg bg-surface focus:outline-none focus-visible:border-focus-border"
        />
        <select
          value={audience}
          onChange={(e) => setAudience(e.currentTarget.value)}
          className="border border-border rounded-md px-2 py-1.5 text-sm text-fg bg-surface focus:outline-none focus-visible:border-focus-border"
          title="Retrieval audience - public keys only ever see 'public'"
        >
          <option value="all">All audiences</option>
          <option value="public">Public</option>
          <option value="internal">Internal</option>
        </select>
        <button onClick={() => void search()} disabled={busy || asking}
          className="px-3 py-1.5 text-sm font-medium rounded-md border border-border-strong text-fg bg-surface hover:bg-surface-sunken disabled:opacity-50">
          {busy ? 'Searching…' : 'Search'}
        </button>
        {asking ? (
          <Button size="sm" onClick={() => askAbort.current?.abort()}>Stop</Button>
        ) : (
          <Button size="sm" onClick={() => void ask()} disabled={busy || !query.trim()} title="Grounded answer streamed from the workspace AI provider">
            Ask
          </Button>
        )}
        <button
          onClick={async () => {
            try {
              await adminFetch('/admin/knowledge/reindex', { method: 'POST' })
              toast.success('Reindex queued', 'Progress shows in Settings → Jobs & Cron → Runs')
            } catch (e) {
              toast.error('Reindex failed', (e as Error).message)
            }
          }}
          className="px-3 py-1.5 text-sm font-medium rounded-md border border-border-strong text-fg bg-surface hover:bg-surface-sunken">
          Reindex
        </button>
      </div>

      {/* Streaming Ask result */}
      {answer !== null && (
        <div className="rounded-md border border-border bg-surface-sunken/50 p-2.5 space-y-1.5">
          <p className="text-sm text-fg whitespace-pre-wrap">
            {answer}
            {asking && <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle rounded-sm bg-accent animate-pulse" />}
          </p>
          {askNote && !asking && <p className="text-xs text-fg-subtle">{askNote}</p>}
          {citations.length > 0 && (
            <div className="text-xs text-fg-subtle space-y-0.5 pt-1 border-t border-border">
              {citations.map((c) => (
                <p key={c.ref} className="truncate">[{c.ref}] {c.title ?? c.sourceGroup} <span className="text-fg-subtle/70">{Math.round(c.score * 1000) / 1000}</span></p>
              ))}
            </div>
          )}
        </div>
      )}

      {hits && (
        <div className="divide-y divide-border text-xs">
          {hits.length === 0 && <p className="py-1.5 text-fg-subtle">No matches.</p>}
          {hits.map((h, i) => (
            <div key={i} className="py-1.5">
              <span className="font-medium text-fg">{h.title ?? h.sourceGroup}</span>
              <span className="text-fg-subtle ml-2">{h.score}</span>
              {h.audience === 'internal' && <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-warning">internal</span>}
              <p className="text-fg-muted mt-0.5">{h.snippet}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
