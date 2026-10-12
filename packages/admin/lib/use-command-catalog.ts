/**
 * File Name: use-command-catalog.ts
 * Purpose: Assembles the command palette's navigation catalog from the SAME
 *          sources and gates the sidebar uses — content types, Media,
 *          extensions + their pages, and the capability/role-gated AI,
 *          Devspace and Settings sections — then hands them to buildNavCommands.
 *          Keeping the gating here (not in the pure catalog module) means the
 *          palette never offers a destination the sidebar would hide.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useMemo } from 'react'
import { useExtensionUi } from '@/lib/extension-ui'
import { ADMIN_EXTENSION } from 'virtual:tangen/app-ui-registry'
import type { AdminAccessRule, IconValue } from '@tangen/types'
import { buildNavCommands, buildActionCommands, buildThemeCommands, buildExtensionCommandItems, buildContextCommands, type CommandItem, type NavCommandInput, type ContextCommandInput } from './command-catalog'
import { groupTypesBySidebar } from './sidebar'
import { extensionPageNavTrees, extensionsWithOwnNav } from './extension-pages'
import { devspacePlatformPages, canAccessDevspace } from './devspace'
import { buildSettingsNavItems, filterSettingsNavItems } from './settings-nav'
import { extensionsForNav } from './nav-sections'
import { useCan } from './use-can'
import { useTheme } from './theme'
import { useGraphqlEnabled } from './use-graphql-enabled'
import { checkAdminAccess } from '@/components/require-permission'

interface TypeItem { name: string; label: string; admin?: { menu?: { icon?: string; label?: string; show?: boolean; order?: number; parentExtension?: string } } }
interface AppItem { id: string; name: string; icon?: string; kind?: 'extension' | 'connector-pack' }

/** Build the (gated) navigation half of the command catalog. */
export function useNavCommands(workspaceId: string, types: TypeItem[], apps: AppItem[]): CommandItem[] {
  // K7.3: build-time extension pages and commands merged with the runtime-loaded ones.
  const extensionUi = useExtensionUi(workspaceId)
  const { me, hasCapability, canUseExtension } = useCan()
  const role = me?.effectiveRole ?? me?.role
  const isAdmin = canAccessDevspace(role)
  const graphqlEnabled = useGraphqlEnabled(isAdmin)

  const themeMode = useTheme((t) => t.mode)
  return useMemo(() => {
    const base = `/${workspaceId}`
    const appIds = apps.map((a) => a.id)

    // Content types (flatten the sidebar's parent/child grouping).
    const { topLevel, childrenOf } = groupTypesBySidebar(types as never)
    const contentTypes: NavCommandInput['contentTypes'] = []
    for (const t of topLevel) {
      contentTypes.push({ name: t.name, label: t.admin?.menu?.label ?? t.label, icon: t.admin?.menu?.icon })
      for (const c of childrenOf.get(t.name) ?? []) {
        contentTypes.push({ name: c.name, label: c.admin?.menu?.label ?? c.label, icon: c.admin?.menu?.icon })
      }
    }

    // Extensions: auto-entry apps (those NOT represented by their own pages).
    const ownNav = extensionsWithOwnNav(extensionUi.pages)
    const extensions = extensionsForNav(apps)
      .filter((a) => canUseExtension(a.id) && !ownNav.has(a.id))
      .map((a) => ({ id: a.id, name: a.name, icon: a.icon }))

    // Extension pages (root trees + children + escaped top-level), gated and
    // routed to a group by their section (ai / devspace / extensions).
    const navShape = extensionPageNavTrees(extensionUi.pages, appIds)
    const flatPages = [
      ...navShape.trees.flatMap((t) => [
        { to: `${base}/${t.root.path}`, label: t.root.label, icon: t.root.icon, section: t.root.section, extensionId: t.extensionId, access: (t.root as { access?: AdminAccessRule }).access },
        ...t.children.map((c) => ({ to: `${base}/${c.path}`, label: c.label, icon: c.icon, section: c.section, extensionId: c.extensionId, access: (c as { access?: AdminAccessRule }).access })),
      ]),
      ...navShape.topLevel.map((i) => ({ to: `${base}/${i.path}`, label: i.label, icon: i.icon, section: i.section, extensionId: i.extensionId, access: (i as { access?: AdminAccessRule }).access })),
    ].filter((p) => canUseExtension(p.extensionId) && checkAdminAccess(me, p.access))

    const extensionPages: NavCommandInput['extensionPages'] = []
    const platformPages: NavCommandInput['platformPages'] = []
    for (const p of flatPages) {
      if (p.section === 'ai') platformPages.push({ to: p.to, label: p.label, icon: p.icon, group: 'AI' })
      else if (p.section === 'devspace') { if (isAdmin) platformPages.push({ to: p.to, label: p.label, icon: p.icon, group: 'Devspace' }) }
      else extensionPages.push({ to: p.to, label: p.label, icon: p.icon })
    }

    // Site-dev extension routes (ADMIN_EXTENSION.routes) with a nav entry.
    for (const r of (ADMIN_EXTENSION.routes ?? [])) {
      if (!r.nav || !checkAdminAccess(me, (r as { access?: AdminAccessRule }).access)) continue
      const to = `${base}/${r.path}`
      const section = r.nav.section
      if (section === 'ai') platformPages.push({ to, label: r.nav.label, icon: r.nav.icon, group: 'AI' })
      else if (section === 'devspace') { if (isAdmin) platformPages.push({ to, label: r.nav.label, icon: r.nav.icon, group: 'Devspace' }) }
      else extensionPages.push({ to, label: r.nav.label, icon: r.nav.icon })
    }

    // AI platform pages (mirror the sidebar) — capability-gated. Knowledge (RAG)
    // + its facets (Q&A/Insights) and Agents (MCP); providers live in Settings → AI.
    if (hasCapability('manage:aiSettings' as never)) {
      const aiBase = `${base}/ai`
      for (const p of [
        { to: `${aiBase}/knowledge`, label: 'Knowledge', icon: 'IconDatabase' },
        { to: `${aiBase}/qa`, label: 'Q&A', icon: 'IconSurvey' },
        { to: `${aiBase}/insights`, label: 'Insights', icon: 'IconBarChart' },
        { to: `${aiBase}/agents`, label: 'Agents (MCP)', icon: 'IconWebhook' },
      ]) platformPages.push({ ...p, group: 'AI' })
      platformPages.push({ to: `${base}/settings/ai`, label: 'AI settings (providers)', icon: 'IconSparkles', group: 'Settings' })
    }

    // Globals are content: the Content group, beside the types (sidebar mirror).
    if (hasCapability('manage:settings' as never)) {
      platformPages.push({ to: `${base}/globals`, label: 'Globals', icon: 'IconGlobe', group: 'Content' })
    }
    // Devspace platform pages — owner/admin only.
    if (isAdmin) {
      for (const p of devspacePlatformPages({ base, graphqlEnabled })) {
        platformPages.push({ to: p.path, label: p.label, icon: p.icon, group: 'Devspace' })
      }
    }

    // Settings — capability/role-filtered. Deep links to each sub-page (great
    // for jump-to), plus one umbrella "Settings" entry mirroring the sidebar.
    const settingsItems = filterSettingsNavItems(buildSettingsNavItems(workspaceId), hasCapability as never, role)
    if (settingsItems.length > 0) {
      platformPages.push({ to: `${base}/settings`, label: 'Settings', icon: 'IconSettings', group: 'Settings' })
    }
    for (const s of settingsItems) {
      // An action row (Sign out) and an outside link are not places to jump to.
      if (s.action || s.external) continue
      platformPages.push({ to: s.href, label: s.label, icon: s.icon, group: 'Settings' })
    }

    // Quick actions first (create/upload), then navigation.
    const actions = buildActionCommands({
      base,
      creatableTypes: contentTypes,
    })
    // Per-extension declared quick actions (≤3 each), for installed+allowed exts.
    const extActions: CommandItem[] = []
    for (const app of apps) {
      if (!canUseExtension(app.id)) continue
      const cmds = extensionUi.commands[app.id]
      extActions.push(...buildExtensionCommandItems(base, app.id, cmds, app.name))
    }
    const theme = buildThemeCommands((m) => useTheme.getState().setMode(m), themeMode)
    return [...actions, ...extActions, ...theme, ...buildNavCommands({ base, contentTypes, extensions, extensionPages, platformPages })]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, types, apps, me, isAdmin, graphqlEnabled, themeMode, extensionUi])
}

