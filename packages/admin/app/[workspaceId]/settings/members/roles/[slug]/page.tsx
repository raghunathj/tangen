/**
 * File Name: page.tsx (settings/members/roles/:slug)
 * Purpose: One role at its own URL - `new` creates one. Loads the role and
 *          the members (who holds it), then hands both to the editor.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { adminFetch } from '@/lib/api'
import { RoleEditor } from '@/components/members/role-editor'
import type { RoleDto, RoleHolder } from '@/components/members/roles-tab'

export default function RolePage() {
  const params = useParams<{ workspaceId: string; slug: string }>()
  const isNew = params.slug === 'new'
  const [role, setRole] = useState<RoleDto | null | undefined>(isNew ? null : undefined)
  const [members, setMembers] = useState<RoleHolder[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isNew) {
      adminFetch<{ data: RoleDto[] }>('/roles')
        .then((r) => {
          const found = (Array.isArray(r.data) ? r.data : []).find((x) => x.slug === params.slug)
          if (found) setRole(found); else setError('Role not found')
        })
        .catch((e) => setError(e.message))
    }
    adminFetch<{ data: RoleHolder[] }>('/members')
      .then((r) => setMembers(Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
  }, [params.slug, isNew])

  if (error) return <p className="text-sm text-danger-fg">{error}</p>
  if (role === undefined) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 animate-pulse rounded bg-surface-hover" />
        {[0, 1, 2].map((i) => <div key={i} className="h-12 w-full animate-pulse rounded-lg bg-surface-hover" />)}
      </div>
    )
  }
  return <RoleEditor key={role?.slug ?? 'new'} existing={role} workspaceId={params.workspaceId!} members={members} />
}
