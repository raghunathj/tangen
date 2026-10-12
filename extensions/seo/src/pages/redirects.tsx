/**
 * File Name: redirects.tsx
 * Purpose: Redirect management (closure plan Phase 9A, Unit 15), built on the
 *          Phase 8B Admin contracts rather than on a second set of its own:
 *          four async states, filtered-empty distinct from true empty, a
 *          failed load that says so and offers a retry, and a delete that
 *          confirms in proportion to what it does.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @/kit only. The server owns every rule; this page
 *          renders the server's refusals rather than duplicating them, so the
 *          Admin and any other caller can never disagree about what is legal.
 *          No em dashes in UI copy.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { IconMoreHorizontal, IconArrowLeftRight, IconLink, IconRepeat, IconToggleOn, IconListChecks } from '@tangen/icons'
import {
  adminFetch, useCan, useContentTypes, RelationPicker, usePageHeaderActions, ListChip, ListFilter, ListFilterChips, activeFilters,
  Button, Badge, Callout, Text, DataList, Input, Label, Select, SelectItem, useConfirm, toast,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
  ChoiceRow, RadioGroup, RadioGroupItem, Toggle,
  type DataListColumn, type ListFilterFacet, type ListFilterValue, Menu, MenuTrigger, MenuContent, MenuItem, Panel } from '@/kit'
import { MANAGER_PAGE_SIZE } from '../lib/seo-manager-nav'

interface RedirectRow {
  source: string
  destination: { kind: 'external'; url: string } | { kind: 'path'; path: string } | { kind: 'internal'; type: string; id: string }
  status: 301 | 302
  enabled: boolean
  createdAt: string
  updatedAt: string
  note?: string
  /** Absent means the visitor's query string rides along. */
  keepQuery?: boolean
  /** For a content target: the URL the site resolves it to, when it can. */
  resolved?: string | null
}

