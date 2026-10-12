/**
 * AI → Overview — one page answering "what is AI doing in this workspace":
 * MCP state, Knowledge state, provider availability. Read-only; config
 * lives in code, editors live on the sibling pages.
 */
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { usePageHeader, adminFetch, Card, Badge, Text, InlineCode } from '@/kit'

/** One surface as the deployment resolves it: the package, the config, the resolved state. */
interface SurfaceState { installed: boolean; configured: boolean; enabled: boolean; write?: unknown; provider?: string | null; model?: string | null }
interface Surfaces {
  mcp: SurfaceState
  knowledge: SurfaceState
}

export default function AiOverviewPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [surfaces, setSurfaces] = useState<Surfaces | null>(null)
  const [providers, setProviders] = useState<Array<{ name: string; available: boolean }> | null>(null)

  usePageHeader({ title: 'AI', description: 'Everything AI in this workspace - agents, knowledge, providers' })

  useEffect(() => {
    adminFetch<{ data: Surfaces }>('/admin/ai/surfaces').then((r) => setSurfaces(r.data)).catch(() => {})
    adminFetch<{ data: { providers: Array<{ name: string; available: boolean }> } }>('/admin/ai/providers')
      .then((r) => setProviders(r.data.providers)).catch(() => {})
  }, [])

  const base = `/${workspaceId}/ai`
  // One deployment, one resolved state: the row names this deployment, not an environment.
  const stateRow = (s: SurfaceState, detail: (s: SurfaceState) => string) => (
    <div className="rounded-md bg-surface-sunken border border-border">
      <div className="flex items-center justify-between px-3 py-2 text-xs">
        <span className="font-mono text-fg-muted">this deployment</span>
        <span className={s.enabled ? 'text-success font-medium' : 'text-fg-subtle'}>{s.enabled ? detail(s) : (s.configured ? 'off' : 'not configured')}</span>
      </div>
    </div>
  )

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-6 max-w-3xl space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <Card
          title="Agents (MCP)"
          description="Typed tools for AI agents"
          action={<Link to={`${base}/agents`} className="text-xs text-accent-fg hover:underline">Open</Link>}
        >
          {surfaces
            ? (surfaces.mcp.installed
              ? stateRow(surfaces.mcp, (s) => `on · write: ${String(s.write)}`)
              : <Text variant="help">Package not installed - <InlineCode>bun add @tangen/mcp</InlineCode></Text>)
            : <Text variant="help">Loading…</Text>}
        </Card>
        <Card
          title="Knowledge (RAG)"
          description="Semantic search & ask over your content"
          action={<Link to={`${base}/knowledge`} className="text-xs text-accent-fg hover:underline">Open</Link>}
        >
          {surfaces
            ? (surfaces.knowledge.installed
              ? stateRow(surfaces.knowledge, (s) => `on · ${s.provider ?? 'no provider!'}${s.model ? `/${s.model}` : ''}`)
              : <Text variant="help">Package not installed - <InlineCode>bun add @tangen/knowledge</InlineCode></Text>)
            : <Text variant="help">Loading…</Text>}
        </Card>
      </div>
      <Card
        title="Content AI providers"
        description="Generation for the editor assistant and /knowledge/ask"
        action={<Link to={`${base}/providers`} className="text-xs text-accent-fg hover:underline">Configure</Link>}
      >
        {providers
          ? (
            <div className="flex flex-wrap gap-2">
              {providers.map((p) => (
                <Badge key={p.name} variant={p.available ? 'success' : 'neutral'}>{p.name}{p.available ? '' : ' (no key)'}</Badge>
              ))}
            </div>
          )
          : <Text variant="help">Loading…</Text>}
      </Card>
      <Text variant="help">
        Enablement is code-first: <InlineCode>app/config/mcp.ts</InlineCode> · <InlineCode>app/config/knowledge.ts</InlineCode> · <InlineCode>app/config/ai.ts</InlineCode>.
        This section grows - app and extension pages can register into it with <InlineCode>{`nav: { section: 'ai' }`}</InlineCode>.
      </Text>
      </div>
    </div>
  )
}
