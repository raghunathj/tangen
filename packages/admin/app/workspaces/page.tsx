

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconBuilding, IconArrowRight } from '@tangen/icons'
import { useAuthStore } from '@/lib/auth'
import { workspaceFetch } from '@/lib/api'
import { avatarTone } from '@/components/layout/sidebar-chrome'

interface Workspace {
  id: string
  name: string
  slug: string
  createdAt: string
  memberCount: number | null
  lastActivity: string | null
}

function fmt(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 30) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export default function WorkspacesPage() {
  const navigate = useNavigate()
  const { member, setAuth } = useAuthStore((s) => ({ member: s.member, setAuth: s.setAuth }))
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)

  useEffect(() => {
    workspaceFetch<{ data: Workspace[] }>('/workspaces')
      .then((r) => setWorkspaces(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleSelect(ws: Workspace) {
    if (ws.id === member?.workspaceId) {
      navigate(`/${ws.id}/dashboard`)
      return
    }
    setSwitching(ws.id)
    try {
      const res = await workspaceFetch<{ accessToken: string; member: typeof member }>(
        '/workspaces/switch',
        { method: 'POST', body: JSON.stringify({ workspaceId: ws.id }) },
      )
      setAuth(res.accessToken, res.member)
      navigate(`/${ws.id}/dashboard`)
    } catch (e: any) {
      setError(e.message ?? 'Failed to switch workspace')
      setSwitching(null)
    }
  }

  return (
    <div className="min-h-screen bg-surface-sunken flex flex-col items-center justify-start pt-20 px-4">
      <div className="w-full max-w-xl">

        <div className="mb-6">
          <h1 className="text-xl font-semibold text-fg">Workspaces</h1>
          <p className="text-sm text-fg-muted mt-0.5">Select a workspace to manage its content</p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 rounded-xl border border-border bg-surface px-5 py-4">
                <div className="w-9 h-9 rounded-lg bg-surface-hover animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-36 bg-surface-hover rounded animate-pulse" />
                  <div className="h-3 w-28 bg-surface-hover rounded animate-pulse" />
                </div>
                <div className="w-4 h-4 bg-surface-hover rounded animate-pulse shrink-0" />
              </div>
            ))}
          </div>
        ) : workspaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl border border-dashed border-border-strong bg-surface">
            <IconBuilding className="size-8 text-gray-300" />
            <p className="text-sm text-fg-muted">No workspaces yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {workspaces.map((ws) => {
              const isActive = ws.id === member?.workspaceId
              const isSwitching = switching === ws.id
              return (
                <button
                  key={ws.id}
                  onClick={() => handleSelect(ws)}
                  disabled={isSwitching}
                  className="w-full flex items-center gap-4 rounded-xl border border-border bg-surface px-5 py-4 text-left shadow-xs transition hover:border-indigo-300 hover:shadow-sm disabled:opacity-60 disabled:cursor-wait"
                >
                  <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-sm font-semibold ${avatarTone(ws.id)}`} aria-hidden="true">
                    {(ws.name || '?').trim().charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-fg truncate">{ws.name}</span>
                      {isActive && (
                        <span className="text-[10px] font-medium text-accent-fg bg-accent-muted rounded-full px-2 py-0.5">current</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-fg-subtle font-mono">{ws.id}</span>
                      {ws.memberCount != null && (
                        <span className="text-xs text-fg-subtle">· {ws.memberCount} member{ws.memberCount !== 1 ? 's' : ''}</span>
                      )}
                      {ws.lastActivity && (
                        <span className="text-xs text-fg-subtle">· active {fmt(ws.lastActivity)}</span>
                      )}
                    </div>
                  </div>
                  {isSwitching ? (
                    <div className="w-4 h-4 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin flex-shrink-0" />
                  ) : (
                    <IconArrowRight className="size-4 text-gray-300 flex-shrink-0" />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
