

import { useCallback, useEffect, useState } from 'react'
import { Callout } from '@tangen/ui'
import { useParams, useNavigate } from 'react-router-dom'
import { IconKey, IconInfo, IconLock, IconArrowRight, IconClock, IconHistory, IconCalendar, IconCloseCircle } from '@tangen/icons'
import { usePageHeader } from '@/lib/page-header'
import { SettingsSection } from '@/components/settings/settings-section'
import { FactGrid, FactRow } from '@/components/settings/fact-grid'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { adminFetch } from '@/lib/api'
import { useAuthStore } from '@/lib/auth'
import {
  isKeyRevoked, formatKeyStatus,
  PERMISSION_RESOURCES, permissionsToState, buildPermissions, fetchKeyResources,
  type PermissionsFormState } from '@/lib/api-keys'
import type { ApiKey, RouteResourceGroup, FeatureResource } from '@tangen/types'
import { RevokeDialog, humanizeAction } from '@/components/api-keys/primitives'
import { PermissionsEditor, isFullAccessState, type TypeDef } from '@/components/api-keys/permissions-editor'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_VARIANT = { Active: 'success', Expired: 'warning', Revoked: 'error' } as const

type Tab = 'summary' | 'permissions'

const EMPTY_STATE: PermissionsFormState = {
  globalActions: {}, typeOverrides: [], extensionOverrides: {}, customRoutes: {}, resourceOverrides: {},
}

// ── Summary tab ───────────────────────────────────────────────────────────────

