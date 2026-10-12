/**
 * AI → Agents (MCP) — server state, setup recipe, and the audit trail of
 * every agent write (workspace_activity, actor_type api_key).
 */
import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  usePageHeader, adminFetch, Card, Badge, Text, InlineCode, CodeBlock, Button,
  DataList, useKitQuery, fromAdminRoute, type DataListColumn,
  Menu, MenuTrigger, MenuContent, MenuItem,
} from '@/kit'
import { useDevMode } from '@/lib/use-dev-mode'
import { IdentitySheet, KIND_LABEL } from '@/components/identities/identity-sheet'
import type { Identity } from '@tangen/types'

type IdentityRow = Identity & { keys: Array<{ id: string; label: string; keyPrefix: string; revokedAt: string | null; lastUsedAt: string | null }> }

interface AgentActivityRow {
  id: string
  action: string
  typeName: string | null
  objectTitle: string | null
  actorName: string | null
  createdAt: string
}

export default function AiAgentsPage() {
  const devMode = useDevMode()
  const [mcp, setMcp] = useState<{ installed: boolean; configured: boolean; enabled: boolean; write?: unknown } | null>(null)

  usePageHeader({ title: 'Agents (MCP)', description: 'AI agents operating this workspace through typed tools' })
  const navigate = useNavigate()
  const params = useParams<{ workspaceId: string }>()

  // K8: the identities agents (and services) act as. Absent for members who cannot manage keys.
  const [identities, setIdentities] = useState<IdentityRow[] | null>(null)
  const [editing, setEditing] = useState<{ open: boolean; identity: IdentityRow | null }>({ open: false, identity: null })
  const loadIdentities = useCallback(() => {
    adminFetch<{ data: IdentityRow[] }>('/admin/identities').then((r) => setIdentities(r.data)).catch(() => setIdentities(null))
  }, [])
  useEffect(() => { loadIdentities() }, [loadIdentities])
  async function setStatus(idn: IdentityRow, status: 'active' | 'suspended') {
    await adminFetch(`/admin/identities/${idn.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
    loadIdentities()
  }
  async function remove(idn: IdentityRow) {
    if (!window.confirm(`Delete ${idn.name}? Its keys are revoked; what it wrote stays attributed to it.`)) return
    await adminFetch(`/admin/identities/${idn.id}`, { method: 'DELETE' })
    loadIdentities()
  }
  const identityColumns: DataListColumn<IdentityRow>[] = [
    { key: 'name', header: 'Identity', cell: (r) => (
      <span className="text-sm">
        <span className={r.status === 'suspended' ? 'text-fg-subtle line-through' : 'font-medium text-fg'}>{r.name}</span>
        {r.description && <span className="block text-xs text-fg-subtle">{r.description}</span>}
      </span>
    ) },
    { key: 'kind', header: 'Kind', cell: (r) => <Badge variant="neutral">{KIND_LABEL[r.kind]}</Badge> },
    { key: 'status', header: 'Status', cell: (r) => <Badge variant={r.status === 'active' ? 'success' : 'warning'}>{r.status}</Badge> },
    { key: 'keys', header: 'Credentials', cell: (r) => {
      const live = r.keys.filter((k) => !k.revokedAt).length
      return <span className="text-xs text-fg-muted">{live} active{r.keys.length - live > 0 ? `, ${r.keys.length - live} revoked` : ''}</span>
    } },
    { key: 'caps', header: 'Capabilities', cell: (r) => <span className="text-xs text-fg-muted">{r.capabilities.length ? r.capabilities.join(', ') : '-'}</span> },
    { key: 'actions', header: '', cell: (r) => (
      <Menu>
        <MenuTrigger asChild><Button variant="ghost" size="sm">Actions</Button></MenuTrigger>
        <MenuContent align="end">
          <MenuItem onSelect={() => setEditing({ open: true, identity: r })}>Edit</MenuItem>
          <MenuItem onSelect={() => navigate(`/${params.workspaceId}/settings/api-keys/new?identity=${encodeURIComponent(r.id)}&name=${encodeURIComponent(r.name)}`)}>New key for it</MenuItem>
          <MenuItem onSelect={() => setStatus(r, r.status === 'active' ? 'suspended' : 'active')}>{r.status === 'active' ? 'Suspend' : 'Activate'}</MenuItem>
          <MenuItem onSelect={() => remove(r)}>Delete</MenuItem>
        </MenuContent>
      </Menu>
    ) },
  ]

  useEffect(() => {
    adminFetch<{ data: { mcp: typeof mcp } }>('/admin/ai/surfaces')
      .then((r) => setMcp(r.data.mcp as never)).catch(() => {})
  }, [])

  const q = useKitQuery(fromAdminRoute<AgentActivityRow>('/admin/ai/agent-activity'), { initialPageSize: 15 })

  const columns: DataListColumn<AgentActivityRow>[] = [
    { key: 'action', header: 'Action', cell: (r) => <Badge variant={r.action === 'published' ? 'success' : 'neutral'}>{r.action}</Badge> },
    { key: 'what', header: 'What', cell: (r) => <span className="text-sm text-fg">{r.objectTitle ?? '-'} <span className="text-xs text-fg-subtle">({r.typeName})</span></span> },
    { key: 'who', header: 'Who', cell: (r) => <span className="text-xs text-fg-muted">{r.actorName ?? 'api key'}</span> },
    { key: 'when', header: 'When', cell: (r) => <span className="text-xs text-fg-muted tabular-nums">{new Date(r.createdAt).toLocaleString()}</span> },
  ]

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-6 space-y-6">
      {devMode && (<>
      <Card title="Server state" description="POST /api/v1/mcp · API-key auth · config in app/config/mcp.ts">
        {mcp ? (mcp.installed ? (
          <div className="rounded-md bg-surface-sunken border border-border">
            <div className="flex items-center justify-between px-3 py-2 text-xs">
              <span className="font-mono text-fg-muted">this deployment</span>
              <span className={mcp.enabled ? 'text-success font-medium' : 'text-fg-subtle'}>
                {mcp.enabled ? `on · write: ${String(mcp.write)}` : 'off'}
              </span>
            </div>
          </div>
        ) : <Text>Package not installed - <InlineCode>bun add @tangen/mcp</InlineCode></Text>) : <Text variant="help">Loading…</Text>}
      </Card>

      <Card
        title="Develop with your agent"
        description="Build this project by describing it to your editor's AI - Claude Code, ChatGPT Codex, Gemini CLI, Cursor, or Windsurf. The agent writes the schema/route files and pushes; nothing is generated inside the admin."
      >
        <div className="space-y-4">
          <div>
            <Text variant="help">1 · Make your editor Tangen-aware (writes agent rules + the build playbook + MCP config)</Text>
            <CodeBlock code={`tangen ai init            # Claude + Codex + Gemini by default
# add Cursor/Windsurf:   tangen ai init --tools cursor,windsurf`} />
          </div>
          <div>
            <Text variant="help">2 · Connect the agent to this running project over MCP</Text>
            <CodeBlock code={`claude mcp add tangen -- tangen mcp --key <api-key>
# key needs the grants you want the agent to have; writes are drafts by default`} />
          </div>
          <div>
            <Text variant="help">3 · Hand it a brief - it follows skills/tangen-ai-project/SKILL.md end to end</Text>
            <CodeBlock code={`Build a <feature> on this Tangen project.
Follow skills/tangen-ai-project/SKILL.md.

Domain:
- <type A>: <fields…>, relates to <type B>
- <type B>: <fields…>

Then run: tangen check -> tangen push --plan -> tangen push,
and seed 2-3 sample items over MCP.`} />
          </div>
        </div>
      </Card>
      </>)}

      {identities && (
        <Card
          title="Identities"
          description="Who an agent or a service is. An identity holds its own grants and capabilities; the keys minted for it are credentials, and everything done with them is attributed to the identity."
          flush
          action={<Button size="sm" onClick={() => setEditing({ open: true, identity: null })}>New identity</Button>}
        >
          <DataList
            columns={identityColumns}
            rows={identities}
            rowKey={(r) => r.id}
            emptyState={{ title: 'No identities yet', description: 'Create one for each agent or service, then mint its key from here. A key minted without an identity keeps acting as itself.' }}
          />
        </Card>
      )}
      <IdentitySheet open={editing.open} identity={editing.identity} onOpenChange={(open) => setEditing((e) => ({ ...e, open }))} onSaved={() => loadIdentities()} />

      <Card title="Agent activity" description="Every MCP write is attributable - creates/updates by the tools, publishes via the platform pipeline" flush>
        <DataList
          columns={columns}
          rows={q.rows}
          rowKey={(r) => r.id}
          loading={q.loading}
          page={q.query.page}
          pageSize={q.query.pageSize}
          total={q.total}
          onPageChange={q.setPage}
          emptyState={{ title: 'No agent writes yet', description: 'MCP tool writes will appear here.' }}
        />
      </Card>
      </div>
    </div>
  )
}
