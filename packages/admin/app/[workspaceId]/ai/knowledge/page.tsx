/**
 * AI → Knowledge — index status, the retrieval playground, and Reindex.
 * Config (what indexes) stays in code; this page operates on top of it.
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { usePageHeader, adminFetch, Card, Text, InlineCode, Callout } from '@/kit'
import { useDevMode } from '@/lib/use-dev-mode'
import { KnowledgeOps } from './knowledge-ops'

interface KnowledgeStatus {
  enabled: boolean
  provider: string | null
  model: string | null
  indexed: boolean
  counts: Record<string, number>
}

export default function AiKnowledgePage() {
  const devMode = useDevMode()
  const [status, setStatus] = useState<KnowledgeStatus | null>(null)

  usePageHeader({ title: 'Knowledge', description: 'The vector index over your content - status, playground, reindex' })

  useEffect(() => {
    adminFetch<{ data: KnowledgeStatus }>('/admin/knowledge/status')
      .then((r) => setStatus(r.data)).catch(() => setStatus(null))
  }, [])

  const total = status ? Object.values(status.counts).reduce((a, b) => a + b, 0) : 0

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-6 space-y-6">
      {status && !status.enabled && (
        <Callout variant="info" title="Knowledge is off for this environment">
          Enable it in <InlineCode>app/config/knowledge.ts</InlineCode> (wired via workspace.config.ts) - see docs/knowledge.md.
        </Callout>
      )}
      {status?.enabled && (
        <>
          <Card title="Index" description={status.provider ? `${status.provider}${status.model ? `/${status.model}` : ''}` : 'no embedding provider configured'}>
            {status.indexed ? (
              <div className="grid grid-cols-5 gap-3">
                {(['object', 'table', 'asset', 'file', 'qa'] as const).map((k) => (
                  <div key={k} className="rounded-md bg-surface-sunken border border-border px-3 py-2 text-center">
                    <p className="text-lg font-semibold text-fg tabular-nums">{status.counts[k] ?? 0}</p>
                    <p className="text-xs text-fg-subtle">{k} chunks</p>
                  </div>
                ))}
              </div>
            ) : (
              <Text>{devMode ? <>No index yet - run <InlineCode>tangen knowledge index</InlineCode> or hit Reindex below.</> : 'No index yet - hit Reindex below.'}</Text>
            )}
            <Text variant="help" className="mt-3">Total: {total} chunks. Reindex runs through the jobs queue - progress in Settings → Jobs & Cron → Runs.</Text>
          </Card>
          <Card title="Playground">
            <KnowledgeOps />
          </Card>
        </>
      )}
      </div>
    </div>
  )
}
