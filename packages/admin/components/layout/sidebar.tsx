

import React, { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'

import { clsx } from 'clsx'
import { useCan } from '@/lib/use-can'
import { checkAdminAccess } from '@/components/require-permission'
import { DynamicIcon } from '@/components/dynamic-icon'
import { ADMIN_EXTENSION } from 'virtual:tangen/app-ui-registry'
import { useExtensionUi } from '@/lib/extension-ui'
import { extensionPageNavTrees, extensionsWithOwnNav } from '@/lib/extension-pages'
import { canAccessDevspace, devspacePlatformPages } from '@/lib/devspace'
import { useNavConfig } from '@/lib/use-nav-config'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { usePageHeaderStore } from '@/lib/page-header'
import { resolveContextNav, contextFromPageTabs, activeChild, type ContextNavItem, type ContextNav } from '@/lib/context-nav'
import { useSidebarWidth } from '@/lib/use-sidebar-width'
import { SidebarHeader, type WorkspaceItem } from './sidebar-chrome'
import { useDevMode } from '@/lib/use-dev-mode'
import { extensionsSectionMode, extensionsForNav } from '@/lib/nav-sections'
import { useSignOut } from '@/lib/use-sign-out'
import { useNavCommands } from '@/lib/use-command-catalog'
import type { AdminRouteEntry, IconValue } from '@tangen/types'
import {
  IconFileText, IconHome, IconSettings,
  IconImage, IconPuzzle, IconSearch, IconStar, IconStarFill, IconClock, IconSparkles, IconCodeBox, IconGlobe,
  IconChevronLeft, IconChevronRight, IconChevronDown,
} from '@tangen/icons'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@tangen/ui'
import { groupTypesBySidebar, type SidebarTypeItem } from '@/lib/sidebar'
import { useCapabilities } from '@/lib/use-capabilities'
import { aiSectionVisible } from '@/lib/ai-nav'
import {
  toggleInSet, togglePinned, isPinned, pushRecent, filterByLabel, splitOverflow,
  type NavRef,
} from '@/lib/sidebar-prefs'

type TypeItem = SidebarTypeItem

interface AppItem {
  id: string
  name: string
  icon: string
  builtIn: boolean
  /** `connector-pack`: offered under Connections, never as an Extensions item. */
  kind?: 'extension' | 'connector-pack'
}

interface SidebarProps {
  workspaceId: string
  workspaceName: string
  workspaces: WorkspaceItem[]
  onSearchOpen: () => void
  types: TypeItem[]
  apps: AppItem[]
  typesLoading?: boolean
  extensionRoutes?: AdminRouteEntry[]
}

const STORAGE_KEY = 'tangen-sidebar-collapsed'
const TAXONOMY_EXPANDED_KEY = 'tangen-sidebar-taxonomy-expanded'
const SECTIONS_COLLAPSED_KEY = 'tangen-sidebar-sections-collapsed'
const PINS_KEY = 'tangen-sidebar-pins'
const RECENTS_KEY = 'tangen-sidebar-recents'
/** Beyond this many items, a section folds its tail under "More…". */
const SECTION_OVERFLOW_LIMIT = 8

function loadSet(key: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try { const s = localStorage.getItem(key); return new Set(s ? JSON.parse(s) : []) } catch { return new Set() }
}
function loadList(key: string): NavRef[] {
  if (typeof window === 'undefined') return []
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : [] } catch { return [] }
}

