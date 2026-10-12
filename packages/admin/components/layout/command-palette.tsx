/**
 * File Name: command-palette.tsx
 * Purpose: The command center (⌘K). Fuzzy-jump to any page, content type,
 *          extension, or setting from a local catalog (instant), merged with
 *          async server results — content records (/admin/search) and, later,
 *          media. Results are grouped; the keyboard moves over the flat list.
 *          Navigation targets are gated upstream (useNavCommands) so the
 *          palette never offers a destination the sidebar would hide.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { IconSearch } from '@tangen/icons'
import { clsx } from 'clsx'
import { Badge } from '@/components/ui/badge'
import { DynamicIcon } from '@/components/dynamic-icon'
import { adminFetch } from '@/lib/api'
import { getStatusVariant, buildSearchUrl, hitGroupLabel, type SearchHit } from '@/lib/search'
import { filterCommands, buildMediaCommand, buildEmptyStateCommands, mergeContextCommands, CONTEXT_GROUP, type CommandItem, type SuggestionRef } from '@/lib/command-catalog'
import { useNavCommands, useContextCommands } from '@/lib/use-command-catalog'
import { useNavConfig } from '@/lib/use-nav-config'

const PINS_KEY = 'tangen-sidebar-pins'
const RECENTS_KEY = 'tangen-sidebar-recents'

/** Read a persisted sidebar suggestion list (pins/recents) from localStorage. */
function loadRefs(key: string): SuggestionRef[] {
  if (typeof window === 'undefined') return []
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : [] } catch { return [] }
}

interface MediaHit { id: string; filename: string; originalName?: string; mimeType?: string }

interface TypeItem { name: string; label: string; admin?: { menu?: { icon?: string; label?: string; show?: boolean; order?: number; parentExtension?: string } } }
interface AppItem { id: string; name: string; icon?: string; builtIn?: boolean }

interface CommandPaletteProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  types: TypeItem[]
  apps: AppItem[]
}

// The order groups appear in the results list. Unknown groups fall to the end.
const GROUP_ORDER = [CONTEXT_GROUP, 'Pinned', 'Recent', 'Actions', 'Navigation', 'Content', 'Extensions', 'AI', 'Devspace', 'Workspace', 'Content records', 'Users', 'Forms', 'Media']

function hitIcon(kind?: string): string {
  if (kind === 'form') return 'IconSurvey'
  if (kind?.startsWith('ext:')) return 'IconPuzzle'
  return 'IconFileText'
}

function contentHitToItem(workspaceId: string, hit: SearchHit): CommandItem {
  const isContent = !hit.kind || hit.kind === 'content'
  return {
    id: `content:${hit.kind ?? 'content'}:${hit.id}`,
    label: hit.title ?? 'Untitled',
    kind: 'content',
    to: buildSearchUrl(workspaceId, hit),
    icon: hitIcon(hit.kind),
    group: hitGroupLabel(hit),
    // typeName is only meaningful for content records (it's a redundant marker
    // like "auth_user"/"form" for the other kinds).
    sublabel: isContent ? hit.typeName : undefined,
    badge: hit.status,
  }
}

