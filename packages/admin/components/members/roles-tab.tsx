/**
 * File Name: roles-tab.tsx
 * Purpose: Roles management inside Settings → Members — built-in roles shown
 *          read-only with their compiled grants; custom roles are created and
 *          edited through the same PermissionsEditor the API manager uses,
 *          plus an admin-capabilities section.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: permission state rides PermissionsFormState via
 *          permissionsToState/buildPermissions (shared with api-keys);
 *          capabilities are a plain pill list on top.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { IconPlus, IconArrowLeft, IconTrash, IconCode, IconLock, IconUser, IconUsers } from '@tangen/icons'
import { Callout, DataList, type DataListColumn } from '@tangen/ui'
import { avatarTone } from '@/components/layout/sidebar-chrome'
import { avatarInitials } from '@/lib/avatars'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { adminFetch } from '@/lib/api'
import {
  permissionsToState, buildPermissions, fetchKeyResources,
  type PermissionsFormState,
} from '@/lib/api-keys'
import { useCanStore } from '@/lib/use-can'
import { ALL_CAPABILITIES, type Capability, type CoreCapability, type MemberPermissions } from '@tangen/types'
import type { RouteResourceGroup, FeatureResource } from '@tangen/types'
import { ActionPill } from '@/components/api-keys/primitives'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { PermissionsEditor, type TypeDef } from '@/components/api-keys/permissions-editor'
import { ADMIN_EXTENSION } from 'virtual:tangen/app-ui-registry'

const EMPTY_STATE: PermissionsFormState = {
  globalActions: {}, typeOverrides: [], extensionOverrides: {}, customRoutes: {}, resourceOverrides: {},
}

/**
 * CORE capability labels - the offline fallback only. The editor renders
 * from GET /admin/capabilities (core + installed extensions' manifest
 * capabilities); this map covers the render before/without that response.
 */
export const CAPABILITY_LABELS: Record<CoreCapability, string> = {
  'use:ai': 'Use AI (Gen AI, fills, image generation)',
  'manage:members': 'Manage members',
  'manage:roles': 'Manage roles',
  'manage:apiKeys': 'Manage API keys',
  'manage:webhooks': 'Manage webhooks',
  'manage:settings': 'Manage settings',
  'connections:use': 'Choose a connection for an automation (read-only)',
  'manage:aiSettings': 'Manage AI settings',
  'manage:cron': 'Manage jobs & cron',
  'schema:migrate': 'Migrate content & schema',
  'releases:review': 'Submit and withdraw releases for review',
  'releases:approve': 'Approve releases (freezes the reviewed payload)',
  'releases:apply': 'Apply, retry and schedule approved releases',
}

/** One selectable capability in the roles editor (from the server catalog). */
export interface CapabilityOption {
  id: string
  label: string
  description?: string
  source?: 'core' | 'extension'
  extensionId?: string
}

/** The offline-fallback catalog: core capabilities only. */
export const CORE_CAPABILITY_OPTIONS: CapabilityOption[] =
  ALL_CAPABILITIES.map((id) => ({ id, label: CAPABILITY_LABELS[id], source: 'core' as const }))

export interface RoleDto {
  slug: string
  name: string
  description: string | null
  builtIn: boolean
  /** 'code' when the role is defined in app/roles.ts (source of truth is code, not the DB). */
  source?: string
  permissions: MemberPermissions & { admin?: boolean }
}

/**
 * True when a role can't be edited in the admin: built-in roles are fixed, and
 * code-defined roles (app/roles.ts) are owned by code — the server rejects
 * mutations to them with a 409. The UI must treat both as read-only.
 */
export function isRoleLocked(role: Pick<RoleDto, 'builtIn' | 'source'>): boolean {
  return role.builtIn || role.source === 'code'
}

/** Badge label for a locked role, or null when the role is an editable DB role. */
export function roleSourceBadge(role: Pick<RoleDto, 'builtIn' | 'source'>): string | null {
  if (role.builtIn) return 'Built-in'
  if (role.source === 'code') return 'In code'
  return null
}

function roleSummary(role: RoleDto): string {
  // A thin row (an older server, a fixture) has no permissions block: read it as none.
  const p = (role.permissions ?? {}) as RoleDto['permissions']
  if (p.admin) return 'Full access'
  const parts: string[] = []
  if (p.objects?.actions?.length) parts.push(`Objects: ${p.objects.actions.join(', ')}`)
  if (p.media?.actions?.length) parts.push(`Media: ${p.media.actions.join(', ')}`)
  if ((p.capabilities ?? []).length) parts.push(`${p.capabilities!.length} capability${p.capabilities!.length > 1 ? 'ies' : ''}`)
  return parts.length ? parts.join(' · ') : 'No permissions'
}

// ── Roles list ────────────────────────────────────────────────────────────────

/** Who holds a role: enough of a member to draw an initial and count. */
export interface RoleHolder { id: string; name?: string | null; email: string; role: string; avatar?: string | null; status?: string; lastLoginAt?: string | null }

