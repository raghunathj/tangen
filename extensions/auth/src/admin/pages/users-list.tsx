/**
 * File Name: users-list.tsx
 * Purpose: The Site users home: every account with its role, state and last
 *          sign-in, searchable and filterable; a user opens to their page;
 *          an account can be created by hand.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { IconKey, IconPlus, IconUsers } from '@tangen/icons'
import {
  AdminPage, Badge, Button, DataList, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  FilterDropdown, Input, Label, Select, SelectItem, Text, toast, useCan, type DataListColumn,
} from '@/kit'
import { authApi, displayNameOf, relativeTime, type UserRow } from '../api'
import type { ProfileFieldDef } from '../../contract'

const PAGE_SIZE = 25

export function usersTabs(base: string) {
  return [
    { id: 'users', label: 'Users', href: base, icon: <IconUsers aria-hidden /> },
    { id: 'methods', label: 'Sign-in methods', href: `${base}/methods`, icon: <IconKey aria-hidden /> },
  ]
}

function StatusBadge({ u }: { u: UserRow }) {
  if (u.status === 'blocked') return <Badge variant="error">Blocked</Badge>
  if (u.isAnonymous) return <Badge variant="neutral">Guest</Badge>
  return <Badge variant="success">Active</Badge>
}

export function UsersListPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { hasCapability } = useCan()
  const canManage = hasCapability('auth:manage' as never)
  const base = `/${workspaceId}/extensions/auth`

  const [rows, setRows] = useState<UserRow[]>([])
  const [total, setTotal] = useState(0)
  const [roles, setRoles] = useState<string[]>([])
  const [listFields, setListFields] = useState<ProfileFieldDef[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState(params.get('status') ?? '')
  const [role, setRole] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async (p = 1) => {
    setLoading(true)
    try {
      const q: Record<string, string> = { limit: String(PAGE_SIZE), offset: String((p - 1) * PAGE_SIZE) }
      if (search.trim()) q.search = search.trim()
      if (status) q.status = status
      if (role) q.role = role
      const res = await authApi.list(q)
      setRows(res.data)
      setTotal(res.meta.total)
      setRoles(res.roles)
      setListFields(res.profileFields.filter((f) => f.config?.admin?.showInList))
    } catch (e) {
      toast.error('Could not load site users', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [search, status, role])
  useEffect(() => { setPage(1); void load(1) }, [load])

  const columns = useMemo<DataListColumn<UserRow>[]>(() => [
    {
      key: 'who', header: 'User',
      cell: (u) => (
        <div className="min-w-0">
          <p className="truncate text-ui-sm font-medium text-fg">{displayNameOf(u)}</p>
          {(u.name && (u.email || u.phone)) ? <p className="truncate text-ui-xs text-fg-subtle">{u.email ?? u.phone}</p> : null}
        </div>
      ),
    },
    { key: 'role', header: 'Role', className: 'w-28', cell: (u) => <span className="text-ui-sm text-fg-muted">{u.role}</span> },
    { key: 'status', header: 'Status', className: 'w-28', cell: (u) => <StatusBadge u={u} /> },
    ...listFields.map((f) => ({
      key: `pf:${f.name}`, header: f.label, className: 'w-40',
      cell: (u: UserRow) => <span className="truncate text-ui-sm text-fg-muted">{u[f.name] == null || u[f.name] === '' ? '' : String(u[f.name])}</span>,
    })),
    { key: 'joined', header: 'Joined', className: 'w-28', cell: (u) => <span className="text-ui-xs text-fg-subtle" title={u.createdAt ? new Date(u.createdAt).toLocaleString() : ''}>{relativeTime(u.createdAt)}</span> },
    { key: 'seen', header: 'Last sign-in', className: 'w-28', cell: (u) => <span className="text-ui-xs text-fg-subtle" title={u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : ''}>{u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'Never'}</span> },
  ], [listFields])

  const actions: ReactNode = canManage ? (
    <Button size="xs" icon={<IconPlus className="size-3.5" />} onClick={() => setCreateOpen(true)}>New user</Button>
  ) : null

  return (
    <AdminPage title="Site users" icon={<IconUsers className="size-4" />} description="The accounts on your site" tabs={usersTabs(base)} actions={actions} flush access={{ capability: 'auth:read' }}>
      <DataList<UserRow>
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        loading={loading}
        onRowClick={(u) => navigate(`${base}/${u.id}`)}
        search={search}
        searchPlaceholder="Search by name, email or phone"
        onSearchChange={setSearch}
        toolbarLeft={
          <div className="flex flex-wrap items-center gap-2">
            <FilterDropdown label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All users' }, { value: 'active', label: 'Active' }, { value: 'blocked', label: 'Blocked' }, { value: 'anonymous', label: 'Guests' }]} />
            {roles.length > 0 && <FilterDropdown label="Role" value={role} onChange={setRole} options={[{ value: '', label: 'Any role' }, ...roles.map((r) => ({ value: r, label: r }))]} />}
          </div>
        }
        page={page} pageSize={PAGE_SIZE} total={total} onPageChange={(p) => { setPage(p); void load(p) }}
        filtered={Boolean(search || status || role)}
        emptyState={{
          icon: <IconUsers className="size-6" />,
          title: 'No site users yet',
          description: 'Accounts appear here as people register, sign in with a code, or arrive through single sign-on.',
          action: canManage ? <Button size="sm" icon={<IconPlus className="size-3.5" />} onClick={() => setCreateOpen(true)}>New user</Button> : undefined,
        }}
        filteredEmptyState={{ title: 'No users match', description: 'Try another search or clear the filters.' }}
      />
      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} roles={roles} onCreated={(u) => navigate(`${base}/${u.id}`)} />
    </AdminPage>
  )
}

function CreateUserDialog({ open, onOpenChange, roles, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; roles: string[]; onCreated: (u: UserRow) => void }) {
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState(roles[0] ?? 'user')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => { if (!open) { setEmail(''); setPhone(''); setName(''); setPassword(''); setErrors({}) } }, [open])
  useEffect(() => { if (!roles.includes(role)) setRole(roles[0] ?? 'user') }, [roles, role])

  async function create() {
    setSaving(true)
    setErrors({})
    try {
      const body: Record<string, unknown> = { email: email.trim() || undefined, phone: phone.trim() || undefined, name: name.trim() || undefined, role }
      if (password) body.password = password
      const created = await authApi.create(body)
      toast.success('User created')
      onOpenChange(false)
      onCreated(created)
    } catch (e) {
      const err = e as { message: string; fieldErrors?: Record<string, string>; details?: { fieldErrors?: Record<string, string> } }
      const fieldErrors = err.fieldErrors ?? err.details?.fieldErrors
      if (fieldErrors) setErrors(fieldErrors)
      else toast.error('Could not create the user', err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
          <DialogDescription>An account you create by hand. Give it an email or a phone number; a password lets it sign in straight away.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div>
            <Label htmlFor="nu-email" className="mb-1">Email</Label>
            <Input id="nu-email" type="email" autoFocus value={email} onChange={(e) => setEmail(e.currentTarget.value)} placeholder="grace@example.com" />
            {errors.email && <Text variant="help" className="mt-1 text-danger-fg">{errors.email === 'required' ? 'An email or a phone number is required' : errors.email}</Text>}
          </div>
          <div>
            <Label htmlFor="nu-phone" className="mb-1">Phone</Label>
            <Input id="nu-phone" type="tel" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} placeholder="+14155552671" />
            {errors.phone && <Text variant="help" className="mt-1 text-danger-fg">{errors.phone === 'phone is invalid' ? 'Use the international format, e.g. +14155552671' : errors.phone}</Text>}
          </div>
          <div>
            <Label htmlFor="nu-name" className="mb-1">Name</Label>
            <Input id="nu-name" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Optional" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="nu-password" className="mb-1">Password</Label>
              <Input id="nu-password" type="password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} placeholder="At least 8 characters" />
              {errors.password && <Text variant="help" className="mt-1 text-danger-fg">{errors.password === 'needs an email' ? 'A password needs an email to sign in with' : errors.password}</Text>}
            </div>
            <div>
              <Label htmlFor="nu-role" className="mb-1">Role</Label>
              <Select id="nu-role" value={role} onValueChange={(v: string) => setRole(v)}>
                {(roles.length ? roles : ['user']).map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </Select>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={create} isLoading={saving} disabled={!email.trim() && !phone.trim()}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
