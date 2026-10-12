/**
 * File Name: page.tsx (settings/members/:id)
 * Purpose: The member access page (tasks/plan-permissions-tree.md P4) - one
 *   page per member, replacing the edit Sheet. Identity, role, status, remove,
 *   and the shared PermissionTree as the aggregated summary: the member's role
 *   grants are checked and LOCKED ("from role"); the editable rows are the
 *   per-member grants layered on top (additive). Owner/admin short-circuit to a
 *   "Full access" note. Feeds GET /members/:id/access and PUT /members/:id/grants.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AdminPage, Button, Badge, Callout, Skeleton, Label, Select, SelectItem } from '@/kit'
import { adminFetch, workspaceFetch } from '@/lib/api'
import { useAuthStore } from '@/lib/auth'
import { useCapabilities } from '@/lib/use-capabilities'
import { useCan } from '@/lib/use-can'
import { toast } from '@/lib/toast'
import { PermissionTree } from '@/components/permissions/permission-tree'
import { buildManagementSection, buildExtensionSection, type CatalogEntry } from '@/lib/permission-tree'
import type { CapabilityOption } from '@/components/members/roles-tab'

interface AccessDto {
  memberId: string
  role: string
  status: string
  roleCapabilities: 'all' | string[]
  roleExtensions: 'all' | string[]
  grant: { capabilities: string[]; extensions: string[]; grantedBy: string | null; reason: string | null; expiresAt: string | null; expired: boolean } | null
}
interface MemberRow { id: string; name: string | null; email: string; role: string; status?: string }

export default function MemberPage() {
  const { workspaceId, id } = useParams<{ workspaceId: string; id: string }>()
  const navigate = useNavigate()
  const authMember = useAuthStore((s) => s.member)
  const isOwner = authMember?.role === 'owner'
  const self = authMember?.memberId === id
  const { hasCapability } = useCan()
  const canManage = isOwner || hasCapability('manage:members')
  const { flags } = useCapabilities(workspaceId)
  const deploymentRole = flags?.deploymentRole as string | undefined

  const [member, setMember] = useState<MemberRow | null>(null)
  const [access, setAccess] = useState<AccessDto | null>(null)
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [extOptions, setExtOptions] = useState<{ id: string; label: string }[]>([])
  const [granted, setGranted] = useState<Set<string>>(new Set())
  const [roleOptions, setRoleOptions] = useState<string[]>(['owner', 'admin', 'editor', 'viewer'])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const base = `/${workspaceId}/settings/members`

  const load = useCallback(async () => {
    const [list, a, caps, exts] = await Promise.all([
      adminFetch<{ data: MemberRow[] }>('/members'),
      adminFetch<{ data: AccessDto }>(`/members/${id}/access`),
      adminFetch<{ data: CapabilityOption[] }>('/admin/capabilities').catch(() => ({ data: [] as CapabilityOption[] })),
      adminFetch<{ data: { id: string; name: string }[] }>('/extensions').catch(() => ({ data: [] as { id: string; name: string }[] })),
    ])
    const found = (Array.isArray(list.data) ? list.data : []).find((m) => m.id === id) ?? null
    setMember(found)
    setAccess(a.data)
    setCatalog((Array.isArray(caps.data) ? caps.data : []).map((o) => ({
      id: o.id, label: o.label, source: (o.source ?? 'core') as 'core' | 'extension', extensionId: o.extensionId,
      resource: (o as { resource?: string }).resource, action: (o as { action?: string }).action, sensitive: (o as { sensitive?: boolean }).sensitive,
    })))
    setExtOptions((Array.isArray(exts.data) ? exts.data : []).map((x) => ({ id: x.id, label: x.name })))
    // The granted set: role capabilities (locked) + grant extras, plus page access.
    const g = new Set<string>()
    if (a.data.roleCapabilities !== 'all') a.data.roleCapabilities.forEach((c) => g.add(c))
    if (a.data.roleExtensions !== 'all') a.data.roleExtensions.forEach((e) => g.add(`ext:${e}`))
    a.data.grant?.capabilities.forEach((c) => g.add(c))
    a.data.grant?.extensions.forEach((e) => g.add(`ext:${e}`))
    setGranted(g)
    adminFetch<{ data: { slug: string }[] }>('/roles').then((r) => {
      const custom = (Array.isArray(r.data) ? r.data : []).map((x) => x.slug)
      setRoleOptions([...new Set(['owner', 'admin', 'editor', 'viewer', ...custom])])
    }).catch(() => {})
  }, [id])

  useEffect(() => { setLoading(true); setError(null); load().catch((e) => setError(e.message)).finally(() => setLoading(false)) }, [load])

  const sections = useMemo(() => [
    buildManagementSection(catalog),
    ...(extOptions.length ? [buildExtensionSection(extOptions, catalog)] : []),
  ], [catalog, extOptions])

  const locked = useMemo(() => {
    const l = new Set<string>()
    if (access && access.roleCapabilities !== 'all') access.roleCapabilities.forEach((c) => l.add(c))
    if (access && access.roleExtensions !== 'all') access.roleExtensions.forEach((e) => l.add(`ext:${e}`))
    // If the role opens all extensions, lock every extension's page-access leaf.
    if (access?.roleExtensions === 'all') extOptions.forEach((e) => l.add(`ext:${e.id}`))
    return l
  }, [access, extOptions])

  const onToggle = useCallback((ids: string[], on: boolean) => {
    setGranted((prev) => { const s = new Set(prev); ids.forEach((x) => on ? s.add(x) : s.delete(x)); return s })
    setSaved(false)
  }, [])

  async function saveGrants() {
    setBusy(true); setError(null)
    try {
      const extras = [...granted].filter((x) => !locked.has(x))
      const capabilities = extras.filter((x) => !x.startsWith('ext:'))
      const extensions = extras.filter((x) => x.startsWith('ext:')).map((x) => x.slice(4))
      await adminFetch(`/members/${id}/grants`, { method: 'PUT', body: JSON.stringify({ capabilities, extensions }) })
      setSaved(true); toast.success('Access saved')
      await load()
    } catch (e: any) { setError(e.message ?? 'Failed to save access') } finally { setBusy(false) }
  }
  async function changeRole(role: string) {
    setBusy(true); setError(null)
    try { await workspaceFetch(`/members/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) }); await load() }
    catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  async function toggleStatus() {
    const next = member?.status === 'suspended' ? 'active' : 'suspended'
    setBusy(true); setError(null)
    try { await workspaceFetch(`/members/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: next }) }); await load() }
    catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  async function remove() {
    if (!confirm(`Remove ${member?.name ?? member?.email}? They lose access immediately.`)) return
    setBusy(true)
    try { await workspaceFetch(`/members/${id}`, { method: 'DELETE' }); toast.success('Member removed'); navigate(base) }
    catch (e: any) { setError(e.message); setBusy(false) }
  }

  const crumbs = [{ label: 'Settings', href: `/${workspaceId}/settings` }, { label: 'Members', href: base }, { label: member?.name ?? member?.email ?? 'Member' }]
  const suspended = member?.status === 'suspended'
  const extras = [...granted].filter((x) => !locked.has(x)).length
  const fullAccess = access?.roleCapabilities === 'all'

  // Header actions live in the breadcrumb bar (top right).
  const headerActions = !loading && member ? (
    <>
      <Button variant="secondary" size="sm" onClick={() => navigate(`${base}/roles/new`)}>Create role from this</Button>
      {canManage && !self && !fullAccess && <Button size="sm" onClick={saveGrants} isLoading={busy}>Update access</Button>}
    </>
  ) : null

  return (
    <AdminPage breadcrumbs={crumbs} title={member?.name ?? member?.email ?? 'Member'} description={member?.email} actions={headerActions}>
      <div className="max-w-3xl space-y-6 pb-16">
        {error && <Callout variant="danger">{error}</Callout>}

        {loading ? (
          <div className="space-y-3"><Skeleton className="h-9 w-64" /><Skeleton className="h-40 w-full" /></div>
        ) : (
          <>
            {/* Role + status, in a card to set it apart from the tree below. */}
            <section className="grid gap-5 rounded-xl border border-border bg-surface-raised p-5 shadow-xs sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={member?.role ?? 'editor'} disabled={!isOwner || self || busy}
                  onValueChange={(v) => changeRole(v)} aria-label="Workspace role">
                  {roleOptions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </Select>
                <p className="text-ui-xs text-fg-subtle">The member's role in this workspace{deploymentRole ? ` (${deploymentRole} deployment)` : ''}.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <div className="flex h-(--tg-control-h) items-center"><Badge variant={suspended ? 'error' : 'success'}>{suspended ? 'Suspended' : 'Active'}</Badge></div>
                <p className="text-ui-xs text-fg-subtle">{suspended ? 'Signed out and blocked from signing in.' : 'Can sign in and work normally.'}</p>
              </div>
            </section>

            {/* Aggregated access: role rows locked, grants editable. */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-sm font-semibold text-fg">Access</h2>
                {!fullAccess && <Badge variant={extras > 0 ? 'default' : 'neutral'}>{extras > 0 ? `+${extras} ${extras === 1 ? 'permission' : 'permissions'}` : 'No extra access'}</Badge>}
                {access?.grant?.expired && <Badge variant="warning">grant expired</Badge>}
              </div>
              <p className="text-ui-xs text-fg-subtle">On top of the <span className="font-medium text-fg">{member?.role}</span> role — its grants are locked; toggle the extras below.</p>

              {fullAccess ? (
                <Callout variant="info" title="Full access">This member's role grants every capability, so there is nothing extra to add.</Callout>
              ) : (
                <PermissionTree sections={sections} granted={granted} locked={locked} onToggle={canManage && !self ? onToggle : undefined} markGrants />
              )}
            </section>

            {/* Danger zone: suspend (block sign-in, keep the account) or remove. */}
            {isOwner && !self && (
              <section className="space-y-4 rounded-xl border border-danger/40 bg-danger-muted/20 p-5">
                <h2 className="text-sm font-semibold text-danger-fg">Danger zone</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="secondary" size="sm" isLoading={busy} onClick={toggleStatus}>{suspended ? 'Reactivate member' : 'Suspend member'}</Button>
                  <span className="min-w-0 flex-1 text-ui-xs text-fg-subtle">{suspended ? 'Reactivate to let them sign in again.' : 'Suspend blocks sign-in and ends their sessions without deleting the account or its history.'}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 border-t border-danger/25 pt-4">
                  <span className="min-w-0 flex-1 text-ui-xs text-fg-subtle">Permanently remove this member and their access. This cannot be undone.</span>
                  <Button variant="destructive" size="sm" onClick={remove} isLoading={busy}>Remove member</Button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </AdminPage>
  )
}
