/**
 * File Name: sidebar-chrome.tsx
 * Purpose: The sidebar's two fixed rows (tasks/ui-v2-calibration.md,
 *          "Sidebar header"): a 44px header holding the workspace switcher
 *          and the Search and Collapse controls (or, inside a context, the
 *          way back), and a 44px footer holding the account menu. This is
 *          where the former global top bar went: the benchmark has no top
 *          bar, the page owns its own header, and the shell never scrolls as
 *          a whole. Nothing the top bar offered is lost - the deployment role
 *          is a dot on the workspace mark with its label in the tooltip.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Leaf imports only (never the @/kit barrel - see
 *          query-monitor-fab.tsx). The production stripe stays on the page
 *          header (workspace-layout.tsx).
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  IconSearch, IconCheck,
  IconChevronDown, IconArrowLeft, IconLayoutLeft,
} from '@tangen/icons'
import {
  Popover, PopoverTrigger, PopoverContent, Tooltip, TooltipTrigger, TooltipContent,
} from '@tangen/ui'
import { apiUrl } from '@/lib/api-origin'
import { useAuthStore } from '@/lib/auth'
import type { ContextNav } from '@/lib/context-nav'

export interface WorkspaceItem { id?: string; workspaceId?: string; name: string }
const wsId = (w: WorkspaceItem) => (w.workspaceId ?? w.id) as string

/** The 24px icon button of the benchmark's sidebar header (`h-6 w-6 rounded-md`). */
const iconButton = clsx(
  'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-control text-fg-subtle transition-colors motion-fast',
  'hover:bg-surface-hover hover:text-fg data-[state=open]:bg-surface-selected data-[state=open]:text-fg',
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
  '[&_svg]:size-4',
)

/** The workspace's initial in one of four muted tones chosen by its id (the
 *  benchmark's mark), so a workspace always wears the same one. */
const AVATAR_TONES = [
  'bg-warning-muted text-warning-fg',
  'bg-accent-muted text-accent-fg',
  'bg-success-muted text-success-fg',
  'bg-info-muted text-info-fg',
] as const
export function avatarTone(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]!
}

