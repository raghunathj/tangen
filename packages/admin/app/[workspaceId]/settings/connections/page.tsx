/**
 * File Name: page.tsx (settings/connections)
 * Purpose: Settings → Connections (Extension Kernel K6.2,
 *          tasks/plan-extension-kernel.md). The workspace's connections to
 *          outside services: which connectors the active extensions offer,
 *          the connections configured for each, their last health, and the
 *          ways to add one - a key or a username and password typed here,
 *          or an OAuth2 flow that leaves for the provider and comes back to
 *          this page with `?connected=` or `?error=`. Credentials are typed
 *          once and never shown again; the API keeps them sealed.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { IconPlus, IconTrash, IconRefresh, IconLink } from '@tangen/icons'
import { Callout, Checkbox, Select, SelectItem, toast } from '@tangen/ui'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { SettingsSection } from '@/components/settings/settings-section'
import { adminFetch } from '@/lib/api'
import { usePageHeaderActions } from '@/lib/page-header'

// ── Types (the API's public shapes; never material) ───────────────────────────

type ConnectorAuth =
  | { kind: 'oauth2'; authorizeUrl: string; tokenUrl: string; scopes?: string[]; pkce?: boolean }
  | { kind: 'apiKey'; fields: string[] }
  | { kind: 'basic' }

interface Connector {
  id: string
  /** The outside service; several auth models may share it. */
  provider?: string
  extensionId: string
  label: string
  description?: string
  auth: ConnectorAuth
  hosts: string[]
  /** Where the operator's OAuth client comes from. Never the client itself. */
  oauthClient?: 'deployment' | 'operator' | null
  /** What a connection may be authorized for, and who already requires it. */
  capabilities?: Array<{ key: string; qualified: string; label: string; description?: string; requiredBy: string[] }>
  /** The pack's own mark, inline, so a list of providers is readable at a glance. */
  brand?: { icon?: string; color?: string }
  /** E2: the active extensions that hold a grant for this provider, from their grants. */
  usedBy?: string[]
}

/** A connector pack this workspace has, enabled or not (E2). */
interface Pack {
  extensionId: string
  name: string
  version?: string | null
  enabled: boolean
  active: boolean
  providers: string[]
  brand?: { icon?: string; color?: string }
}

/**
 * The provider's mark, or its initial on the pack's colour when it ships none.
 * An `<img>`, deliberately: a browser runs no script in one, whatever a pack
 * put in its data URI.
 */
function ProviderMark({ connector, size = 24 }: { connector?: Connector; size?: number }) {
  const label = connector?.label ?? '?'
  const color = connector?.brand?.color ?? 'var(--tg-color-fg-subtle)'
  if (connector?.brand?.icon) {
    return <img src={connector.brand.icon} alt="" width={size} height={size} className="shrink-0 rounded-[5px]" />
  }
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-[5px] text-[11px] font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: color }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  )
}

interface ProviderConflict { provider: string; extensionIds: string[] }

/** B1: the server's own derivation. This page renders it and never recomputes it. */
interface ConnectionVerdict {
  state: 'pending' | 'connected' | 'needs_capability' | 'degraded' | 'revoked' | 'unreadable' | 'dormant'
  /** E2: which heading it belongs under, decided with the state, not here. */
  group: 'connected' | 'attention' | 'dormant' | 'conflicted'
  reason: string
  fix?: { action: string; hint: string; extensionIds?: string[] }
  authorizationKnown: boolean
}

interface Connection {
  id: string
  connectorId: string
  extensionId: string
  offered: boolean
  /** What the operator consented to, as the row recorded it. */
  capabilities?: string[]
  state: ConnectionVerdict
  label: string
  kind: ConnectorAuth['kind']
  status: 'active' | 'pending' | 'revoked' | 'unreadable'
  health: { ok: boolean; checkedAt: string; message?: string } | null
  createdAt: string
}

