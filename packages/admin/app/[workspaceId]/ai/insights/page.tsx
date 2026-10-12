/**
 * File Name: page.tsx
 * Purpose: AI → Insights — the retrieval-gap backlog. Every search/ask/MCP
 *          retrieval logs what was asked and how well the index answered;
 *          this page surfaces unanswered and low-confidence queries so an
 *          admin can close the gap with one click ("Create Q&A" opens the
 *          Q&A editor prefilled with the logged question).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Query text is end-user input — the log truncates to
 *          500 chars, prunes at 90 days, and knowledge.insights:false turns
 *          logging off entirely (documented in docs/knowledge.md).
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  usePageHeader, adminFetch,
  Button, Badge, Callout, InlineCode, TabBar, DataList, toast,
  type DataListColumn,
} from '@/kit'

interface InsightRow {
  query: string
  asks: number
  bestScore: number | null
  answered: boolean
  sources: string[]
  lastSeen: string
}

type Mode = 'unanswered' | 'low' | 'top'

export default function AiInsightsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('unanswered')
  const [rows, setRows] = useState<InsightRow[]>([])
  const [loading, setLoading] = useState(true)

  usePageHeader({ title: 'Insights', description: 'What users asked - and where the knowledge base fell short' })

  const reload = useCallback(() => {
    setLoading(true)
    adminFetch<{ data: InsightRow[] }>('/admin/knowledge/insights', undefined, { mode })
      .then((r) => setRows(r.data))
      .catch((e) => toast.error('Could not load insights', (e as Error).message))
      .finally(() => setLoading(false))
  }, [mode])
  useEffect(reload, [reload])

  const columns: DataListColumn<InsightRow>[] = [
    { key: 'query', header: 'Query', cell: (r) => <span className="font-medium text-fg">{r.query}</span> },
    { key: 'asks', header: 'Asked', cell: (r) => <span className="tabular-nums">{r.asks}×</span> },
    {
      key: 'score', header: 'Best score',
      cell: (r) => r.bestScore == null
        ? <Badge variant="error">no hits</Badge>
        : <span className={`tabular-nums ${r.bestScore < 0.5 ? 'text-warning-fg' : 'text-fg-muted'}`}>{Math.round(r.bestScore * 1000) / 1000}</span>,
    },
    { key: 'sources', header: 'Via', cell: (r) => <span className="text-xs text-fg-subtle">{r.sources.join(', ')}</span> },
    {
      key: 'ops', header: '',
      cell: (r) => (
        <Button size="xs" variant="secondary" onClick={() =>
          navigate(`/${workspaceId}/ai/qa?question=${encodeURIComponent(r.query)}`)
        }>Create Q&A</Button>
      ),
    },
  ]

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-6 space-y-4">
      <Callout variant="info" title="The curation loop">
        Unanswered queries need content or a curated Q&A pair; low-confidence ones answered weakly.
        Logging truncates queries, prunes at 90 days, and turns off with <InlineCode>{`knowledge: { insights: false }`}</InlineCode>.
      </Callout>
      <TabBar
        variant="pills"
        active={mode}
        onChange={(m) => setMode(m as Mode)}
        tabs={[
          { id: 'unanswered', label: 'Unanswered' },
          { id: 'low', label: 'Low confidence' },
          { id: 'top', label: 'Top queries' },
        ]}
      />
      <DataList<InsightRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.query}
        loading={loading}
        emptyState={{
          title: mode === 'unanswered' ? 'No unanswered queries' : mode === 'low' ? 'No low-confidence queries' : 'No queries logged yet',
          description: 'Retrievals through /knowledge/search, /knowledge/ask, and MCP land here.',
        }}
      />
      </div>
    </div>
  )
}