export function Sidebar({ workspaceId, workspaceName, workspaces, onSearchOpen, types, apps, typesLoading, extensionRoutes }: SidebarProps) {
  const { hasCapability, me, can, canUseExtension } = useCan()
  const devMode = useDevMode()
  // The AI-flag probes only drive nav-section visibility, so they wait until
  // after the first paint - a one-shot idle flag hands the hooks their env
  // then (both hooks no-op and stay null on a falsy env, which callers hide).
  const [deferred, setDeferred] = useState(false)
  useEffect(() => {
    const flip = () => setDeferred(true)
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(flip)
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(flip, 0)
    return () => window.clearTimeout(id)
  }, [])
  // The AI SECTION (Knowledge/RAG + Agents/MCP) comes from the one capability
  // truth, keyed by workspace AND environment - content-AI providers are a
  // setting (Settings -> AI), not a nav section.
  const capabilities = useCapabilities(deferred ? workspaceId : undefined)
  // K7.3: build-time pages merged with the ones installed extensions load at runtime.
  const extensionUi = useExtensionUi(workspaceId)
  const aiSection = aiSectionVisible(capabilities.status)
  const pathname = useLocation().pathname
  // A route family inside a CONTEXT (Settings, a form's settings) replaces the
  // primary tree with its own, in this same column (UI V2 spec §15).
  const headerConfig = usePageHeaderStore((s) => s.config)
  // Recents are opt-in via workspace config (admin.nav.recents); off by default.
  // The links are what Settings shows under "Other" (admin.nav.links).
  // Content is opt-OUT (admin.nav.content: false) - a project whose every
  // type carries admin.menu.show: false has nothing this section could ever
  // show, and an empty "Content" with a "No types match" line under it is
  // noise, not an honest empty state.
  const { recents: recentsEnabled, links: navLinks, content: contentEnabled } = useNavConfig()
  const signOut = useSignOut()
  const context = resolveContextNav({
    pathname, workspaceId,
    hasCapability: (cap) => hasCapability(cap as never),
    role: me?.effectiveRole ?? me?.role,
    links: navLinks,
  }) ?? contextFromPageTabs(headerConfig, workspaceId)
  // Only probe GraphQL when the viewer can actually see Devspace.
  // GraphQL folded into the API Playground (PG-1) — no separate probe needed.

  // Tier 4 — collapsed "rail": one icon per section + a hover flyout of its
  // items. Reuses the (already-gated) command catalog so the flyout shows
  // exactly what the full sidebar would, with zero duplication.
  const navCommands = useNavCommands(workspaceId, types as never, apps as never)
  const RAIL_META: { key: string; icon: string }[] = [
    { key: 'Content', icon: 'IconFileText' },
    { key: 'Extensions', icon: 'IconPuzzle' },
    ...(aiSection ? [{ key: 'AI', icon: 'IconSparkles' }] : []),
    { key: 'Devspace', icon: 'IconCodeBox' },
  ]
  const railSections = RAIL_META
    .map((m) => ({ ...m, items: navCommands.filter((c) => c.group === m.key) }))
    .filter((s) => s.items.length > 0)

  const [userCollapsed, setUserCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(STORAGE_KEY) === 'true'
  })

  // The window itself can force the rail. Not a preference, so not stored:
  // widen the window and the user's own choice comes back untouched.
  const narrow = useNarrowViewport()
  const collapsed = narrow || userCollapsed
  // The benchmark's resizable width: 250 by default, 160 to 280 by drag or
  // arrow keys, persisted, applied as one custom property.
  const { width: sidebarWidth, dragging, handleProps } = useSidebarWidth()

  const [expandedParents, setExpandedParents] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const stored = localStorage.getItem(TAXONOMY_EXPANDED_KEY)
      return new Set(stored ? JSON.parse(stored) : [])
    } catch {
      return new Set()
    }
  })

  function toggleParentExpanded(typeName: string) {
    setExpandedParents(prev => {
      const next = new Set(prev)
      next.has(typeName) ? next.delete(typeName) : next.add(typeName)
      try { localStorage.setItem(TAXONOMY_EXPANDED_KEY, JSON.stringify([...next])) } catch {}
      return next
    })
  }

  // ── Nav scaling: collapsible sections · in-section filter · pins · recents ──
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => loadSet(SECTIONS_COLLAPSED_KEY))
  const [contentFilter, setContentFilter] = useState('')
  // Recomputed on every render before (the sidebar re-renders per navigation).
  const groupedTypes = useMemo(() => groupTypesBySidebar(types), [types])
  const [pins, setPins] = useState<NavRef[]>(() => loadList(PINS_KEY))
  const [recents, setRecents] = useState<NavRef[]>(() => loadList(RECENTS_KEY))

  const [contentMoreOpen, setContentMoreOpen] = useState(false)
  const isSectionCollapsed = (name: string) => collapsedSections.has(name)
  // Items show in rail mode (icons) OR when the section isn't user-collapsed.
  const showItems = (name: string) => collapsed || !collapsedSections.has(name)
  function toggleSection(name: string) {
    setCollapsedSections((prev) => {
      const next = toggleInSet(prev, name)
      try { localStorage.setItem(SECTIONS_COLLAPSED_KEY, JSON.stringify([...next])) } catch {}
      return next
    })
  }
  function togglePin(item: NavRef) {
    setPins((prev) => {
      const next = togglePinned(prev, item)
      try { localStorage.setItem(PINS_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }
  // Track the current page into recents (skips Home; keyed by pathname).
  useEffect(() => {
    if (!recentsEnabled) return
    const home = `/${workspaceId}/dashboard`
    if (pathname === home) return
    const label = document.title?.split('·')[0]?.trim() || pathname.split('/').pop() || 'Page'
    setRecents((prev) => {
      const next = pushRecent(prev, { to: pathname, label }, 5)
      if (next === prev) return prev
      try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [pathname, workspaceId, recentsEnabled])

  function toggleCollapsed() {
    setUserCollapsed((c) => {
      const next = !c
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }

  // Render an extension page nav tree — an expandable root with nested
  // children (Kitchen Sink shape). Shared by the Extensions and Devspace
  // sections so a tree looks identical wherever its root's section homes it.
  function renderPageTree(tree: { extensionId: string; root: { path: string; label: string; icon?: IconValue }; children: { path: string; label: string }[] }) {
    const rootHref = `/${workspaceId}/${tree.root.path}`
    const expandKey = `ext:${tree.extensionId}`
    const rootActive = pathname === rootHref
    const childActive = tree.children.some((c) => pathname.startsWith(`/${workspaceId}/${c.path}`))
    const isExpanded = expandedParents.has(expandKey) || childActive
    if (collapsed || tree.children.length === 0) {
      return <NavItem key={expandKey} to={rootHref} label={tree.root.label} icon={<DynamicIcon name={tree.root.icon ?? 'IconPuzzle'} className="size-4" />} active={pathname.startsWith(rootHref)} collapsed={collapsed} />
    }
    return (
      <div key={expandKey}>
        <ParentRow
          to={rootHref}
          label={tree.root.label}
          icon={<DynamicIcon name={tree.root.icon ?? 'IconPuzzle'} />}
          active={rootActive}
          childActive={childActive}
          expanded={isExpanded}
          onToggle={() => toggleParentExpanded(expandKey)}
        />
        {isExpanded && (
          <TreeChildren>
            {tree.children.map((c) => {
              const href = `/${workspaceId}/${c.path}`
              return <TreeChild key={c.path} to={href} label={c.label} active={pathname.startsWith(href)} />
            })}
          </TreeChildren>
        )}
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={300} disableHoverableContent>
    <aside
      data-dragging={dragging || undefined}
      style={{ ['--tg-sidebar-w' as string]: `${sidebarWidth}px` }}
      className={clsx(
        // Above the page header's sticky layer, so the rail's expand handle rides its edge.
        'relative z-(--tg-z-rail) flex h-full shrink-0 flex-col border-r border-border-subtle bg-canvas [contain:layout]',
        'transition-[width] motion-slow overflow-visible data-[dragging]:transition-none',
        collapsed ? 'w-12' : 'w-(--tg-sidebar-w)',
      )}
    >
      <SidebarHeader
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        workspaces={workspaces}
        collapsed={collapsed}
        canCollapse={!narrow}
        onToggleCollapse={toggleCollapsed}
        onSearchOpen={onSearchOpen}
        context={context}
      />
      {/* Nav */}
      <nav className="flex min-h-0 flex-1 flex-col gap-px overflow-x-hidden overflow-y-auto px-2 pt-[5px] pb-3" aria-label={context ? context.title : 'Primary'}>
        {context ? <ContextNavPanel context={context} collapsed={collapsed} pathname={pathname} onSignOut={() => { void signOut() }} /> : (<>
        <NavItem to={`/${workspaceId}/dashboard`} label="Home" icon={<IconHome className="size-4" />} active={pathname === `/${workspaceId}/dashboard`} collapsed={collapsed} />
        <NavItem to={`/${workspaceId}/media`} label="Media" icon={<IconImage className="size-4" />} active={pathname.startsWith(`/${workspaceId}/media`)} collapsed={collapsed} />

        {/* ── Root-section extension pages: top-level items directly after
            Media (section: 'root' in the manifest nav), rendered in both the
            expanded sidebar and the collapsed rail - the Home/Media pattern. ── */}
        {(() => {
          const navShape = extensionPageNavTrees(extensionUi.pages, apps.map((a) => a.id))
          const allowed = (i: { extensionId: string; access?: import('@tangen/types').AdminAccessRule }) =>
            canUseExtension(i.extensionId) && checkAdminAccess(me, i.access)
          const rootTrees = navShape.trees
            .filter((t) => t.root.section === 'root')
            .filter((t) => allowed(t.root))
            .map((t) => ({ ...t, children: t.children.filter(allowed) }))
          const rootPages = navShape.topLevel
            .filter((i) => (i as { section?: string }).section === 'root')
            .filter(allowed)
          if (rootTrees.length === 0 && rootPages.length === 0) return null
          // Order semantics preserved across trees and flat pages.
          const entries = [
            ...rootTrees.map((t) => ({ order: t.root.order, node: renderPageTree(t) })),
            ...rootPages.map((i) => ({
              order: i.order,
              node: (
                <NavItem
                  key={`root-page-${i.path}`}
                  to={`/${workspaceId}/${i.path}`}
                  label={i.label}
                  icon={<DynamicIcon name={i.icon ?? 'IconPuzzle'} className="size-4" />}
                  active={pathname.startsWith(`/${workspaceId}/${i.path}`)}
                  collapsed={collapsed}
                />
              ),
            })),
          ].sort((a, b) => a.order - b.order)
          return <>{entries.map((e) => e.node)}</>
        })()}

        {/* ── Tier 4: collapsed rail - section icons + hover flyouts ── */}
        {collapsed && (
          <>
            {pins.map((p) => (
              <NavItem key={`rail-pin-${p.to}`} to={p.to} label={p.label} icon={<DynamicIcon name={p.icon ?? 'IconFileText'} className="size-4" />} active={pathname === p.to || pathname.startsWith(`${p.to}/`)} collapsed />
            ))}
            {pins.length > 0 && <div className="mt-2 mb-1 border-t border-border-subtle" />}
            {railSections.map((s) => (
              <RailSection key={s.key} icon={s.icon} label={s.key} items={s.items} pathname={pathname} />
            ))}
          </>
        )}

        {!collapsed && (<>
        {/* Pinned - user-curated favourites */}
        {!collapsed && pins.length > 0 && (
          <>
            <SectionHeader name="Pinned" collapsed={isSectionCollapsed('Pinned')} onToggle={() => toggleSection('Pinned')} />
            <SectionBody open={showItems('Pinned')}>{pins.map((p) => (
              <PinnableNavItem
                key={`pin-${p.to}`}
                item={p}
                active={pathname === p.to || pathname.startsWith(`${p.to}/`)}
                pinned
                onTogglePin={() => togglePin(p)}
              />
            ))}</SectionBody>
          </>
        )}

        {/* Recent - auto-tracked, most recent first (opt-in via config) */}
        {recentsEnabled && !collapsed && recents.length > 0 && (
          <>
            <SectionHeader name="Recent" collapsed={isSectionCollapsed('Recent')} onToggle={() => toggleSection('Recent')} />
            <SectionBody open={showItems('Recent')}>{recents.map((r) => (
              <NavItem key={`rec-${r.to}`} to={r.to} label={r.label} icon={<IconClock className="size-4" />} active={pathname === r.to} collapsed={false} />
            ))}</SectionBody>
          </>
        )}

        {contentEnabled && (
        <>
        {!collapsed && <SectionHeader name="Content" collapsed={isSectionCollapsed('Content')} onToggle={() => toggleSection('Content')} />}
        {collapsed && <div className="mt-3 mb-1 border-t border-border-subtle" />}

        <SectionBody open={showItems('Content')}>{(typesLoading ? (
          !collapsed && (
            <>
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-8 mx-0.5 my-0.5 bg-surface-hover rounded-md animate-pulse" />
              ))}
            </>
          )
        ) : types.length > 0 ? (() => {
          const { topLevel: allTopLevel, childrenOf } = groupedTypes
          const disp = (t: TypeItem) => t.admin?.menu?.label ?? t.label
          const q = collapsed ? '' : contentFilter.trim().toLowerCase()
          const matched = q ? allTopLevel.filter((t) => disp(t).toLowerCase().includes(q)) : allTopLevel
          const { visible: topLevel, overflow } = (collapsed || q || contentMoreOpen)
            ? { visible: matched, overflow: [] as typeof matched }
            : splitOverflow(matched, SECTION_OVERFLOW_LIMIT)
          return (
          <>
          {!collapsed && allTopLevel.length > 6 && (
            <div className="px-2 pt-1 pb-0.5">
              <div className="relative">
                <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-fg-subtle pointer-events-none" />
                <input
                  value={contentFilter}
                  onChange={(e) => setContentFilter((e.target as HTMLInputElement).value)}
                  placeholder="Filter types…"
                  className="h-7 w-full rounded-control border border-border bg-surface-raised pl-6 pr-2 text-ui-xs text-fg placeholder:text-fg-subtle outline-none focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25"
                />
              </div>
            </div>
          )}
          {matched.length === 0 && !collapsed && (
            <p className="px-2.5 py-1.5 text-xs text-fg-subtle">No types match “{contentFilter}”</p>
          )}
          {topLevel.map((t) => {
            const href = `/${workspaceId}/objects/${t.name}`
            const navLabel = t.admin?.menu?.label ?? t.label
            const icon = t.admin?.menu?.icon
              ? <DynamicIcon name={t.admin.menu.icon} className="size-4" />
              : <IconFileText className="size-4" />
            const children = childrenOf.get(t.name) ?? []
            const isExpanded = expandedParents.has(t.name)
            const hasChildren = children.length > 0
            const parentActive = pathname === href || pathname.startsWith(`${href}/`)
            const childActive = children.some(c => {
              const ch = `/${workspaceId}/objects/${c.name}`
              return pathname === ch || pathname.startsWith(`${ch}/`)
            })

            return (
              <div key={t.name}>
                {collapsed ? (
                  <NavItem to={href} label={navLabel} icon={icon} active={parentActive} collapsed={collapsed} />
                ) : hasChildren ? (
                  <ParentRow
                    to={href}
                    label={navLabel}
                    icon={icon}
                    active={parentActive}
                    childActive={childActive}
                    expanded={isExpanded}
                    onToggle={() => toggleParentExpanded(t.name)}
                    pin={{ pinned: isPinned(pins, href), onToggle: () => togglePin({ to: href, label: navLabel, icon: t.admin?.menu?.icon }) }}
                  />
                ) : (
                  <PinnableNavItem
                    item={{ to: href, label: navLabel, icon: t.admin?.menu?.icon }}
                    active={parentActive}
                    pinned={isPinned(pins, href)}
                    onTogglePin={() => togglePin({ to: href, label: navLabel, icon: t.admin?.menu?.icon })}
                  />
                )}

                {/* Taxonomy sub-items, as a tree */}
                {hasChildren && !collapsed && isExpanded && (
                  <TreeChildren>
                    {children.map(child => {
                      const childHref = `/${workspaceId}/objects/${child.name}`
                      return (
                        <TreeChild
                          key={child.name}
                          to={childHref}
                          label={child.admin?.menu?.label ?? child.label}
                          icon={child.admin?.menu?.icon ? <DynamicIcon name={child.admin.menu.icon} /> : <IconFileText />}
                          active={pathname === childHref || pathname.startsWith(`${childHref}/`)}
                        />
                      )
                    })}
                  </TreeChildren>
                )}
              </div>
            )
          })}
          {overflow.length > 0 && !collapsed && (
            <button
              type="button"
              onClick={() => setContentMoreOpen(true)}
              className="mt-0.5 flex h-7 w-full items-center gap-x-2.5 rounded-control px-2 text-ui-xs font-medium text-fg-subtle hover:bg-surface-hover hover:text-fg transition-colors motion-fast"
            >
              <IconChevronDown className="size-3.5 shrink-0" />
              Show {overflow.length} more…
            </button>
          )}
          </>
          )
        })() : (
          !collapsed && (
            <p className="px-2.5 py-2 text-sm text-fg-subtle">
              {devMode ? (
                <>
                  No content types yet - build them in the{' '}
                  <Link to={`/${workspaceId}/schema`} className="text-accent-fg hover:underline">Schema Builder</Link>
                  {' '}or run <code className="font-mono text-accent-fg text-xs">tangen push</code>
                </>
              ) : (
                <>No content types yet.</>
              )}
            </p>
          )
        ))}{/* Globals are content an editor owns (2026-09-07): the last entry of Content, never a setting. */}
        {hasCapability('manage:settings' as never) && (
          <NavItem to={`/${workspaceId}/globals`} label="Globals" icon={<IconGlobe className="size-4" />} active={pathname.startsWith(`/${workspaceId}/globals`)} collapsed={collapsed} />
        )}</SectionBody>
        </>
        )}

        {(() => {
          const devRoutes = (extensionRoutes ?? ADMIN_EXTENSION.routes ?? [])
            .filter(r => r.nav?.section !== 'content' && r.nav?.section !== 'workspace' && r.nav)
            .filter(r => checkAdminAccess(me, (r as { access?: import('@tangen/types').AdminAccessRule }).access))
            .filter(r => {
              const seg = r.path.match(/^extensions\/([^/]+)/)?.[1]
              return !seg || canUseExtension(seg)
            })
          // Package-extension pages (manifest `pages:`) — installed only,
          // member allow-list + page access rule respected. Root-page nav
          // becomes an expandable parent; sub-page nav nests under it.
          const allowed = (i: { extensionId: string; access?: import('@tangen/types').AdminAccessRule }) =>
            canUseExtension(i.extensionId) && checkAdminAccess(me, i.access)
          const navShape = extensionPageNavTrees(extensionUi.pages, apps.map((a) => a.id))
          // Trees whose root targets another section (e.g. Kitchen Sink →
          // 'devspace') render in that section instead, not here.
          const pageTrees = navShape.trees
            .filter((t) => (t.root.section ?? 'extensions') === 'extensions')
            .filter((t) => allowed(t.root))
            .map((t) => ({ ...t, children: t.children.filter(allowed) }))
          // Unknown/unsupported section values fall back HERE rather than
          // silently dropping the page from nav entirely (a manifest typo or
          // an unsupported section must never make a page unreachable).
          // 'root' renders top-level after Media, not in this section.
          const KNOWN_SECTIONS = new Set(['extensions', 'ai', 'devspace', 'root'])
          const pageNav = navShape.topLevel.filter(allowed).filter((i) => {
            const sec = (i as { section?: string }).section
            return sec === undefined || sec === 'extensions' || !KNOWN_SECTIONS.has(sec)
          })
          // Extensions that declare their own page nav replace their auto entry
          const ownNav = extensionsWithOwnNav(extensionUi.pages)
          // A connector pack belongs to Connections, not here.
          const navApps = extensionsForNav(apps)
          const hasExtensions = navApps.length > 0 || devRoutes.length > 0 || pageNav.length > 0 || pageTrees.length > 0
          const sorted = [...devRoutes].sort((a, b) => (a.nav!.order ?? 100) - (b.nav!.order ?? 100))
          // Nothing active: no section at all (2026-09-08). A declared
          // extension is installed by an operator, never by a boot, and the
          // way to install one is documentation, not navigation.
          if (extensionsSectionMode({ hasExtensions }) === 'hidden') return null
          return (
            <>
              {!collapsed && <SectionHeader name="Extensions" collapsed={isSectionCollapsed('Extensions')} onToggle={() => toggleSection('Extensions')} />}
              {collapsed && <div className="mt-3 mb-1 border-t border-border-subtle" />}
              <SectionBody open={showItems('Extensions')}>{(<>
              {navApps.map((app) => {
                if (!canUseExtension(app.id)) return null
                if (ownNav.has(app.id)) return null
                const href = `/${workspaceId}/extensions/${app.id}`
                return (
                  <NavItem key={app.id} to={href} label={app.name} icon={<DynamicIcon name={app.icon} className="size-4" />} active={pathname.startsWith(href)} collapsed={collapsed} />
                )
              })}
              {pageTrees.map((tree) => renderPageTree(tree))}
              {pageNav.map((i) => {
                const href = `/${workspaceId}/${i.path}`
                return (
                  <NavItem key={`ext-page-${i.path}`} to={href} label={i.label} icon={<DynamicIcon name={i.icon ?? 'IconPuzzle'} className="size-4" />} active={pathname.startsWith(href)} collapsed={collapsed} />
                )
              })}
              {sorted.map((r) => {
                const href = `/${workspaceId}/${r.path}`
                return (
                  <NavItem key={r.path} to={href} label={r.nav!.label} icon={<DynamicIcon name={r.nav!.icon ?? 'IconFileText'} className="size-4" />} active={pathname.startsWith(href)} collapsed={collapsed} />
                )
              })}
              </>)}</SectionBody>
            </>
          )
        })()}

        {/* ── AI - the growing home for AI-led features (registry: app/extension
            pages with nav.section 'ai' join it) ─────────────────────────── */}
        {hasCapability('manage:aiSettings' as never) && aiSection && (() => {
          const aiBase = `/${workspaceId}/ai`
          // Knowledge (RAG) is the parent — Q&A + Insights are facets of it, nested
          // below. Content-AI providers moved to Settings → AI.
          const knowledge = { path: `${aiBase}/knowledge`, label: 'Knowledge', icon: 'IconDatabase' }
          const knowledgeChildren = [
            { path: `${aiBase}/qa`, label: 'Q&A', icon: 'IconSurvey' },
            { path: `${aiBase}/insights`, label: 'Insights', icon: 'IconBarChart' },
          ]
          const agents = { path: `${aiBase}/agents`, label: 'Agents (MCP)', icon: 'IconWebhook' }
          const item = (p: { path: string; label: string; icon: string }) => (
            <NavItem key={p.path} to={p.path} label={p.label} icon={<DynamicIcon name={p.icon} className="size-4" />}
              active={pathname.startsWith(p.path)} collapsed={collapsed} />
          )
          const aiDevRoutes = (extensionRoutes ?? ADMIN_EXTENSION.routes ?? [])
            .filter(r => r.nav?.section === 'ai')
            .filter(r => checkAdminAccess(me, (r as { access?: import('@tangen/types').AdminAccessRule }).access))
          const aiExtPages = extensionPageNavTrees(extensionUi.pages, apps.map((a) => a.id))
            .topLevel.filter((i) => (i as any).section === 'ai')
          return (
            <>
              {!collapsed && <SectionHeader name="AI" collapsed={isSectionCollapsed('AI')} onToggle={() => toggleSection('AI')} />}
              {collapsed && <div className="mt-3 mb-1 border-t border-border-subtle" />}
              <SectionBody open={showItems('AI')}>{(<>
              {(() => {
                // Knowledge is an expandable parent (chevron) — Q&A + Insights nest
                // under it, mirroring how taxonomy parents (e.g. Posts) render.
                const knowledgeKey = 'ai:knowledge'
                const knowledgeActive = pathname.startsWith(knowledge.path)
                const childActive = knowledgeChildren.some((c) => pathname.startsWith(c.path))
                const expanded = expandedParents.has(knowledgeKey) || knowledgeActive || childActive
                if (collapsed) return <>{item(knowledge)}{knowledgeChildren.map(item)}</>
                return (
                  <>
                    <ParentRow
                      to={knowledge.path}
                      label={knowledge.label}
                      icon={<DynamicIcon name={knowledge.icon} />}
                      active={knowledgeActive}
                      childActive={childActive}
                      expanded={expanded}
                      onToggle={() => toggleParentExpanded(knowledgeKey)}
                    />
                    {expanded && (
                      <TreeChildren>
                        {knowledgeChildren.map((c) => (
                          <TreeChild key={c.path} to={c.path} label={c.label} icon={<DynamicIcon name={c.icon} />} active={pathname.startsWith(c.path)} />
                        ))}
                      </TreeChildren>
                    )}
                  </>
                )
              })()}
              {item(agents)}
              {aiDevRoutes.map((r) => (
                <NavItem key={r.path} to={`/${workspaceId}/${r.path}`} label={r.nav!.label}
                  icon={<DynamicIcon name={r.nav!.icon ?? 'IconSparkles'} className="size-4" />}
                  active={pathname.startsWith(`/${workspaceId}/${r.path}`)} collapsed={collapsed} />
              ))}
              {aiExtPages.map((i) => (
                <NavItem key={`ai-ext-${i.path}`} to={`/${workspaceId}/${i.path}`} label={i.label}
                  icon={<DynamicIcon name={i.icon ?? 'IconSparkles'} className="size-4" />}
                  active={pathname.startsWith(`/${workspaceId}/${i.path}`)} collapsed={collapsed} />
              ))}
              </>)}</SectionBody>
            </>
          )
        })()}

        {/* ── Devspace - developer reference & tooling (registry: app/extension
            pages with nav.section 'devspace' join it). Owners/admins only. ── */}
        {canAccessDevspace(me?.effectiveRole ?? me?.role) && (() => {
          const dsBase = `/${workspaceId}/devspace`
          const platformPages = devspacePlatformPages({ base: `/${workspaceId}` })
          const dsDevRoutes = (extensionRoutes ?? ADMIN_EXTENSION.routes ?? [])
            .filter(r => r.nav?.section === 'devspace')
            .filter(r => checkAdminAccess(me, (r as { access?: import('@tangen/types').AdminAccessRule }).access))
          const dsNavShape = extensionPageNavTrees(extensionUi.pages, apps.map((a) => a.id))
          const dsAllowed = (i: { extensionId: string; access?: import('@tangen/types').AdminAccessRule }) =>
            canUseExtension(i.extensionId) && checkAdminAccess(me, i.access)
          // Extension trees whose root homes here (e.g. Kitchen Sink) — expandable, nested.
          const dsTrees = dsNavShape.trees
            .filter((t) => (t.root.section ?? 'extensions') === 'devspace')
            .filter((t) => dsAllowed(t.root))
            .map((t) => ({ ...t, children: t.children.filter(dsAllowed) }))
          const dsExtPages = dsNavShape.topLevel.filter((i) => (i as { section?: string }).section === 'devspace')
          return (
            <>
              {!collapsed && <SectionHeader name="Devspace" collapsed={isSectionCollapsed('Devspace')} onToggle={() => toggleSection('Devspace')} />}
              {collapsed && <div className="mt-3 mb-1 border-t border-border-subtle" />}
              <SectionBody open={showItems('Devspace')}>{(<>
              {platformPages.map((p) => p.children?.length
                ? renderPageTree({
                    extensionId: `devspace:${p.label}`,
                    root: { path: p.path.replace(`/${workspaceId}/`, ''), label: p.label, icon: p.icon },
                    children: p.children.map((c) => ({ path: c.path.replace(`/${workspaceId}/`, ''), label: c.label })),
                  })
                : (
                <NavItem key={p.path} to={p.path} label={p.label} icon={<DynamicIcon name={p.icon} className="size-4" />}
                  active={p.path === dsBase ? pathname === dsBase : pathname.startsWith(p.path)} collapsed={collapsed} />
              ))}
              {dsDevRoutes.map((r) => (
                <NavItem key={`ds-dev-${r.path}`} to={`/${workspaceId}/${r.path}`} label={r.nav!.label}
                  icon={<DynamicIcon name={r.nav!.icon ?? 'IconCode'} className="size-4" />}
                  active={pathname.startsWith(`/${workspaceId}/${r.path}`)} collapsed={collapsed} />
              ))}
              {dsTrees.map((tree) => renderPageTree(tree))}
              {dsExtPages.map((i) => (
                <NavItem key={`ds-ext-${i.path}`} to={`/${workspaceId}/${i.path}`} label={i.label}
                  icon={<DynamicIcon name={i.icon ?? 'IconPuzzle'} className="size-4" />}
                  active={pathname.startsWith(`/${workspaceId}/${i.path}`)} collapsed={collapsed} />
              ))}
              </>)}</SectionBody>
            </>
          )
        })()}
        </>)}
        </>)}
      </nav>

      {/* The footer is the one Settings entry (2026-09-07): the account lives
          under Settings > User, so the sticky account card is gone. */}
      <div className={clsx('flex h-(--tg-header-h) shrink-0 items-center border-t border-border-subtle px-2', collapsed && 'justify-center')} data-testid="sidebar-footer">
        <div className={collapsed ? undefined : 'min-w-0 flex-1'}>
          <NavItem to={`/${workspaceId}/settings`} label="Settings" icon={<IconSettings className="size-4" />} active={pathname.startsWith(`/${workspaceId}/settings`)} collapsed={collapsed} />
        </div>
      </div>

      {/* The resize handle (calibration: an 8px hit area straddling the edge,
          a 1px line revealed on hover, focus and drag; arrow keys resize). */}
      {!collapsed && (
        <button
          type="button"
          {...handleProps}
          className="group/resize absolute top-0 -right-1 hidden h-full w-2 cursor-col-resize touch-none select-none border-none bg-transparent p-0 outline-none lg:block"
        >
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border-prominent opacity-0 transition-opacity motion group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100 group-data-[dragging]/resize:opacity-100" />
        </button>
      )}
    </aside>
    </TooltipProvider>
  )
}

/** A collapsible section header — click the row to fold/unfold the section. */
function SectionHeader({ name, collapsed, onToggle }: { name: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="group mt-[15px] flex h-5 w-full items-center gap-1 px-[10px] pr-1 text-ui-sm font-medium text-fg-subtle hover:text-fg-muted transition-colors motion-fast outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
    >
      {name}
      {/* The fold chevron follows the caption and is revealed on hover or
          keyboard focus of the row (and stays when the section is folded), so
          a caption reads as a caption at rest and nothing is reserved before it. */}
      <IconChevronDown className={clsx('size-3 shrink-0 text-fg-faint transition-[opacity,transform] motion-fast group-hover:opacity-100 group-focus-visible:opacity-100', collapsed ? '-rotate-90 opacity-100' : 'opacity-0')} />
    </button>
  )
}

/**
 * A section's items, folding like an accordion: a grid whose single row goes
 * from 1fr to 0fr over the slow motion token, the items kept mounted (so the
 * rail and the tests see them) but inert and invisible while folded.
 */
function SectionBody({ open, children }: { open: boolean; children: React.ReactNode }) {
  const state = open ? 'open' : 'closed'
  return (
    <div data-state={state} className="grid transition-[grid-template-rows] motion-slow data-[state=closed]:grid-rows-[0fr] data-[state=open]:grid-rows-[1fr]">
      <div
        data-state={state}
        className="flex min-h-0 flex-col gap-px overflow-hidden transition-[visibility] motion-slow data-[state=closed]:invisible"
        {...(open ? {} : ({ inert: '' } as Record<string, string>))}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * Collapsed-rail section: an icon that reveals a flyout of the section's items.
 * The flyout is PORTALED to <body> and fixed-positioned at the icon's edge so
 * it escapes the sidebar's overflow clipping (otherwise it renders but is
 * clipped and unclickable). Hover-intent: a short close delay lets the pointer
 * cross the gap into the flyout.
 */
function RailSection({ icon, label, items, pathname }: { icon: string; label: string; items: { to: string; label: string; icon?: IconValue }[]; pathname: string }) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const openNow = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    const r = anchorRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.top, left: r.right + 4 })
    setOpen(true)
  }
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }

  return (
    <div ref={anchorRef} className="relative" onMouseEnter={openNow} onMouseLeave={scheduleClose}>
      <button
        type="button"
        aria-label={label}
        onClick={openNow}
        className={clsx(
          'flex h-(--tg-nav-item-h) w-full items-center justify-center rounded-control transition-colors motion-fast [&_svg]:size-4.5',
          'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
          open ? 'bg-surface-hover text-fg' : 'text-fg-subtle hover:bg-surface-hover hover:text-fg',
        )}
      >
        <DynamicIcon name={icon} className="size-4" />
      </button>
      {open && createPortal(
        <div
          onMouseEnter={openNow}
          onMouseLeave={scheduleClose}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 60 }}
          className="min-w-52 max-h-[70vh] overflow-y-auto rounded-lg bg-surface-raised p-1 shadow-popover"
        >
          <p className="px-2 py-1.5 text-ui-2xs text-fg-subtle">{label}</p>
          {items.map((it) => {
            const active = pathname === it.to || pathname.startsWith(`${it.to}/`)
            return (
              <Link
                key={it.to}
                to={it.to}
                onClick={() => setOpen(false)}
                className={clsx(
                  'flex h-7 items-center gap-x-2.5 rounded-control px-2 text-ui-sm transition-colors motion-fast',
                  active ? 'bg-surface-selected text-fg font-medium' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                )}
              >
                <span className={clsx('shrink-0', active ? 'text-fg' : 'text-fg-subtle')}>
                  <DynamicIcon name={it.icon ?? 'IconFileText'} className="size-4" />
                </span>
                {it.label}
              </Link>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}

/** A pinnable nav row: NavItem + a hover star that toggles the pin. */
function PinnableNavItem({ item, active, pinned, onTogglePin }: { item: NavRef; active: boolean; pinned: boolean; onTogglePin: () => void }) {
  return (
    <div className="group/pin relative">
      <NavItem to={item.to} label={item.label} icon={<DynamicIcon name={item.icon ?? 'IconFileText'} className="size-4" />} active={active} collapsed={false} />
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTogglePin() }}
        aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
        className={clsx(
          'absolute right-1.5 top-1/2 -translate-y-1/2 rounded-xs p-1 transition-opacity motion-fast outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
          pinned ? 'opacity-100 text-warning' : 'opacity-0 group-hover/pin:opacity-100 group-focus-within/pin:opacity-100 text-fg-subtle hover:text-fg',
        )}
      >
        {pinned ? <IconStarFill className="size-3.5" /> : <IconStar className="size-3.5" />}
      </button>
    </div>
  )
}

/**
 * An expandable parent row (a type with taxonomy children, an extension
 * tree, Knowledge): ONE hover across the whole row, the link taking the
 * space, a pin star revealed on hover and the fold chevron at the right,
 * both 24px and both inside the same highlight. Children go in TreeChildren.
 */
function ParentRow({ to, label, icon, active, childActive, expanded, onToggle, pin }: {
  to: string; label: string; icon: React.ReactNode; active: boolean; childActive: boolean
  expanded: boolean; onToggle: () => void
  pin?: { pinned: boolean; onToggle: () => void }
}) {
  const lit = active || childActive
  return (
    <div
      className={clsx(
        'group/parent flex h-(--tg-nav-item-h) items-center rounded-control pr-1 transition-colors motion-fast hover:bg-surface-hover',
        active ? 'bg-surface-hover text-fg' : lit ? 'text-fg' : 'text-fg-muted hover:text-fg',
      )}
    >
      <Link
        to={to}
        className="flex h-full min-w-0 flex-1 items-center gap-1 rounded-control p-1.5 text-ui outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        <span className={clsx('flex size-5 shrink-0 items-center justify-center [&_svg]:size-4.5', lit ? 'text-fg' : 'text-fg-subtle group-hover/parent:text-fg')}>{icon}</span>
        <span className="min-w-0 flex-1 truncate leading-[18px]">{label}</span>
      </Link>
      {pin && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); pin.onToggle() }}
          aria-label={pin.pinned ? `Unpin ${label}` : `Pin ${label}`}
          className={clsx(
            'flex size-6 shrink-0 items-center justify-center rounded-control transition-[opacity,background-color,color] motion-fast hover:bg-surface-selected outline-none focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
            pin.pinned ? 'text-warning' : 'text-fg-subtle opacity-0 hover:text-fg group-hover/parent:opacity-100 group-focus-within/parent:opacity-100',
          )}
        >
          {pin.pinned ? <IconStarFill className="size-3.5" /> : <IconStar className="size-3.5" />}
        </button>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
        className="flex size-6 shrink-0 items-center justify-center rounded-control text-fg-subtle transition-colors motion-fast hover:bg-surface-selected hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      >
        <IconChevronDown className={clsx('size-4 transition-transform motion-fast', expanded && 'rotate-180')} />
      </button>
    </div>
  )
}

/**
 * A parent's children as a tree (the benchmark): a rail down from the
 * parent's icon to the last child, and a connector into each child.
 */
function TreeChildren({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative ml-4 pl-3 before:absolute before:left-0 before:top-0 before:h-[calc(100%-1rem)] before:w-px before:bg-border" data-testid="tree-children">
      {children}
    </div>
  )
}

function TreeChild({ to, label, icon, active }: { to: string; label: string; icon?: React.ReactNode; active: boolean }) {
  return (
    <Link
      to={to}
      className={clsx(
        'relative flex h-(--tg-nav-item-h) items-center gap-1 rounded-control p-1.5 text-ui transition-colors motion-fast',
        'before:absolute before:-left-3 before:top-1/2 before:h-px before:w-3 before:bg-border',
        'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
        active ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      {icon && <span className={clsx('flex size-5 shrink-0 items-center justify-center [&_svg]:size-4', active ? 'text-fg' : 'text-fg-subtle')}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate leading-[18px]">{label}</span>
    </Link>
  )
}

const navRowClass = (active: boolean, collapsed: boolean) => clsx(
  'flex h-(--tg-nav-item-h) w-full items-center rounded-control border border-transparent p-1.5 text-ui transition-colors motion-fast',
  'outline-none focus-visible:border-focus-border',
  collapsed ? 'justify-center' : 'gap-1',
  active ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
)

/** A row that acts instead of navigating (Settings > Other > Sign out), drawn as a NavItem. */
function NavButton({ label, icon, collapsed, onClick }: { label: string; icon: React.ReactNode; collapsed: boolean; onClick: () => void }) {
  const button = (
    <button type="button" onClick={onClick} aria-label={collapsed ? label : undefined} title={collapsed ? label : undefined} className={clsx(navRowClass(false, collapsed), 'cursor-pointer bg-transparent')}>
      <span className="flex size-5 shrink-0 items-center justify-center text-fg-muted [&_svg]:size-4.5">{icon}</span>
      {!collapsed && <span className="min-w-0 flex-1 truncate text-left leading-[18px]">{label}</span>}
    </button>
  )
  if (!collapsed) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function NavItem({
  to, label, icon, active, collapsed, external,
}: {
  to: string; label: string; icon: React.ReactNode; active: boolean; collapsed: boolean
  /** An outside URL: a plain anchor in a new tab, never a router link. */
  external?: boolean
}) {
  const inner = (
    <>
      <span className={clsx('flex size-5 shrink-0 items-center justify-center [&_svg]:size-4.5', active ? 'text-fg' : 'text-fg-muted')}>{icon}</span>
      {!collapsed && <span className="min-w-0 flex-1 truncate text-left leading-[18px]">{label}</span>}
    </>
  )
  // In the rail the label is not on the screen, and a tooltip is not an
  // accessible name - without this a screen reader announces the whole
  // navigation as a column of "link" (Phase 8B browser harness).
  const a11y = { 'aria-label': collapsed ? label : undefined, title: collapsed ? label : undefined }
  const link = external
    ? <a href={to} target="_blank" rel="noreferrer" {...a11y} className={navRowClass(active, collapsed)}>{inner}</a>
    : <Link to={to} {...a11y} className={navRowClass(active, collapsed)}>{inner}</Link>

  if (!collapsed) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The contextual tree (UI V2 spec §15): the context's items, rendered in the
 * sidebar's own column in place of the primary tree. The way back and the
 * context's title live in the sidebar header (SidebarHeader), as in the
 * benchmark, so nothing is repeated here. In the rail every item keeps its accessible name through
 * NavItem's `aria-label={collapsed ? label : undefined}`.
 */
function ContextNavPanel({ context, collapsed, pathname, onSignOut }: { context: ContextNav; collapsed: boolean; pathname: string; onSignOut?: () => void }) {
  const [opened, setOpened] = useState<Set<string>>(() => new Set())
  const iconOf = (icon: ContextNavItem['icon'], cls = 'size-4') =>
    typeof icon === 'string' || icon == null ? <DynamicIcon name={icon ?? 'IconFileText'} className={cls} /> : icon
  // A caption where the group changes (Settings: User, Workspace, Other), drawn
  // like a section caption but static - the context's groups do not fold.
  const captionBefore = (item: ContextNavItem, index: number) => {
    if (collapsed || !item.group || context.items[index - 1]?.group === item.group) return null
    return <p key={`caption-${item.group}`} className="mt-[15px] flex h-5 items-center px-[10px] text-ui-sm font-medium text-fg-subtle" data-testid="context-caption">{item.group}</p>
  }
  // Among the top-level items, the LONGEST matching href is the one lit - a
  // section's home ('/extensions/forms') stays off while its sibling
  // ('/extensions/forms/submissions') is the page.
  const activeTop = activeChild(pathname, context.items.filter((i) => !i.children?.length))
  return (
    <>
      {context.items.map((item, index) => {
        const kids = item.children ?? []
        if (kids.length === 0) {
          return (
            <React.Fragment key={item.id}>
              {captionBefore(item, index)}
              {item.action === 'sign-out'
                ? <NavButton label={item.label} icon={iconOf(item.icon)} collapsed={collapsed} onClick={() => onSignOut?.()} />
                : <NavItem to={item.href} label={item.label} icon={iconOf(item.icon)} active={activeTop?.id === item.id} collapsed={collapsed} external={item.external} />}
            </React.Fragment>
          )
        }
        // A section with pages of its own: a parent row and a tree, as the primary tree draws them.
        const current = activeChild(pathname, kids)
        if (collapsed) {
          return (
            <React.Fragment key={item.id}>
              {kids.map((k) => <NavItem key={k.id} to={k.href} label={k.label} icon={iconOf(k.icon)} active={current?.id === k.id} collapsed />)}
            </React.Fragment>
          )
        }
        const expanded = opened.has(item.id) || current !== null
        return (
          <div key={item.id}>
            {captionBefore(item, index)}
            <ParentRow
              to={item.href}
              label={item.label}
              icon={iconOf(item.icon, 'size-4.5')}
              active={false}
              childActive={current !== null}
              expanded={expanded}
              onToggle={() => setOpened((prev) => { const next = new Set(prev); if (expanded) next.delete(item.id); else next.add(item.id); return next })}
            />
            {expanded && (
              <TreeChildren>
                {kids.map((k) => <TreeChild key={k.id} to={k.href} label={k.label} icon={iconOf(k.icon)} active={current?.id === k.id} />)}
              </TreeChildren>
            )}
          </div>
        )
      })}
    </>
  )
}
