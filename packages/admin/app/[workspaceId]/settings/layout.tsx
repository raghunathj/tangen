/**
 * File Name: layout.tsx (workspace settings)
 * Purpose: The Settings route family. Its navigation is a CONTEXT (UI V2
 *          spec §15): while a route is under /settings the sidebar shows the
 *          settings tree with a way back, in the same column, so this layout
 *          no longer renders a navigation column of its own. When the sidebar has
 *          narrowed to a rail, the tree becomes a SubNav row under the frame
 *          header so nothing stacks and every item keeps its label.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { Link, Outlet, useParams, useLocation } from 'react-router-dom'
import { SubNav, SubNavItem } from '@tangen/ui'
import { DynamicIcon } from '@/components/dynamic-icon'
import { buildSettingsNavItems, isSettingsItemActive } from '@/lib/settings-nav'
import { resolveContextNav, isContextItemActive } from '@/lib/context-nav'
import { useCan } from '@/lib/use-can'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { useNavConfig } from '@/lib/use-nav-config'
import { useSignOut } from '@/lib/use-sign-out'
import { NoPermission } from '@/components/require-permission'
import { settingsColumnClass, useSettingsWidthStore } from '@/lib/settings-width'

export default function SettingsLayout() {
  const params = useParams<{ workspaceId: string }>()
  const { pathname } = useLocation()
  const { hasCapability, ready, me } = useCan()
  const narrow = useNarrowViewport()
  const { links } = useNavConfig()
  const signOut = useSignOut()
  // A table-shaped page asks for the wide column (useSettingsWidth); a page of
  // cards gets the 900px one, which is the default and the decision.
  const width = useSettingsWidthStore((w) => w.width)
  const context = resolveContextNav({
    pathname,
    workspaceId: params.workspaceId!,
    hasCapability: (cap) => hasCapability(cap as never),
    role: me?.effectiveRole ?? me?.role,
    links,
  })

  // Direct-URL guard: the nav filter hides items, this blocks the page.
  const all = buildSettingsNavItems(params.workspaceId!)
  const current = all.find((i) => isSettingsItemActive(pathname, i))
  const blocked = ready && current?.capability && !hasCapability(current.capability as never)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {narrow && context && (
        <SubNav label={context.title} className="shrink-0 border-b border-border-subtle bg-surface">
          {context.items.map((item) => (
            <SubNavItem key={item.id} asChild active={isContextItemActive(pathname, item)} icon={item.icon ? <DynamicIcon name={item.icon} /> : undefined}>
              {item.action === 'sign-out'
                ? <button type="button" onClick={() => { void signOut() }}>{item.label}</button>
                : item.external
                  ? <a href={item.href} target="_blank" rel="noreferrer">{item.label}</a>
                  : <Link to={item.href}>{item.label}</Link>}
            </SubNavItem>
          ))}
        </SubNav>
      )}
      {/* The settings column: 900px wide (the user's calls of 2026-09-07 and 2026-09-08: wider than the benchmark's 850, narrower than the 1100 tried in between), 120px below. */}
      {/* The settings ground is white (the benchmark's page); every card sits a hair darker on it. */}
      <div className="relative min-w-0 flex-1 overflow-y-auto bg-page">
        <div className={settingsColumnClass(width)}>
          {blocked ? <NoPermission /> : <Outlet />}
        </div>
      </div>
    </div>
  )
}