export function RolesTab({ canManage, members = [] }: { canManage: boolean; members?: RoleHolder[] }) {
  const [rolesList, setRolesList] = useState<RoleDto[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<RoleDto | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const navigate = useNavigate()
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const openRole = (slug: string) => navigate(`/${workspaceId}/settings/members/roles/${slug}`)

  const fetchRoles = useCallback(() => {
    setLoading(true)
    adminFetch<{ data: RoleDto[] }>('/roles')
      .then((r) => setRolesList(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchRoles() }, [fetchRoles])

  async function handleDelete() {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await adminFetch(`/roles/${deleting.slug}`, { method: 'DELETE' })
      setDeleting(null)
      fetchRoles()
    } catch (e: any) {
      setError(e.message)
      setDeleting(null)
    } finally {
      setDeleteLoading(false)
    }
  }

  const q = search.trim().toLowerCase()
  const visible = q ? rolesList.filter((r) => r.name.toLowerCase().includes(q) || r.slug.includes(q)) : rolesList
  const holdersOf = (slug: string) => members.filter((m) => m.role === slug)

  // The settings list (2026-09-08): a titled section, a compact list with a
  // search, the lock on a role that cannot be edited, who holds it, a chevron
  // where a row opens, and Create role below the list.
  const columns: DataListColumn<RoleDto>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (role) => {
        const locked = isRoleLocked(role)
        return (
          <span className="inline-flex items-center gap-2">
            <span className="text-fg-subtle [&_svg]:size-4" aria-hidden>{role.permissions?.admin ? <IconUsers /> : <IconUser />}</span>
            <span className="font-medium text-fg">{role.name}</span>
            {locked && <IconLock className="size-3.5 text-fg-faint" aria-label={role.builtIn ? 'Built-in role, not editable' : 'Defined in code, not editable here'} />}
            {role.source === 'code' && <IconCode className="size-3.5 text-fg-faint" aria-hidden />}
          </span>
        )
      },
    },
    {
      key: 'summary',
      header: 'Access',
      cell: (role) => <span className="text-fg-muted">{role.description || roleSummary(role)}</span>,
      clipAt: 60,
    },
    {
      key: 'holders',
      header: 'Assigned to',
      className: 'w-40',
      cell: (role) => {
        const holders = holdersOf(role.slug)
        if (holders.length === 0) return <span className="text-fg-faint">-</span>
        const shown = holders.slice(0, 4)
        return (
          <span className="inline-flex items-center" title={holders.map((h) => h.name || h.email).join(', ')}>
            {shown.map((h, i) => (
              h.avatar
                ? <img key={h.id} src={h.avatar} alt="" className={clsx('size-6 rounded-full border-2 border-surface object-cover', i > 0 && '-ml-1.5')} />
                : <span key={h.id} className={clsx('flex size-6 items-center justify-center rounded-full border-2 border-surface text-[10px] font-semibold', avatarTone(h.id), i > 0 && '-ml-1.5')}>{avatarInitials(h.name, h.email)}</span>
            ))}
            {holders.length > shown.length && <span className="ml-1.5 text-xs text-fg-subtle">+{holders.length - shown.length}</span>}
          </span>
        )
      },
      clipAt: false,
    },
    ...(canManage ? [{
      key: 'actions',
      header: '',
      className: 'w-10 pr-0',
      cell: (role: RoleDto) => isRoleLocked(role) ? null : (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDeleting(role) }}
          className="rounded-md p-1.5 text-fg-faint transition-colors hover:bg-surface-hover hover:text-danger-fg"
          title="Delete role"
          aria-label={`Delete ${role.name}`}
        >
          <IconTrash className="size-4" />
        </button>
      ),
      clipAt: false as const,
    }] : []),
  ]

  return (
    <div className="space-y-3">
      <header>
        <h2 className="text-sm font-semibold text-fg">All roles</h2>
        <p className="mt-1 text-sm text-fg-subtle">Built-in roles are fixed; custom roles compose content permissions and admin capabilities.</p>
      </header>

      {error && (
        <Callout variant="danger">{error}</Callout>
      )}

      <DataList<RoleDto>
        chrome="compact"
        columns={columns}
        rows={visible}
        rowKey={(r) => r.slug}
        loading={loading}
        search={search}
        searchPlaceholder="Search a role…"
        onSearchChange={setSearch}
        onRowClick={(role) => openRole(role.slug)}
        emptyState={{ title: q ? 'No role matches' : 'No roles yet' }}
      />

      {canManage && (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" icon={<IconPlus className="size-[15px]" />} onClick={() => openRole('new')}>
            Create role
          </Button>
        </div>
      )}

      {deleting && (
        <Dialog open onOpenChange={(v) => { if (!v) setDeleting(null) }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete role?</DialogTitle>
              <DialogDescription className="mt-1">
                <strong>{deleting.name}</strong> will be removed. Members still assigned
                to it must be reassigned first - the delete fails otherwise.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" size="sm" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="destructive" size="sm" isLoading={deleteLoading} onClick={handleDelete}>
                Delete role
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