function SummaryTab({ apiKey, revoked, onRevoke }: {
  apiKey: ApiKey; revoked: boolean; onRevoke: () => void
}) {
  const status = formatKeyStatus(apiKey)
  const p = apiKey.permissions as any
  const sysPerm = PERMISSION_RESOURCES
    .filter((r) => (p[r.id]?.actions?.length ?? 0) > 0)
    .map((r) => ({
      label: r.label,
      detail: (p[r.id].actions as string[]).map(humanizeAction).join(', '),
    }))
  const customGroups = Object.entries(apiKey.permissions.customRoutes ?? {}).filter(([, a]) => a.length > 0)

  return (
    <div className="space-y-10">
      {/* The key - the section card: what it is in the header row, its facts in two columns. */}
      <SettingsSection
        title="Key"
        description="When it was created, when it was last used and when it stops working."
        summary={(
          <>
            <div className="flex min-w-0 items-center gap-2.5">
              <IconKey className="size-4 text-fg-subtle" aria-hidden />
              <span className="truncate text-sm font-medium text-fg">{apiKey.label}</span>
              <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>
            </div>
            <code className="font-mono text-xs text-fg-muted">{apiKey.keyPrefix}…</code>
          </>
        )}
        flush
      >
        <FactGrid>
          <div>
            <FactRow icon={<IconCalendar />} label="Created"><span className="inline-flex h-8 items-center">{fmt(apiKey.createdAt)}</span></FactRow>
            <FactRow icon={<IconHistory />} label="Last used"><span className="inline-flex h-8 items-center">{fmt(apiKey.lastUsedAt)}</span></FactRow>
          </div>
          <div>
            <FactRow icon={<IconClock />} label="Expires"><span className="inline-flex h-8 items-center">{fmt(apiKey.expiresAt)}</span></FactRow>
            {revoked && <FactRow icon={<IconCloseCircle />} label="Revoked"><span className="inline-flex h-8 items-center text-danger-fg">{fmt(apiKey.revokedAt)}</span></FactRow>}
          </div>
        </FactGrid>
      </SettingsSection>

      {/* What it may do - a read of the grants; the Permissions tab edits them. */}
      <SettingsSection
        title="Access"
        description="What this key may read and write. Edit it under Permissions."
      >
        {(sysPerm.length > 0 || customGroups.length > 0) ? (
          <div className="space-y-4">
            {sysPerm.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-fg-subtle">System permissions</p>
                <div className="flex flex-wrap gap-1.5">
                  {sysPerm.map((r) => (
                    <span key={r.label} className="rounded-md border border-border bg-surface-sunken px-2 py-0.5 text-xs text-fg-muted">
                      {r.label} <span className="font-medium text-accent-fg">· {r.detail}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {customGroups.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-fg-subtle">Custom & resource permissions</p>
                <div className="space-y-1.5">
                  {customGroups.map(([groupId, actions]) => (
                    <div key={groupId} className="flex items-center gap-2">
                      <span className="min-w-[72px] font-mono text-xs text-fg-muted">{groupId}</span>
                      <div className="flex flex-wrap gap-1">
                        {actions.map((a) => (
                          <span key={a} className="rounded border border-accent/30 bg-accent-muted px-2 py-0.5 text-xs text-accent-fg">{a}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-fg-subtle">No permissions granted.</p>
        )}
      </SettingsSection>

      {!revoked && (
        <SettingsSection
          title="Revoke this key"
          description="Once revoked, this key can no longer authenticate API requests. There is no undo."
        >
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-fg-muted">Rotate first: create the replacement, move the client, then revoke.</p>
            <Button variant="destructive" size="sm" onClick={onRevoke}>Revoke key</Button>
          </div>
        </SettingsSection>
      )}
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────

/**
 * The page header owns the key's name as the last crumb, "Open in Playground"
 * as the action, and Summary / Permissions as centred tabs (2026-09-08) - no
 * back link and no second title on the page.
 */
function ApiKeyHeader({ workspaceId, keyId, label, revoked, permCount, tab, onTab }: {
  workspaceId: string; keyId: string; label: string; revoked: boolean; permCount: number; tab: Tab; onTab: (t: Tab) => void
}) {
  const navigate = useNavigate()
  usePageHeader({
    icon: <IconKey />,
    breadcrumbs: [
      { label: 'Settings', href: `/${workspaceId}/settings` },
      { label: 'API Manager', href: `/${workspaceId}/settings/api-keys` },
      { label },
    ],
    actions: !revoked ? (
      <Button size="sm" variant="secondary" onClick={() => navigate(`/${workspaceId}/devspace/playground?key=${keyId}`)}>
        Open in Playground <IconArrowRight className="ml-1.5 size-3.5" aria-hidden />
      </Button>
    ) : undefined,
    tabs: [
      { id: 'summary', label: 'Summary', icon: <IconInfo /> },
      { id: 'permissions', label: 'Permissions', icon: <IconLock />, badge: permCount },
    ],
    activeTab: tab,
    onTabChange: (id) => onTab(id as Tab),
  }, [workspaceId, keyId, label, revoked, permCount, tab])
  return null
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ApiKeyDetailPage() {
  const params = useParams<{ workspaceId: string; id: string }>()
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)

  const [key, setKey] = useState<ApiKey | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('summary')
  const [showRevoke, setShowRevoke] = useState(false)
  const [revokeLoading, setRevokeLoading] = useState(false)

  const [types, setTypes] = useState<TypeDef[]>([])
  const [groups, setGroups] = useState<RouteResourceGroup[]>([])
  const [features, setFeatures] = useState<FeatureResource[]>([])
  const [state, setState] = useState<PermissionsFormState>(EMPTY_STATE)
  const [permSaving, setPermSaving] = useState(false)
  const [permError, setPermError] = useState<string | null>(null)
  const [permSaved, setPermSaved] = useState(false)

  const fetchKey = useCallback(() => {
    if (!accessToken) return
    setLoading(true)
    adminFetch<{ data: ApiKey[] }>('/api-keys')
      .then((r) => {
        const found = r.data.find((k) => k.id === params.id)
        if (!found) throw new Error('Key not found')
        setKey(found)
        setState(permissionsToState(found.permissions))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [accessToken, params.id])

  useEffect(() => { fetchKey() }, [fetchKey])

  useEffect(() => {
    if (!accessToken) return
    adminFetch<{ data: TypeDef[] }>('/types')
      .then((r) => setTypes(r.data))
      .catch(() => {})
    fetchKeyResources()
      .then(({ groups, features }) => { setGroups(groups); setFeatures(features) })
      .catch(() => {})
  }, [accessToken])

  async function handleSavePermissions() {
    if (!key) return
    setPermSaving(true); setPermError(null); setPermSaved(false)
    try {
      const permissions = buildPermissions(state)
      await adminFetch(`/api-keys/${key.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ permissions }),
      })
      setKey((k) => k ? { ...k, permissions } : k)
      setPermSaved(true)
      setTimeout(() => setPermSaved(false), 3000)
    } catch (e: any) {
      setPermError(e.message ?? 'Failed to save permissions')
    } finally {
      setPermSaving(false)
    }
  }

  async function handleRevoke() {
    if (!key) return
    setRevokeLoading(true)
    try {
      await adminFetch(`/api-keys/${key.id}`, { method: 'DELETE' })
      navigate(`/${params.workspaceId}/settings/api-keys`)
    } catch (e: any) {
      setError(e.message)
      setRevokeLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 bg-surface-hover rounded animate-pulse" />
        <div className="h-10 w-full bg-surface-hover rounded animate-pulse" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 w-full bg-surface-hover rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (error || !key) {
    return (
      <div>
        <p className="text-sm text-danger-fg">{error ?? 'Key not found'}</p>
        <button
          onClick={() => navigate(`/${params.workspaceId}/settings/api-keys`)}
          className="mt-2 text-sm text-accent-fg hover:underline"
        >
          Back to API Manager
        </button>
      </div>
    )
  }

  const revoked = isKeyRevoked(key)
  const permCount =
    Object.values(state.globalActions).filter((a) => a.length > 0).length +
    Object.values(state.customRoutes).filter((a) => a.length > 0).length

  return (
    <div>
      <ApiKeyHeader
        workspaceId={params.workspaceId!}
        keyId={key.id}
        label={key.label}
        revoked={revoked}
        permCount={permCount}
        tab={tab}
        onTab={setTab}
      />

      {tab === 'summary' && (
        <SummaryTab apiKey={key} revoked={revoked} onRevoke={() => setShowRevoke(true)} />
      )}

      {tab === 'permissions' && (
        revoked ? (
          <p className="text-sm text-fg-subtle">Permissions cannot be edited on a revoked key.</p>
        ) : (
          <div>
            <PermissionsEditor
              state={state}
              onChange={setState}
              types={types}
              features={features}
              groups={groups}
            />
            {isFullAccessState(state, features, groups) && (
              <Callout variant="warning" title="This key grants every permission" className="mt-3">
                <p>
                  Anyone holding it can read, write, publish, and delete everything in this
                  environment. Share it only with fully trusted systems.
                </p>
              </Callout>
            )}
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3">
              <Button variant="primary" size="sm" isLoading={permSaving} onClick={handleSavePermissions}>
                Save permissions
              </Button>
              {permSaved && <p className="text-xs text-success-fg">Saved.</p>}
              {permError && <p className="text-xs text-danger-fg">{permError}</p>}
            </div>
          </div>
        )
      )}

      {showRevoke && (
        <RevokeDialog
          keyLabel={key.label}
          onConfirm={handleRevoke}
          onCancel={() => setShowRevoke(false)}
          loading={revokeLoading}
        />
      )}
    </div>
  )
}
