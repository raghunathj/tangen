/**
 * File Name: rest-tab.tsx
 * Purpose: PG-2 — the REST workbench: left rail (searchable endpoint catalog
 *          tree / collections / history), request bar with Params | Headers |
 *          Body editors (headers & query params ride the existing execute
 *          support), and a persistent response panel. Runs impersonate the
 *          key picked in the shell's top bar.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  adminFetch, Button, Badge, Text, Callout, Input, Select, SelectItem, useConfirm, toast,
} from '@/kit'
import { rowsToRecord, filterCatalog, interpolate, unresolvedPlaceholders, type KVRow } from '@/lib/playground'
import { generateSnippets } from '@/lib/playground-snippets'
import { KVEditor } from './kv-editor'
import { Resizer } from './resizer'
import { VarsPanel } from './vars-panel'
import { JsonTree, JsonEditor, beautifyJson } from './json-view'
import type { CatalogGroup, CatalogEndpoint, KeyOption, Method } from './playground-types'

interface ExecResult { status: number; ms: number; truncated?: boolean; headers: Record<string, string>; json: unknown; raw?: string }
interface SavedRequest { id: string; name: string; request: Record<string, unknown> }
interface Collection { id: string; name: string; requests: SavedRequest[]; visibility: 'private' | 'shared'; createdBy: string }
interface VarDef { value: string; secret?: boolean }
interface HistoryEntry {
  keyId: string; keyLabel: string; method: Method; path: string; body: string; status: number; at: number
  headers?: KVRow[]; params?: KVRow[]
}

const DESTRUCTIVE = /\/(delete|unpublish)|method=DELETE/i
const emptyRow = (): KVRow => ({ key: '', value: '', enabled: true })

const METHOD_COLORS: Record<Method, string> = {
  GET: 'text-success-fg', POST: 'text-info-fg', PATCH: 'text-warning-fg', PUT: 'text-violet-600', DELETE: 'text-danger-fg',
}

export function RestTab({ workspaceId, keyId, selectedKey, catalog, onOpenGraphql, railOpen = true, editorsOpen = true, onEditorsOpenChange }: {
  workspaceId: string
  keyId: string
  selectedKey: KeyOption | undefined
  catalog: CatalogGroup[]
  /** A saved GraphQL request was clicked — the shell switches tabs with this handoff. */
  onOpenGraphql?: (handoff: { query?: string; variables?: string; headers?: KVRow[] }) => void
  /** Layout state owned by the shell's panel toggles. */
  railOpen?: boolean
  editorsOpen?: boolean
  onEditorsOpenChange?: (open: boolean) => void
}) {
  const [method, setMethod] = useState<Method>('POST')
  const [path, setPath] = useState('/api/v1/objects/post/query')
  const [bodyText, setBodyText] = useState('{\n  "type": "post",\n  "limit": 10\n}')
  const [bodyBad, setBodyBad] = useState(false)
  const [paramRows, setParamRows] = useState<KVRow[]>([emptyRow()])
  const [headerRows, setHeaderRows] = useState<KVRow[]>([emptyRow()])
  const [reqTab, setReqTab] = useState<'params' | 'headers' | 'body'>('body')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ExecResult | null>(null)
  const [resTab, setResTab] = useState<'pretty' | 'raw' | 'headers'>('pretty')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [rail, setRail] = useState<'catalog' | 'saved' | 'history' | 'vars'>('catalog')
  const [railWidth, setRailWidth] = useState(288)
  const setEditorsOpen = (open: boolean) => onEditorsOpenChange?.(open)
  const [collections, setCollections] = useState<Collection[]>([])
  const [vars, setVars] = useState<Record<string, VarDef>>({})
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveCollectionId, setSaveCollectionId] = useState('')
  const [saveNewCollection, setSaveNewCollection] = useState('')
  const [codeOpen, setCodeOpen] = useState(false)
  const [codeTab, setCodeTab] = useState<'curl' | 'fetch' | 'sdk'>('sdk')
  const [search, setSearch] = useState('')
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const { confirm, confirmDialog } = useConfirm()

  const historyKey = `tangen-playground-history:${workspaceId}`
  const tabsKey = `tangen-playground-tabs:${workspaceId}`

  // ── Request tabs (Postman-style) ─────────────────────────────────────────
  // The individual useStates above are the ACTIVE tab's working state; the
  // strip stores snapshots and swaps them on switch. Results live only in
  // memory (dropped on persist).
  interface ReqTabSnap {
    id: string
    method: Method
    path: string
    bodyText: string
    paramRows: KVRow[]
    headerRows: KVRow[]
    result?: ExecResult | null
  }
  const newSnap = (): ReqTabSnap => ({
    id: Math.random().toString(36).slice(2, 10),
    method: 'POST', path: '/api/v1/objects/post/query',
    bodyText: '{\n  "limit": 10\n}', paramRows: [emptyRow()], headerRows: [emptyRow()],
  })
  const [reqTabs, setReqTabs] = useState<ReqTabSnap[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(tabsKey) ?? '[]') as ReqTabSnap[]
      if (Array.isArray(stored) && stored.length) return stored.map((t) => ({ ...newSnap(), ...t, result: null }))
    } catch { /* ignore */ }
    return [newSnap()]
  })
  const [activeReqTab, setActiveReqTab] = useState(() => reqTabs[0].id)

  const snapshotCurrent = (): ReqTabSnap => ({
    id: activeReqTab, method, path, bodyText, paramRows, headerRows, result,
  })
  const loadSnap = (t: ReqTabSnap) => {
    setMethod(t.method); setPath(t.path); setBodyText(t.bodyText); setBodyBad(false)
    setParamRows(t.paramRows?.length ? t.paramRows : [emptyRow()])
    setHeaderRows(t.headerRows?.length ? t.headerRows : [emptyRow()])
    setResult(t.result ?? null)
  }
  const persistTabs = (tabs: ReqTabSnap[]) => {
    try { localStorage.setItem(tabsKey, JSON.stringify(tabs.map(({ result: _r, ...t }) => t))) } catch { /* ignore */ }
  }
  // Computed OUTSIDE setState — updaters must stay pure (React double-invokes
  // them in dev; loadSnap/persist are side effects).
  const switchTab = (id: string) => {
    if (id === activeReqTab) return
    const next = reqTabs.map((t) => (t.id === activeReqTab ? snapshotCurrent() : t))
    const target = next.find((t) => t.id === id)
    setReqTabs(next)
    persistTabs(next)
    if (target) loadSnap(target)
    setActiveReqTab(id)
  }
  const addTab = () => {
    const fresh = newSnap()
    const next = [...reqTabs.map((t) => (t.id === activeReqTab ? snapshotCurrent() : t)), fresh]
    setReqTabs(next)
    persistTabs(next)
    loadSnap(fresh)
    setActiveReqTab(fresh.id)
  }
  const closeTab = (id: string) => {
    const idx = reqTabs.findIndex((t) => t.id === id)
    let next = reqTabs.filter((t) => t.id !== id)
    if (next.length === 0) next = [newSnap()]
    if (id === activeReqTab) {
      const neighbor = next[Math.max(0, idx - 1)]
      loadSnap(neighbor)
      setActiveReqTab(neighbor.id)
    }
    setReqTabs(next)
    persistTabs(next)
  }
  const tabTitle = (t: ReqTabSnap) => {
    const active = t.id === activeReqTab
    const p = active ? path : t.path
    const m = active ? method : t.method
    const seg = p.split('?')[0].split('/').filter(Boolean).slice(2).join('/') || p
    return `${m} ${seg}`
  }
  // Keep the persisted copy roughly current as the active tab is edited
  useEffect(() => {
    const t = setTimeout(() => {
      const next = reqTabs.map((x) => (x.id === activeReqTab ? snapshotCurrent() : x))
      setReqTabs(next)
      persistTabs(next)
    }, 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, path, bodyText, paramRows, headerRows])

  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem(historyKey) ?? '[]')) } catch { /* ignore */ }
  }, [historyKey])

  const refreshCollections = useCallback(() => {
    adminFetch<{ data: Collection[] }>('/admin/playground/collections')
      .then((r) => setCollections(r.data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshCollections()
    adminFetch<{ data: { vars: Record<string, VarDef> } }>('/admin/playground/variables')
      .then((r) => setVars(r.data.vars ?? {}))
      .catch(() => {})
  }, [refreshCollections])

  // First catalog group starts open so the tree never looks empty
  useEffect(() => {
    if (catalog.length > 0) setOpenGroups((s) => (s.size ? s : new Set([catalog[0].group])))
  }, [catalog])

  const pushHistory = useCallback((entry: HistoryEntry) => {
    setHistory((h) => {
      const next = [entry, ...h].slice(0, 50)
      try { localStorage.setItem(historyKey, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [historyKey])

  const hasBody = method !== 'GET' && method !== 'DELETE'

  const applyEndpoint = (e: CatalogEndpoint) => {
    setMethod(e.method)
    setPath(e.path)
    if (e.sampleBody) { setBodyText(JSON.stringify(e.sampleBody, null, 2)); setBodyBad(false); setReqTab('body') }
    if (e.sampleParams) {
      setParamRows([...Object.entries(e.sampleParams).map(([key, value]) => ({ key, value, enabled: true })), emptyRow()])
      if (!e.sampleBody) setReqTab('params')
    }
  }

  const loadHistory = (h: HistoryEntry) => {
    setMethod(h.method)
    setPath(h.path)
    if (h.body) { setBodyText(h.body); setBodyBad(false) }
    setParamRows(h.params?.length ? h.params : [emptyRow()])
    setHeaderRows(h.headers?.length ? h.headers : [emptyRow()])
  }

  const varValues = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(vars)) out[k] = v.value
    return out
  }, [vars])

  const run = async () => {
    if (!keyId) { toast.error('Pick an API key first'); return }
    // {{variable}} interpolation happens HERE — values never persist anywhere
    const iPath = interpolate(path, varValues)
    const iBodyText = hasBody ? interpolate(bodyText, varValues) : ''
    const missing = unresolvedPlaceholders(
      [path, hasBody ? bodyText : null, ...paramRows.map((r) => r.enabled ? r.value : null), ...headerRows.map((r) => r.enabled ? r.value : null)],
      varValues,
    )
    if (missing.length > 0) {
      const go = await confirm({ title: 'Unresolved variables', message: `No value set for: ${missing.map((m) => `{{${m}}}`).join(', ')} - send anyway?` })
      if (!go) return
    }
    let parsedBody: unknown
    if (hasBody) {
      try { parsedBody = JSON.parse(iBodyText || '{}') } catch { toast.error('Request body is not valid JSON'); return }
    }
    if (DESTRUCTIVE.test(iPath) || method === 'DELETE') {
      const go = await confirm({ title: 'Run a destructive request?', message: `${method} ${iPath} - this runs for real as the key.`, variant: 'destructive' })
      if (!go) return
    }
    setRunning(true)
    setResult(null)
    try {
      const query = Object.fromEntries(Object.entries(rowsToRecord(paramRows)).map(([k, v]) => [k, interpolate(v, varValues)]))
      const headers = Object.fromEntries(Object.entries(rowsToRecord(headerRows)).map(([k, v]) => [k, interpolate(v, varValues)]))
      const r = await adminFetch<{ data: ExecResult }>('/admin/playground/execute', {
        method: 'POST',
        body: JSON.stringify({
          keyId, method, path: iPath,
          ...(Object.keys(query).length ? { query } : {}),
          ...(Object.keys(headers).length ? { headers } : {}),
          ...(hasBody ? { body: JSON.parse(iBodyText || '{}') } : {}),
        }),
      })
      setResult(r.data)
      setResTab('pretty')
      pushHistory({
        keyId, keyLabel: selectedKey?.label ?? keyId, method, path,
        body: hasBody ? bodyText : '', status: r.data.status, at: Date.now(),
        params: paramRows.filter((p) => p.key.trim()), headers: headerRows.filter((h) => h.key.trim()),
      })
    } catch (e) {
      toast.error('Execute failed', (e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const snippets = useMemo(() => generateSnippets({
    origin: location.origin, method, path,
    params: paramRows, headers: headerRows,
    body: hasBody ? bodyText : null,
  }), [method, path, bodyText, paramRows, headerRows, hasBody])

  // ── Collections handlers ────────────────────────────────────────────────
  const currentRequest = () => ({
    kind: 'rest' as const, method, path,
    query: paramRows.filter((r) => r.key.trim()),
    headers: headerRows.filter((r) => r.key.trim()),
    ...(hasBody ? { body: bodyText } : {}),
  })

  const loadSaved = (r: SavedRequest) => {
    const req = r.request as { kind?: string; method?: Method; path?: string; body?: string; query?: KVRow[]; headers?: KVRow[]; graphql?: { query?: string; variables?: string } }
    if (req.kind === 'graphql') {
      onOpenGraphql?.({ query: req.graphql?.query, variables: req.graphql?.variables, headers: req.headers })
      return
    }
    if (req.method) setMethod(req.method)
    if (req.path) setPath(req.path)
    setBodyText(typeof req.body === 'string' ? req.body : '')
    setBodyBad(false)
    setParamRows(req.query?.length ? [...req.query, emptyRow()] : [emptyRow()])
    setHeaderRows(req.headers?.length ? [...req.headers, emptyRow()] : [emptyRow()])
  }

  const saveRequest = async () => {
    const name = saveName.trim()
    if (!name) { toast.error('Give the request a name'); return }
    try {
      let target = collections.find((c) => c.id === saveCollectionId)
      if (!target) {
        const cname = saveNewCollection.trim() || 'My requests'
        const created = await adminFetch<{ data: Collection }>('/admin/playground/collections', {
          method: 'POST', body: JSON.stringify({ name: cname }),
        })
        target = created.data
      }
      const entry: SavedRequest = { id: Math.random().toString(36).slice(2, 12), name, request: currentRequest() }
      await adminFetch(`/admin/playground/collections/${target.id}`, {
        method: 'PATCH', body: JSON.stringify({ requests: [...(target.requests ?? []), entry] }),
      })
      toast.success(`Saved to “${target.name}”`)
      setSaveOpen(false); setSaveName(''); setSaveNewCollection('')
      refreshCollections()
      setRail('saved')
    } catch (e) {
      toast.error('Could not save', (e as Error).message)
    }
  }

  const removeSaved = async (c: Collection, r: SavedRequest) => {
    try {
      await adminFetch(`/admin/playground/collections/${c.id}`, {
        method: 'PATCH', body: JSON.stringify({ requests: (c.requests ?? []).filter((x) => x.id !== r.id) }),
      })
      refreshCollections()
    } catch (e) { toast.error('Could not remove', (e as Error).message) }
  }

  const toggleShare = async (c: Collection) => {
    try {
      await adminFetch(`/admin/playground/collections/${c.id}`, {
        method: 'PATCH', body: JSON.stringify({ visibility: c.visibility === 'shared' ? 'private' : 'shared' }),
      })
      refreshCollections()
    } catch (e) { toast.error('Only the owner can change sharing', (e as Error).message) }
  }

  const deleteCollection = async (c: Collection) => {
    const go = await confirm({ title: `Delete “${c.name}”?`, message: 'Its saved requests are gone for everyone it was shared with.', variant: 'destructive' })
    if (!go) return
    try {
      await adminFetch(`/admin/playground/collections/${c.id}`, { method: 'DELETE' })
      refreshCollections()
    } catch (e) { toast.error('Only the owner can delete', (e as Error).message) }
  }

  const filtered = useMemo(() => filterCatalog(catalog, search), [catalog, search])
  const statusVariant = (s: number) => s < 300 ? 'success' : s < 500 ? 'warning' : 'error'

  return (
    <div className="flex-1 min-h-0 flex">
      {/* ── Left rail (toggled from the shell's panel icons) ── */}
      <aside style={{ width: railWidth }} className={clsx('shrink-0 bg-surface flex-col min-h-0', railOpen ? 'flex' : 'hidden')}>
        <div className="flex items-stretch border-b border-border">
          {(['catalog', 'saved', 'history', 'vars'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setRail(t)}
              className={clsx(
                'flex-1 py-2 text-[11px] font-medium capitalize transition-colors',
                rail === t ? 'text-accent-fg border-b-2 border-accent-strong' : 'text-fg-subtle hover:text-fg',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {rail === 'catalog' && (
          <>
            <div className="p-2 border-b border-border">
              <Input value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="Search endpoints…" />
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.map((g) => {
                const open = search.trim() !== '' || openGroups.has(g.group)
                return (
                  <div key={g.group}>
                    <button
                      type="button"
                      onClick={() => setOpenGroups((s) => { const n = new Set(s); n.has(g.group) ? n.delete(g.group) : n.add(g.group); return n })}
                      className="w-full text-left px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle hover:text-fg sticky top-0 bg-surface"
                    >
                      {open ? '▾' : '▸'} {g.group}
                    </button>
                    {open && g.endpoints.map((e, i) => (
                      <button
                        key={`${e.method}:${e.path}:${i}`}
                        type="button"
                        onClick={() => applyEndpoint(e)}
                        className="w-full text-left px-3 py-1.5 hover:bg-surface-hover transition-colors flex items-baseline gap-2"
                        title={e.description ? `${e.path}\n${e.description}` : e.path}
                      >
                        <span className={clsx('text-[10px] font-bold w-11 shrink-0', METHOD_COLORS[e.method])}>{e.method}</span>
                        <span className="text-xs text-fg truncate">{e.label}</span>
                      </button>
                    ))}
                  </div>
                )
              })}
              {filtered.length === 0 && <p className="p-3 text-xs text-fg-subtle">No endpoints match.</p>}
            </div>
          </>
        )}

        {rail === 'saved' && (
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {collections.length === 0 && <Text variant="help">Save a request with the Save button - collections live here. Flip one to “Shared” to publish it to other playground admins.</Text>}
            {collections.map((c) => (
              <div key={c.id} className="border border-border rounded-md">
                <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-surface-sunken rounded-t-md">
                  <span className="text-xs font-semibold text-fg truncate flex-1">{c.name}</span>
                  <button
                    type="button"
                    title={c.visibility === 'shared' ? 'Shared with playground admins - click to make private' : 'Private - click to share with playground admins'}
                    onClick={() => toggleShare(c)}
                    className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium', c.visibility === 'shared' ? 'bg-success-muted text-success-fg' : 'bg-surface-hover text-fg-subtle')}
                  >
                    {c.visibility === 'shared' ? 'Shared' : 'Private'}
                  </button>
                  <button type="button" title="Delete collection" onClick={() => deleteCollection(c)} className="text-fg-subtle hover:text-danger-fg px-1 text-xs">✕</button>
                </div>
                <div className="py-1">
                  {(c.requests ?? []).length === 0 && <p className="px-2 py-1 text-[11px] text-fg-subtle">Empty</p>}
                  {(c.requests ?? []).map((r) => (
                    <div key={r.id} className="flex items-center group">
                      <button
                        type="button"
                        onClick={() => loadSaved(r)}
                        className="flex-1 min-w-0 text-left px-2 py-1 hover:bg-surface-hover flex items-baseline gap-1.5"
                      >
                        <span className={clsx('text-[10px] font-bold w-9 shrink-0', METHOD_COLORS[(r.request.method as Method) ?? 'GET'] ?? 'text-fg-subtle')}>
                          {(r.request.kind === 'graphql' ? 'GQL' : r.request.method) as string}
                        </span>
                        <span className="text-xs text-fg truncate">{r.name}</span>
                      </button>
                      <button type="button" title="Remove request" onClick={() => removeSaved(c, r)} className="opacity-0 group-hover:opacity-100 text-fg-subtle hover:text-danger-fg px-1.5 text-xs">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {rail === 'vars' && (
          <VarsPanel vars={vars} onVarsChange={setVars} />
        )}
      </aside>

      {railOpen && (
        <Resizer direction="col" startValue={() => railWidth} onResize={(v, d) => setRailWidth(Math.min(480, Math.max(200, v + d)))} />
      )}

      {/* ── Workbench ── */}
      <main className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Request tabs */}
        <div className="shrink-0 flex items-stretch bg-surface-sunken border-b border-border overflow-x-auto">
          {reqTabs.map((t) => (
            <div
              key={t.id}
              className={clsx(
                'group flex items-center gap-1 border-r border-border max-w-[220px]',
                t.id === activeReqTab ? 'bg-surface' : 'hover:bg-surface-hover/60',
              )}
            >
              <button
                type="button"
                onClick={() => switchTab(t.id)}
                className={clsx('pl-3 py-1.5 text-[11px] font-mono truncate', t.id === activeReqTab ? 'text-fg' : 'text-fg-subtle')}
                title={t.id === activeReqTab ? path : t.path}
              >
                {tabTitle(t)}
              </button>
              <button
                type="button"
                onClick={() => closeTab(t.id)}
                className={clsx('pr-2 pl-0.5 text-fg-subtle hover:text-danger-fg text-[11px]', reqTabs.length === 1 && t.id === activeReqTab ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100')}
                title="Close tab"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addTab}
            className="px-3 text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors text-sm"
            title="New request"
          >
            +
          </button>
        </div>

        {/* Request bar */}
        <div className="shrink-0 flex items-center gap-2 p-3 border-b border-border bg-surface">
          <div className="w-28 shrink-0">
            <Select value={method} onValueChange={(v: string) => setMethod(v as Method)}>
              {(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as Method[]).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </Select>
          </div>
          <Input value={path} onChange={(e) => setPath(e.currentTarget.value)} placeholder="/api/v1/objects/query" className="flex-1 font-mono text-sm" />
          <Button size="sm" onClick={run} isLoading={running} disabled={!keyId} loadingText="Sending…">Send</Button>
          <div className="relative">
            <Button size="sm" variant="secondary" onClick={() => setSaveOpen((v) => !v)}>Save</Button>
            {saveOpen && (
              <div className="absolute top-full right-0 mt-1 w-72 bg-surface border border-border rounded-lg shadow-lg z-50 p-3 space-y-2">
                <Input value={saveName} onChange={(e) => setSaveName(e.currentTarget.value)} placeholder="Request name" autoFocus />
                <Select value={saveCollectionId} onValueChange={setSaveCollectionId}>
                  <SelectItem value="">New collection…</SelectItem>
                  {collections.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.visibility === 'shared' ? ' (shared)' : ''}</SelectItem>)}
                </Select>
                {!saveCollectionId && (
                  <Input value={saveNewCollection} onChange={(e) => setSaveNewCollection(e.currentTarget.value)} placeholder="Collection name" />
                )}
                <div className="flex justify-end gap-2">
                  <Button size="xs" variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button>
                  <Button size="xs" onClick={saveRequest}>Save request</Button>
                </div>
              </div>
            )}
          </div>
          <div className="relative">
            <Button size="sm" variant="ghost" onClick={() => setCodeOpen((v) => !v)}>Code</Button>
            {codeOpen && (
              <div className="absolute top-full right-0 mt-1 w-[520px] max-w-[90vw] bg-surface border border-border rounded-lg shadow-lg z-50 p-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  {(['sdk', 'fetch', 'curl'] as const).map((t) => (
                    <Button key={t} size="xs" variant={codeTab === t ? 'secondary' : 'ghost'} onClick={() => setCodeTab(t)}>
                      {t === 'sdk' ? '@tangen/sdk' : t}
                    </Button>
                  ))}
                  <span className="flex-1" />
                  <Button size="xs" onClick={() => { navigator.clipboard?.writeText(snippets[codeTab]); toast.success('Copied (with a placeholder key)') }}>Copy</Button>
                </div>
                <pre className="text-[11px] font-mono bg-surface-sunken rounded p-2 overflow-x-auto max-h-72 whitespace-pre">{snippets[codeTab]}</pre>
              </div>
            )}
          </div>
        </div>

        {/* Request editors */}
        <div className="shrink-0 border-b border-border bg-surface">
          <div className="flex gap-1 px-3 pt-2">
            {(['params', 'headers', 'body'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { if (reqTab === t && editorsOpen) { setEditorsOpen(false) } else { setReqTab(t); setEditorsOpen(true) } }}
                disabled={t === 'body' && !hasBody}
                className={clsx(
                  'px-2.5 py-1 rounded-t text-[11px] font-medium capitalize transition-colors disabled:opacity-40',
                  reqTab === t ? 'bg-surface-sunken text-fg' : 'text-fg-subtle hover:text-fg',
                )}
              >
                {t}
                {t === 'params' && paramRows.some((r) => r.key.trim()) && <span className="ml-1 text-accent-fg">•</span>}
                {t === 'headers' && headerRows.some((r) => r.key.trim()) && <span className="ml-1 text-accent-fg">•</span>}
              </button>
            ))}
            <span className="flex-1" />
            {selectedKey && (
              <span className="text-[11px] text-fg-subtle self-center truncate max-w-[50%]">
                Grants: {summarizePermissions(selectedKey.permissions)}
              </span>
            )}
          </div>
          {editorsOpen && (
          <div className="bg-surface-sunken px-3 py-2 max-h-56 overflow-y-auto">
            {reqTab === 'body' && hasBody && (
              <div className="space-y-1">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => { const b = beautifyJson(bodyText); if (b == null) { toast.error('Not valid JSON'); return } setBodyText(b); setBodyBad(false) }}
                    className="text-[11px] text-accent-fg hover:underline"
                  >
                    Beautify
                  </button>
                </div>
                <JsonEditor
                  value={bodyText}
                  onChange={(t) => { setBodyText(t); try { JSON.parse(t || '{}'); setBodyBad(false) } catch { setBodyBad(true) } }}
                />
                {bodyBad && <Text variant="help" className="text-danger-fg">Not valid JSON.</Text>}
              </div>
            )}
            {reqTab !== 'body' && (
              <KVEditor
                rows={reqTab === 'params' ? paramRows : headerRows}
                onChange={reqTab === 'params' ? setParamRows : setHeaderRows}
                keyPlaceholder={reqTab === 'params' ? 'param' : 'Header-Name'}
              />
            )}
          </div>
          )}
        </div>

        {/* Response */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          {!result && !running && (
            <div className="h-full grid place-items-center">
              <Text variant="help">Pick an endpoint from the catalog and hit Send - the response lands here.</Text>
            </div>
          )}
          {result && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant(result.status)}>HTTP {result.status}</Badge>
                <span className="text-xs text-fg-subtle tabular-nums">{result.ms}ms</span>
                <span className="flex-1" />
                {(['pretty', 'raw', 'headers'] as const).map((t) => (
                  <Button key={t} size="xs" variant={resTab === t ? 'secondary' : 'ghost'} onClick={() => setResTab(t)}>{t}</Button>
                ))}
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    const text = resTab === 'headers'
                      ? Object.entries(result.headers).map(([k, v]) => `${k}: ${v}`).join('\n')
                      : result.json != null ? JSON.stringify(result.json, null, 2) : (result.raw ?? '')
                    navigator.clipboard?.writeText(text)
                    toast.success('Response copied')
                  }}
                >
                  Copy
                </Button>
              </div>
              {result.truncated && <Callout variant="warning" title="Response truncated at 256KB" />}
              {resTab === 'headers' ? (
                <pre className="text-xs font-mono bg-surface rounded border border-border p-2 overflow-auto max-h-[48vh]">{Object.entries(result.headers).map(([k, v]) => `${k}: ${v}`).join('\n') || '(none)'}</pre>
              ) : resTab === 'pretty' && result.json != null ? (
                <div className="bg-surface rounded border border-border p-2 overflow-auto max-h-[48vh]">
                  <JsonTree value={result.json} />
                </div>
              ) : (
                <pre className="text-xs font-mono bg-surface rounded border border-border p-2 overflow-auto max-h-[48vh]">
                  {result.raw ?? JSON.stringify(result.json, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </main>
      {confirmDialog}
    </div>
  )
}

function summarizePermissions(p?: Record<string, unknown>): string {
  if (!p) return 'none'
  const parts: string[] = []
  const objects = p.objects as { allowedTypes?: string[] } | undefined
  if (objects?.allowedTypes?.length) parts.push(`objects: ${objects.allowedTypes.join(', ')}`)
  const routes = p.customRoutes as Record<string, string[]> | undefined
  if (routes) for (const [g, acts] of Object.entries(routes)) parts.push(`${g}: ${acts.join('/')}`)
  if (p.search) parts.push('search')
  if (p.tables) parts.push('tables')
  return parts.length ? parts.join(' · ') : 'none'
}

/** "Jul 18, 02:14" — compact history timestamp (year only when it differs). */
function formatHistoryTime(at: number): string {
  const d = new Date(at)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}
