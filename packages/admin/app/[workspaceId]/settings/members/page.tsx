
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { IconPlus, IconUsers, IconCheck, IconCopy, IconLock } from '@tangen/icons'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription, DialogClose,
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetClose,
} from '@/components/ui/dialog'
import { useAuthStore } from '@/lib/auth'
import { workspaceFetch, adminFetch } from '@/lib/api'
import { usePageHeaderActions, usePageHeader } from '@/lib/page-header'
import {
  formatRole, isMemberSelf, buildInviteBody, ASSIGNABLE_ROLES,
} from '@/lib/members'
import type { Member } from '@tangen/types'
import { isNoAccessRole } from '@tangen/types'
import { Callout, DataList, type DataListColumn } from '@tangen/ui'
import { RolesTab, type RoleDto } from '@/components/members/roles-tab'

const PAGE_SIZE = 20

/** A member row as GET /members returns it. */
type MemberRow = Member & {
  status?: string
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const ROLE_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'error'> = {
  owner: 'success',
  admin: 'default',
  editor: 'default',
  viewer: 'default',
}

// ── Invite dialog ─────────────────────────────────────────────────────────────

function InviteDialog({ onInvited, roleOptions }: {
  onInvited: (tempPassword: string) => void
  roleOptions: { value: string; label: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('editor')
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setEmail(''); setName(''); setRole('editor'); setTemporaryPassword(''); setError(null)
  }

  async function handleInvite() {
    if (!email.trim()) { setError('Email is required'); return }
    setSaving(true); setError(null)
    try {
      const res = await workspaceFetch<{ temporaryPassword: string }>(
        '/members/invite',
        {
          method: 'POST',
          body: JSON.stringify(buildInviteBody({ email, name, role, temporaryPassword: temporaryPassword || undefined })),
        },
      )
      setOpen(false)
      reset()
      onInvited(res.temporaryPassword)
    } catch (e: any) {
      setError(e.message ?? 'Failed to invite member')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button icon={<IconPlus className="size-[15px]" />} size="sm" onClick={() => { reset(); setOpen(true) }}>
        Invite member
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Invite member</SheetTitle>
            <SheetDescription className="mt-1">
              The temporary password is shown once - share it securely.
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-fg mb-1">
                Email <span className="text-danger-fg">*</span>
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
                placeholder="alice@example.com"
                inputClassName="h-9 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-fg mb-1">Name (optional)</label>
              <Input
                value={name}
                onChange={(e) => setName((e.target as HTMLInputElement).value)}
                placeholder="Alice Smith"
                inputClassName="h-9 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-fg mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full appearance-none rounded-md border border-border-strong bg-surface px-2.5 py-2 text-sm text-fg shadow-xs outline-none transition focus-visible:ring-[3px] focus-visible:ring-focus/25 focus-visible:border-focus-border"
              >
                {roleOptions.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-fg mb-1">
                Temporary password (leave blank to auto-generate)
              </label>
              <Input
                type="text"
                value={temporaryPassword}
                onChange={(e) => setTemporaryPassword((e.target as HTMLInputElement).value)}
                placeholder="Auto-generated"
                inputClassName="h-9 text-sm font-mono"
              />
            </div>

            {error && <p className="text-xs text-danger-fg">{error}</p>}
          </SheetBody>

          <SheetFooter>
            <SheetClose asChild>
              <Button variant="secondary" size="sm">Cancel</Button>
            </SheetClose>
            <Button variant="primary" size="sm" isLoading={saving} onClick={handleInvite}>
              Send invite
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}

// ── Password reveal dialog ────────────────────────────────────────────────────

function PasswordRevealDialog({ password, onClose }: { password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(password).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md" showClose={false}>
        <DialogHeader>
          <DialogTitle>Member invited</DialogTitle>
          <DialogDescription className="mt-1">
            Share this temporary password - it will not be shown again.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 py-4">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-3">
            <code className="flex-1 font-mono text-sm text-fg">{password}</code>
            <button
              onClick={copy}
              className="shrink-0 rounded-md p-1.5 text-fg-subtle hover:bg-surface-hover hover:text-fg transition-colors"
              title="Copy"
            >
              {copied ? <IconCheck className="size-4 text-success-fg" /> : <IconCopy className="size-4" />}
            </button>
          </div>
          <p className="mt-2 text-xs text-warning-fg">The member should change this password after first login.</p>
          <p className="mt-3 text-xs text-fg-muted">
            Login URL:{' '}
            <button
              onClick={() => navigator.clipboard.writeText(`${window.location.origin}/login`)}
              className="font-mono text-accent-fg hover:underline cursor-pointer"
              title="Click to copy"
            >
              {typeof window !== 'undefined' ? `${window.location.origin}/login` : '/login'}
            </button>
          </p>
        </div>
        <DialogFooter>
          <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


// ── Main page ─────────────────────────────────────────────────────────────────

export default function MembersPage() {
  const params = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const authMember = useAuthStore((s) => s.member)

  const [members, setMembers] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<'members' | 'roles'>(searchParams.get('tab') === 'roles' ? 'roles' : 'members')
  const [customRoles, setCustomRoles] = useState<RoleDto[]>([])

  const isOwner = authMember?.role === 'owner'
  const currentMemberId = authMember?.memberId ?? ''

  const fetchMembers = useCallback(() => {
    setLoading(true)
    adminFetch<{ data: MemberRow[] }>('/members')
      .then((res) => {
        setMembers(res.data)
        // Deep link ?member=<id> opens that member's page directly.
        const want = searchParams.get('member')
        if (want && (res.data as MemberRow[]).some((m) => m.id === want)) navigate(`/${params.workspaceId}/settings/members/${want}`)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchMembers() }, [fetchMembers])

  useEffect(() => {
    adminFetch<{ data: RoleDto[] }>('/roles')
      .then((r) => setCustomRoles(r.data.filter((x) => !x.builtIn)))
      .catch(() => {})
  }, [tab])

  // Built-in assignables + workspace custom roles
  const roleOptions = useMemo(() => [
    ...ASSIGNABLE_ROLES,
    ...customRoles.map((r) => ({ value: r.slug, label: r.name })),
  ], [customRoles])

  usePageHeaderActions(
    isOwner && tab === 'members'
      ? <InviteDialog roleOptions={roleOptions} onInvited={(pw) => { setTempPassword(pw); fetchMembers() }} />
      : null,
    [isOwner, tab, roleOptions],
  )

  useEffect(() => { setPage(1) }, [search])

  const filteredMembers = useMemo(() => {
    if (!search.trim()) return members
    const q = search.toLowerCase()
    return members.filter(
      (m) =>
        (m.name ?? '').toLowerCase().includes(q) ||
        (m.email ?? '').toLowerCase().includes(q),
    )
  }, [members, search])

  const paginatedMembers = useMemo(
    () => filteredMembers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredMembers, page],
  )

  const columns = useMemo<DataListColumn<MemberRow>[]>(() => [
    {
      key: 'name',
      header: 'Name',
      cell: (m) => (
        <span className="font-medium text-fg">
          {m.name ?? '-'}
          {isMemberSelf(m.id, currentMemberId) && (
            <span className="ml-1.5 text-xs text-fg-subtle">(you)</span>
          )}
        </span>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      cell: (m) => <span className="text-fg-muted">{m.email}</span>,
    },
    {
      // Effective role for THIS environment — the members view is env-scoped.
      key: 'role',
      header: 'Role',
      cell: (m) => {
        const eff = m.role
        if (isNoAccessRole(eff)) return <Badge variant="error">No access</Badge>
        return (
          <span className="inline-flex items-center gap-1.5">
            <Badge variant={ROLE_VARIANT[eff] ?? 'default'}>{formatRole(eff)}</Badge>
          </span>
        )
      },
    },
    {
      key: 'status',
      header: 'Status',
      cell: (m) => {
        const suspended = m.status === 'suspended'
        return <Badge variant={suspended ? 'error' : 'success'}>{suspended ? 'Suspended' : 'Active'}</Badge>
      },
    },
    {
      key: 'lastLogin',
      header: 'Last login',
      cell: (m) => <span className="text-fg-subtle text-xs">{fmt(m.lastLoginAt)}</span>,
    },
  ], [currentMemberId])

  // The page's views are header tabs (2026-09-08), centred under the crumbs.
  usePageHeader({
    description: 'The people in this workspace, their roles and what each role may do.',
    tabs: [
      { id: 'members', label: 'Members', icon: <IconUsers />, badge: members.length },
      { id: 'roles', label: 'Roles', icon: <IconLock /> },
    ],
    activeTab: tab,
    onTabChange: (id) => setTab(id as 'members' | 'roles'),
  }, [tab, members.length])

  return (
    <div>

      {error && (
        <Callout variant="danger" className="mb-4">{error}</Callout>
      )}

      {tab === 'roles' ? (
        <RolesTab canManage={isOwner} members={members} />
      ) : (
      <DataList
        chrome="compact"
        columns={columns}
        rows={paginatedMembers}
        rowKey={(m) => m.id}
        loading={loading}
        onRowClick={(m) => navigate(`/${params.workspaceId}/settings/members/${m.id}`)}
        search={search}
        searchPlaceholder="Search by name or email…"
        onSearchChange={setSearch}
        page={page}
        pageSize={PAGE_SIZE}
        total={filteredMembers.length}
        onPageChange={setPage}
        emptyState={{
          icon: <IconUsers className="size-8 text-fg-faint" />,
          title: search ? 'No members match your search' : 'No members found',
        }}
      />

      )}

      {tempPassword && (
        <PasswordRevealDialog password={tempPassword} onClose={() => setTempPassword(null)} />
      )}
    </div>
  )
}