export function CommandPalette({ workspaceId, open, onOpenChange: setOpen, types, apps }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [contentHits, setContentHits] = useState<SearchHit[]>([])
  const [mediaHits, setMediaHits] = useState<MediaHit[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  // Pins/recents are read from the sidebar's stores each time the palette opens,
  // so newly pinned/visited items show up without a reload.
  const [pins, setPins] = useState<SuggestionRef[]>([])
  const [recents, setRecents] = useState<SuggestionRef[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const navItems = useNavCommands(workspaceId, types, apps)
  // Page-aware "On this page" entries (navigation-only, derived from pathname).
  const contextItems = useContextCommands(workspaceId, pathname, types, apps)
  const { recents: recentsEnabled } = useNavConfig()

  // ⌘K / Ctrl+K to toggle
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(!open) }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, setOpen])

  useEffect(() => {
    if (open) {
      setQuery(''); setContentHits([]); setMediaHits([]); setActiveIndex(0); setLoading(false)
      setPins(loadRefs(PINS_KEY)); setRecents(loadRefs(RECENTS_KEY))
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  const doSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) { setContentHits([]); setMediaHits([]); setLoading(false); return }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      // Content records and media assets in parallel; neither blocks the other.
      const [content, media] = await Promise.allSettled([
        adminFetch<{ data: SearchHit[] }>('/admin/search', undefined, { q }),
        adminFetch<{ data: MediaHit[] }>('/media', undefined, { q, limit: '6' }),
      ])
      setContentHits(content.status === 'fulfilled' ? (content.value.data ?? []) : [])
      setMediaHits(media.status === 'fulfilled' ? (media.value.data ?? []) : [])
      setLoading(false)
    }, 200)
  }, [])

  // The visible, ordered, flat list. Empty query → suggestions (on-this-page +
  // pinned + recent, then the catalog); a real query → ranked catalog (context
  // entries merged in, static twins de-duped) + async content/media hits.
  const visible = useMemo<CommandItem[]>(() => {
    if (!query.trim()) {
      return buildEmptyStateCommands(navItems, pins, recentsEnabled ? recents : [], contextItems).slice(0, 200)
    }
    const nav = filterCommands(mergeContextCommands(contextItems, navItems), query, 30)
    const content = contentHits.map((h) => contentHitToItem(workspaceId, h))
    const media = mediaHits.map((m) => buildMediaCommand(`/${workspaceId}`, m))
    return [...nav, ...content, ...media]
  }, [navItems, contextItems, query, contentHits, mediaHits, workspaceId, pins, recents, recentsEnabled])

  useEffect(() => { setActiveIndex(0) }, [query, contentHits, mediaHits])

  // Bucket the flat list into groups, ordered by GROUP_ORDER for rendering.
  const groups = useMemo(() => {
    const map = new Map<string, CommandItem[]>()
    for (const item of visible) {
      const arr = map.get(item.group)
      if (arr) arr.push(item); else map.set(item.group, [item])
    }
    return [...map.entries()].sort((a, b) => {
      const ai = GROUP_ORDER.indexOf(a[0]); const bi = GROUP_ORDER.indexOf(b[0])
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
  }, [visible])

  // The list in the exact order rows RENDER — so arrow keys and the eye agree.
  // (visible is score-ordered; groups re-orders it, so keyboard nav must walk
  // this display order, not visible, or the highlight jumps between groups.)
  const ordered = useMemo(() => groups.flatMap(([, items]) => items), [groups])
  const indexById = useMemo(() => {
    const m = new Map<string, number>()
    ordered.forEach((it, i) => m.set(it.id, i))
    return m
  }, [ordered])

  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }) }, [activeIndex])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, ordered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && ordered[activeIndex]) { handleSelect(ordered[activeIndex]) }
  }

  function handleSelect(item: CommandItem) {
    setOpen(false)
    if (item.run) { item.run(); return }
    navigate(item.to)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-(--tg-z-dialog) bg-surface-overlay" />
        <Dialog.Content
          className="fixed left-1/2 top-[15%] z-(--tg-z-dialog) w-[calc(100vw-2rem)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-xl bg-surface-raised text-fg shadow-dialog outline-none"
          onKeyDown={handleKeyDown}
          aria-label="Command palette"
        >
          <div className="flex h-11 items-center gap-3 border-b border-border-subtle px-4">
            <IconSearch className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { const q = (e.target as HTMLInputElement).value; setQuery(q); doSearch(q) }}
              placeholder="Search or jump to…"
              className="flex-1 border-0 bg-transparent text-ui-lg text-fg placeholder:text-fg-subtle outline-none focus:outline-none focus:ring-0"
            />
            {query && (
              <button onMouseDown={() => { setQuery(''); setContentHits([]); inputRef.current?.focus() }}
                className="flex size-6 items-center justify-center rounded-control text-fg-subtle transition-colors motion-fast hover:bg-surface-hover hover:text-fg" tabIndex={-1} aria-label="Clear search">
                <span className="text-ui-xs">✕</span>
              </button>
            )}
          </div>

          {visible.length > 0 && (
            <div className="max-h-80 overflow-y-auto p-1">
              {groups.map(([group, entries]) => (
                <div key={group}>
                  <p className="px-2 pt-2 pb-1 text-ui-2xs text-fg-subtle">{group}</p>
                  <ul>
                    {entries.map((item) => {
                      const index = indexById.get(item.id)!
                      const active = index === activeIndex
                      return (
                      <li key={item.id}>
                        <button
                          ref={active ? activeRef : undefined}
                          onMouseDown={() => handleSelect(item)}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={clsx('flex h-8 w-full items-center gap-3 rounded-control px-2 text-left transition-colors motion-fast',
                            active ? 'bg-surface-selected' : '')}
                        >
                          <span className={clsx('shrink-0', active ? 'text-fg' : 'text-fg-subtle')}><DynamicIcon name={item.icon ?? 'IconFileText'} className="size-4" /></span>
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-ui-sm text-fg">
                              {item.source && <span className="text-fg-muted">{item.source}: </span>}
                              {item.label}
                            </p>
                            {item.sublabel && <p className="truncate text-ui-xs capitalize text-fg-subtle">{item.sublabel}</p>}
                          </div>
                          {item.tag && <Badge variant="neutral">{item.tag}</Badge>}
                          {item.badge && <Badge variant={getStatusVariant(item.badge) as never}>{item.badge}</Badge>}
                        </button>
                      </li>
                    )})}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {loading && visible.length === 0 && (
            <div className="px-3 py-3 space-y-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg">
                  <div className="size-4 shrink-0 rounded-sm bg-surface-hover motion-safe:animate-pulse" />
                  <div className="h-3.5 rounded-sm bg-surface-hover motion-safe:animate-pulse" style={{ width: `${50 + i * 10}%` }} />
                </div>
              ))}
            </div>
          )}

          {!loading && query.trim() && visible.length === 0 && (
            <p className="px-4 py-10 text-center text-ui-sm text-fg-muted">No results for &ldquo;{query}&rdquo;</p>
          )}

          <div className="flex items-center gap-4 border-t border-border-subtle px-4 py-2">
            <span className="flex items-center gap-1.5 text-ui-2xs font-normal text-fg-subtle">
              <kbd className="rounded-xs border border-border bg-surface px-1 font-mono text-fg-subtle">↑↓</kbd> navigate
            </span>
            <span className="flex items-center gap-1.5 text-ui-2xs font-normal text-fg-subtle">
              <kbd className="rounded-xs border border-border bg-surface px-1 font-mono text-fg-subtle">↵</kbd> open
            </span>
            <span className="flex items-center gap-1.5 text-ui-2xs font-normal text-fg-subtle">
              <kbd className="rounded-xs border border-border bg-surface px-1 font-mono text-fg-subtle">Esc</kbd> close
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
