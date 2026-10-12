/**
 * File Name: user-detail.tsx
 * Purpose: One site user: the account (name, email, phone, role), the
 *          profile fields the site declared (through the platform's own
 *          field inputs), how they sign in, their sessions, and the actions
 *          that matter - block, sign out everywhere, set a new password.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IconKey, IconMoreHorizontal, IconUsers } from '@tangen/icons'
import {
  Badge, Button, Callout, DetailPage, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  ErrorState, FieldControl, FormFooter, FormRow, FormSection, Input, Label, Menu, MenuContent, MenuItem, MenuTrigger, Select, SelectItem, Skeleton, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Text,
  toast, useCan, useConfirm,
} from '@/kit'
import { authApi, displayNameOf, providerLabel, relativeTime, type SessionRow, type UserDetail } from '../api'

export function UserDetailPage() {
  const { workspaceId, userId } = useParams<{ workspaceId: string; userId: string }>()
  const navigate = useNavigate()
  const { hasCapability } = useCan()
  const canManage = hasCapability('auth:manage' as never)
  const base = `/${workspaceId}/extensions/auth`
  const { confirm, confirmDialog } = useConfirm()

  const [user, setUser] = useState<UserDetail | null>(null)
  const [roles, setRoles] = useState<string[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ name: string; email: string; phone: string; role: string; profileMeta: Record<string, unknown> } | null>(null)
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const [res, s] = await Promise.all([authApi.get(userId), authApi.sessions(userId)])
      setUser(res.data)
      setRoles(res.roles)
      setSessions(s)
      setDraft({ name: res.data.name ?? '', email: res.data.email ?? '', phone: res.data.phone ?? '', role: res.data.role, profileMeta: { ...res.data.profileMeta } })
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [userId])
  useEffect(() => { void load() }, [load])

  const dirty = useMemo(() => {
    if (!user || !draft) return false
    if (draft.name !== (user.name ?? '') || draft.email !== (user.email ?? '') || draft.phone !== (user.phone ?? '') || draft.role !== user.role) return true
    return user.profileFields.some((f) => JSON.stringify(draft.profileMeta[f.name] ?? null) !== JSON.stringify(user.profileMeta[f.name] ?? null))
  }, [user, draft])

  async function save() {
    if (!user || !draft) return
    setSaving(true)
    setFieldErrors({})
    try {
      const profileMeta = Object.fromEntries(user.profileFields.filter((f) => f.adminEditable !== false).map((f) => [f.name, draft.profileMeta[f.name] ?? null]))
      const res = await authApi.patch(user.id, { name: draft.name, email: draft.email, phone: draft.phone, role: draft.role, profileMeta })
      setUser(res.data)
      setDraft({ name: res.data.name ?? '', email: res.data.email ?? '', phone: res.data.phone ?? '', role: res.data.role, profileMeta: { ...res.data.profileMeta } })
      toast.success('User saved')
    } catch (e) {
      const err = e as { message: string; fieldErrors?: Record<string, string>; details?: { fieldErrors?: Record<string, string> } }
      const fe = err.fieldErrors ?? err.details?.fieldErrors
      if (fe) setFieldErrors(fe)
      toast.error('Could not save the user', err.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleBlock() {
    if (!user) return
    const blocking = user.status !== 'blocked'
    if (blocking && !(await confirm({ title: `Block ${displayNameOf(user)}?`, message: 'They are signed out everywhere and cannot sign in until unblocked.', confirmLabel: 'Block', variant: 'destructive' }))) return
    setBusy(true)
    try {
      if (blocking) await authApi.block(user.id); else await authApi.unblock(user.id)
      toast.success(blocking ? 'User blocked' : 'User unblocked')
      await load()
    } catch (e) { toast.error('Could not update the user', (e as Error).message) }
    finally { setBusy(false) }
  }

  async function signOutEverywhere() {
    if (!user) return
    if (!(await confirm({ title: 'Sign out everywhere?', message: 'Every session ends now; they sign in again on their next visit.', confirmLabel: 'Sign out' }))) return
    setBusy(true)
    try { await authApi.signOutEverywhere(user.id); toast.success('Signed out everywhere'); setSessions(await authApi.sessions(user.id)) }
    catch (e) { toast.error('Could not end the sessions', (e as Error).message) }
    finally { setBusy(false) }
  }

  async function revoke(session: SessionRow) {
    if (!user) return
    try { await authApi.revokeSession(user.id, session.id); setSessions(await authApi.sessions(user.id)) }
    catch (e) { toast.error('Could not end the session', (e as Error).message) }
  }

  if (error) {
    return (
      <DetailPage parent={{ label: 'Site users', href: base, icon: <IconUsers className="size-4" /> }} title="User">
        <ErrorState message={error} retry={load} />
      </DetailPage>
    )
  }
  if (!user || !draft) {
    return (
      <DetailPage parent={{ label: 'Site users', href: base, icon: <IconUsers className="size-4" /> }} title="User" loading>
        <Skeleton variant="rows" rows={6} />
      </DetailPage>
    )
  }

  const blocked = user.status === 'blocked'
  const hasActiveSession = sessions.some((s) => s.isActive)
  // The secondary actions fold into one menu on narrow screens so the header never overflows; block stays put.
  const actions: ReactNode = canManage ? (
    <div className="flex items-center gap-2">
      <Badge variant={blocked ? 'error' : user.isAnonymous ? 'neutral' : 'success'}>{blocked ? 'Blocked' : user.isAnonymous ? 'Guest' : 'Active'}</Badge>
      <div className="hidden items-center gap-2 md:flex">
        <Button size="xs" variant="secondary" icon={<IconKey className="size-3.5" />} disabled={!user.email} onClick={() => setPasswordOpen(true)}>Set password</Button>
        <Button size="xs" variant="secondary" disabled={busy || !hasActiveSession} onClick={signOutEverywhere}>Sign out everywhere</Button>
      </div>
      <div className="md:hidden">
        <Menu>
          <MenuTrigger asChild>
            <Button size="xs" variant="secondary" aria-label="More actions"><IconMoreHorizontal className="size-3.5" /></Button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem disabled={!user.email} onSelect={() => setPasswordOpen(true)}>Set password</MenuItem>
            <MenuItem disabled={busy || !hasActiveSession} onSelect={() => { void signOutEverywhere() }}>Sign out everywhere</MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <Button size="xs" variant={blocked ? 'secondary' : 'destructive'} isLoading={busy} onClick={toggleBlock}>{blocked ? 'Unblock' : 'Block'}</Button>
    </div>
  ) : <Badge variant={blocked ? 'error' : 'success'}>{blocked ? 'Blocked' : 'Active'}</Badge>

  return (
    <DetailPage parent={{ label: 'Site users', href: base, icon: <IconUsers className="size-4" /> }} title={displayNameOf(user)} actions={actions} access={{ capability: 'auth:read' }}>
      {user.isAnonymous && (
        <Callout variant="info" title="Guest session" className="mb-6">
          A guest with no email or phone yet. Their account becomes a real one when they convert it on the site.
        </Callout>
      )}

      <FormSection title="Account" description="How they are identified and what they may do on the site.">
        <FormRow label="Name" htmlFor="u-name">
          <Input id="u-name" value={draft.name} disabled={!canManage} onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })} />
        </FormRow>
        <FormRow label="Email" htmlFor="u-email" error={fieldErrors.email}>
          <Input id="u-email" type="email" value={draft.email} disabled={!canManage} onChange={(e) => setDraft({ ...draft, email: e.currentTarget.value })} />
        </FormRow>
        <FormRow label="Phone" htmlFor="u-phone" help="International format, e.g. +14155552671." error={fieldErrors.phone}>
          <Input id="u-phone" type="tel" value={draft.phone} disabled={!canManage} onChange={(e) => setDraft({ ...draft, phone: e.currentTarget.value })} />
        </FormRow>
        <FormRow label="Role" htmlFor="u-role" error={fieldErrors.role}>
          <Select id="u-role" value={draft.role} disabled={!canManage} onValueChange={(v: string) => setDraft({ ...draft, role: v })}>
            {(roles.includes(draft.role) ? roles : [draft.role, ...roles]).map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </Select>
        </FormRow>
        <FormRow label="Signs in with">
          <div className="flex flex-wrap items-center gap-1.5 py-1.5">
            {user.providers.length === 0 ? <Text variant="help">No sign-in method yet</Text> : user.providers.map((p) => <Badge key={p} variant="neutral">{providerLabel(p)}</Badge>)}
          </div>
        </FormRow>
        <FormRow label="Joined">
          <Text variant="body" className="py-1.5">{user.createdAt ? new Date(user.createdAt).toLocaleString() : ''}{user.lastLoginAt ? ` · last sign-in ${relativeTime(user.lastLoginAt)}` : ' · never signed in'}</Text>
        </FormRow>
      </FormSection>

      {user.profileFields.length > 0 && (
        <FormSection title="Profile" description="The fields your site declared. A field marked as the user's own is shown, not edited here.">
          {user.profileFields.map((f) => (
            <FormRow key={f.name} label={f.label} help={f.adminEditable === false ? 'Written by the user' : undefined} error={fieldErrors[f.name]}>
              {canManage && f.adminEditable !== false ? (
                <FieldControl
                  field={{ ...f, config: f.config ?? {} } as never}
                  value={draft.profileMeta[f.name]}
                  onChange={(v) => setDraft({ ...draft, profileMeta: { ...draft.profileMeta, [f.name]: v } })}
                  workspaceId={workspaceId!}
                />
              ) : (
                <Text variant="body" className="py-1.5">{formatProfileValue(user.profileMeta[f.name])}</Text>
              )}
            </FormRow>
          ))}
        </FormSection>
      )}

      <FormSection title="Sessions" description="Where they are signed in. Ending a session signs that device out on its next request.">
        {sessions.length === 0 ? (
          <Text variant="help" className="px-1 py-2">No sessions yet.</Text>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Started</TableHeaderCell>
                  <TableHeaderCell>Expires</TableHeaderCell>
                  <TableHeaderCell>State</TableHeaderCell>
                  {canManage && <TableHeaderCell className="w-24" />}
                </TableRow>
              </TableHead>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell><span title={new Date(s.createdAt).toLocaleString()}>{relativeTime(s.createdAt)}</span></TableCell>
                    <TableCell>{new Date(s.expiresAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</TableCell>
                    <TableCell>{s.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">{s.revokedAt ? 'Ended' : 'Expired'}</Badge>}</TableCell>
                    {canManage && <TableCell className="text-right">{s.isActive && <Button size="xs" variant="ghost" onClick={() => revoke(s)}>End</Button>}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </FormSection>

      {canManage && (
        <FormFooter>
          <Button size="sm" variant="secondary" disabled={!dirty || saving} onClick={() => setDraft({ name: user.name ?? '', email: user.email ?? '', phone: user.phone ?? '', role: user.role, profileMeta: { ...user.profileMeta } })}>Discard</Button>
          <Button size="sm" isLoading={saving} disabled={!dirty} onClick={save}>Save changes</Button>
        </FormFooter>
      )}

      <SetPasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} userId={user.id} onDone={() => { void authApi.sessions(user.id).then(setSessions) }} />
      {confirmDialog}
    </DetailPage>
  )
}

function formatProfileValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (Array.isArray(v)) return v.map(String).join(', ')
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function SetPasswordDialog({ open, onOpenChange, userId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; userId: string; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (!open) setPassword('') }, [open])
  async function apply() {
    setSaving(true)
    try {
      await authApi.patch(userId, { password })
      toast.success('Password set', 'Every session was signed out.')
      onOpenChange(false)
      onDone()
    } catch (e) { toast.error('Could not set the password', (e as Error).message) }
    finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Set a new password</DialogTitle>
          <DialogDescription>They sign in with it from now on; every current session ends.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Label htmlFor="np-password" className="mb-1">New password</Label>
          <Input id="np-password" type="password" autoFocus value={password} onChange={(e) => setPassword(e.currentTarget.value)} placeholder="At least 8 characters" onKeyDown={(e) => { if (e.key === 'Enter' && password.length >= 8) void apply() }} />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply} isLoading={saving} disabled={password.length < 8}>Set password</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