/**
 * Page-aware "On this page" commands derived from the current pathname — no
 * fetches, only data the palette already holds (types, extension nav metadata,
 * apps), gated exactly like the static catalog so context never offers a
 * destination the sidebar would hide.
 */
export function useContextCommands(workspaceId: string, pathname: string, types: TypeItem[], apps: AppItem[]): CommandItem[] {
  const { me, canUseExtension } = useCan()
  const extensionUi = useExtensionUi(workspaceId)
  const role = me?.effectiveRole ?? me?.role
  const isAdmin = canAccessDevspace(role)

  return useMemo(() => {
    const base = `/${workspaceId}`
    const contentTypes: ContextCommandInput['contentTypes'] =
      types.map((t) => ({ name: t.name, label: t.admin?.menu?.label ?? t.label, icon: t.admin?.menu?.icon }))

    // Extension destinations the static catalog already knows: nav pages first
    // (author's nav order), then plain roots for auto-entry extensions.
    const navShape = extensionPageNavTrees(extensionUi.pages, apps.map((a) => a.id))
    const extensionPages: ContextCommandInput['extensionPages'] = []
    const pushPage = (p: { extensionId: string; path: string; label: string; icon?: IconValue; section?: string; access?: AdminAccessRule }) => {
      if (!canUseExtension(p.extensionId) || !checkAdminAccess(me, p.access)) return
      if (p.section === 'devspace' && !isAdmin) return
      extensionPages.push({ to: `${base}/${p.path}`, label: p.label, icon: p.icon })
    }
    for (const t of navShape.trees) { pushPage(t.root); t.children.forEach(pushPage) }
    navShape.topLevel.forEach(pushPage)
    // Site-dev extension routes with a nav entry (always installed).
    for (const r of (ADMIN_EXTENSION.routes ?? [])) {
      if (!r.nav || !checkAdminAccess(me, (r as { access?: AdminAccessRule }).access)) continue
      if (r.nav.section === 'devspace' && !isAdmin) continue
      extensionPages.push({ to: `${base}/${r.path}`, label: r.nav.label, icon: r.nav.icon })
    }
    // Extension roots (labels from the installed-apps list).
    for (const a of apps) {
      if (canUseExtension(a.id)) extensionPages.push({ to: `${base}/extensions/${a.id}`, label: a.name, icon: a.icon })
    }

    return buildContextCommands({ base, pathname, contentTypes, extensionPages })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, pathname, types, apps, me, isAdmin, extensionUi])
}
