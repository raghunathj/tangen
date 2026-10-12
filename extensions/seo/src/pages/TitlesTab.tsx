/**
 * File Name: TitlesTab.tsx
 * Purpose: Titles & Meta (plan-seo-manager-v2 V2): every published page's SEO
 *          copy in the platform's own data list - search, filters, paging -
 *          and one row opens a Sheet to edit it. An edit writes the DRAFT, so
 *          the Sheet states what visitors see now beside each field and reads
 *          the platform's publish policy for that object: where another
 *          extension gates publishing (Review, for one), the Sheet says so
 *          rather than promising the change will appear.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AdminPage, Button, Callout, DataList, Input, Textarea, Text,
  Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
  adminFetch, toast, useCan, ListChip, ListFilter, ListFilterChips, activeFilters, TEXT_LINK,
  type DataListColumn, type ListFilterFacet, type ListFilterValue,
} from '@/kit'
import { IconSparkles, IconText, IconFileText, IconListChecks, IconTable } from '@tangen/icons'
import type { LifecycleActions } from '@tangen/cms'
import { TITLES_PAGE_SIZE, type TitleRow, type TitleState } from '../lib/titles'

interface Meta { total: number; scanned: number; counts: Record<TitleState, number>; types: string[] }

const STATE_LABEL: Record<TitleState, string> = { good: 'Good', 'needs-work': 'Needs work', missing: 'No metadata' }
const STATE_CLASS: Record<TitleState, string> = {
  good: 'bg-success-muted text-success-fg',
  'needs-work': 'bg-warning-muted text-warning-fg',
  missing: 'bg-danger-muted text-danger-fg',
}
const EMPTY_META: Meta = { total: 0, scanned: 0, counts: { good: 0, 'needs-work': 0, missing: 0 }, types: [] }

function StateBadge({ state }: { state: TitleState }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>
}

export function SeoTitlesPage() {
  const { hasCapability } = useCan()
  const mayWrite = hasCapability('seo:write')

  const [rows, setRows] = useState<TitleRow[]>([])
  const [meta, setMeta] = useState<Meta>(EMPTY_META)
  // A deep link may arrive already filtered (the Dashboard's "Edit all").
  const [urlParams] = useSearchParams()
  const [filters, setFilters] = useState<ListFilterValue>({
    state: urlParams.get('state') ?? 'all',
    type: urlParams.get('type') ?? 'all',
  })
  const state = String(filters.state ?? 'all')
  const type = String(filters.type ?? 'all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<TitleRow | null>(null)
  const [aiReady, setAiReady] = useState(false)
  const [sort, setSort] = useState<{ field: string; direction: 'asc' | 'desc' } | undefined>(undefined)

  useEffect(() => {
    let alive = true
    adminFetch<{ data: { generate: { available: boolean } } }>('/admin/ext/seo/ai-status')
      .then((r) => { if (alive) setAiReady(r.data.generate.available) })
      .catch(() => { if (alive) setAiReady(false) })
    return () => { alive = false }
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams({ limit: String(TITLES_PAGE_SIZE), offset: String((page - 1) * TITLES_PAGE_SIZE) })
      if (state !== 'all') params.set('state', state)
      if (type !== 'all') params.set('type', type)
      if (search.trim()) params.set('search', search.trim())
      if (sort) { params.set('sort', sort.field); params.set('dir', sort.direction) }
      const res = await adminFetch<{ data: TitleRow[]; meta: Meta }>(`/admin/ext/seo/titles?${params.toString()}`)
      setRows(res.data ?? [])
      setMeta(res.meta ?? EMPTY_META)
    } catch (e) {
      setError((e as Error).message || 'The list could not be loaded.')
    } finally { setLoading(false) }
  }, [page, search, sort, state, type])
  useEffect(() => { load() }, [load])

  // The counts live in the labels, so the menu says how much each state holds.
  const facets: ListFilterFacet[] = [
    {
      id: 'state', label: 'State', icon: <IconListChecks />,
      options: [
        { value: 'all', label: `All (${meta.scanned})` },
        { value: 'attention', label: `Needs attention (${meta.counts.missing + meta.counts['needs-work']})` },
        { value: 'missing', label: `${STATE_LABEL.missing} (${meta.counts.missing})` },
        { value: 'needs-work', label: `${STATE_LABEL['needs-work']} (${meta.counts['needs-work']})` },
        { value: 'good', label: `${STATE_LABEL.good} (${meta.counts.good})` },
      ],
    },
    ...(meta.types.length > 1
      ? [{ id: 'type', label: 'Content type', icon: <IconTable />, options: [{ value: 'all', label: 'All types' }, ...meta.types.map((t) => ({ value: t, label: t }))] }]
      : []),
  ]

  const columns: DataListColumn<TitleRow>[] = [
    {
      key: 'page', header: 'Page', icon: <IconTable />, sortKey: 'page',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{r.objectTitle || r.id}</p>
          <p className="truncate text-[11px] text-fg-subtle">{r.type}</p>
        </div>
      ),
    },
    {
      key: 'title', header: 'SEO title', icon: <IconText />, sortKey: 'title',
      cell: (r) => r.published.title
        ? <span className="line-clamp-1 text-fg-muted">{r.published.title}</span>
        : <span className="text-fg-faint">Falls back to the page title</span>,
    },
    {
      key: 'description', header: 'Meta description', icon: <IconFileText />,
      cell: (r) => r.published.description
        ? <span className="line-clamp-1 text-fg-muted">{r.published.description}</span>
        : <span className="text-fg-faint">Not set</span>,
    },
    {
      key: 'state', header: 'State', icon: <IconListChecks />, sortKey: 'state',
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StateBadge state={r.state} />
          {r.pending && <span className="inline-flex rounded-full bg-accent-muted px-2 py-0.5 text-[11px] font-semibold text-accent-fg">Draft waiting</span>}
        </span>
      ),
    },
  ]

  return (
    <AdminPage
      title="Titles & Meta"
      description="Every published page's SEO title and description, in one place."
      access={{ capability: 'seo:read' }}
    >
      <div className="space-y-4">
        <DataList<TitleRow>
          chrome="framed"
          columns={columns}
          rows={rows}
          rowKey={(r) => `${r.type}:${r.id}`}
          loading={loading}
          onRowClick={(r) => setEditing(r)}
          page={page}
          pageSize={TITLES_PAGE_SIZE}
          total={meta.total}
          onPageChange={setPage}
          search={search}
          searchPlaceholder="Search titles and descriptions"
          onSearchChange={(v) => { setSearch(v); setPage(1) }}
          filtered={state !== 'all' || type !== 'all' || search.trim() !== ''}
          error={error ? { message: error, onRetry: load } : undefined}
          sortConfig={sort}
          onSortChange={setSort}
          toolbarLeft={<ListChip icon={<IconTable />} label="Pages" count={meta.total} />}
          toolbarRight={<ListFilter facets={facets} value={filters} onChange={(next) => { setFilters(next); setPage(1) }} />}
          filterRow={activeFilters(facets, filters).length
            ? <ListFilterChips facets={facets} value={filters} onChange={(next) => { setFilters(next); setPage(1) }} />
            : undefined}
          emptyState={{
            title: 'Nothing to show',
            description: 'Nothing is published yet. A page appears here once it is published.',
          }}
          filteredEmptyState={{
            title: 'No page matches these filters',
            description: 'Clear the filters, or search for something else.',
            action: <Button size="sm" variant="secondary" onClick={() => { setFilters({ state: 'all', type: 'all' }); setSearch(''); setPage(1) }}>Clear filters</Button>,
          }}
        />
        <Text variant="help">
          An edit here is saved as a draft and reaches visitors when the page is next published, exactly as an edit in the page's own SEO panel does. Per-locale values are edited in that panel, where the locale switcher lives.
        </Text>
      </div>
      <EditSheet
        row={editing}
        mayWrite={mayWrite}
        aiReady={aiReady}
        onClose={() => setEditing(null)}
        onSaved={(next) => setRows((all) => all.map((r) => (r.id === next.id ? { ...next, objectTitle: r.objectTitle } : r)))}
      />
    </AdminPage>
  )
}

/** What another extension's publish policy says about this object, if anything. */
function publishGateOf(actions: LifecycleActions | null | undefined): { blocked: boolean; reason?: string } {
  const publish = actions?.actions?.find((a) => a.id === 'publish')
  const policy = publish?.blockers?.find((b) => b.code === 'POLICY')
  if (!policy) return { blocked: false }
  return { blocked: true, ...(policy.reason ? { reason: policy.reason } : {}) }
}

