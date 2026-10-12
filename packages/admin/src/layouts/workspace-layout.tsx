

import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useParams, useNavigate, useLocation } from 'react-router-dom'

import { IconInfo, IconArrowRight, IconX } from '@tangen/icons'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from '@tangen/ui'
import { clsx, clsx as cx } from 'clsx'
import { useAuthStore, refreshRequest } from '@/lib/auth'
import { adminFetch } from '@/lib/api'
import { Sidebar } from '@/components/layout/sidebar'
import { useUIStore } from '@/lib/ui-store'
import { QueryMonitorFab } from '@/components/query-monitor-fab'
import { NoPermission } from '@/components/require-permission'
import { useCan } from '@/lib/use-can'
import { usePageTitleOverride } from '@/lib/page-title'
import { ADMIN_EXTENSION } from 'virtual:tangen/app-ui-registry'
import { CommandPalette } from '@/components/layout/command-palette'
import { TYPES_CHANGED_EVENT } from '@/lib/schema-save'
import { useLocaleStore } from '@/lib/locale'
import { usePageHeaderStore, resolveHeaderActions } from '@/lib/page-header'
import { useCapabilities } from '@/lib/use-capabilities'
import { isProductionRole } from '@/lib/role-meta'

interface TypeItem {
  name: string
  label: string
  disabled?: boolean
  admin?: { menu?: { icon?: string; label?: string; order?: number; show?: boolean; parentExtension?: string } }
}
interface WorkspaceItem { id: string; name: string }
interface AppItem { id: string; name: string; icon: string; builtIn: boolean }

/**
 * The secondary bar — renders a page's declared header chrome (title/crumbs,
 * grayed description, center slot, actions, optional tabs row) and falls back
 * to the automatic route breadcrumbs for pages that declare nothing. The
 * #page-actions portal slot stays for pages that portal complex action state
 * (the object editor's Save/Publish).
 */
