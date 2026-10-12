/**
 * File Name: page.tsx (settings/workspace - General)
 * Purpose: What this workspace is and what it holds (2026-09-08): its
 *          identity as facts, and an overview of the content, media, people
 *          and integrations in it. Nothing here edits or deletes the
 *          workspace - its name and slug are code (app/workspaces), and
 *          deleting a workspace is an operator's act, not a settings page.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { Callout } from '@tangen/ui'
import { useParams } from 'react-router-dom'
import {
  IconBuilding, IconCode, IconFileText, IconImage, IconUsers, IconKey, IconWebhook, IconSurvey, IconCodeBox, IconShieldCheck,
} from '@tangen/icons'
import { workspaceFetch, adminFetch } from '@/lib/api'
import { usePageHeader } from '@/lib/page-header'
import { useCapabilities } from '@/lib/use-capabilities'
import { formatBytes } from '@/lib/format-bytes'
import { roleMeta, isProductionRole } from '@/lib/role-meta'
import { Badge } from '@/components/ui/badge'
import { SettingsSection } from '@/components/settings/settings-section'
import { FactGrid, FactRow } from '@/components/settings/fact-grid'
import { Slot } from '@/components/slot-mount'

interface WorkspaceOverview {
  contentTypes: number
  objects: { total: number; published: number; draft: number }
  media: { total: number; sizeBytes: number }
  members: number
  apiKeys: { active: number }
  webhooks: number
}

/** The benchmark's overview card: a grid of icon, label and number, hairlines between the columns. */
function MetricGrid({ items }: { items: Array<{ id: string; icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string }> }) {
  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-border-subtle bg-card sm:grid-cols-2 lg:grid-cols-3 sm:[&>*+*]:border-l sm:[&>*+*]:border-border-subtle" data-testid="metric-grid">
      {items.map((m) => (
        <div key={m.id} className="flex items-center gap-3 px-4 py-3.5">
          <span className="flex size-6 shrink-0 items-center justify-center text-fg-subtle [&_svg]:size-4" aria-hidden>{m.icon}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">{m.label}</span>
          <span className="text-right text-sm tabular-nums text-fg">
            {m.value}
            {m.hint && <span className="ml-1.5 text-xs text-fg-subtle">{m.hint}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function WorkspaceSettingsPage() {
  usePageHeader({ description: 'What this workspace is and what it holds.' })
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params.workspaceId!
  const { flags } = useCapabilities(workspaceId)
  const [workspace, setWorkspace] = useState<{ id: string; name: string; slug: string } | null>(null)
  const [overview, setOverview] = useState<WorkspaceOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    workspaceFetch<{ data: { id: string; name: string; slug: string } }>(`/admin/workspaces/${workspaceId}`)
      .then((r) => setWorkspace(r.data))
      .catch((e) => setError(e.message))
    adminFetch<{ data: WorkspaceOverview }>('/admin/workspace-overview')
      .then((r) => { if (r.data && typeof r.data === 'object' && 'objects' in r.data) setOverview(r.data) })
      .catch(() => {})
  }, [workspaceId])

  const role = flags.deploymentRole ? roleMeta(flags.deploymentRole) : null

  return (
    <div className="space-y-10">
      {error && <Callout variant="danger">{error}</Callout>}

      {/* Extension Kernel K7.2: sections the active extensions contribute, and the generated settings form of each extension with typed settings. */}
      <Slot name="admin.settings.sections@1" />

      <SettingsSection title="Workspace" description="Declared in code (app/workspaces); shown here, changed there." flush>
        <FactGrid>
          <div>
            <FactRow icon={<IconBuilding />} label="Name"><span className="inline-flex h-8 items-center font-medium text-fg">{workspace?.name ?? '…'}</span></FactRow>
            <FactRow icon={<IconCode />} label="Slug"><code className="inline-flex min-h-8 items-center break-all font-mono text-xs text-fg-muted">{workspace?.slug ?? '…'}</code></FactRow>
          </div>
          <div>
            <FactRow icon={<IconCodeBox />} label="Workspace id"><code className="inline-flex min-h-8 items-center break-all font-mono text-xs text-fg-muted">{workspace?.id ?? workspaceId}</code></FactRow>
            <FactRow icon={<IconShieldCheck />} label="Deployment">
              <span className="inline-flex h-8 items-center">{role ? <Badge variant={isProductionRole(flags.deploymentRole) ? 'success' : 'default'}>{role.label}</Badge> : <span className="text-fg-subtle">-</span>}</span>
            </FactRow>
          </div>
        </FactGrid>
      </SettingsSection>

      <SettingsSection title="Overview" description="What this workspace holds right now." plain>
        {overview ? (
          <MetricGrid items={[
            { id: 'types', icon: <IconCodeBox />, label: 'Content types', value: overview.contentTypes },
            { id: 'objects', icon: <IconFileText />, label: 'Objects', value: overview.objects.total, hint: `${overview.objects.published} published` },
            { id: 'media', icon: <IconImage />, label: 'Media', value: overview.media.total, hint: formatBytes(overview.media.sizeBytes) },
            { id: 'members', icon: <IconUsers />, label: 'Members', value: overview.members },
            { id: 'keys', icon: <IconKey />, label: 'API keys', value: overview.apiKeys.active, hint: 'active' },
            { id: 'webhooks', icon: <IconWebhook />, label: 'Webhooks', value: overview.webhooks },
          ]} />
        ) : (
          <div className="h-24 animate-pulse rounded-xl border border-border-subtle bg-surface-hover" aria-busy="true" aria-label="Loading" />
        )}
      </SettingsSection>
    </div>
  )
}
