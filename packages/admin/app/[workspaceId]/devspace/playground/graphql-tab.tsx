/**
 * File Name: graphql-tab.tsx
 * Purpose: PG-5 — the in-admin GraphQL workbench: CodeMirror 6 with schema-
 *          aware autocomplete/lint (cm6-graphql over the admin-gated SDL, so
 *          it works even where public introspection is off), a docs explorer
 *          drawer, variables + headers editors, key-impersonated runs through
 *          the playground execute route (audited, honest 403s), and Save into
 *          the shared collections.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: CodeMirror is loaded lazily inside the tab so the chunk
 *          costs nothing until the GraphQL tab is opened.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { adminFetch, Button, Badge, Text, Card, Input, Select, SelectItem, toast } from '@/kit'
import { useGraphqlEnabled } from '@/lib/use-graphql-enabled'
import { rowsToRecord, interpolate, unresolvedPlaceholders, type KVRow } from '@/lib/playground'
import { KVEditor } from './kv-editor'
import { buildGraphqlExamples, type GraphqlExample } from '@/lib/graphql-examples'
import { JsonTree } from './json-view'
import { Resizer } from './resizer'
import { VarsPanel } from './vars-panel'
import type { GraphQLSchema } from 'graphql'

interface ExecResult { status: number; ms: number; truncated?: boolean; headers: Record<string, string>; json: unknown; raw?: string }
interface Collection { id: string; name: string; requests: Array<{ id: string; name: string; request: Record<string, unknown> }>; visibility: string; createdBy: string }
interface VarDef { value: string; secret?: boolean }

const emptyRow = (): KVRow => ({ key: '', value: '', enabled: true })
const DEFAULT_QUERY = `# Autocomplete knows your generated schema - try Ctrl+Space
{
  __typename
}
`

export const GQL_HANDOFF_KEY = 'tangen-playground-gql-handoff'

export function GraphqlTab({ workspaceId, keyId, docsOpen: docsOpenProp, onDocsOpenChange, railOpen = true }: {
  workspaceId: string
  keyId: string
  docsOpen?: boolean
  onDocsOpenChange?: (open: boolean) => void
  railOpen?: boolean
}) {
  const graphqlEnabled = useGraphqlEnabled()
  const editorHost = useRef<HTMLDivElement>(null)
  const viewRef = useRef<{ state: { doc: { toString(): string } }; destroy(): void } | null>(null)
  const [schemaObj, setSchemaObj] = useState<GraphQLSchema | null>(null)
  const [sdlError, setSdlError] = useState<string | null>(null)
  const [variablesText, setVariablesText] = useState('{}')
  const [headerRows, setHeaderRows] = useState<KVRow[]>([emptyRow()])
  const [showHeaders, setShowHeaders] = useState(false)
  const [docsOpenLocal, setDocsOpenLocal] = useState(false)
  const docsOpen = docsOpenProp ?? docsOpenLocal
  const setDocsOpen = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(docsOpen) : v
    setDocsOpenLocal(next)
    onDocsOpenChange?.(next)
  }
  const [docType, setDocType] = useState<string | null>(null)
  const [docSearch, setDocSearch] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ExecResult | null>(null)
  const [vars, setVars] = useState<Record<string, VarDef>>({})
  const [collections, setCollections] = useState<Collection[]>([])
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveCollectionId, setSaveCollectionId] = useState('')
  const [saveNewCollection, setSaveNewCollection] = useState('')
  const [examplesOpen, setExamplesOpen] = useState(false)
  const [varsHeight, setVarsHeight] = useState(88)
  const [respWidth, setRespWidth] = useState(480)
  const [rail, setRail] = useState<'saved' | 'history' | 'vars'>('saved')
  const [railWidth, setRailWidth] = useState(260)

  // GraphQL run history — browser storage, like the REST tab
  interface GqlHistoryEntry { query: string; variables: string; headerRows?: KVRow[]; status: number; at: number }
  const gqlHistoryKey = `tangen-playground-gql-history:${workspaceId}`
  const [gqlHistory, setGqlHistory] = useState<GqlHistoryEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem(gqlHistoryKey) ?? '[]') } catch { return [] }
  })
  const pushGqlHistory = (entry: GqlHistoryEntry) => {
    setGqlHistory((h) => {
      const next = [entry, ...h].slice(0, 50)
      try { localStorage.setItem(gqlHistoryKey, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }
  const [docsWidth, setDocsWidth] = useState(288)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)
  const onVarsDrag = (e: React.PointerEvent) => {
    dragRef.current = { startY: e.clientY, startH: varsHeight }
    const move = (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      // dragging UP grows the pane (it sits at the bottom)
      setVarsHeight(Math.min(400, Math.max(48, d.startH + (d.startY - ev.clientY))))
    }
    const up = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const [exampleSearch, setExampleSearch] = useState('')

  // ── Query tabs (same snapshot pattern as the REST tab) ────────────────────
  interface GqlTabSnap { id: string; query: string; variables: string; headerRows: KVRow[]; result?: ExecResult | null }
  const tabsKey = `tangen-playground-gql-tabs:${workspaceId}`
  const newSnap = (query = DEFAULT_QUERY, variables = '{}'): GqlTabSnap =>
    ({ id: Math.random().toString(36).slice(2, 10), query, variables, headerRows: [emptyRow()] })
  const [gqlTabs, setGqlTabs] = useState<GqlTabSnap[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(tabsKey) ?? '[]') as GqlTabSnap[]
      if (Array.isArray(stored) && stored.length) return stored.map((t) => ({ ...newSnap(), ...t, result: null }))
    } catch { /* ignore */ }
    return [newSnap()]
  })
  const [activeGqlTab, setActiveGqlTab] = useState(() => gqlTabs[0].id)
  const getDoc = () => viewRef.current?.state.doc.toString() ?? ''
  const setDoc = (text: string) => {
    const view = viewRef.current
    if (view) (view as unknown as { dispatch: (s: unknown) => void }).dispatch({ changes: { from: 0, to: view.state.doc.toString().length, insert: text } })
  }
  const snapshotCurrent = (): GqlTabSnap =>
    ({ id: activeGqlTab, query: getDoc(), variables: variablesText, headerRows, result })
  const loadSnap = (t: GqlTabSnap) => {
    setDoc(t.query)
    setVariablesText(t.variables)
    setHeaderRows(t.headerRows?.length ? t.headerRows : [emptyRow()])
    setResult(t.result ?? null)
  }
  const persistTabs = (tabs: GqlTabSnap[]) => {
    try { localStorage.setItem(tabsKey, JSON.stringify(tabs.map(({ result: _r, ...t }) => t))) } catch { /* ignore */ }
  }
  // NOTE: all of these compute the next tab list OUTSIDE setState — the
  // snapshot reads the mutable CodeMirror doc, and React double-invokes
  // updaters in dev, which previously overwrote every tab with the incoming
  // tab's content on switch.
  const switchTab = (id: string) => {
    if (id === activeGqlTab) return
    const next = gqlTabs.map((t) => (t.id === activeGqlTab ? snapshotCurrent() : t))
    const target = next.find((t) => t.id === id)
    setGqlTabs(next)
    persistTabs(next)
    if (target) loadSnap(target)
    setActiveGqlTab(id)
  }
  const addTab = (query?: string, variables?: string) => {
    const fresh = newSnap(query, variables)
    const next = [...gqlTabs.map((t) => (t.id === activeGqlTab ? snapshotCurrent() : t)), fresh]
    setGqlTabs(next)
    persistTabs(next)
    loadSnap(fresh)
    setActiveGqlTab(fresh.id)
  }
  const closeTab = (id: string) => {
    const idx = gqlTabs.findIndex((t) => t.id === id)
    let next = gqlTabs.filter((t) => t.id !== id)
    if (next.length === 0) next = [newSnap()]
    if (id === activeGqlTab) {
      const neighbor = next[Math.max(0, idx - 1)]
      loadSnap(neighbor)
      setActiveGqlTab(neighbor.id)
    }
    setGqlTabs(next)
    persistTabs(next)
  }
  const gqlTabTitle = (t: GqlTabSnap) => {
    const q = t.id === activeGqlTab ? (getDoc() || t.query) : t.query
    const m = q.match(/(?:query|mutation)\s+([A-Za-z0-9_]+)/) ?? q.match(/\{\s*([A-Za-z0-9_]+)/)
    return m?.[1] ?? 'query'
  }

  const examples = useMemo(() => (schemaObj ? buildGraphqlExamples(schemaObj) : []), [schemaObj])

  const prettify = async () => {
    try {
      const { parse, print } = await import('graphql')
      setDoc(print(parse(getDoc())))
    } catch (e) {
      toast.error('Query does not parse', (e as Error).message)
    }
  }

  // ── Editor + SDL (lazy chunk) ─────────────────────────────────────────────
  useEffect(() => {
    if (!graphqlEnabled || !editorHost.current) return
    let disposed = false
    ;(async () => {
      try {
        const [{ EditorView, basicSetup }, { graphql: gqlExt }, { buildSchema }, { keymap }, { playgroundTheme }, sdlRes] = await Promise.all([
          import('codemirror'),
          import('cm6-graphql'),
          import('graphql'),
          import('@codemirror/view'),
          import('./cm-theme'),
          adminFetch<{ data: { sdl: string } }>('/admin/graphql/sdl'),
        ])
        if (disposed || !editorHost.current) return
        let schema: GraphQLSchema | undefined
        try {
          schema = buildSchema(sdlRes.data.sdl)
          setSchemaObj(schema)
        } catch (e) {
          setSdlError((e as Error).message)
        }
        const handoff = sessionStorage.getItem(GQL_HANDOFF_KEY)
        let doc = gqlTabs.find((t) => t.id === activeGqlTab)?.query ?? DEFAULT_QUERY
        if (handoff) {
          try {
            const h = JSON.parse(handoff)
            if (typeof h.query === 'string') doc = h.query
            if (typeof h.variables === 'string') setVariablesText(h.variables)
            if (Array.isArray(h.headers) && h.headers.length) { setHeaderRows([...h.headers, emptyRow()]); setShowHeaders(true) }
          } catch { /* ignore */ }
          sessionStorage.removeItem(GQL_HANDOFF_KEY)
        }
        viewRef.current?.destroy()
        viewRef.current = new EditorView({
          doc,
          parent: editorHost.current,
          extensions: [
            keymap.of([{ key: 'Mod-Enter', run: () => { runRef.current(); return true } }]),
            basicSetup,
            ...playgroundTheme,
            ...(schema ? [gqlExt(schema)] : []),
          ],
        }) as never
      } catch (e) {
        setSdlError((e as Error).message)
      }
    })()
    return () => { disposed = true; viewRef.current?.destroy(); viewRef.current = null }
  }, [graphqlEnabled])

  // Variables + collections ride the same PG-3 surfaces as the REST tab
  useEffect(() => {
    if (!graphqlEnabled) return
    adminFetch<{ data: { vars: Record<string, VarDef> } }>('/admin/playground/variables')
      .then((r) => setVars(r.data.vars ?? {})).catch(() => {})
    refreshCollections()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphqlEnabled])

  const refreshCollections = useCallback(() => {
    adminFetch<{ data: Collection[] }>('/admin/playground/collections')
      .then((r) => setCollections(r.data)).catch(() => {})
  }, [])

  const varValues = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(vars)) out[k] = v.value
    return out
  }, [vars])

  // ── Run — impersonates the shell's key via the execute route ──────────────
  const runRef = useRef<() => void>(() => {})
  const run = async () => {
    if (!keyId) { toast.error('Pick an API key in the top bar first'); return }
    const query = viewRef.current?.state.doc.toString() ?? ''
    if (!query.trim()) { toast.error('Write a query first'); return }
    const missing = unresolvedPlaceholders([query, variablesText, ...headerRows.map((r) => r.enabled ? r.value : null)], varValues)
    if (missing.length > 0) {
      toast.error(`No value for ${missing.map((m) => `{{${m}}}`).join(', ')} - set them in the Vars tab on the left`)
      return
    }
    let variables: unknown = undefined
    try { variables = JSON.parse(interpolate(variablesText, varValues) || '{}') } catch { toast.error('Variables are not valid JSON'); return }
    setRunning(true)
    setResult(null)
    try {
      const headers = Object.fromEntries(Object.entries(rowsToRecord(headerRows)).map(([k, v]) => [k, interpolate(v, varValues)]))
      const r = await adminFetch<{ data: ExecResult }>('/admin/playground/execute', {
        method: 'POST',
        body: JSON.stringify({
          keyId, method: 'POST', path: '/api/v1/graphql',
          ...(Object.keys(headers).length ? { headers } : {}),
          body: { query: interpolate(query, varValues), variables },
        }),
      })
      setResult(r.data)
      pushGqlHistory({ query, variables: variablesText, headerRows: headerRows.filter((h) => h.key.trim()), status: r.data.status, at: Date.now() })
    } catch (e) {
      toast.error('Execute failed', (e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  runRef.current = run

  // ── Save into collections (kind: 'graphql') ───────────────────────────────
  const saveRequest = async () => {
    const name = saveName.trim()
    if (!name) { toast.error('Give the query a name'); return }
    const query = viewRef.current?.state.doc.toString() ?? ''
    try {
      let target = collections.find((c) => c.id === saveCollectionId)
      if (!target) {
        const created = await adminFetch<{ data: Collection }>('/admin/playground/collections', {
          method: 'POST', body: JSON.stringify({ name: saveNewCollection.trim() || 'My requests' }),
        })
        target = created.data
      }
      const entry = {
        id: Math.random().toString(36).slice(2, 12), name,
        request: { kind: 'graphql', graphql: { query, variables: variablesText }, headers: headerRows.filter((r) => r.key.trim()) },
      }
      await adminFetch(`/admin/playground/collections/${target.id}`, {
        method: 'PATCH', body: JSON.stringify({ requests: [...(target.requests ?? []), entry] }),
      })
      toast.success(`Saved to “${target.name}”`)
      setSaveOpen(false); setSaveName(''); setSaveNewCollection('')
      refreshCollections()
    } catch (e) {
      toast.error('Could not save', (e as Error).message)
    }
  }

  // ── Docs explorer data ────────────────────────────────────────────────────
  const docTypes = useMemo(() => {
    if (!schemaObj) return []
    return Object.values(schemaObj.getTypeMap())
      .filter((t) => !t.name.startsWith('__'))
      .sort((a, b) => {
        const rank = (n: string) => (n === 'Query' ? 0 : n === 'Mutation' ? 1 : 2)
        return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)
      })
  }, [schemaObj])

  const currentDocType = useMemo(
    () => (docType ? schemaObj?.getTypeMap()[docType] ?? null : null),
    [docType, schemaObj],
  )

  if (!graphqlEnabled) {
    return (
      <div className="p-6 max-w-2xl space-y-4">
        <Card title="GraphQL is not enabled for this environment">
          <Text variant="help">
            Run <code>npx tangen enable graphql</code> in your project - it creates
            <code> app/config/graphql.ts</code> and wires it into your workspace config.
            Then restart <code>npm run dev</code> and the GraphQL workbench appears here.
            (Fine-tune mutations/introspection in that config file.)
          </Text>
        </Card>
      </div>
    )
  }

  const statusVariant = (s: number) => s < 300 ? 'success' : s < 500 ? 'warning' : 'error'

  const savedGraphqlRequests = collections.flatMap((c) =>
    (c.requests ?? [])
      .filter((r) => (r.request as { kind?: string }).kind === 'graphql')
      .map((r) => ({ ...r, collectionName: c.name })))

  return (
    <div className="flex-1 min-h-0 flex">
      {/* ── Left rail - Saved | History (Apollo-style) ── */}
      <aside style={{ width: railWidth }} className={clsx('shrink-0 bg-surface flex-col min-h-0 border-r border-border', railOpen ? 'flex' : 'hidden')}>
        <div className="flex border-b border-border">
          {(['saved', 'history', 'vars'] as const).map((t) => (
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
        {rail === 'saved' && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {savedGraphqlRequests.length === 0 && (
              <Text variant="help">Save a query with the Save button - saved GraphQL operations from your collections appear here.</Text>
            )}
            {savedGraphqlRequests.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  const g = (r.request as { graphql?: { query?: string; variables?: string } }).graphql
                  addTab(g?.query, g?.variables)
                }}
                className="w-full text-left px-2 py-1.5 border border-border rounded hover:bg-surface-hover"
                title={`Opens in a new tab · from “${r.collectionName}”`}
              >
                <span className="block text-xs text-fg truncate">{r.name}</span>
                <span className="block text-[10px] text-fg-subtle truncate">{r.collectionName}</span>
              </button>
            ))}
          </div>
        )}
        {rail === 'vars' && (
          <VarsPanel vars={vars} onVarsChange={setVars} />
        )}
        {rail === 'history' && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <p className="px-1 pb-1 text-[10px] text-fg-subtle">
              Stored in this browser only (last 50) - save a query to a collection to keep it for good.
            </p>
            {gqlHistory.length === 0 && <Text variant="help">Run a query - it lands here.</Text>}
            {gqlHistory.map((h, i) => (
              <button
                key={i}
                type="button"
                onClick={() => addTab(h.query, h.variables)}
                className="w-full text-left px-2 py-1.5 border border-border rounded hover:bg-surface-hover"
              >
                <span className="flex items-center gap-1.5">
                  <Badge variant={h.status < 300 ? 'success' : h.status < 500 ? 'warning' : 'error'}>{h.status}</Badge>
                  <span className="flex-1" />
                  <span className="text-[10px] text-fg-subtle tabular-nums">{formatGqlTime(h.at)}</span>
                </span>
                <span className="block text-[10px] font-mono text-fg-subtle truncate mt-0.5">{h.query.replace(/\s+/g, ' ').slice(0, 60)}</span>
              </button>
            ))}
          </div>
        )}
      </aside>
      {railOpen && (
        <Resizer direction="col" startValue={() => railWidth} onResize={(v, d) => setRailWidth(Math.min(420, Math.max(200, v + d)))} />
      )}

      {/* ── Editor column ── */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Query tabs */}
        <div className="shrink-0 flex items-stretch bg-surface-sunken border-b border-border overflow-x-auto">
          {gqlTabs.map((t) => (
            <div
              key={t.id}
              className={clsx(
                'group flex items-center gap-1 border-r border-border max-w-[180px]',
                t.id === activeGqlTab ? 'bg-surface' : 'hover:bg-surface-hover/60',
              )}
            >
              <button
                type="button"
                onClick={() => switchTab(t.id)}
                className={clsx('pl-3 py-1.5 text-[11px] font-mono truncate', t.id === activeGqlTab ? 'text-fg' : 'text-fg-subtle')}
              >
                {gqlTabTitle(t)}
              </button>
              <button
                type="button"
                onClick={() => closeTab(t.id)}
                className={clsx('pr-2 pl-0.5 text-fg-subtle hover:text-danger-fg text-[11px]', gqlTabs.length === 1 && t.id === activeGqlTab ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100')}
                title="Close tab"
              >
                ✕
              </button>
            </div>
          ))}
          <button type="button" onClick={() => addTab()} className="px-3 text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors text-sm" title="New query">+</button>
        </div>

        <div className="shrink-0 flex items-center gap-2 p-2.5 border-b border-border bg-surface">
          <Button size="sm" onClick={run} isLoading={running} disabled={!keyId} loadingText="Running…" title="Cmd/Ctrl+Enter">Run</Button>
          {/* Examples - the on-ramp when you don't know GraphQL */}
          <div className="relative">
            <Button size="sm" variant="secondary" onClick={() => { setExamplesOpen((v) => !v); setExampleSearch('') }}>Examples</Button>
            {examplesOpen && (
              <div className="absolute top-full left-0 mt-1 w-80 bg-surface border border-border rounded-lg shadow-lg z-50 overflow-hidden">
                <div className="p-1.5 border-b border-border">
                  <Input value={exampleSearch} onChange={(e) => setExampleSearch(e.currentTarget.value)} placeholder="Search queries…" autoFocus />
                </div>
                <p className="px-3 py-1.5 text-[10px] text-fg-subtle border-b border-border">
                  Ready-to-run queries generated from your schema - each opens in a new tab with its variables filled in.
                </p>
                <div className="max-h-72 overflow-y-auto py-1">
                  {examples.length === 0 && <p className="px-3 py-2 text-xs text-fg-subtle">Schema still loading…</p>}
                  {examples
                    .filter((e) => e.name.toLowerCase().includes(exampleSearch.trim().toLowerCase()))
                    .map((e: GraphqlExample) => (
                      <button
                        key={e.name}
                        type="button"
                        onClick={() => { addTab(e.query, e.variables); setExamplesOpen(false) }}
                        className="w-full text-left px-3 py-1.5 text-xs font-mono text-fg hover:bg-surface-hover transition-colors"
                      >
                        {e.label}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={prettify}>Prettify</Button>
          <div className="relative">
            <Button size="sm" variant="secondary" onClick={() => setSaveOpen((v) => !v)}>Save</Button>
            {saveOpen && (
              <div className="absolute top-full left-0 mt-1 w-72 bg-surface border border-border rounded-lg shadow-lg z-50 p-3 space-y-2">
                <Input value={saveName} onChange={(e) => setSaveName(e.currentTarget.value)} placeholder="Query name" autoFocus />
                <Select value={saveCollectionId} onValueChange={setSaveCollectionId}>
                  <SelectItem value="">New collection…</SelectItem>
                  {collections.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.visibility === 'shared' ? ' (shared)' : ''}</SelectItem>)}
                </Select>
                {!saveCollectionId && (
                  <Input value={saveNewCollection} onChange={(e) => setSaveNewCollection(e.currentTarget.value)} placeholder="Collection name" />
                )}
                <div className="flex justify-end gap-2">
                  <Button size="xs" variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button>
                  <Button size="xs" onClick={saveRequest}>Save query</Button>
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowHeaders((v) => !v)}
            className={clsx('h-8 px-3 rounded-md text-sm font-medium transition-colors', showHeaders ? 'bg-surface-sunken text-fg' : 'text-fg-subtle hover:text-fg')}
          >
            Headers{headerRows.some((r) => r.key.trim()) ? ' •' : ''}
          </button>
          <span className="flex-1" />
          {sdlError && <span className="text-[11px] text-warning-fg" title={sdlError}>schema unavailable - editing without autocomplete</span>}
          <Button size="sm" variant={docsOpen ? 'secondary' : 'ghost'} onClick={() => setDocsOpen((v) => !v)}>Docs</Button>
        </div>

        {showHeaders && (
          <div className="shrink-0 border-b border-border bg-surface-sunken px-3 py-2 max-h-56 overflow-y-auto">
            <KVEditor rows={headerRows} onChange={setHeaderRows} keyPlaceholder="Header-Name" />
          </div>
        )}

        {/* CodeMirror host */}
        <div ref={editorHost} className="flex-1 min-h-0 overflow-auto bg-surface [&_.cm-editor]:h-full [&_.cm-editor]:text-[13px]" />

        {/* Variables - draggable divider above resizes the pane */}
        <div className="shrink-0 bg-surface">
          <div
            onPointerDown={onVarsDrag}
            className="h-1.5 cursor-row-resize border-t border-border hover:bg-accent-muted/60 transition-colors touch-none"
            title="Drag to resize"
          />
          <p className="px-3 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle select-none">Query variables (JSON)</p>
          <textarea
            value={variablesText}
            onChange={(e) => setVariablesText(e.currentTarget.value)}
            style={{ height: varsHeight }}
            spellCheck={false}
            className="w-full px-3 py-1.5 text-xs font-mono text-fg bg-surface focus:outline-none resize-none"
          />
        </div>
      </div>

      {/* ── Response column (drag the divider to trade space with the editor) ── */}
      <Resizer direction="col" startValue={() => respWidth} onResize={(v, d) => setRespWidth(Math.min(900, Math.max(260, v - d)))} />
      <div style={{ width: respWidth }} className="shrink-0 flex flex-col min-h-0">
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          {!result && !running && (
            <div className="h-full grid place-items-center">
              <Text variant="help">Run a query - the response (as the selected key sees it) lands here.</Text>
            </div>
          )}
          {result && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant(result.status)}>HTTP {result.status}</Badge>
                <span className="text-xs text-fg-subtle tabular-nums">{result.ms}ms</span>
                <span className="flex-1" />
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard?.writeText(result.json != null ? JSON.stringify(result.json, null, 2) : (result.raw ?? ''))
                    toast.success('Response copied')
                  }}
                >
                  Copy
                </Button>
              </div>
              {result.json != null ? (
                <div className="bg-surface rounded border border-border p-2 overflow-auto max-h-[70vh]">
                  <JsonTree value={result.json} />
                </div>
              ) : (
                <pre className="text-xs font-mono bg-surface rounded border border-border p-2 overflow-auto max-h-[70vh]">{result.raw ?? ''}</pre>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Docs drawer ── */}
      {docsOpen && (
        <Resizer direction="col" startValue={() => docsWidth} onResize={(v, d) => setDocsWidth(Math.min(480, Math.max(220, v - d)))} />
      )}
      {docsOpen && (
        <aside style={{ width: docsWidth }} className="shrink-0 bg-surface flex flex-col min-h-0">
          <div className="shrink-0 p-2 border-b border-border flex items-center gap-1.5">
            {currentDocType
              ? <button type="button" onClick={() => setDocType(null)} className="text-xs text-accent-fg hover:underline">← All types</button>
              : <Input value={docSearch} onChange={(e) => setDocSearch(e.currentTarget.value)} placeholder="Search types…" />}
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {!schemaObj && <Text variant="help">{sdlError ?? 'Loading schema…'}</Text>}
            {schemaObj && !currentDocType && docTypes
              .filter((t) => t.name.toLowerCase().includes(docSearch.trim().toLowerCase()))
              .map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => setDocType(t.name)}
                  className="w-full text-left px-2 py-1 rounded hover:bg-surface-hover text-xs font-mono text-fg"
                >
                  {t.name}
                </button>
              ))}
            {currentDocType && (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold font-mono text-fg">{currentDocType.name}</p>
                {'getTypes' in currentDocType && typeof (currentDocType as { getTypes?: unknown }).getTypes === 'function' && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Union of - select with <code>{'... on Type { … }'}</code></p>
                    {(currentDocType as unknown as { getTypes(): Array<{ name: string }> }).getTypes().map((t) => (
                      <button key={t.name} type="button" onClick={() => setDocType(t.name)} className="block text-[11px] font-mono text-accent-fg hover:underline">
                        ... on {t.name}
                      </button>
                    ))}
                  </div>
                )}
                {'description' in currentDocType && currentDocType.description && (
                  <p className="text-[11px] text-fg-subtle">{String(currentDocType.description)}</p>
                )}
                {'getFields' in currentDocType && typeof (currentDocType as { getFields?: unknown }).getFields === 'function' && (
                  <div className="space-y-1">
                    {Object.values((currentDocType as unknown as { getFields(): Record<string, { name: string; type: unknown; description?: string | null }> }).getFields()).map((f) => {
                      const typeName = String(f.type)
                      const bare = typeName.replace(/[[\]!]/g, '')
                      return (
                        <div key={f.name} className="text-[11px] font-mono">
                          <span className="text-fg">{f.name}</span>
                          <span className="text-fg-subtle">: </span>
                          <button
                            type="button"
                            onClick={() => schemaObj?.getTypeMap()[bare] && setDocType(bare)}
                            className="text-accent-fg hover:underline"
                          >
                            {typeName}
                          </button>
                          {f.description && <p className="text-fg-subtle font-sans">{f.description}</p>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}

/** Compact history timestamp, matching the REST rail. */
function formatGqlTime(at: number): string {
  const d = new Date(at)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}
