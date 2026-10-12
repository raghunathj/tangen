/**
 * File Name: page.tsx (profile)
 * Purpose: #37 — self-service member profile. The logged-in member edits ONLY
 *   their own name / email / designation / avatar (PATCH /me/profile) and changes
 *   their password (POST /me/password). No id in the URL, no editing others.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { adminFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { useAuthStore } from '@/lib/auth'
import { usePageHeader } from '@/lib/page-header'
import { SettingsSection } from '@/components/settings/settings-section'
import { AVATAR_TONES, avatarInitials, toneAvatarUri, fileToAvatarDataUri } from '@/lib/avatars'
import { Badge } from '@/components/ui/badge'
import { formatRole } from '@/lib/members'
import { avatarTone } from '@/components/layout/sidebar-chrome'
import { clsx as cx } from 'clsx'
import { IconUser, IconLock, IconUpload, IconTrash } from '@tangen/icons'

interface Profile { id: string; name: string | null; email: string; role: string; designation: string | null; avatar: string | null }

export default function ProfilePage() {
  const params = useParams()
  const updateMember = useAuthStore((s) => s.updateMember)
  const [tab, setTab] = useState<'profile' | 'password'>('profile')

  const [profile, setProfile] = useState<Profile | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [designation, setDesignation] = useState('')
  const [avatar, setAvatar] = useState('')
  const [savingInfo, setSavingInfo] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''   // allow re-picking the same file
    if (!file) return
    try {
      setAvatar(await fileToAvatarDataUri(file))
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not read that image')
    }
  }

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [savingPw, setSavingPw] = useState(false)

  useEffect(() => {
    adminFetch<{ data: Profile }>('/me/profile')
      .then((r) => {
        const p = r.data
        setProfile(p)
        setName(p.name ?? ''); setEmail(p.email); setDesignation(p.designation ?? ''); setAvatar(p.avatar ?? '')
      })
      .catch(() => {})
  }, [])

  const infoDirty = profile && (
    (name || '') !== (profile.name ?? '') ||
    email !== profile.email ||
    (designation || '') !== (profile.designation ?? '') ||
    (avatar || '') !== (profile.avatar ?? '')
  )

  async function saveInfo() {
    if (!infoDirty || savingInfo) return
    setSavingInfo(true)
    try {
      const res = await adminFetch<{ data: Profile }>('/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name, email, designation, avatar }),
      })
      setProfile(res.data)
      updateMember({ name: res.data.name, email: res.data.email, avatar: res.data.avatar })
      toast.success('Profile updated')
    } catch (e: any) {
      toast.error('Could not save profile', e?.message)
    } finally {
      setSavingInfo(false)
    }
  }

  async function changePassword() {
    if (savingPw) return
    if (next.length < 8) { toast.error('New password must be at least 8 characters'); return }
    if (next !== confirm) { toast.error('New passwords don’t match'); return }
    setSavingPw(true)
    try {
      await adminFetch('/me/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      setCurrent(''); setNext(''); setConfirm('')
      toast.success('Password changed')
    } catch (e: any) {
      toast.error('Could not change password', e?.message)
    } finally {
      setSavingPw(false)
    }
  }

  const initials = avatarInitials(name, email)
  const role = profile?.role || 'member'

  // Two header tabs (2026-09-08): the profile and the password are separate forms.
  // Each form ends with its own button (2026-09-12): the save belongs to what it saves, not to the page header.
  usePageHeader({
    description: 'Your name, picture and password. Only you can edit these.',
    tabs: [
      { id: 'profile', label: 'Profile', icon: <IconUser /> },
      { id: 'password', label: 'Password', icon: <IconLock /> },
    ],
    activeTab: tab,
    onTabChange: (id) => setTab(id as 'profile' | 'password'),
  }, [tab])

  if (!profile) return <div className="text-sm text-fg-subtle">Loading…</div>

  const label = 'mb-1 block text-xs font-medium text-fg-muted'
  // The whole form - titles, fields, footer - is one 576px column centred in the settings column (the user, 2026-09-12).

  return (
    <div className="mx-auto max-w-xl space-y-10">
      {tab === 'profile' && (
        <>
          <SettingsSection title="Picture" description="A photo, or your initials on a tone." plain>
            <div className="flex items-start gap-4">
              {avatar
                ? <img src={avatar} alt="" className="size-20 shrink-0 rounded-xl border border-border object-cover" />
                : <span className={clsx('flex size-20 shrink-0 items-center justify-center rounded-xl text-xl font-semibold', avatarTone(profile.id || email || 'me'))}>{initials}</span>}
              <div className="min-w-0 space-y-3 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
                  <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}><IconUpload className="mr-1.5 size-3.5" />Upload</Button>
                  <Button size="sm" variant="secondary" disabled={!avatar} onClick={() => setAvatar('')}><IconTrash className="mr-1.5 size-3.5" />Remove</Button>
                </div>
                <p className="text-xs text-fg-subtle">Square PNG or JPG. Or pick a tone:</p>
                <div className="flex items-center gap-2">
                  {AVATAR_TONES.map((tone, i) => {
                    const uri = toneAvatarUri(i, initials)
                    const selected = avatar === uri
                    return (
                      <button
                        key={tone.bg}
                        type="button"
                        onClick={() => setAvatar(uri)}
                        aria-label={`Avatar tone ${i + 1}`}
                        aria-pressed={selected}
                        className={clsx('flex size-7 items-center justify-center rounded-full border-2 text-[10px] font-semibold transition-colors motion-fast', tone.className, selected ? 'border-accent-strong' : 'border-transparent hover:border-border-strong')}
                      >
                        {initials}
                      </button>
                    )
                  })}
                </div>
                <details className="text-xs">
                  <summary className="cursor-pointer select-none text-fg-subtle">Or paste an image URL</summary>
                  <Input value={avatar.startsWith('data:') ? '' : avatar} onChange={(e) => setAvatar(e.currentTarget.value)} placeholder="https://…/me.png" className="mt-1.5 max-w-md" aria-label="Image URL" />
                </details>
              </div>
            </div>
          </SettingsSection>

          <SettingsSection title="Name" description="Your name as it is shown, and what you do." plain>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="profile-name">Name</label>
                <Input id="profile-name" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Your name" />
              </div>
              <div>
                <label className={label} htmlFor="profile-designation">Designation</label>
                <Input id="profile-designation" value={designation} onChange={(e) => setDesignation(e.currentTarget.value)} placeholder="e.g. Content Editor" />
              </div>
            </div>
          </SettingsSection>

          <SettingsSection title="Email" description="Used to sign in. Must be unique in this workspace." plain>
            <Input type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} aria-label="Email" />
          </SettingsSection>

          <SettingsSection title="Role" description="What you may do here. A workspace owner or admin changes it under Members." plain>
            <div className="flex h-8 items-center gap-2 text-sm text-fg">
              <Badge variant={role === 'owner' ? 'success' : 'default'}>{formatRole(role)}</Badge>
            </div>
          </SettingsSection>

          <div className="flex justify-end border-t border-border-subtle pt-5">
            <Button size="sm" onClick={saveInfo} disabled={!infoDirty} isLoading={savingInfo}>Save changes</Button>
          </div>
        </>
      )}

      {tab === 'password' && (
        <SettingsSection title="Change password" description="At least 8 characters. This device stays signed in; other devices keep their sessions until they expire." plain>
          <div className="space-y-4">
            <div>
              <label className={label} htmlFor="pw-current">Current password</label>
              <Input id="pw-current" type="password" value={current} onChange={(e) => setCurrent(e.currentTarget.value)} autoComplete="current-password" />
            </div>
            <div>
              <label className={label} htmlFor="pw-new">New password</label>
              <Input id="pw-new" type="password" value={next} onChange={(e) => setNext(e.currentTarget.value)} autoComplete="new-password" />
            </div>
            <div>
              <label className={label} htmlFor="pw-confirm">Confirm new password</label>
              <Input id="pw-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} autoComplete="new-password" />
            </div>
          </div>
        </SettingsSection>
      )}
      {tab === 'password' && (
        <div className="flex justify-end border-t border-border-subtle pt-5">
          <Button size="sm" onClick={changePassword} disabled={!current || !next || !confirm} isLoading={savingPw}>Change password</Button>
        </div>
      )}
    </div>
  )
}