const OAUTH_ERRORS: Record<string, string> = {
  access_denied: 'The provider reported that access was denied.',
  missing_code: 'The provider came back without an authorization code.',
  connector_missing: 'The extension offering this connector is no longer active.',
  exchange_failed: 'The provider refused to exchange the authorization code.',
}

function fieldLabel(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}

function credentialFields(auth: ConnectorAuth): Array<{ name: string; secret: boolean }> {
  if (auth.kind === 'apiKey') return auth.fields.map((name) => ({ name, secret: true }))
  if (auth.kind === 'basic') return [{ name: 'username', secret: false }, { name: 'password', secret: true }]
  return [{ name: 'clientId', secret: false }, { name: 'clientSecret', secret: true }]
}

// ── Add dialog ────────────────────────────────────────────────────────────────

function AddDialog({ connectors, workspaceId, onClose, onAdded, reconnect }: {
  connectors: Connector[]; workspaceId: string; onClose: () => void; onAdded: () => void
  /** Re-consenting an existing connection: same row, same id, more capabilities. */
  reconnect?: Connection
}) {
  const [connectorId, setConnectorId] = useState(reconnect?.connectorId ?? connectors[0]?.id ?? '')
  const connector = connectors.find((c) => c.id === connectorId)
  const [label, setLabel] = useState(reconnect?.label ?? '')
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isOAuth = connector?.auth.kind === 'oauth2'
  // The deployment may supply the operator's OAuth client
  // (CONNECTOR_<PROVIDER>_CLIENT_ID), in which case this form does not ask for
  // it - a secret should not be pasted into a browser when it is already on
  // the server.
  const clientFromDeployment = isOAuth && connector?.oauthClient === 'deployment'
  const fields = (connector ? credentialFields(connector.auth) : []).filter((f) => !(clientFromDeployment && (f.name === 'clientId' || f.name === 'clientSecret')))
  // Capability consent (C2): what this connection may do. Anything an active
  // integration requires is ticked and locked, with the reason on screen.
  const capabilities = connector?.capabilities ?? []
  const required = capabilities.filter((c) => c.requiredBy.length > 0).map((c) => c.key)
  // A re-consent starts from what the connection already has, so adding one
  // capability cannot quietly drop the others.
  const [chosen, setChosen] = useState<string[]>(reconnect?.capabilities ?? [])
  const selected = [...new Set([...chosen, ...required])]

  const submit = async () => {
    if (!connector) return
    setSaving(true); setError(null)
    try {
      if (isOAuth) {
        const res = await adminFetch<{ id: string; authorizeUrl: string }>(`/admin/workspaces/${workspaceId}/connections/oauth/start`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...(reconnect ? { connectionId: reconnect.id } : { connectorId, label }),
            ...(clientFromDeployment ? {} : { clientId: values.clientId ?? '', clientSecret: values.clientSecret ?? '' }),
            ...(capabilities.length > 0 ? { capabilities: selected } : {}),
          }),
        })
        window.location.assign(res.authorizeUrl)
        return
      }
      await adminFetch(`/admin/workspaces/${workspaceId}/connections`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ connectorId, label, credentials: values }),
      })
      toast.success('Connection added', label)
      onAdded()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{reconnect ? `Reconnect ${reconnect.label}` : 'Add connection'}</DialogTitle>
          <DialogDescription className="mt-1">
            {reconnect
              ? 'The same connection is re-authorized, so everything pointed at it keeps working.'
              : isOAuth
                ? 'You will be sent to the provider to approve access, then brought back here.'
                : 'Credentials are stored sealed and never shown again.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!reconnect && (
            <div>
              <label className="mb-1 block text-xs font-medium text-fg" htmlFor="connection-connector">Service</label>
              <Select id="connection-connector" value={connectorId} onValueChange={(v) => { setConnectorId(v); setValues({}) }}>
                {connectors.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </Select>
              {connector?.description && <p className="mt-1 text-xs text-fg-subtle">{connector.description}</p>}
            </div>
          )}
          {!reconnect && (
          <div>
            <label className="mb-1 block text-xs font-medium text-fg" htmlFor="connection-label">Label</label>
            <Input id="connection-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={connector ? `${connector.label} (production)` : ''} />
            <p className="mt-1 text-xs text-fg-subtle">Tells connections of the same service apart, for example by account or region.</p>
          </div>
          )}
          {fields.map((f) => (
            <div key={f.name}>
              <label className="mb-1 block text-xs font-medium text-fg" htmlFor={`connection-${f.name}`}>{fieldLabel(f.name)}</label>
              <Input
                id={`connection-${f.name}`} type={f.secret ? 'password' : 'text'} autoComplete="off"
                value={values[f.name] ?? ''} onChange={(e) => { const next = e.target.value; setValues((v) => ({ ...v, [f.name]: next })) }}
              />
            </div>
          ))}
          {capabilities.length > 0 && (
            <div>
              <p className="mb-1 block text-xs font-medium text-fg">What this connection may do</p>
              <div className="space-y-1.5 rounded-lg border border-border-subtle bg-surface-raised p-3">
                {capabilities.map((c) => {
                  const locked = c.requiredBy.length > 0
                  return (
                    <label key={c.key} className="flex cursor-pointer items-start gap-2 text-xs" htmlFor={`cap-${c.key}`}>
                      <Checkbox
                        id={`cap-${c.key}`} className="mt-0.5" checked={selected.includes(c.key)} disabled={locked}
                        onCheckedChange={(on) => { setChosen((v) => (on === true ? [...v, c.key] : v.filter((k) => k !== c.key))) }}
                      />
                      <span className="min-w-0">
                        <span className="font-medium text-fg">{c.label}</span>
                        {c.description && <span className="block text-fg-subtle">{c.description}</span>}
                        {locked && <span className="block text-fg-muted">{`Required by ${c.requiredBy.join(', ')}, so it cannot be turned off here.`}</span>}
                      </span>
                    </label>
                  )
                })}
              </div>
              <p className="mt-1 text-xs text-fg-subtle">You will approve exactly these at the provider.</p>
            </div>
          )}
          {isOAuth && (
            <p className="text-xs text-fg-subtle">
              {clientFromDeployment
                ? 'This deployment already supplies the OAuth client for this service, so there is nothing to paste here.'
                : 'The client ID and secret come from the OAuth app you registered with the provider.'}
              {' Its redirect URL must be this API\'s '}
              <code className="mx-1 rounded bg-surface-hover px-1">/api/v1/connections/oauth/callback</code>.
            </p>
          )}
          {error && <Callout variant="danger" title="Could not add the connection">{error}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" isLoading={saving} disabled={!connector || (!reconnect && !label.trim())} onClick={() => { void submit() }}>
            {isOAuth ? `Continue to ${connector?.label ?? 'provider'}` : 'Add connection'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConnectionsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [connections, setConnections] = useState<Connection[]>([])
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [conflicts, setConflicts] = useState<ProviderConflict[]>([])
  const [packs, setPacks] = useState<Pack[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [reconnecting, setReconnecting] = useState<Connection | null>(null)
  const [deleting, setDeleting] = useState<Connection | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await adminFetch<{ data: Connection[]; connectors: Connector[]; conflicts?: ProviderConflict[]; packs?: Pack[] }>(`/admin/workspaces/${workspaceId}/connections`)
      setConnections(res.data); setConnectors(res.connectors); setConflicts(res.conflicts ?? []); setPacks(res.packs ?? [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])
  useEffect(() => { void load() }, [load])

  // Back from the provider: say what happened, once, and clean the URL.
  useEffect(() => {
    const connected = searchParams.get('connected')
    const err = searchParams.get('error')
    if (!connected && !err) return
    if (connected) toast.success('Connected', 'The provider approved access.')
    if (err) toast.error('Could not connect', OAUTH_ERRORS[err] ?? err, searchParams.get('detail') ? { description: searchParams.get('detail') ?? undefined } : undefined)
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  usePageHeaderActions(
    <Button icon={<IconPlus className="size-[15px]" />} size="xs" disabled={connectors.length === 0} onClick={() => setAdding(true)}>
      Add connection
    </Button>,
    [connectors.length],
  )

  const connectorById = useMemo(() => new Map(connectors.map((c) => [c.id, c])), [connectors])

  const test = async (c: Connection) => {
    setBusyId(c.id)
    try {
      // The route answers with the whole row, so the DERIVED state moves with
      // the health: patching only `health` left a row that had just passed
      // still reading "not working" until a reload (the user, 2026-09-19).
      const row = await adminFetch<Connection>(`/admin/workspaces/${workspaceId}/connections/${c.id}/test`, { method: 'POST' })
      setConnections((rows) => rows.map((r) => (r.id === c.id ? row : r)))
      if (row.health?.ok) toast.success('Connection works', c.label)
      else toast.warning('Connection did not work', row.health?.message ?? c.label)
    } catch (e) {
      toast.error('Could not test the connection', (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const revoke = async (c: Connection) => {
    setBusyId(c.id)
    try {
      const row = await adminFetch<Connection>(`/admin/workspaces/${workspaceId}/connections/${c.id}/revoke`, { method: 'POST' })
      setConnections((rows) => rows.map((r) => (r.id === c.id ? row : r)))
      toast.success('Connection revoked', `${c.label} can no longer be used. Remove it, or add a new one.`)
    } catch (e) {
      toast.error('Could not revoke the connection', (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const remove = async () => {
    if (!deleting) return
    setBusyId(deleting.id)
    try {
      await adminFetch(`/admin/workspaces/${workspaceId}/connections/${deleting.id}`, { method: 'DELETE' })
      setConnections((rows) => rows.filter((r) => r.id !== deleting.id))
      toast.success('Connection removed', deleting.label)
      setDeleting(null)
    } catch (e) {
      toast.error('Could not remove the connection', (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  // The server decides what a connection IS and why (plan-connectors B1); this
  // maps that one answer onto a badge. No status is re-read here.
  const STATE_BADGE: Record<ConnectionVerdict['state'], { variant: 'success' | 'warning' | 'error' | 'neutral'; label: string }> = {
    connected: { variant: 'success', label: 'Working' },
    pending: { variant: 'warning', label: 'Connecting' },
    needs_capability: { variant: 'warning', label: 'Needs re-consent' },
    degraded: { variant: 'error', label: 'Not working' },
    revoked: { variant: 'neutral', label: 'Revoked' },
    unreadable: { variant: 'error', label: 'Unreadable' },
    dormant: { variant: 'warning', label: 'Unavailable' },
  }
  /**
   * E2: the catalogue's headings, in the order an operator should read them -
   * what needs them first, then what is fine, then what is about a PACK
   * rather than a connection. Which group a row is in comes from the server's
   * own derivation (`state.group`); this only names the headings.
   */
  const GROUPS: Array<{ group: Connection['state']['group']; title: string; description: string }> = [
    { group: 'conflicted', title: 'Conflicted', description: 'Two packs claim the same provider, so these cannot be used until one is disabled.' },
    { group: 'attention', title: 'Needs attention', description: 'Each of these is something you can fix: a consent to re-give, a credential to replace, an authorization to finish.' },
    { group: 'connected', title: 'Connected', description: 'Working, and usable by any extension granted the provider.' },
    { group: 'dormant', title: 'Unavailable', description: 'The pack that offered these is not active here. Nothing was deleted.' },
  ]
  const grouped = GROUPS
    .map((g) => ({ ...g, rows: connections.filter((c) => c.state.group === g.group) }))
    .filter((g) => g.rows.length > 0)

  /** Connectors nobody has connected yet: what an operator can add. */
  const unconnected = connectors.filter((c) => !connections.some((x) => x.connectorId === c.id && x.extensionId === c.extensionId))

  const statusBadge = (c: Connection) => {
    const badge = STATE_BADGE[c.state.state]
    if (c.state.state === 'connected' && !c.health) return <Badge variant="neutral">Not tested</Badge>
    return <Badge variant={badge.variant}>{badge.label}</Badge>
  }

  return (
    <div className="space-y-8">
      {error && <Callout variant="danger" title="Could not load connections">{error}</Callout>}
      {conflicts.map((c) => (
        <Callout key={c.provider} variant="danger" title={`Two extensions offer ${c.provider}`}>
          {`${c.extensionIds.join(' and ')} each offer it, so none of its connections can be used and no new one can be added. Disable one of them.`}
        </Callout>
      ))}

      <SettingsSection
        title="Connections"
        description="Outside services this workspace is connected to. Extensions use them through their connectors and never see the credentials."
        actions={<Button variant="ghost" size="xs" icon={<IconRefresh className="size-[14px]" />} onClick={() => { void load() }}>Refresh</Button>}
        flush
      >
        {loading ? (
          <p className="px-4 py-6 text-sm text-fg-subtle">Loading connections</p>
        ) : connections.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <IconLink className="mx-auto size-6 text-fg-subtle" />
            <p className="mt-2 text-sm font-medium text-fg">No connections yet</p>
            <p className="mt-1 text-sm text-fg-subtle">
              {connectors.length === 0
                ? 'No active extension offers a connector. Install one that does, and it appears here.'
                : 'Add one to let an extension reach a service on your behalf.'}
            </p>
          </div>
        ) : (
          /* E2: grouped by the state the SERVER derived, in the order an
             operator should read them. A heading appears only when it has
             rows, so a healthy workspace is one list, not four empty ones. */
          <div className="divide-y divide-border">
            {grouped.map((group) => (
              <div key={group.group}>
                <div className="flex items-baseline gap-2 bg-surface-sunken/40 px-4 py-2">
                  <h3 className="text-ui-xs font-semibold uppercase tracking-wider text-fg-subtle">{group.title}</h3>
                  <span className="text-ui-xs text-fg-faint">{group.rows.length}</span>
                  <p className="ml-auto hidden max-w-[52ch] truncate text-ui-xs text-fg-subtle sm:block" title={group.description}>{group.description}</p>
                </div>
                <ul className="divide-y divide-border-subtle">
            {group.rows.map((c) => {
              const connector = connectorById.get(c.connectorId)
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <ProviderMark connector={connector} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-fg">{c.label}</span>
                      {statusBadge(c)}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-fg-subtle">
                      {connector?.label ?? c.connectorId} via {c.extensionId || 'an extension'}
                      {c.health?.checkedAt ? ` · checked ${new Date(c.health.checkedAt).toLocaleString()}` : ''}
                      {c.health && !c.health.ok && c.health.message ? ` · ${c.health.message}` : ''}
                    </p>
                    {c.state.state !== 'connected' && (
                      <p className={`mt-1 text-xs ${c.state.state === 'degraded' || c.state.state === 'unreadable' ? 'text-danger-fg' : 'text-fg-muted'}`}>
                        {c.state.reason}{c.state.fix ? ` ${c.state.fix.hint}` : ''}
                      </p>
                    )}
                    {c.state.state === 'connected' && !c.state.authorizationKnown && c.state.fix && (
                      <p className="mt-1 text-xs text-fg-muted">{c.state.fix.hint}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="secondary" size="xs" isLoading={busyId === c.id} disabled={c.state.state === 'dormant' || c.state.state === 'pending' || c.state.state === 'revoked' || c.state.state === 'unreadable'} onClick={() => { void test(c) }}>
                      Test
                    </Button>
                    {/* Re-consent: the same row, with more capabilities. */}
                    {connector?.auth.kind === 'oauth2' && (
                      <Button variant="secondary" size="xs" onClick={() => setReconnecting(c)}>Reconnect</Button>
                    )}
                    {/* Revoking only means something while material still exists. */}
                    {c.state.state !== 'revoked' && c.state.state !== 'pending' && (
                      <Button variant="ghost" size="xs" disabled={busyId === c.id} onClick={() => { void revoke(c) }}>
                        Revoke
                      </Button>
                    )}
                    <Button variant="ghost" size="xs" aria-label={`Remove ${c.label}`} icon={<IconTrash className="size-[14px]" />} onClick={() => setDeleting(c)} />
                  </div>
                </li>
              )
            })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      {unconnected.length > 0 && (
        <SettingsSection
          title="Available"
          description="Offered here and not connected yet. Adding one is what makes it usable; nothing reaches a provider until you do."
          flush
        >
          <ul className="divide-y divide-border-subtle">
            {unconnected.map((c) => (
              <li key={`${c.extensionId}/${c.id}`} className="flex items-center gap-3 px-4 py-3">
                <ProviderMark connector={c} />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-fg">{c.label}</span>
                  <p className="mt-0.5 text-xs text-fg-subtle">
                    {c.description ? `${c.description} · ` : ''}
                    {c.auth.kind === 'oauth2' ? 'OAuth2' : c.auth.kind === 'apiKey' ? 'API key' : 'Username and password'}
                    {' · '}offered by {c.extensionId}
                    {c.capabilities?.length ? ` · ${c.capabilities.length} ${c.capabilities.length === 1 ? 'capability' : 'capabilities'}` : ''}
                  </p>
                  {/* E2: who would use it, derived from what extensions were
                      GRANTED - so an operator knows before connecting, and
                      knows what a revoke would break afterwards. */}
                  {c.usedBy && c.usedBy.length > 0 && (
                    <p className="mt-0.5 text-xs text-fg-muted">Wanted by {c.usedBy.join(', ')}</p>
                  )}
                </div>
                <Button size="xs" variant="secondary" onClick={() => setAdding(true)}>Connect</Button>
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}

      {packs.length > 0 && (
        <SettingsSection
          title="Connector packs"
          description="Where connections come from. A pack is an extension whose whole job is offering them, so it lives here rather than among the extensions."
          flush
        >
          <ul className="divide-y divide-border-subtle">
            {packs.map((p) => {
              const conflicted = conflicts.some((c) => c.extensionIds.includes(p.extensionId))
              return (
                <li key={p.extensionId} className="flex items-center gap-3 px-4 py-3">
                  <ProviderMark connector={{ label: p.name, brand: p.brand } as Connector} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-fg">{p.name}</span>
                      {conflicted
                        ? <Badge variant="error">Conflicted</Badge>
                        : p.active ? <Badge variant="success">Active</Badge>
                          : p.enabled ? <Badge variant="warning">Enabled, not loaded</Badge>
                            : <Badge variant="neutral">Switched off</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {p.providers.length > 0 ? `Offers ${p.providers.join(', ')}` : 'Offers no provider'}
                      {p.version ? ` · ${p.version}` : ''}
                      {` · ${connections.filter((x) => x.extensionId === p.extensionId).length} connection(s)`}
                    </p>
                    {/* A pack that is off is why its connections are dormant,
                        so say what switching it on would restore. */}
                    {!p.enabled && (
                      <p className="mt-1 text-xs text-fg-muted">
                        Switched off, so it offers nothing here. Enabling it makes its connections usable again, with no re-consent.
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </SettingsSection>
      )}

      {adding && workspaceId && (
        <AddDialog connectors={connectors} workspaceId={workspaceId} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); void load() }} />
      )}
      {reconnecting && workspaceId && (
        <AddDialog
          connectors={connectors} workspaceId={workspaceId} reconnect={reconnecting}
          onClose={() => setReconnecting(null)} onAdded={() => { setReconnecting(null); void load() }}
        />
      )}
      {deleting && (
        <Dialog open onOpenChange={(v) => { if (!v) setDeleting(null) }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Remove connection?</DialogTitle>
              <DialogDescription className="mt-1">
                <strong>{deleting.label}</strong> will stop working for every extension that uses it. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" size="sm" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="destructive" size="sm" isLoading={busyId === deleting.id} onClick={() => { void remove() }}>Remove</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