/** One page's SEO copy: the draft being edited, the live values beside it, and who gates the publish that would apply it. */
function EditSheet({ row, mayWrite, aiReady, onClose, onSaved }: {
  row: TitleRow | null
  mayWrite: boolean
  aiReady: boolean
  onClose: () => void
  onSaved: (row: TitleRow) => void
}) {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [proposing, setProposing] = useState(false)
  const [gate, setGate] = useState<{ blocked: boolean; reason?: string } | null>(null)

  useEffect(() => {
    if (!row) return
    setTitle(row.draft.title ?? '')
    setDescription(row.draft.description ?? '')
    setGate(null)
    let alive = true
    // Ask the platform what can be done to this object, rather than guess at
    // another extension's rules: a Review workflow (or any publish policy)
    // shows up here as a POLICY blocker on the publish action.
    adminFetch<{ data: LifecycleActions }>(`/objects/${encodeURIComponent(row.type)}/actions`, undefined, { objectId: row.id })
      .then((r) => { if (alive) setGate(publishGateOf(r.data)) })
      .catch(() => { if (alive) setGate(null) })
    return () => { alive = false }
  }, [row])

  if (!row) return null
  const dirty = (row.draft.title ?? '') !== title || (row.draft.description ?? '') !== description

  const save = async () => {
    setSaving(true)
    try {
      const res = await adminFetch<{ data?: TitleRow; error?: { message: string } }>('/admin/ext/seo/titles', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: row.id, type: row.type, title, description }),
      })
      if (res.error) toast.error(res.error.message)
      else if (res.data) {
        onSaved(res.data)
        toast.success('Saved as a draft; it applies when this page is published')
        onClose()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That could not be saved')
    } finally { setSaving(false) }
  }

  const propose = async () => {
    setProposing(true)
    try {
      const res = await adminFetch<{ data?: { proposal: { title?: string; description?: string } }; error?: { message: string } }>('/admin/ext/seo/optimize', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: row.id, type: row.type }),
      })
      if (res.error) toast.error(res.error.message)
      else if (res.data) {
        if (res.data.proposal.title) setTitle(res.data.proposal.title)
        if (res.data.proposal.description) setDescription(res.data.proposal.description)
        toast.success('Proposed. Review it, then save the draft.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Nothing could be proposed for this page')
    } finally { setProposing(false) }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent size="md" dismissible>
        <SheetHeader>
          <SheetTitle>{row.objectTitle || row.id}</SheetTitle>
          <SheetDescription>{`${row.type} · saved as a draft, applied when this page is next published`}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StateBadge state={row.state} />
              {row.pending && <span className="inline-flex rounded-full bg-accent-muted px-2 py-0.5 text-[11px] font-semibold text-accent-fg">Draft waiting on publish</span>}
            </div>
            {row.issues.length > 0 && <Callout variant="warning" title="What the checks say">{row.issues.join(' ')}</Callout>}
            {gate?.blocked && (
              <Callout variant="info" title="Publishing this page is gated">
                {`${gate.reason ?? 'Another extension controls when this page can be published.'} Your draft is saved either way, and applies when that publish happens.`}
              </Callout>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted" htmlFor="seo-sheet-title">SEO title</label>
                <span className="text-[11px] text-fg-subtle tabular-nums">{title.length}/60</span>
              </div>
              <Input id="seo-sheet-title" value={title} onChange={(e) => setTitle((e.target as HTMLInputElement).value)} disabled={!mayWrite} placeholder={row.objectTitle ?? 'Not set'} />
              <p className="mt-1 text-[11px] text-fg-subtle">{`Live: ${row.published.title ?? 'not set, so the page title is used'}`}</p>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted" htmlFor="seo-sheet-desc">Meta description</label>
                <span className="text-[11px] text-fg-subtle tabular-nums">{description.length}/160</span>
              </div>
              <Textarea id="seo-sheet-desc" rows={4} value={description} onChange={(e) => setDescription((e.target as HTMLTextAreaElement).value)} disabled={!mayWrite} placeholder="Not set" className="resize-none" />
              <p className="mt-1 text-[11px] text-fg-subtle">{`Live: ${row.published.description ?? 'not set'}`}</p>
            </div>

            <Text variant="help">
              Canonical URLs, robots, social fields, FAQ and the answer summary live in this page's own SEO panel, along with the locale switcher.
            </Text>
          </div>
        </SheetBody>
        <SheetFooter>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/${workspaceId}/objects/${row.type}/${row.id}`)}>Open the page</Button>
          <div className="flex-1" />
          {mayWrite && aiReady && (
            <Button size="sm" variant="secondary" disabled={proposing} icon={<IconSparkles className={proposing ? 'size-3.5 animate-pulse text-accent' : 'size-3.5'} />} onClick={propose}>
              {proposing ? 'Writing' : 'Write with AI'}
            </Button>
          )}
          {mayWrite && <Button size="sm" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving' : 'Save draft'}</Button>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