function PageHeaderBar({ autoBreadcrumbs, production }: { autoBreadcrumbs: React.ReactNode; production: boolean }) {
  const config = usePageHeaderStore((s) => s.config)
  const actionsOverlay = usePageHeaderStore((s) => s.actionsOverlay)
  const selection = usePageHeaderStore((s) => s.selection)
  const { pathname } = useLocation()
  const actions = resolveHeaderActions(config, actionsOverlay)
  // The header description shows on hover and can be *pinned* open by a click
  // (so it survives moving the mouse away). Escape or navigating unpins it.
  const [infoPinned, setInfoPinned] = useState(false)
  const [infoHovered, setInfoHovered] = useState(false)
  useEffect(() => { setInfoPinned(false); setInfoHovered(false) }, [pathname])

  const crumbs = config?.breadcrumbs ?? (config?.title ? [{ label: config.title }] : null)
  const viewTabs = (config?.tabs ?? []).filter((t) => !t.href)

  if (config?.loading) {
    return (
      <header className="sticky top-0 z-(--tg-z-sticky) shrink-0 border-b border-border-subtle bg-surface">
        <div className="flex h-(--tg-header-h) items-center gap-4 px-4 sm:px-6">
          <div className="h-3.5 w-40 rounded-sm bg-surface-hover motion-safe:animate-pulse" />
          <div className="flex-1" />
          <div className="h-8 w-28 rounded-control bg-surface-hover motion-safe:animate-pulse" />
        </div>
      </header>
    )
  }

  return (
    <header className="relative sticky top-0 z-(--tg-z-sticky) shrink-0 border-b border-border-subtle bg-surface">
      {/* Persistent "you are in production" stripe */}
      {production && <div aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-success" />}
      {/* The page header: 44px, 10px padding, and from `sm` the 12px inset the
          list column uses (Twenty's), so the title, the view switcher and
          the checkbox column share one edge. */}
      <div className="flex h-(--tg-header-h) items-center gap-2 p-[10px] sm:px-3">
        {crumbs ? (
          <Breadcrumb className="flex min-w-0 items-center gap-1.5">
            {config?.icon && <span className="mr-0.5 shrink-0 text-fg-subtle [&_svg]:size-4">{config.icon}</span>}
            <BreadcrumbList className="flex-nowrap">
              {crumbs.map((crumb, i) => (
                <BreadcrumbItem key={i}>
                  {i > 0 && <BreadcrumbSeparator />}
                  {crumb.icon && <span className="shrink-0 text-fg-subtle [&_svg]:size-4">{crumb.icon}</span>}
                  {crumb.href ? (
                    <BreadcrumbLink asChild><Link to={crumb.href}>{crumb.label}</Link></BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        ) : (
          autoBreadcrumbs
        )}
        {config?.titleAdornment && <span className="shrink-0">{config.titleAdornment}</span>}
        {/* A list's selection reads on from the title ("Posts -> 4 selected")
            and clears from here; its actions land in #page-selection below. */}
        {selection && (
          <span className="inline-flex shrink-0 items-center gap-1 text-ui text-fg-muted" data-testid="page-selection-summary">
            <IconArrowRight className="size-4 text-fg-subtle" aria-hidden />
            <span className="tabular-nums">{selection.count} selected</span>
            {selection.onClear && (
              <button
                type="button"
                onClick={selection.onClear}
                aria-label="Clear selection"
                className="flex size-6 items-center justify-center rounded-control text-fg-subtle transition-colors motion-fast hover:bg-surface-hover hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
              >
                <IconX className="size-4" aria-hidden />
              </button>
            )}
          </span>
        )}
        {config?.description && (
          <TooltipProvider delayDuration={100}>
            {/* Fully controlled: hover drives infoHovered, click pins. Radix's
                own open management (which dismisses on pointer-down) is bypassed
                via the noop onOpenChange so a click can't be undone by it. */}
            <Tooltip open={infoPinned || infoHovered} onOpenChange={() => {}}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setInfoPinned((p) => !p)}
                  onMouseEnter={() => setInfoHovered(true)}
                  onMouseLeave={() => setInfoHovered(false)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setInfoPinned(false); setInfoHovered(false) } }}
                  aria-label="About this page"
                  aria-expanded={infoPinned}
                  className="flex size-6 shrink-0 items-center justify-center rounded-control text-fg-subtle transition-colors motion-fast hover:bg-surface-hover hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                >
                  <IconInfo className="size-4" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" className="max-w-xs whitespace-normal font-normal normal-case leading-snug">
                {config.description}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Tabs live in the crumb row - one header, more page. */}
        {config?.center ? (
          <div className="flex-1 flex justify-center min-w-0 px-2">{config.center}</div>
        ) : (
          <div className="flex-1" />
        )}
        <div className="flex items-center gap-2 shrink-0">
          {config?.tabsRight}
          <div id="page-selection" ref={(el) => usePageHeaderStore.getState().setSelectionSlot(el)} className="flex items-center gap-2 empty:hidden" />
          {actions}
          {/* Pages portal complex action state here (e.g. the editor's Save/Publish) */}
          <div id="page-actions" className="flex items-center gap-2" />
        </div>
      </div>
      {/* Tabs (the benchmark's): their own row under the title, centred, 13px,
          an icon before the label, the active one carrying a 2px underline in `fg`. */}
      {/* Only VIEW tabs (no href) live here. Sub-pages (href tabs) open in the
          contextual sidebar, the one format for a section's pages. */}
      {viewTabs.length > 0 && (
        <div role="tablist" className="flex h-11 items-center justify-center gap-5 overflow-x-auto border-t border-border-subtle px-3">
          {(() => {
            return viewTabs.map((tab) => {
              const isActive = config?.activeTab === tab.id
              // The benchmark's tab (2026-09-08): an icon before the label, a thin
              // underline in `fg` on the active one, and a soft rounded ground on hover.
              const cls = cx(
                'group/tab inline-flex h-full cursor-pointer items-center whitespace-nowrap border-b px-0.5 text-ui transition-colors motion-fast',
                'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                isActive ? 'border-fg font-medium text-fg' : 'border-transparent text-fg-muted hover:text-fg',
              )
              return (
                <button key={tab.id} type="button" role="tab" aria-selected={isActive} onClick={() => config?.onTabChange?.(tab.id)} className={cls}>
                  <span className={cx('inline-flex items-center gap-1.5 rounded-control px-2 py-1 transition-colors motion-fast group-hover/tab:bg-surface-hover [&_svg]:size-4 [&_svg]:shrink-0', isActive ? '[&_svg]:text-fg' : '[&_svg]:text-fg-subtle')}>
                    {tab.icon}{tab.label}
                    {tab.badge !== undefined && tab.badge > 0 && (
                      <span className={cx('rounded-full px-1.5 text-ui-xs tabular-nums', isActive ? 'bg-surface-selected text-fg' : 'bg-surface-hover text-fg-subtle')}>{tab.badge}</span>
                    )}
                  </span>
                </button>
              )
            })
          })()}
        </div>
      )}
    </header>
  )
}

function HeaderBreadcrumbs({
  workspaceId,
  types,
}: {
  workspaceId: string
  types: TypeItem[]
}) {
  const { pathname } = useLocation()

  const base = `/${workspaceId}`
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname
  const [first, second, third] = rest.split('/').filter(Boolean)

  if (!first || !second) return null

  // ── Extension page (extensions/:name) ──────────────────────────────────────
  if (first === 'extensions') {
    const extRoute = (ADMIN_EXTENSION.routes ?? []).find(r => r.path === `extensions/${second}`)
    if (!extRoute?.nav) return null
    return (
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-ui text-fg-muted [&>span]:truncate [&>a]:truncate">
        <span className="font-medium text-fg">{extRoute.nav.label}</span>
      </nav>
    )
  }

  // ── Settings pages (settings/:section) ──────────────────────────────────────
  if (first === 'settings') {
    const base = `/${workspaceId}/settings`
    return (
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-ui text-fg-muted [&>span]:truncate [&>a]:truncate">
        {second ? (
          <>
            <Link to={base} className="rounded-xs transition-colors motion-fast hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Settings</Link>
            <span aria-hidden className="select-none text-fg-faint">/</span>
            <span className="font-medium text-fg">{humanizeSegment(second)}</span>
          </>
        ) : (
          <span className="font-medium text-fg">Settings</span>
        )}
      </nav>
    )
  }

  // ── Object page (objects/:typeName/:id?) ────────────────────────────────────
  if (first === 'objects') {
    const type = types.find((t) => t.name === second)
    const typeLabel = type?.label ?? humanizeSegment(second)
    const typeHref = `/${workspaceId}/objects/${second}`

    const parentExtPath = type?.admin?.menu?.parentExtension
    const parentExt = parentExtPath
      ? (ADMIN_EXTENSION.routes ?? []).find(r => r.path === parentExtPath)
      : null

    return (
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-ui text-fg-muted [&>span]:truncate [&>a]:truncate">
        {parentExt?.nav && (
          <>
            <Link
              to={`/${workspaceId}/${parentExtPath}`}
              className="rounded-xs transition-colors motion-fast hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {parentExt.nav.label}
            </Link>
            <span aria-hidden className="select-none text-fg-faint">/</span>
          </>
        )}
        {third ? (
          <>
            <Link to={typeHref} className="rounded-xs transition-colors motion-fast hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              {typeLabel}
            </Link>
            <span aria-hidden className="select-none text-fg-faint">/</span>
            <span className="font-medium text-fg">{third === 'new' ? 'New' : 'Edit'}</span>
          </>
        ) : (
          <span className="font-medium text-fg">{typeLabel}</span>
        )}
      </nav>
    )
  }

  return null
}

function humanizeWorkspaceId(id: string | undefined): string {
  if (!id) return ''
  return id
    .replace(/^wsp_/, '')
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function humanizeSegment(seg: string | undefined): string {
  if (!seg) return ''
  const KNOWN: Record<string, string> = {
    'api-keys': 'API Manager',
    'members': 'Members',
    'webhooks': 'Webhooks',
    'globals': 'Globals',
    'cache': 'Cache',
    'workspace': 'General',
    'profile': 'Profile',
    'preferences': 'Preferences',
    'submissions': 'Submissions',
    'releases': 'Releases',
    'schema': 'Schema',
    'media': 'Media',
    'dashboard': 'Dashboard',
    'settings': 'Settings',
    'extensions': 'Extensions',
    'apps': 'Apps',
  }
  if (KNOWN[seg]) return KNOWN[seg]
  return seg
    .replace(/-/g, ' ')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export default function WorkspaceLayout() {
  const params = useParams<{ workspaceId: string }>()
  const previewMode = useUIStore((s) => s.previewMode)   // live-preview focus mode hides the nav
  const deploymentRole = useCapabilities(params.workspaceId).flags.deploymentRole
  const { canUseExtension: canUseExtensionGate, ready: meReady } = useCan()
  const navigate = useNavigate()
  // Selector subscriptions - see top-bar.tsx.
  const accessToken = useAuthStore((s) => s.accessToken)
  const member = useAuthStore((s) => s.member)
  const setAuth = useAuthStore((s) => s.setAuth)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const [types, setTypes] = useState<TypeItem[]>([])
  const [apps, setApps] = useState<AppItem[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([])
  // authReady: true once we know the user is authenticated (fast — from store or after refresh)
  const [authReady, setAuthReady] = useState(!!accessToken)
  // typesLoading: true until sidebar data arrives
  const [typesLoading, setTypesLoading] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)

  const workspaceName =
    workspaces.find((w) => w.id === params.workspaceId)?.name ??
    humanizeWorkspaceId(params.workspaceId)

  const { pathname } = useLocation()
  // Detail pages that know their entity's real name override the URL-derived
  // leading label: explicit usePageTitle wins, then the page header's title /
  // last breadcrumb (most pages already declare those).
  const explicitTitle = usePageTitleOverride()
  const headerConfig = usePageHeaderStore((s) => s.config)
  const titleOverride = explicitTitle
    ?? headerConfig?.title
    ?? headerConfig?.breadcrumbs?.[headerConfig.breadcrumbs.length - 1]?.label
    ?? null

  useEffect(() => {
    const wid = params.workspaceId ?? ''
    const base = wid ? `/${wid}` : null
    const rest = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname
    const [first, second, third] = rest.split('/').filter(Boolean)

    const parts: string[] = []

    if (!first || first === 'dashboard') {
      parts.push('Dashboard')
    } else if (first === 'objects' && second) {
      const found = types.find((t) => t.name === second)
      const label = found?.admin?.menu?.label || found?.label || humanizeSegment(second)
      if (third === 'new') parts.push('New')
      else if (third) parts.push(titleOverride ?? 'Edit')
      parts.push(label)
      const parentExtPath = found?.admin?.menu?.parentExtension
      const parentExt = parentExtPath
        ? (ADMIN_EXTENSION.routes ?? []).find(r => r.path === parentExtPath)
        : null
      if (parentExt?.nav?.label) parts.push(parentExt.nav.label)
    } else if (first === 'settings') {
      if (second) parts.push(humanizeSegment(second))
      parts.push('Settings')
    } else if (first === 'extensions' || first === 'apps') {
      const devRoute = second ? (ADMIN_EXTENSION.routes ?? []).find(r => r.path === `extensions/${second}`) : undefined
      const app = second ? apps.find((a) => a.id === second) : undefined
      // An app name that looks like a path ('../../extensions/flows') is a
      // registry that predates the manifest-name fix - never show it raw.
      const appName = app?.name && !app.name.includes('/') ? app.name : undefined
      const appLabel = devRoute?.nav?.label ?? appName ?? (second ? humanizeSegment(second) : 'Extensions')
      if (third) parts.push(titleOverride ?? humanizeSegment(third))
      parts.push(appLabel)
    } else {
      if (second) parts.push(titleOverride ?? humanizeSegment(second))
      parts.push(humanizeSegment(first))
    }

    if (workspaceName) parts.push(workspaceName)
    parts.push('Tangen')

    document.title = parts.filter(Boolean).join(' · ')
  }, [pathname, types, apps, workspaceName, titleOverride, params.workspaceId])

  // Schema changed elsewhere (disable/enable/delete/new type) — refresh the nav +
  // command palette without a full reload.
  useEffect(() => {
    const refetch = () => {
      adminFetch<{ data: TypeItem[] }>('/types')
        .then((r) => setTypes((r.data ?? []).filter((t) => !t.disabled)))
        .catch(() => {})
    }
    window.addEventListener(TYPES_CHANGED_EVENT, refetch)
    return () => window.removeEventListener(TYPES_CHANGED_EVENT, refetch)
  }, [])

  useEffect(() => {
    async function init() {
      let token = accessToken
      let currentMember = member

      // Proactively refresh if the token is absent OR already expired so we never
      // fire a wave of 401s and rely on adminFetch to repair them after the fact.
      const isExpired = (t: string | null): boolean => {
        if (!t) return true
        try {
          const payload = JSON.parse(atob(t.split('.')[1]))
          return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()
        } catch { return true }
      }

      if (isExpired(token)) {
        const result = await refreshRequest()
        if (!result) { clearAuth(); navigate('/login'); return }
        setAuth(result.accessToken, result.member)
        token = result.accessToken
        currentMember = result.member
      }

      // Workspace boundary: the credential must belong to the workspace in the URL.
      // Superadmins are exempt — they can cross workspace boundaries.
      const urlWorkspaceId = params.workspaceId
      if (
        currentMember &&
        urlWorkspaceId &&
        currentMember.workspaceId !== urlWorkspaceId &&
        currentMember.role !== 'superadmin'
      ) {
        // Send them to that workspace's own login page so they can authenticate
        navigate(`/${urlWorkspaceId}/login`, { replace: true })
        return
      }

      // Show the layout shell immediately after auth is confirmed
      setAuthReady(true)

      // Fetch sidebar data in the background — don't block rendering. Each
      // request settles INDEPENDENTLY: the content nav (types) must not wait
      // for the workspace switcher or the extensions list - previously the
      // sidebar skeleton held until the slowest of the three resolved.
      adminFetch<{ data: TypeItem[] }>('/types')
        // TL-4: disabled types are hidden from the content nav (Schema page still shows them)
        .then((r) => setTypes((r.data ?? []).filter((t) => !t.disabled)))
        .catch(() => {})
        .finally(() => setTypesLoading(false))
      adminFetch<{ data: WorkspaceItem[] }>('/workspaces')
        .then((r) => setWorkspaces(r.data ?? []))
        .catch(() => {})
      adminFetch<{ data: AppItem[] }>('/extensions')
        .then((r) => setApps(r.data ?? []))
        .catch(() => {})
    }


    init()
    useLocaleStore.getState().hydrate(params.workspaceId!).catch(() => {})
  }, [params.workspaceId])

  if (!authReady) {
    return (
      <div className="fixed inset-0 flex flex-col overflow-clip bg-surface">
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <SidebarSkeleton />
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            <div className="sticky top-0 z-10 flex h-(--tg-header-h) shrink-0 items-center border-b border-border-subtle bg-surface px-6" />
            <main className="flex-1 overflow-y-auto bg-surface" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 flex flex-col overflow-clip">
      <CommandPalette
        workspaceId={params.workspaceId}
        open={searchOpen}
        onOpenChange={setSearchOpen}
        types={types}
        apps={apps}
      />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {!previewMode && (
          <Sidebar
            workspaceId={params.workspaceId}
            workspaceName={workspaceName}
            workspaces={workspaces}
            onSearchOpen={() => setSearchOpen(true)}
            types={types}
            apps={apps}
            typesLoading={typesLoading}
            extensionRoutes={ADMIN_EXTENSION.routes}
          />
        )}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {!previewMode && <PageHeaderBar production={isProductionRole(deploymentRole)} autoBreadcrumbs={<HeaderBreadcrumbs workspaceId={params.workspaceId} types={types} />} />}
          <main className="flex-1 overflow-hidden flex flex-col bg-surface">
            {(() => {
              // Extension-access choke point: /extensions/<id>/** for every
              // extension page (built-in and dev routes) in one place
              const m = pathname.match(/\/extensions\/([^/]+)/)
              if (m && meReady && !canUseExtensionGate(m[1])) return <NoPermission />
              return <Outlet />
            })()}
          </main>
        </div>
      </div>
      <QueryMonitorFab />
    </div>
  )
}

function SidebarSkeleton() {
  return (
    <aside className="w-65 shrink-0 flex flex-col h-full bg-canvas">
      <div className="px-3 py-4">
        <div className="flex items-center gap-3 px-1.5 py-1.5">
          <div className="size-9 rounded-md bg-surface-hover animate-pulse shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-28 bg-surface-hover rounded animate-pulse" />
            <div className="h-3 w-16 bg-surface-hover rounded animate-pulse" />
          </div>
        </div>
      </div>
      <div className="px-3 pb-3">
        <div className="h-8 w-full bg-surface-hover rounded-lg animate-pulse" />
      </div>
      <nav className="flex-1 px-2 pb-2 space-y-1 pt-1">
        {[0, 1].map((i) => (
          <div key={i} className="h-8 w-full bg-surface-hover rounded-md animate-pulse" />
        ))}
        <div className="h-3.5 w-16 bg-surface-hover rounded animate-pulse mx-2.5 mt-5 mb-1" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-8 w-full bg-surface-hover rounded-md animate-pulse" />
        ))}
      </nav>
      <div className="border-t border-border pt-2 px-2 pb-3">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <div className="size-8 rounded-full bg-surface-hover animate-pulse shrink-0" />
          <div className="h-3.5 flex-1 bg-surface-hover rounded animate-pulse" />
        </div>
      </div>
    </aside>
  )
}
