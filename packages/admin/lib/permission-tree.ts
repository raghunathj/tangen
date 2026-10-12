/**
 * File Name: permission-tree.ts
 * Purpose: The pure model behind the shared permission tree
 *   (tasks/plan-permissions-tree.md P1) - the node types, the tri-state math,
 *   and the builders that shape a capability catalog into grouped sections
 *   (Management, and one group per installed extension with its resources
 *   sub-grouped). The React `PermissionTree` renders these; roles and the member
 *   page both consume it. No React here - pure and unit-tested.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** A single toggleable permission (a leaf of the tree). */
export interface PermLeaf {
  id: string
  label: string
  /** read | write | delete | manage | open | <custom> - drives the row icon. */
  action: string
  slug?: string
  sensitive?: boolean
}
/** A parent with children - either a group (top level) or a resource sub-group. */
export interface PermNode {
  id: string
  label: string
  icon?: string
  desc?: string
  /** True for an extension resource sub-group (renders indented). */
  resource?: boolean
  children: PermItem[]
}
export type PermItem = PermLeaf | PermNode
export interface PermSection { title: string; groups: PermNode[] }

export function isLeaf(n: PermItem): n is PermLeaf {
  return (n as PermNode).children === undefined
}
export function leavesOf(node: PermItem): PermLeaf[] {
  return isLeaf(node) ? [node] : node.children.flatMap(leavesOf)
}
export type Tri = 'none' | 'some' | 'all'
export function triStateOf(node: PermItem, granted: ReadonlySet<string>): Tri {
  const leaves = leavesOf(node)
  const on = leaves.filter((l) => granted.has(l.id)).length
  return on === 0 ? 'none' : on === leaves.length ? 'all' : 'some'
}
/** The leaf ids a toggle on this node may flip (locked leaves never move). */
export function toggleableLeafIds(node: PermItem, locked: ReadonlySet<string>): string[] {
  return leavesOf(node).filter((l) => !locked.has(l.id)).map((l) => l.id)
}
export function grantedCount(node: PermItem, granted: ReadonlySet<string>): [number, number] {
  const leaves = leavesOf(node)
  return [leaves.filter((l) => l.id === l.id && granted.has(l.id)).length, leaves.length]
}

// ── Catalog → sections ────────────────────────────────────────────────────────

export interface CatalogEntry {
  id: string
  label: string
  source: 'core' | 'extension'
  extensionId?: string
  resource?: string
  action?: string
  sensitive?: boolean
  implies?: string[]
}

/** Which core capabilities belong under which Management group, in order. */
const CORE_GROUPS: Array<{ id: string; label: string; icon: string; desc: string; caps: string[] }> = [
  { id: 'members', label: 'Members & roles', icon: 'IconUsers', desc: 'Who is in the workspace and what they can do.', caps: ['manage:members', 'manage:roles'] },
  { id: 'apiKeys', label: 'API keys', icon: 'IconKey', desc: 'Programmatic access keys.', caps: ['manage:apiKeys'] },
  { id: 'webhooks', label: 'Webhooks', icon: 'IconWebhook', desc: 'Outbound event delivery.', caps: ['manage:webhooks'] },
  { id: 'settings', label: 'Settings, AI & jobs', icon: 'IconSettings', desc: 'Workspace configuration.', caps: ['manage:settings', 'connections:use', 'manage:aiSettings', 'use:ai', 'manage:cron', 'schema:migrate'] },
  { id: 'releases', label: 'Releases', icon: 'IconUpload', desc: 'Review, approve and apply releases.', caps: ['releases:review', 'releases:approve', 'releases:apply'] },
]

const inferAction = (id: string): string => {
  const verb = id.split(':')[0]
  return ['read', 'write', 'delete', 'manage', 'open'].includes(verb) ? verb : 'manage'
}

/** The Management section: core capabilities in fixed groups. */
export function buildManagementSection(catalog: CatalogEntry[]): PermSection {
  const byId = new Map(catalog.filter((c) => c.source === 'core').map((c) => [c.id, c]))
  const groups: PermNode[] = []
  for (const g of CORE_GROUPS) {
    const children: PermLeaf[] = g.caps
      .filter((id) => byId.has(id))
      .map((id) => ({ id, label: byId.get(id)!.label, action: inferAction(id), slug: id }))
    if (children.length) groups.push({ id: g.id, label: g.label, icon: g.icon, desc: g.desc, children })
  }
  return { title: 'Management', groups }
}

/**
 * The Extensions section: one group per installed extension. A capability with
 * `resource` metadata nests under a resource sub-group; a raw capability is a
 * direct leaf; every extension gets an implicit "Open pages" leaf (id
 * `ext:<id>`).
 */
export function buildExtensionSection(
  extensions: Array<{ id: string; label: string }>,
  catalog: CatalogEntry[],
): PermSection {
  const groups: PermNode[] = []
  for (const ext of extensions) {
    const caps = catalog.filter((c) => c.source === 'extension' && c.extensionId === ext.id)
    const children: PermItem[] = [
      { id: `ext:${ext.id}`, label: 'Open pages', action: 'open', slug: `ext:${ext.id}` },
    ]
    // Resource sub-groups, in first-seen order.
    const resources = new Map<string, PermLeaf[]>()
    const raw: PermLeaf[] = []
    for (const c of caps) {
      const leaf: PermLeaf = { id: c.id, label: c.label, action: c.action ?? inferAction(c.id), slug: c.id, sensitive: c.sensitive }
      if (c.resource) { (resources.get(c.resource) ?? resources.set(c.resource, []).get(c.resource)!).push(leaf) }
      else raw.push(leaf)
    }
    for (const [resId, leaves] of resources) {
      children.push({ id: `${ext.id}/${resId}`, label: cap(resId), resource: true, children: leaves })
    }
    children.push(...raw)
    groups.push({ id: `ext.${ext.id}`, label: ext.label, icon: 'IconPuzzle', desc: undefined, children })
  }
  return { title: 'Extensions', groups }
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }
