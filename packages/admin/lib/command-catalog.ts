/**
 * File Name: command-catalog.ts
 * Purpose: The command palette's client-side catalog — the jump-to-anything
 *          index. buildNavCommands turns the same data the sidebar computes
 *          (content types, media, extensions + pages, AI/Devspace/Settings)
 *          into flat, navigable CommandItems; filterCommands ranks them for a
 *          query. Pure and synchronous — gating (Devspace admin-only, extension
 *          access) is the caller's responsibility since it holds the me-bundle.
 *          Server-backed sources (content records, media assets) are merged in
 *          by the palette separately.
 *
 * Author: Raghunath J
 * License: MIT
 */

import type { IconValue } from '@tangen/types'

export type CommandKind = 'action' | 'nav' | 'content' | 'media'

export interface CommandItem {
  /** Stable, unique key. */
  id: string
  label: string
  kind: CommandKind
  /** Absolute admin path to navigate to. */
  to: string
  /** An action performed in place instead of a navigation (the theme
   *  switch). When present the palette calls it and does not navigate. */
  run?: () => void
  /** @tangen/icons name or a custom `{ src }` image (resolved by DynamicIcon). */
  icon?: IconValue
  /** Display group heading (Content, Navigation, Extensions, AI, …). */
  group: string
  /** Extra text folded into matching (aliases, type name, …). */
  keywords?: string
  /** Optional muted second line (e.g. a content hit's type). */
  sublabel?: string
  /**
   * Origin shown as an inline text prefix on the row ("Content: New Page") for
   * built-in actions whose bare label would otherwise collide. Display-only —
   * matching/ranking still uses the bare `label`, so "new page" stays an
   * exact-action match. Extension commands use `tag` instead (their author-set
   * label often already carries the extension name, so a prefix would double it).
   */
  source?: string
  /**
   * A small neutral category pill on the right of the row (e.g. "Extension"),
   * marking where an item comes from without touching its label.
   */
  tag?: string
  /** Optional status pill text (e.g. a content hit's status). */
  badge?: string
}

export interface NavCommandInput {
  /** `/<workspaceId>/<env>`. */
  base: string
  /** Visible content types (topLevel + children already flattened). */
  contentTypes: { name: string; label: string; icon?: IconValue }[]
  /** Installed extensions (their root entry). */
  extensions: { id: string; name: string; icon?: IconValue }[]
  /** Extension pages, `to` already absolute (from the sidebar's nav trees). */
  extensionPages: { to: string; label: string; icon?: IconValue }[]
  /**
   * Platform pages that live in a gated section (AI, Devspace, Settings). The
   * caller pre-filters these by role/capability and tags each with its group.
   */
  platformPages: { to: string; label: string; icon?: IconValue; group: string }[]
}

/** Build the navigable (non-action) half of the catalog. */
export function buildNavCommands(input: NavCommandInput): CommandItem[] {
  const { base } = input
  const items: CommandItem[] = []

  // Media — always present, top of Navigation.
  items.push({ id: 'nav:media', label: 'Media', kind: 'nav', to: `${base}/media`, icon: 'IconImage', group: 'Navigation' })

  // Content types → their object list.
  for (const t of input.contentTypes) {
    items.push({
      id: `nav:type:${t.name}`,
      label: t.label,
      kind: 'nav',
      to: `${base}/objects/${t.name}`,
      icon: t.icon ?? 'IconFileText',
      group: 'Content',
      keywords: t.name,
    })
  }

  // Extensions (root entry).
  for (const e of input.extensions) {
    items.push({
      id: `nav:ext:${e.id}`,
      label: e.name,
      kind: 'nav',
      to: `${base}/extensions/${e.id}`,
      icon: e.icon ?? 'IconPuzzle',
      group: 'Extensions',
      keywords: e.id,
    })
  }

  // Extension pages (already absolute).
  for (const p of input.extensionPages) {
    items.push({
      id: `nav:extpage:${p.to}`,
      label: p.label,
      kind: 'nav',
      to: p.to,
      icon: p.icon ?? 'IconPuzzle',
      group: 'Extensions',
    })
  }

  // Gated platform pages (AI / Devspace / Settings) — caller-filtered.
  for (const p of input.platformPages) {
    items.push({
      id: `nav:platform:${p.to}`,
      label: p.label,
      kind: 'nav',
      to: p.to,
      icon: p.icon,
      group: p.group,
    })
  }

  return items
}

export interface ExtensionCommandDef { label: string; icon?: IconValue; to: string }

/** Max quick actions a single extension may surface in the palette. */
export const MAX_EXTENSION_COMMANDS = 3

/**
 * Turn an extension's declared `commands` into palette action items — capped at
 * MAX_EXTENSION_COMMANDS and confined to the extension's own routes. A bare
 * `to` (e.g. `'settings'`) is resolved to `extensions/<id>/settings`; a `to`
 * that escapes the extension (absolute elsewhere, or containing `..`) is
 * dropped so an extension can only send you into its own surface.
 */
export function buildExtensionCommandItems(
  base: string,
  extensionId: string,
  commands: ExtensionCommandDef[] | undefined,
  extensionName?: string,
): CommandItem[] {
  if (!commands?.length) return []
  const prefix = `extensions/${extensionId}`
  const out: CommandItem[] = []
  for (const c of commands.slice(0, MAX_EXTENSION_COMMANDS)) {
    const rel = c.to.replace(/^\/+/, '')
    if (rel.includes('..')) continue // no path traversal
    const path = rel === prefix || rel.startsWith(`${prefix}/`) ? rel : `${prefix}/${rel}`
    if (path !== prefix && !path.startsWith(`${prefix}/`)) continue // must stay in-extension
    out.push({
      id: `extcmd:${extensionId}:${out.length}`,
      label: c.label,
      kind: 'action',
      to: `${base}/${path}`,
      icon: c.icon ?? 'IconPlus',
      group: 'Actions',
      tag: 'Extension',
      keywords: `${extensionName ?? ''} ${extensionId}`.trim(),
    })
  }
  return out
}

/** Light singulariser for action labels: Posts → Post, but Address stays. */
function singularise(label: string): string {
  if (label.length > 3 && label.endsWith('s') && !label.endsWith('ss')) return label.slice(0, -1)
  return label
}

export interface ActionCommandInput {
  /** `/<workspaceId>/<env>`. */
  base: string
  /** Content types a "New «type»" action should be generated for. */
  creatableTypes: { name: string; label: string; icon?: IconValue }[]
}

/**
 * The action half of the catalog — declarative "quick actions" that navigate to
 * a create/upload screen. Platform defaults only; site-dev and per-extension
 * actions are merged by the caller.
 */
/** The three theme preferences as palette commands (UI V2 spec §4). */
export function buildThemeCommands(setMode: (mode: 'light' | 'dark' | 'system') => void, current: 'light' | 'dark' | 'system'): CommandItem[] {
  const defs = [
    { mode: 'light' as const, label: 'Theme: Light', icon: 'IconSun' as IconValue, keywords: 'appearance light mode day' },
    { mode: 'dark' as const, label: 'Theme: Dark', icon: 'IconMoon' as IconValue, keywords: 'appearance dark mode night' },
    { mode: 'system' as const, label: 'Theme: System', icon: 'IconComputer' as IconValue, keywords: 'appearance system auto follow os' },
  ]
  return defs.map((d) => ({
    id: `action:theme:${d.mode}`,
    label: d.label,
    kind: 'action',
    to: '',
    icon: d.icon,
    group: 'Actions',
    keywords: d.keywords,
    badge: d.mode === current ? 'Current' : undefined,
    run: () => setMode(d.mode),
  }))
}

export function buildActionCommands(input: ActionCommandInput): CommandItem[] {
  const { base } = input
  const items: CommandItem[] = []
  items.push({ id: 'action:upload-media', label: 'Upload media', kind: 'action', to: `${base}/media`, icon: 'IconUpload', group: 'Actions', keywords: 'new image file asset upload' })
  for (const t of input.creatableTypes) {
    items.push({
      id: `action:new:${t.name}`,
      label: `New ${singularise(t.label)}`,
      kind: 'action',
      to: `${base}/objects/${t.name}/new`,
      icon: 'IconPlus',
      group: 'Actions',
      source: 'Content',
      keywords: `create add ${t.label} ${t.name}`,
    })
  }
  return items
}

// ── Contextual (page-aware) commands ────────────────────────────────────────

/** Group heading for page-aware entries; renders as the palette's top group. */
export const CONTEXT_GROUP = 'On this page'

export interface ContextCommandInput {
  /** `/<workspaceId>/<env>`. */
  base: string
  /** The router's current pathname (absolute). */
  pathname: string
  /** Visible content types (same shape the nav catalog uses). */
  contentTypes: { name: string; label: string; icon?: IconValue }[]
  /**
   * Every gated extension destination the catalog already knows — roots and
   * nav pages — with `to` absolute, in sidebar nav order. Used to offer an
   * extension's OTHER routes while you are inside that extension.
   */
  extensionPages: { to: string; label: string; icon?: IconValue }[]
}

/**
 * Derive "On this page" commands from the current pathname — navigation only
 * (no editor state is reachable from here), no fetches, only data the palette
 * already holds. Rules:
 * - object LIST (`objects/:type`)      → "New «type»" (the list page's New CTA)
 * - object EDITOR (`objects/:type/…`)  → "Back to «type» list"
 * - extension page (`extensions/:id…`) → that extension's other nav routes
 * - settings sub-page (`settings/…`)   → "Back to Settings overview"
 * Unknown pages produce nothing. Callers de-dupe static twins via
 * mergeContextCommands / buildEmptyStateCommands.
 */
export function buildContextCommands(input: ContextCommandInput): CommandItem[] {
  const { base, pathname } = input
  if (!pathname.startsWith(`${base}/`)) return []
  const segments = pathname.slice(base.length).split('/').filter(Boolean)
  const items: CommandItem[] = []

  if (segments[0] === 'objects' && segments.length >= 2) {
    const type = input.contentTypes.find((t) => t.name === segments[1])
    if (!type) return []
    if (segments.length === 2) {
      // List page → same target as the page's New button.
      items.push({ id: `ctx:new:${type.name}`, label: `New ${singularise(type.label)}`, kind: 'action', to: `${base}/objects/${type.name}/new`, icon: 'IconPlus', group: CONTEXT_GROUP, keywords: `create add ${type.label} ${type.name}` })
    } else {
      // Editor / new / bulk-edit / submissions → back to the list.
      items.push({ id: `ctx:list:${type.name}`, label: `Back to ${type.label} list`, kind: 'nav', to: `${base}/objects/${type.name}`, icon: 'IconArrowLeft', group: CONTEXT_GROUP, keywords: type.name })
    }
  } else if (segments[0] === 'extensions' && segments.length >= 2) {
    const root = `${base}/extensions/${segments[1]}`
    for (const p of input.extensionPages) {
      if (p.to !== root && !p.to.startsWith(`${root}/`)) continue // other extensions
      if (p.to === pathname) continue                             // you are here
      if (items.some((i) => i.to === p.to)) continue              // one entry per target
      items.push({ id: `ctx:ext:${p.to}`, label: p.label, kind: 'nav', to: p.to, icon: p.icon ?? 'IconPuzzle', group: CONTEXT_GROUP })
    }
  } else if (segments[0] === 'settings' && segments.length >= 2) {
    items.push({ id: 'ctx:settings-overview', label: 'Back to Settings overview', kind: 'nav', to: `${base}/settings`, icon: 'IconSettings', group: CONTEXT_GROUP, keywords: 'settings home overview' })
  }
  return items
}

/**
 * Put context entries in front of the catalog, dropping catalog items that
 * target the same URL (the contextual copy wins). The palette's query path
 * ranks this merged list, so contextual entries are searchable without
 * duplicating their static twins.
 */
export function mergeContextCommands(context: CommandItem[], nav: CommandItem[]): CommandItem[] {
  if (context.length === 0) return nav
  const tos = new Set(context.map((c) => c.to))
  return [...context, ...nav.filter((n) => !tos.has(n.to))]
}

/**
 * Map a media asset (from GET /media?q=) to a Media command. There's no
 * per-asset route, so it deep-links the library filtered to the filename
 * (the media page seeds its search from ?q=).
 */
export function buildMediaCommand(
  base: string,
  asset: { id: string; filename: string; originalName?: string; mimeType?: string },
): CommandItem {
  const label = asset.originalName || asset.filename
  return {
    id: `media:${asset.id}`,
    label,
    kind: 'media',
    to: `${base}/media?q=${encodeURIComponent(asset.filename)}`,
    icon: asset.mimeType?.startsWith('image/') ? 'IconImage' : 'IconFileText',
    group: 'Media',
    sublabel: asset.mimeType,
  }
}

/** Lowercase subsequence test: are all chars of `q` present in `s`, in order? */
function isSubsequence(q: string, s: string): boolean {
  let i = 0
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) i++
  }
  return i === q.length
}

/**
 * Score an item against a lowercased query. Higher = better; -1 = no match.
 * Ordering intent: exact label > label prefix > word-boundary prefix >
 * label substring > keyword/group substring > subsequence (fuzzy). Shorter
 * labels win ties so "Media" beats an incidental long match.
 */
function scoreItem(item: CommandItem, q: string): number {
  const label = item.label.toLowerCase()
  const hay = `${label} ${(item.keywords ?? '').toLowerCase()} ${item.group.toLowerCase()}`
  let score = -1
  if (label === q) score = 1000
  else if (label.startsWith(q)) score = 800
  else if (new RegExp(`\\b${escapeRe(q)}`).test(label)) score = 600
  else if (label.includes(q)) score = 400
  else if (hay.includes(q)) score = 250
  else if (isSubsequence(q, label)) score = 150
  else if (isSubsequence(q, hay)) score = 80
  if (score < 0) return -1
  // Prefer shorter labels (tie-break), and actions slightly above nav.
  return score - label.length + (item.kind === 'action' ? 5 : 0)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A pinned / recent nav entry as persisted by the sidebar (see sidebar-prefs). */
export interface SuggestionRef { to: string; label: string; icon?: string }

/**
 * Build the palette's empty-query suggestions: lead with page-aware context
 * entries ("On this page"), then the user's pinned favourites, then their
 * recents, then the rest of the catalog — every later source de-duped by
 * target URL against what's already surfaced, so a pinned "Posts" shows once,
 * at the top, not again under Content (and a contextual entry beats its static
 * twin). Pass `recents` empty to omit the Recent group (e.g. when recents are
 * disabled in config). Order is preserved; the caller caps the result.
 */
export function buildEmptyStateCommands(
  nav: CommandItem[],
  pins: readonly SuggestionRef[],
  recents: readonly SuggestionRef[],
  context: readonly CommandItem[] = [],
): CommandItem[] {
  const used = new Set<string>()
  const out: CommandItem[] = []
  for (const c of context) {
    if (used.has(c.to)) continue
    used.add(c.to)
    out.push(c)
  }
  for (const p of pins) {
    if (used.has(p.to)) continue
    used.add(p.to)
    out.push({ id: `pin:${p.to}`, label: p.label, kind: 'nav', to: p.to, icon: p.icon, group: 'Pinned' })
  }
  for (const r of recents) {
    if (used.has(r.to)) continue
    used.add(r.to)
    out.push({ id: `recent:${r.to}`, label: r.label, kind: 'nav', to: r.to, icon: r.icon, group: 'Recent' })
  }
  for (const item of nav) {
    if (used.has(item.to)) continue
    used.add(item.to)
    out.push(item)
  }
  return out
}

/**
 * Rank `items` for `query`. Empty query returns everything (capped), preserving
 * input order so the caller can present suggestions. `limit` caps the result.
 */
export function filterCommands(items: CommandItem[], query: string, limit = 50): CommandItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items.slice(0, limit)
  const scored: { item: CommandItem; score: number }[] = []
  for (const item of items) {
    const score = scoreItem(item, q)
    if (score >= 0) scored.push({ item, score })
  }
  scored.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
  return scored.slice(0, limit).map((s) => s.item)
}
