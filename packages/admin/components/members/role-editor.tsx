/**
 * File Name: role-editor.tsx
 * Purpose: One role, the benchmark's way (2026-09-08): the role's name as the
 *          last crumb, Save as the header action, and three centred tabs -
 *          Permissions (an all-access toggle, a checkbox table of admin
 *          capabilities, and a checkbox tree per content resource with
 *          object-level overrides), Assignment (who holds it) and Settings
 *          (name, slug, description, delete).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The permission model is the one API keys use
 *          (`PermissionsFormState`); this is a different reading of it, not a
 *          second model. Built-in and code-defined roles open read-only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  IconLock, IconUsers, IconSettings, IconSparkles, IconKey, IconWebhook, IconClock, IconCodeBox, IconHistory,
  IconShieldCheck, IconFileText, IconCode,
} from '@tangen/icons'
import { Callout, DataList, type DataListColumn } from '@tangen/ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { adminFetch } from '@/lib/api'
import { usePageHeader } from '@/lib/page-header'
import { useCanStore } from '@/lib/use-can'
import { toast } from '@/lib/toast'
import {
  permissionsToState, buildPermissions, fetchKeyResources,
  type PermissionsFormState,
} from '@/lib/api-keys'
import type { Capability, RouteResourceGroup, FeatureResource } from '@tangen/types'
import { ActionPill } from '@/components/api-keys/primitives'
import { PermissionsEditor, type TypeDef } from '@/components/api-keys/permissions-editor'
import { PermissionTree } from '@/components/permissions/permission-tree'
import { buildManagementSection, buildExtensionSection, type CatalogEntry } from '@/lib/permission-tree'
import { SettingsSection } from '@/components/settings/settings-section'
import { FactGrid, FactRow } from '@/components/settings/fact-grid'
import { ADMIN_EXTENSION } from 'virtual:tangen/app-ui-registry'
import {
  CORE_CAPABILITY_OPTIONS, isRoleLocked, roleSourceBadge,
  type RoleDto, type CapabilityOption, type RoleHolder,
} from './roles-tab'

const EMPTY_STATE: PermissionsFormState = {
  globalActions: {}, typeOverrides: [], extensionOverrides: {}, customRoutes: {}, resourceOverrides: {},
}

type Tab = 'permissions' | 'assignment' | 'settings'

export function RoleEditor({ existing, workspaceId, members }: {
  existing: RoleDto | null
  workspaceId: string
  members: RoleHolder[]
}) {
  const navigate = useNavigate()
  const readOnly = !!existing && isRoleLocked(existing)
  const [tab, setTab] = useState<Tab>('permissions')
  const [slug, setSlug] = useState(existing?.slug ?? '')
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [state, setState] = useState<PermissionsFormState>(existing ? permissionsToState(existing.permissions as never) : EMPTY_STATE)
  const [capabilities, setCapabilities] = useState<Capability[]>(existing?.permissions?.capabilities ?? [])
  const [capOptions, setCapOptions] = useState<CapabilityOption[]>(CORE_CAPABILITY_OPTIONS)
  const [extAccess, setExtAccess] = useState<'all' | string[]>(existing?.permissions?.extensions ?? 'all')
  const [extOptions, setExtOptions] = useState<{ id: string; label: string }[]>([])
  const [localeAccess, setLocaleAccess] = useState<'all' | string[]>((existing?.permissions as any)?.locales ?? 'all')
  const [localeOptions, setLocaleOptions] = useState<{ code: string; label: string; isDefault?: boolean }[]>([])
  const [types, setTypes] = useState<TypeDef[]>([])
  const [groups, setGroups] = useState<RouteResourceGroup[]>([])
  const [features, setFeatures] = useState<FeatureResource[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [holderSearch, setHolderSearch] = useState('')

  useEffect(() => {
    adminFetch<{ data: TypeDef[] }>('/types').then((r) => setTypes(r.data ?? [])).catch(() => {})
    adminFetch<{ data: CapabilityOption[] }>('/admin/capabilities')
      .then((r) => { if (Array.isArray(r.data) && r.data.length) setCapOptions(r.data) })
      .catch(() => {})
    fetchKeyResources().then(({ groups, features }) => {
      setGroups(groups); setFeatures(features)
    }).catch(() => {})
    adminFetch<{ data: { id: string; name: string }[] }>('/extensions')
      .then((r) => {
        const devPages = (ADMIN_EXTENSION.routes ?? [])
          .map((rt: any) => ({ seg: rt.path.match(/^extensions\/([^/]+)/)?.[1], label: rt.nav?.label }))
          .filter((x: any) => x.seg && x.label)
          .map((x: any) => ({ id: x.seg as string, label: x.label as string }))
        const apps = (Array.isArray(r.data) ? r.data : []).map((a) => ({ id: a.id, label: a.name }))
        const seen = new Set<string>()
        setExtOptions([...apps, ...devPages].filter((o) => !seen.has(o.id) && seen.add(o.id)))
      })
      .catch(() => {})
    adminFetch<{ data: { enabled?: boolean; defaultLocale?: string; locales?: { code: string; label: string }[] } }>('/admin/i18n/locales')
      .then((r) => {
        const d: any = r.data ?? r
        const list = (Array.isArray(d?.locales) ? d.locales : []).map((l: any) => ({ ...l, isDefault: l.code === d.defaultLocale }))
        setLocaleOptions(d?.enabled === false ? [] : list)
      })
      .catch(() => {})
  }, [])

  const holders = useMemo(() => existing ? members.filter((m) => m.role === existing.slug) : [], [members, existing])

  // ── The Management + Extensions permission tree (shared with the member page) ─
  const catalog = useMemo<CatalogEntry[]>(() => capOptions.map((o) => ({
    id: o.id, label: o.label, source: (o.source ?? 'core') as 'core' | 'extension',
    extensionId: o.extensionId, resource: (o as { resource?: string }).resource,
    action: (o as { action?: string }).action, sensitive: (o as { sensitive?: boolean }).sensitive,
  })), [capOptions])
  const permSections = useMemo(() => [
    buildManagementSection(catalog),
    ...(extOptions.length ? [buildExtensionSection(extOptions, catalog)] : []),
  ], [catalog, extOptions])
  const permGranted = useMemo(() => {
    const s = new Set<string>(capabilities as string[])
    if (extAccess === 'all') extOptions.forEach((e) => s.add(`ext:${e.id}`))
    else extAccess.forEach((id) => s.add(`ext:${id}`))
    return s
  }, [capabilities, extAccess, extOptions])
  const onPermToggle = useCallback((ids: string[], on: boolean) => {
    const capIds = ids.filter((id) => !id.startsWith('ext:'))
    const extIds = ids.filter((id) => id.startsWith('ext:')).map((id) => id.slice(4))
    if (capIds.length) setCapabilities((prev) => {
      const set = new Set(prev as string[])
      capIds.forEach((id) => on ? set.add(id) : set.delete(id))
      return [...set] as Capability[]
    })
    if (extIds.length) setExtAccess((prev) => {
      const list = prev === 'all' ? extOptions.map((e) => e.id) : [...prev]
      const set = new Set(list)
      extIds.forEach((id) => on ? set.add(id) : set.delete(id))
      const next = [...set]
      return next.length === extOptions.length ? 'all' : next
    })
  }, [extOptions])

  async function save() {
    if (!name.trim()) { setError('Name is required'); setTab('settings'); return }
    if (!existing && !slug.trim()) { setError('Slug is required'); setTab('settings'); return }
    setSaving(true); setError(null)
    try {
      const permissions = {
        ...buildPermissions(state),
        capabilities,
        ...(extAccess === 'all' ? {} : { extensions: extAccess }),
        ...(localeAccess === 'all' ? {} : { locales: localeAccess }),
      }
      if (existing) {
        await adminFetch(`/roles/${existing.slug}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim(), description: description.trim() || null, permissions }) })
      } else {
        await adminFetch('/roles', { method: 'POST', body: JSON.stringify({ slug: slug.trim(), name: name.trim(), description: description.trim() || null, permissions }) })
      }
      useCanStore.getState().invalidate()
      toast.success(existing ? 'Role saved' : 'Role created')
      navigate(`/${workspaceId}/settings/members?tab=roles`)
    } catch (e: any) {
      setError(e.message ?? 'Failed to save role')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!existing) return
    setDeleting(true)
    try {
      await adminFetch(`/roles/${existing.slug}`, { method: 'DELETE' })
      useCanStore.getState().invalidate()
      toast.success('Role deleted')
      navigate(`/${workspaceId}/settings/members?tab=roles`)
    } catch (e: any) {
      setError(e.message ?? 'Could not delete the role')
      setDeleting(false)
    }
  }

  const title = existing ? existing.name : 'New role'
  usePageHeader({
    icon: <IconLock />,
    breadcrumbs: [
      { label: 'Settings', href: `/${workspaceId}/settings` },
      { label: 'Members', href: `/${workspaceId}/settings/members` },
      { label: 'Roles', href: `/${workspaceId}/settings/members?tab=roles` },
      { label: title },
    ],
    actions: readOnly ? undefined : (
      <Button size="sm" variant="primary" isLoading={saving} onClick={save}>{existing ? 'Save role' : 'Create role'}</Button>
    ),
    tabs: [
      { id: 'permissions', label: 'Permissions', icon: <IconLock /> },
      { id: 'assignment', label: 'Assignment', icon: <IconUsers />, badge: holders.length },
      { id: 'settings', label: 'Settings', icon: <IconSettings /> },
    ],
    activeTab: tab,
    onTabChange: (id) => setTab(id as Tab),
  }, [workspaceId, title, readOnly, saving, tab, holders.length, name, slug, description, state, capabilities, extAccess, localeAccess])

  const holderColumns: DataListColumn<RoleHolder>[] = [
    { key: 'name', header: 'Name', cell: (m) => <span className="font-medium text-fg">{m.name || '-'}</span> },
    { key: 'email', header: 'Email', cell: (m) => <span className="text-fg-muted">{m.email}</span> },
    { key: 'role', header: 'Role', cell: () => <Badge variant={existing?.permissions?.admin ? 'success' : 'default'}>{existing?.name ?? '-'}</Badge>, clipAt: false },
    { key: 'status', header: 'Status', cell: (m) => <Badge variant={m.status === 'suspended' ? 'error' : 'success'}>{m.status === 'suspended' ? 'Suspended' : 'Active'}</Badge>, clipAt: false },
    { key: 'lastLogin', header: 'Last login', cell: (m) => <span className="text-xs text-fg-subtle">{m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}</span> },
  ]

  return (
    <div className="space-y-10">
      {readOnly && (
        <Callout variant="info" title={existing?.builtIn ? 'Built-in role' : 'Defined in code'}>
          {existing?.builtIn
            ? 'Its grants are fixed by the platform and cannot be edited.'
            : <>This role lives in your roles file (<code className="font-mono">app/permissions/roles.ts</code>); edit its <code className="font-mono">defineRole()</code> and restart to change it.</>}
        </Callout>
      )}
      {error && <Callout variant="danger">{error}</Callout>}

      {tab === 'permissions' && (
        <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-10 border-0 p-0">
          {/* Content and API permissions - the one editor keys use, read as a role. */}
          <PermissionsEditor
            state={state}
            onChange={setState}
            types={types}
            features={features}
            groups={groups}
            subject="role"
            hiddenResources={['toolbar']}
          />

          {/* Management capabilities + per-extension access, one tree. "Open
              pages" is each extension's page access; read/write/delete are its
              declared resources. Fields an extension adds to content follow
              content permissions instead. */}
          <SettingsSection title="Access" description="Management surfaces and what this role may do in each extension." flush>
            <div className="p-4">
              <PermissionTree sections={permSections} granted={permGranted} onToggle={readOnly ? undefined : onPermToggle} />
            </div>
          </SettingsSection>

          {localeOptions.length > 0 && (
            <SettingsSection title="Languages" description="Which content languages this role can write. A restricted role translates only; base-language edits, publishing and deleting need the default language.">
              <div className="flex flex-wrap gap-2">
                <ActionPill action="All languages" checked={localeAccess === 'all'} onChange={() => setLocaleAccess(localeAccess === 'all' ? [] : 'all')} />
                {localeAccess !== 'all' && localeOptions.map((l) => (
                  <ActionPill key={l.code} action={l.isDefault ? `${l.label} (default)` : l.label} checked={localeAccess.includes(l.code)} onChange={() => setLocaleAccess((prev) => prev === 'all' ? [l.code] : prev.includes(l.code) ? prev.filter((x) => x !== l.code) : [...prev, l.code])} />
                ))}
              </div>
            </SettingsSection>
          )}
        </fieldset>
      )}

      {tab === 'assignment' && (
        <div className="space-y-3">
          <header>
            <h2 className="text-sm font-semibold text-fg">Assigned to</h2>
            <p className="mt-1 text-sm text-fg-subtle">{existing ? `The members who hold ${existing.name}. Open one to change their role.` : 'Create the role first, then assign it from Members.'}</p>
          </header>
          <DataList<RoleHolder>
            chrome="compact"
            columns={holderColumns}
            rows={holders.filter((m) => !holderSearch.trim() || `${m.name ?? ''} ${m.email}`.toLowerCase().includes(holderSearch.trim().toLowerCase()))}
            rowKey={(m) => m.id}
            search={holderSearch}
            searchPlaceholder="Search by name or email…"
            onSearchChange={setHolderSearch}
            onRowClick={(m) => navigate(`/${workspaceId}/settings/members?member=${m.id}`)}
            emptyState={{ title: holderSearch ? 'No member matches' : 'No one holds this role yet', description: holderSearch ? undefined : 'Assign it from the Members list.' }}
          />
        </div>
      )}

      {tab === 'settings' && (
        <div className="space-y-10">
          <SettingsSection title="Role" description="How the role is named and referenced." flush>
            <FactGrid className="md:grid-cols-1">
              <div className="max-w-xl">
                <FactRow icon={<IconLock />} label="Name">
                  <Input value={name} disabled={readOnly} onChange={(e) => setName(e.currentTarget.value)} placeholder="Publisher" aria-label="Name" />
                </FactRow>
                <FactRow icon={<IconCode />} label="Slug" help="A stable id, referenced by members and field access rules.">
                  <Input value={slug} disabled={!!existing} onChange={(e) => setSlug(e.currentTarget.value)} placeholder="publisher" aria-label="Slug" inputClassName="font-mono" />
                </FactRow>
                <FactRow icon={<IconFileText />} label="Description">
                  <Input value={description} disabled={readOnly} onChange={(e) => setDescription(e.currentTarget.value)} placeholder="Writes and publishes content" aria-label="Description" />
                </FactRow>
                {existing && (
                  <FactRow icon={<IconShieldCheck />} label="Source">
                    <span className="inline-flex h-8 items-center gap-2">{roleSourceBadge(existing) ? <Badge variant="default">{roleSourceBadge(existing)}</Badge> : 'Custom'}</span>
                  </FactRow>
                )}
              </div>
            </FactGrid>
          </SettingsSection>

          {existing && !readOnly && (
            <SettingsSection title="Delete this role" description="Members still assigned to it must be reassigned first; the delete fails otherwise.">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-fg-muted">{holders.length === 0 ? 'No one holds this role.' : `${holders.length} member${holders.length === 1 ? '' : 's'} hold this role.`}</p>
                <Button variant="destructive" size="sm" isLoading={deleting} disabled={holders.length > 0} onClick={remove}>Delete role</Button>
              </div>
            </SettingsSection>
          )}
        </div>
      )}
    </div>
  )
}
