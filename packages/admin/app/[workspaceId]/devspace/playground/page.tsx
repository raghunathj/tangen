/**
 * File Name: page.tsx
 * Purpose: PG-1 — the merged API Playground takeover shell (Hygraph-style):
 *          REST and GraphQL are one destination with its own full-viewport
 *          layout (no admin chrome). The slim top bar carries the REST|GraphQL
 *          tabs, the workspace·env badge, the shared API-key picker, and Exit
 *          (back to the previous admin page, dashboard fallback). Owner/admin
 *          only — the server re-enforces on every call.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: renders INSIDE WorkspaceLayout's provider tree but
 *          escapes its chrome via a fixed full-viewport overlay, so auth,
 *          stores, and toasts keep working.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { useRef } from 'react'
import { adminFetch, useCan, Input, NoPermission, toast, Badge } from '@/kit'
import { IconPlay } from '@tangen/icons'
import { playgroundTab, exitTarget } from '@/lib/playground'
import { RestTab } from './rest-tab'
import { GraphqlTab, GQL_HANDOFF_KEY } from './graphql-tab'
import type { CatalogGroup, KeyOption } from './playground-types'

export default function ApiPlaygroundPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const { me, ready } = useCan()
  const [searchParams, setSearchParams] = useSearchParams()
  const role = me?.effectiveRole ?? me?.role
  const allowed = !ready || role === 'owner' || role === 'admin' || role === 'superadmin'
  const tab = playgroundTab(searchParams)

  const [keys, setKeys] = useState<KeyOption[]>([])
  const [catalog, setCatalog] = useState<CatalogGroup[]>([])
  const [keyId, setKeyId] = useState('')
  // Editor-style layout toggles (VS Code panel icons in the top bar)
  const [railOpen, setRailOpen] = useState(true)
  const [editorsOpen, setEditorsOpen] = useState(true)
  const [docsOpen, setDocsOpen] = useState(false)

  useEffect(() => {
    if (!allowed) return
    adminFetch<{ data: { endpoints: CatalogGroup[]; keys: KeyOption[] } }>('/admin/playground/catalog')
      .then((r) => {
        setCatalog(r.data.endpoints)
        // server sends only usable keys, latest first
        setKeys(r.data.keys)
        const requested = searchParams.get('key')
        const preselect = (requested && r.data.keys.find((k) => k.id === requested)) || r.data.keys[0]
        if (preselect) setKeyId(preselect.id)
      })
      .catch((e) => toast.error('Could not load the playground', (e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed])

  const selectedKey = keys.find((k) => k.id === keyId)

  const exit = () => {
    // Real browser back when there is history; dashboard otherwise.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate(exitTarget({ workspaceId: workspaceId!, from: null }))
  }

  if (ready && !allowed) {
    return <div className="p-6"><NoPermission note="The API Playground is available to owners and admins only." /></div>
  }

  return (
    <div className="fixed inset-0 z-50 bg-surface-sunken flex flex-col">
      {/* ── Takeover top bar ── */}
      <header className="shrink-0 flex items-center gap-3 px-4 h-12 bg-surface border-b border-border">
        <span className="flex items-center gap-2 shrink-0">
          <span className="size-5 rounded bg-accent-strong text-white grid place-items-center">
            <IconPlay className="size-3.5" />
          </span>
          <span className="text-sm font-semibold text-fg">API Playground</span>
        </span>

        {/* Tabs */}
        <nav className="flex items-center gap-1 ml-4">
          {(['rest', 'graphql'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setSearchParams(t === 'rest' ? {} : { tab: 'graphql' }, { replace: true })}
              className={clsx(
                'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                tab === t ? 'bg-accent-muted text-accent-fg' : 'text-fg-muted hover:text-fg hover:bg-surface-hover',
              )}
            >
              {t === 'rest' ? 'REST' : 'GraphQL'}
            </button>
          ))}
        </nav>

        <span className="flex-1" />

        {/* Workspace · env badge */}
        <Badge variant="neutral">{workspaceId}</Badge>

        {/* Shared key picker - searchable, latest first */}
        <KeyPicker keys={keys} keyId={keyId} onPick={setKeyId} />

        {/* Layout toggles - editor style */}
        <span className="w-px h-5 bg-border mx-0.5" />
        <PanelToggle kind="left" active={railOpen} onClick={() => setRailOpen((v) => !v)} title="Toggle sidebar" />
        {tab === 'rest'
          ? <PanelToggle kind="bottom" active={editorsOpen} onClick={() => setEditorsOpen((v) => !v)} title="Toggle request editors" />
          : <PanelToggle kind="right" active={docsOpen} onClick={() => setDocsOpen((v) => !v)} title="Toggle schema docs" />}
        <span className="w-px h-5 bg-border mx-0.5" />

        <button
          type="button"
          onClick={exit}
          className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-hover border border-border transition-colors"
          title="Back to the admin"
        >
          ← Exit
        </button>
      </header>

      {/* ── Tab content ── */}
      {tab === 'graphql'
        ? <GraphqlTab workspaceId={workspaceId!} keyId={keyId} docsOpen={docsOpen} onDocsOpenChange={setDocsOpen} railOpen={railOpen} />
        : <RestTab
            workspaceId={workspaceId!} keyId={keyId} selectedKey={selectedKey} catalog={catalog}
            railOpen={railOpen} editorsOpen={editorsOpen} onEditorsOpenChange={setEditorsOpen}
            onOpenGraphql={(handoff) => {
              sessionStorage.setItem(GQL_HANDOFF_KEY, JSON.stringify(handoff))
              setSearchParams({ tab: 'graphql' }, { replace: true })
            }}
          />}
    </div>
  )
}