export function SidebarHeader({
  workspaceId, workspaceName, workspaces, collapsed, onToggleCollapse, canCollapse, onSearchOpen, context,
}: {
  workspaceId: string
  workspaceName: string
  workspaces: WorkspaceItem[]
  collapsed: boolean
  canCollapse: boolean
  onToggleCollapse: () => void
  onSearchOpen: () => void
  context: ContextNav | null
}) {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [wsOpen, setWsOpen] = useState(false)
  const [wsFilter, setWsFilter] = useState('')

  /** Switch workspace via JWT reissue, landing on its dashboard. */
  async function goTo(targetWs: string) {
    setWsOpen(false); setWsFilter('')
    if (targetWs === workspaceId) return
    try {
      const { accessToken: token } = useAuthStore.getState()
      const res = await fetch(apiUrl('/api/v1/workspaces/switch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ workspaceId: targetWs }),
      })
      if (!res.ok) { navigate(`/${targetWs}/login`); return }
      const { accessToken, member: m } = await res.json() as { accessToken: string; member: never }
      setAuth(accessToken, m)
      navigate(`/${targetWs}/dashboard`)
    } catch {
      navigate(`/${targetWs}/login`)
    }
  }

  const all: WorkspaceItem[] = workspaces.length > 0 ? workspaces : [{ workspaceId, name: workspaceName }]

  const mark = (
    <span className={clsx('flex size-5 shrink-0 items-center justify-center rounded-sm text-ui-xs font-medium uppercase', avatarTone(workspaceId))} aria-hidden>
      {(workspaceName || 'W').trim().charAt(0)}
    </span>
  )

  return (
    <div className={clsx('relative flex h-(--tg-header-h) shrink-0 items-center p-2', collapsed ? 'justify-center' : 'justify-between')}>
      {context ? (
        <Link
          to={context.backHref}
          aria-label={collapsed ? context.backLabel : undefined}
          title={collapsed ? context.backLabel : undefined}
          className={clsx(
            'flex h-6 min-w-0 items-center gap-2 rounded-control pl-1.5 pr-2 text-ui font-medium text-fg-muted transition-colors motion-fast',
            'hover:bg-surface-hover hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
            collapsed && 'justify-center px-0',
          )}
        >
          <IconArrowLeft className="size-5 shrink-0" aria-hidden />
          {!collapsed && <span className="truncate leading-5">{context.title}</span>}
        </Link>
      ) : (
        <Popover open={wsOpen} onOpenChange={(o) => { setWsOpen(o); if (!o) setWsFilter('') }}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Workspace: ${workspaceName}`}
              className={clsx(
                'flex h-6 min-w-0 cursor-pointer items-center gap-2 rounded-control px-1.5 text-ui font-medium text-fg transition-colors motion-fast',
                'hover:bg-surface-hover hover:text-fg data-[state=open]:bg-surface-selected data-[state=open]:text-fg',
                'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                collapsed && 'px-0.5',
              )}
            >
              {mark}
              {!collapsed && <span className="min-w-0 flex-1 truncate text-left leading-5">{workspaceName}</span>}
              {!collapsed && <IconChevronDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={4} flush className="w-[260px]">
            <p className="px-3 pt-2.5 pb-1.5 text-ui-2xs text-fg-subtle">Workspaces</p>
            <div className="px-2 pb-1.5">
              <input
                autoFocus
                value={wsFilter}
                onChange={(e) => setWsFilter((e.target as HTMLInputElement).value)}
                placeholder="Search workspaces…"
                aria-label="Search workspaces"
                className="h-7 w-full rounded-control border border-border bg-surface px-2.5 text-ui-sm text-fg placeholder:text-fg-subtle outline-none focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25"
              />
            </div>
            <div className="max-h-72 overflow-y-auto p-1">
              {all
                .filter((w) => !wsFilter.trim() || w.name.toLowerCase().includes(wsFilter.trim().toLowerCase()))
                .map((w) => {
                  const id = wsId(w)
                  const isActive = id === workspaceId
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => goTo(id)}
                      aria-current={isActive ? 'true' : undefined}
                      className={clsx(
                        'flex h-8 w-full cursor-pointer items-center gap-2 rounded-control px-2 text-ui-sm transition-colors motion-fast',
                        'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                        isActive ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                      )}
                    >
                      <span className={clsx('flex size-5 shrink-0 items-center justify-center rounded-sm text-ui-xs font-medium uppercase', avatarTone(id))} aria-hidden>{(w.name || 'W').trim().charAt(0)}</span>
                      <span className={clsx('flex-1 truncate text-left', isActive && 'font-medium')}>{w.name}</span>
                      {isActive && <IconCheck className="size-3.5 shrink-0 text-accent-fg" aria-hidden />}
                    </button>
                  )
                })}
            </div>
          </PopoverContent>
        </Popover>
      )}
      {/* Collapsed, the 48px rail has room for the initial alone: the toggle
          becomes a small handle riding the rail's edge (the benchmark's). */}
      {collapsed ? (
        canCollapse && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label="Expand sidebar"
                className="absolute top-full -right-3 z-10 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-surface-raised text-fg-subtle shadow-raised ring-1 ring-border-subtle transition-colors motion-fast hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus [&_svg]:size-3.5"
              >
                <IconLayoutLeft aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand sidebar</TooltipContent>
          </Tooltip>
        )
      ) : (
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={onSearchOpen} aria-label="Search" title="Search (⌘K)" className={iconButton}>
            <IconSearch aria-hidden />
          </button>
          {canCollapse && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={onToggleCollapse} aria-label="Collapse sidebar" className={iconButton}>
                  <IconLayoutLeft aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Collapse sidebar</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  )
}