/** What the one Filter control offers, in the order an editor reaches for it. */
const FACETS: ListFilterFacet[] = [
  { id: 'enabled', label: 'State', icon: <IconListChecks />, options: [{ value: 'all', label: 'All' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
  {
    id: 'kind', label: 'Destination', icon: <IconArrowLeftRight />,
    options: [
      { value: 'all', label: 'Any destination' },
      { value: 'content', label: 'Content' },
      { value: 'path', label: 'A path' },
      { value: 'url', label: 'A full URL' },
    ],
  },
]

/** What a frontend fetches to hold the whole map itself. */
const REDIRECTS_JSON_PATH = '/api/v1/ext/seo/redirects.json'

const describe = (d: RedirectRow['destination'], resolved?: string | null): string =>
  d.kind === 'external' ? d.url : d.kind === 'path' ? d.path : resolved ?? `${d.type} / ${d.id}`

/**
 * The Redirects section, rendered as a tab inside the SEO Manager hub. It owns
 * no page header (the hub does): a self-contained toolbar carries the search
 * and the New action instead.
 */
export function RedirectsPanel({ initialSource }: { initialSource?: string } = {}) {
  const { hasCapability } = useCan()
  const { confirm, confirmDialog } = useConfirm()
  // Permission, not capability: the extension being ON is a separate question
  // the platform's page gate already answered (Phase 8A/8B).
  const mayWrite = hasCapability('seo:write' as never)

  const [rows, setRows] = useState<RedirectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<ListFilterValue>({ enabled: 'all', kind: 'all' })
  const enabled = String(filters.enabled ?? 'all')
  const kind = String(filters.kind ?? 'all')
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  // Rows whose destination the app cannot place: they are in the table but not
  // in the endpoint, which is confusing unless the page says so.
  const unresolved = rows.filter((r) => r.destination.kind === 'internal' && !r.resolved)
  const [sort, setSort] = useState<{ field: string; direction: 'asc' | 'desc' } | undefined>(undefined)
  const [editing, setEditing] = useState<RedirectRow | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await adminFetch<{ data: RedirectRow[]; meta?: { total?: number } }>('/admin/ext/seo/redirects', undefined, {
        search, ...(enabled === 'all' ? {} : { enabled }), ...(kind === 'all' ? {} : { kind }),
        ...(sort ? { sort: sort.field, dir: sort.direction } : {}),
        limit: String(MANAGER_PAGE_SIZE), offset: String((page - 1) * MANAGER_PAGE_SIZE),
      })
      setRows(res.data ?? [])
      setTotal(res.meta?.total ?? (res.data ?? []).length)
    } catch (e) {
      // Phase 8B: a failed load is an ERROR, never "no results".
      setError((e as Error).message || 'The redirect list could not be loaded.')
    } finally { setLoading(false) }
  }, [search, enabled, kind, sort, page])

  useEffect(() => { load() }, [load])

  // V5: the 404 Monitor sends an editor here with the path already known.
  const prefilled = useRef(false)
  useEffect(() => {
    if (prefilled.current || !initialSource || !mayWrite) return
    prefilled.current = true
    setEditing({ source: initialSource, destination: { kind: 'external', url: '' }, status: 301 } as RedirectRow)
    setOpen(true)
  }, [initialSource, mayWrite])

  async function remove(row: RedirectRow) {
    const ok = await confirm({
      title: 'Delete this redirect?',
      message: `Visitors going to ${row.source} will stop being sent to ${describe(row.destination, row.resolved)}. You can create it again afterwards.`,
      confirmLabel: 'Delete redirect',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await adminFetch('/admin/ext/seo/redirects', { method: 'DELETE' }, { source: row.source })
      toast.success('Redirect deleted')
      load()
    } catch (e) { toast.error('Could not delete the redirect', (e as Error).message) }
  }

  async function setEnabledState(row: RedirectRow, next: boolean) {
    try {
      const res = await adminFetch<{ data?: unknown; error?: { message?: string } }>('/admin/ext/seo/redirects', {
        method: 'PATCH',
        body: JSON.stringify({ source: row.source, replacing: row.source, destination: row.destination, status: row.status, createdAt: row.createdAt, enabled: next }),
      })
      if (res?.error) { toast.error(res.error.message || 'That could not be changed'); return }
      toast.success(next ? 'Redirect turned on' : 'Redirect turned off')
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'That could not be changed') }
  }

  const columns: DataListColumn<RedirectRow>[] = [
    { key: 'source', header: 'From', icon: <IconArrowLeftRight />, sortKey: 'source', cell: (r) => <span className="font-mono text-xs">{r.source}</span> },
    {
      key: 'destination', header: 'To', icon: <IconLink />,
      cell: (r) => (
        <span className="min-w-0">
          <span className="font-mono text-xs">{describe(r.destination, r.resolved)}</span>
          {r.destination.kind === 'internal' && <span className="ml-1.5 text-[11px] text-fg-subtle">{r.resolved ? 'content' : `${r.destination.type}, no URL yet`}</span>}
          {r.destination.kind === 'path' && <span className="ml-1.5 text-[11px] text-fg-subtle">on this site</span>}
          {r.keepQuery === false && <span className="ml-1.5 text-[11px] text-fg-subtle">query dropped</span>}
        </span>
      ),
    },
    { key: 'status', header: 'Kind', icon: <IconRepeat />, cell: (r) => <Badge>{r.status === 301 ? 'Permanent' : 'Temporary'}</Badge> },
    { key: 'enabled', header: 'State', icon: <IconToggleOn />, cell: (r) => <Badge variant={r.enabled ? 'success' : 'neutral'}>{r.enabled ? 'On' : 'Off'}</Badge> },
    {
      // Row actions reveal on hover or keyboard focus (UI V2 spec §16): a quiet
      // Edit, and the irreversible Delete behind the row menu rather than a
      // red button on every line.
      key: 'actions', header: '', cell: (r) => mayWrite ? (
        <div className="flex justify-end gap-1 opacity-0 transition-opacity motion-fast group-hover/row:opacity-100 group-focus-within/row:opacity-100 has-[[data-state=open]]:opacity-100">
          <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setOpen(true) }}>Edit</Button>
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" variant="ghost" icon={<IconMoreHorizontal />} aria-label={`Actions for ${r.source}`} />
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem onSelect={() => { setEditing(r); setOpen(true) }}>Edit</MenuItem>
              <MenuItem onSelect={() => setEnabledState(r, r.enabled === false)}>{r.enabled === false ? 'Turn on' : 'Turn off'}</MenuItem>
              <MenuItem destructive onSelect={() => remove(r)}>Delete</MenuItem>
            </MenuContent>
          </Menu>
        </div>
      ) : null,
    },
  ]

  // The page header carries the one primary action, as every other page does.
  usePageHeaderActions(
    mayWrite ? <Button size="sm" onClick={() => { setEditing(null); setOpen(true) }}>New redirect</Button> : null,
    [mayWrite],
  )

  return (
    <div className="space-y-4">
      <DataList<RedirectRow>
        chrome="framed"
        columns={columns}
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1) }}
        searchPlaceholder="Search by address"
        filtered={search.trim() !== '' || enabled !== 'all' || kind !== 'all'}
        total={total}
        page={page}
        pageSize={MANAGER_PAGE_SIZE}
        onPageChange={setPage}
        sortConfig={sort}
        onSortChange={setSort}
        toolbarLeft={<ListChip icon={<IconArrowLeftRight />} label="Redirects" count={total} />}
        toolbarRight={<ListFilter facets={FACETS} value={filters} onChange={(next) => { setFilters(next); setPage(1) }} />}
        filterRow={activeFilters(FACETS, filters).length
          ? <ListFilterChips facets={FACETS} value={filters} onChange={(next) => { setFilters(next); setPage(1) }} />
          : undefined}
        rows={rows}
        rowKey={(r) => r.source}
        loading={loading}
        error={error ? { message: error, onRetry: load } : undefined}
        emptyState={{
          title: 'No redirects yet',
          description: 'When a page moves, add a redirect here so its old address keeps working.',
          action: mayWrite ? <Button size="sm" onClick={() => { setEditing(null); setOpen(true) }}>New redirect</Button> : undefined,
        }}
        filteredEmptyState={{
          title: search.trim() ? `Nothing matches "${search}"` : 'No redirect is in that state',
          description: search.trim() ? 'No redirect uses that address.' : 'Change the state filter to see the others.',
          action: <Button size="sm" variant="secondary" onClick={() => { setSearch(''); setFilters({ enabled: 'all', kind: 'all' }) }}>Clear filters</Button>,
        }}
      />
      {unresolved.length > 0 && (
        <Callout variant="warning" title={`${unresolved.length} redirect${unresolved.length === 1 ? '' : 's'} cannot be followed yet`}>
          {`${unresolved.length === 1 ? 'It points' : 'They point'} at content, and your application has not told Tangen how to build that URL, so ${unresolved.length === 1 ? 'it is' : 'they are'} left out of the endpoint below and the public lookup answers nothing for ${unresolved.length === 1 ? 'it' : 'them'}. Give the SEO helpers a resolveUrl in your project's extension config, or point the redirect at a path or a full URL instead.`}
        </Callout>
      )}
      <Panel>
        <p className="text-sm font-semibold text-fg">The whole list, for your frontend</p>
        <p className="mt-1 text-ui-xs text-fg-subtle">
          Every redirect that is on, with its destination already resolved, so your site can hold the map itself (a Next.js <code className="font-mono">redirects()</code>, an edge middleware) instead of asking per request. It answers to a workspace API key.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Input readOnly value={REDIRECTS_JSON_PATH} aria-label="The redirects endpoint" className="min-w-0 flex-1 font-mono text-[11px]" />
          <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard?.writeText(REDIRECTS_JSON_PATH); toast.success('Endpoint copied') }}>Copy</Button>
        </div>
        <p className="mt-1.5 text-[11px] text-fg-subtle">With the SDK: <code className="font-mono">client.seo.redirects()</code></p>
      </Panel>
      <Text variant="help">
        Your site asks Tangen for a redirect on a path it does not recognise, through the public SEO route. Tangen stores the rule and resolves the destination; your application performs the redirect.
      </Text>
      <RedirectDialog open={open} onOpenChange={setOpen} editing={editing} onSaved={() => { setOpen(false); load() }} />
      {confirmDialog}
    </div>
  )
}