/** Searchable API-key dropdown for the top bar (latest keys first). */
function KeyPicker({ keys, keyId, onPick }: {
  keys: KeyOption[]
  keyId: string
  onPick: (id: string) => void
}) {
  const params = useParams<{ workspaceId: string }>()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = keys.find((k) => k.id === keyId)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return keys
    return keys.filter((k) => k.label.toLowerCase().includes(needle) || k.keyPrefix.toLowerCase().includes(needle))
  }, [keys, q])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={rootRef} className="relative w-64">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setQ('') }}
        className="w-full flex items-center gap-1.5 border border-border rounded-md px-2.5 py-1.5 text-xs bg-surface hover:border-border-strong transition-colors"
        title="The key requests run as"
      >
        <span className="size-1.5 rounded-full bg-emerald-400 shrink-0" />
        <span className="flex-1 min-w-0 truncate text-left text-fg">
          {selected ? `${selected.label} · ${selected.keyPrefix}…` : keys.length ? 'Pick an API key' : 'No active keys'}
        </span>
        <span className="text-fg-subtle">▾</span>
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-72 bg-surface border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="p-1.5 border-b border-border">
            <Input value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder="Search keys…" autoFocus />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {keys.length === 0 && (
              <Link to={`/${params.workspaceId}/settings/api-keys/new`} className="block px-3 py-2 text-xs text-accent-fg hover:bg-surface-hover">
                No active keys - create one in the API Manager →
              </Link>
            )}
            {keys.length > 0 && filtered.length === 0 && <p className="px-3 py-2 text-xs text-fg-subtle">No keys match.</p>}
            {filtered.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => { onPick(k.id); setOpen(false) }}
                className={clsx(
                  'w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover transition-colors flex items-center gap-2',
                  k.id === keyId && 'bg-accent-muted/40',
                )}
              >
                <span className="flex-1 min-w-0 truncate text-fg">{k.label}</span>
                <span className="font-mono text-[10px] text-fg-subtle shrink-0">{k.keyPrefix}…</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


/** VS Code-style panel toggle: a frame with the controlled region filled when open. */
function PanelToggle({ kind, active, onClick, title }: {
  kind: 'left' | 'bottom' | 'right'
  active: boolean
  onClick: () => void
  title: string
}) {
  const region = {
    left: { x: 1.5, y: 1.5, w: 5, h: 13 },
    bottom: { x: 1.5, y: 9.5, w: 13, h: 5 },
    right: { x: 9.5, y: 1.5, w: 5, h: 13 },
  }[kind]
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={clsx('p-1 rounded transition-colors', active ? 'text-fg hover:bg-surface-hover' : 'text-fg-subtle hover:text-fg hover:bg-surface-hover')}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <rect x={region.x} y={region.y} width={region.w} height={region.h} rx="1.2" fill="currentColor" opacity={active ? 0.85 : 0.25} />
      </svg>
    </button>
  )
}