function RedirectDialog({ open, onOpenChange, editing, onSaved }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: RedirectRow | null
  onSaved: () => void
}) {
  const [source, setSource] = useState('')
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<301 | 302>(301)
  const [saving, setSaving] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  // Two ways to say where it goes: a piece of content on this site (stored as
  // an identity, so it follows the page when its URL changes), or a full URL.
  const [mode, setMode] = useState<'content' | 'address'>('content')
  const [keepQuery, setKeepQuery] = useState(true)
  const [targetType, setTargetType] = useState('')
  const [targetId, setTargetId] = useState<string | null>(null)
  const contentTypes = useContentTypes()

  useEffect(() => {
    if (!open) return
    setSource(editing?.source ?? '')
    setUrl(editing ? (editing.destination.kind === 'external' ? editing.destination.url : editing.destination.kind === 'path' ? editing.destination.path : '') : '')
    setMode(editing ? (editing.destination.kind === 'internal' ? 'content' : 'address') : 'content')
    setKeepQuery(editing ? editing.keepQuery !== false : true)
    setTargetType(editing && editing.destination.kind === 'internal' ? editing.destination.type : '')
    setTargetId(editing && editing.destination.kind === 'internal' ? editing.destination.id : null)
    setStatus(editing?.status ?? 301)
    setFieldError(null)
  }, [open, editing])

  // Default to the first content type so the picker has something to search.
  useEffect(() => {
    if (mode === 'content' && !targetType && contentTypes.length > 0) setTargetType(contentTypes[0]!.name)
  }, [mode, targetType, contentTypes])

  // One field, either form: a path on this site, or a full address. The shape
  // of what was typed decides what is stored, so nobody picks a radio button
  // to describe what they already wrote.
  const typedAddress = url.trim()
  const addressDestination = typedAddress.startsWith('/')
    ? { kind: 'path' as const, path: typedAddress }
    : { kind: 'external' as const, url: typedAddress }

  async function save() {
    setSaving(true); setFieldError(null)
    try {
      // A route may answer an error envelope with a 200; treating that as a
      // save is how a refused redirect looked created and never appeared.
      const res = await adminFetch<{ data?: unknown; error?: { message?: string } }>('/admin/ext/seo/redirects', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          source,
          destination: mode === 'content'
            ? { kind: 'internal', type: targetType, id: targetId ?? '' }
            : addressDestination,
          status,
          keepQuery,
          ...(editing ? { replacing: editing.source, createdAt: editing.createdAt } : {}),
        }),
      })
      if (res?.error) { setFieldError(res.error.message || 'This redirect could not be saved.'); return }
      toast.success(editing ? 'Redirect updated' : 'Redirect created')
      onSaved()
    } catch (e) {
      // The server's own wording. The Admin does not re-author the rules.
      setFieldError((e as Error).message || 'This redirect could not be saved.')
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{editing ? 'Edit redirect' : 'New redirect'}</DialogTitle></DialogHeader>
        <DialogBody className="space-y-6">
          <div className="space-y-1.5">
            <Label htmlFor="seo-redirect-source">From</Label>
            <Input id="seo-redirect-source" value={source} onChange={(e) => setSource((e.target as HTMLInputElement).value)} placeholder="/old-page" autoFocus />
            <Text variant="help">A path on your site, not a full address.</Text>
          </div>

          <div className="space-y-2.5">
            <Label>To</Label>
            {/* A choice reads as a choice: two radio rows, then the control for
                whichever was chosen. Button pairs looked like actions. */}
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'content' | 'address')}>
              <ChoiceRow
                htmlFor="seo-redirect-to-content"
                label="A page on this site"
                help="Stored as the page's identity, so the redirect follows it if its address changes."
                control={<RadioGroupItem id="seo-redirect-to-content" value="content" />}
              />
              <ChoiceRow
                htmlFor="seo-redirect-to-address"
                label="An address"
                help={'A path like /abc.html, or a full URL including https.'}
                control={<RadioGroupItem id="seo-redirect-to-address" value="address" />}
              />
            </RadioGroup>
            <div className="pt-0.5">
              {mode === 'content' ? (
                <div className="space-y-2">
                  {contentTypes.length > 1 && (
                    <Select value={targetType} onValueChange={(v) => { setTargetType(v); setTargetId(null) }} placeholder="Content type">
                      {contentTypes.map((t) => <SelectItem key={t.name} value={t.name}>{t.label ?? t.name}</SelectItem>)}
                    </Select>
                  )}
                  {targetType
                    ? <RelationPicker targetType={targetType} value={targetId} onChange={setTargetId} label="Destination page" />
                    : <Text variant="help">This workspace has no content types yet.</Text>}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Input id="seo-redirect-url" aria-label="Destination address" value={url} onChange={(e) => setUrl((e.target as HTMLInputElement).value)} placeholder="/abc.html or https://example.com/new-page" />
                  {typedAddress !== '' && (
                    <Text variant="help">
                      {typedAddress.startsWith('/')
                        ? 'A path on this site: your app redirects from its own origin.'
                        : 'A full address. Start with "/" instead for a path on this site.'}
                    </Text>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2.5">
            <Label>Kind</Label>
            {/* Two options, so they are both visible rather than hidden behind a
                menu that a short dialog clips. */}
            <RadioGroup value={String(status)} onValueChange={(v) => setStatus(Number(v) as 301 | 302)}>
              <ChoiceRow
                htmlFor="seo-redirect-301"
                label="Permanent (301)"
                help="The move is final; search engines carry the ranking over."
                control={<RadioGroupItem id="seo-redirect-301" value="301" />}
              />
              <ChoiceRow
                htmlFor="seo-redirect-302"
                label="Temporary (302)"
                help="The old address is coming back; rankings stay with it."
                control={<RadioGroupItem id="seo-redirect-302" value="302" />}
              />
            </RadioGroup>
          </div>

          <Toggle
            label="Carry the query string"
            description="A visitor arriving with ?utm_source=mail keeps it on the new address. The redirect fires either way."
            direction="switch-first"
            size="sm"
            checked={keepQuery}
            onCheckedChange={setKeepQuery}
          />

          {/* A refusal is a persistent condition, not a toast that vanishes. */}
          {fieldError && <p role="alert" className="text-xs text-danger-fg">{fieldError}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" size="sm" isLoading={saving} onClick={save}>{editing ? 'Save' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
