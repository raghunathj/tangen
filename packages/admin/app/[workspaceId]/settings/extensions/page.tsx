/**
 * File Name: page.tsx (settings/extensions)
 * Purpose: Settings → Extensions: every extension installed in this
 *          workspace, in the Admin's table (the user, 2026-09-20). It used to
 *          list only those declaring settings, which answered one question
 *          and left the operator's real ones unanswered: what is installed,
 *          who wrote it, is it running, what is it allowed to do, and is
 *          there something newer.
 *
 *          FOUR columns, not five: a description is prose, and prose in a
 *          table column is two clipped lines nobody reads. It belongs in the
 *          sheet's Overview, where there is room for it.
 *
 *          The sheet is TABS - Overview, Permissions, Details - built from the
 *          kit's Section/Panel/PanelRow, the same shape every settings page
 *          uses. One scroll of six stacked sections was a wall.
 *
 *          The version column keeps two things apart: the code in the project
 *          shipping a newer manifest (an upgrade the platform runs itself),
 *          and the registry having a newer package (which only a dependency
 *          install can fetch). The registry is asked ON DEMAND, from the
 *          header - a settings screen must not phone a registry every time it
 *          opens.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  usePageHeader, adminFetch, useSettingsWidth,
  Button, Badge, Text, Callout, InlineCode, DataList, ListChip, ListFilter, ListFilterChips,
  activeFilters, clearedFilters, TEXT_LINK, toast, Panel, Popover, PopoverTrigger, PopoverContent,
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription,
  Tabs, TabsList, TabsTrigger, TabsContent,
  type DataListColumn, type ListFilterFacet, type ListFilterValue,
} from '@/kit'
import { IconRefresh, IconSettings, IconExternalLink, IconPuzzle, IconListChecks, IconStack, IconCheck, IconX, IconInfo } from '@tangen/icons'
import { DynamicIcon } from '@/components/dynamic-icon'
import {
  extensionState, versionVerdict, filterExtensions, sortExtensions,
  type ExtensionRow, type UpdateVerdict,
} from '@/lib/extension-inventory'

const FACETS: ListFilterFacet[] = [
  {
    id: 'state', label: 'Status', multiple: true, icon: <IconListChecks />,
    options: [
      { value: 'running', label: 'Enabled' },
      { value: 'disabled', label: 'Disabled' },
      { value: 'code-missing', label: 'Code missing' },
      { value: 'retired', label: 'Retired' },
    ],
  },
  {
    id: 'kind', label: 'Kind', multiple: true, icon: <IconStack />,
    options: [
      { value: 'extension', label: 'Extensions' },
      { value: 'connector-pack', label: 'Connector packs' },
    ],
  },
]

/** A grant as the review describes it - the CLI's own shape (K5.2b). */
interface ReviewedGrant {
  grant: string
  tier?: string
  optional?: boolean
  reason?: string
  explanation?: string
  previouslyGranted?: boolean
}

interface ExtensionDetail {
  id: string
  name: string
  version: string
  description?: string
  versionedData?: boolean
  fieldTypes?: Array<{ name: string; label: string }>
  sidebarPanels?: Array<{ id: string; label: string }>
  hasServer?: boolean
  settings?: boolean
  grants?: { review?: { required?: ReviewedGrant[]; optional?: ReviewedGrant[]; cannot?: string[]; unknown?: string[] }; recorded?: string[] | null } | null
}

/** The extension's own mark: a connector pack's brand image, else its icon. */
function ExtensionGlyph({ row, className = 'size-4' }: { row: ExtensionRow; className?: string }) {
  if (row.brandIcon) return <img src={row.brandIcon} alt="" className={`${className} shrink-0 rounded-[3px] object-contain`} />
  return <DynamicIcon name={row.icon ?? 'IconPuzzle'} className={`${className} shrink-0 text-fg-subtle`} />
}

export default function ExtensionsSettingsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [rows, setRows] = useState<ExtensionRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ListFilterValue>({})
  const [search, setSearch] = useState('')
  const [updates, setUpdates] = useState<Record<string, UpdateVerdict>>({})
  const [checking, setChecking] = useState(false)
  const [open, setOpen] = useState<ExtensionRow | null>(null)

  // Six columns of names, versions and states: a table, not a page of cards.
  useSettingsWidth('wide')

  const load = () => {
    setError(null)
    adminFetch<{ data: ExtensionRow[] }>(`/admin/workspaces/${workspaceId}/extensions`)
      .then((r) => setRows(sortExtensions(r.data ?? [])))
      .catch((e) => setError((e as Error).message))
  }
  useEffect(load, [workspaceId])

  /** Ask the registry, once, for every extension that came from one. */
  async function checkForUpdates() {
    setChecking(true)
    try {
      const res = await adminFetch<{ data: UpdateVerdict[] }>(
        `/admin/workspaces/${workspaceId}/extensions/updates?force=1`, { method: 'POST' },
      )
      const byId: Record<string, UpdateVerdict> = {}
      for (const v of res.data ?? []) byId[v.extensionId] = v
      setUpdates(byId)
      const newer = (res.data ?? []).filter((v) => v.updateAvailable)
      toast.success(
        newer.length === 0 ? 'Everything is up to date' : `${newer.length} update${newer.length === 1 ? '' : 's'} available`,
        newer.length === 0 ? undefined : newer.map((v) => `${v.extensionId} ${v.latest}`).join(', '),
      )
    } catch (e) {
      toast.error('Could not check for updates', (e as Error).message)
    } finally { setChecking(false) }
  }

  // The check belongs with the page's own title, beside every other
  // page-level action in the Admin - not in the table's toolbar, which is
  // about the rows (the user, 2026-09-20).
  usePageHeader({
    description: 'Everything installed in this workspace: who wrote it, what it is allowed to do, and whether it is running.',
    actions: (
      <Button
        size="xs"
        variant="secondary"
        isLoading={checking}
        loadingText="Checking…"
        onClick={checkForUpdates}
        title="Ask the registry what the latest published version of each extension is"
      >
        Check for updates
      </Button>
    ),
  }, [checking, workspaceId])

  const statePick = activeFilters(FACETS, filters).find((a) => a.facet.id === 'state')
  const kindPick = activeFilters(FACETS, filters).find((a) => a.facet.id === 'kind')
  const visible = useMemo(() => filterExtensions(rows ?? [], {
    search,
    states: statePick ? (statePick.value as string[]) : [],
    statesNegated: statePick?.op === 'not-in',
    kinds: kindPick ? (kindPick.value as string[]) : [],
    kindsNegated: kindPick?.op === 'not-in',
  }), [rows, search, filters])

  const columns: DataListColumn<ExtensionRow>[] = [
    {
      key: 'name', header: 'Extension', icon: <IconPuzzle />,
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <ExtensionGlyph row={r} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-fg">{r.name}</span>
              {r.kind === 'connector-pack' && <Badge variant="neutral">Connector pack</Badge>}
            </div>
            <div className="truncate text-ui-xs text-fg-subtle">{r.extensionId}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'author', header: 'Author',
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate text-ui-sm text-fg">{r.author ?? '-'}</div>
          {r.homepage && (
            <a
              href={r.homepage}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              className={`${TEXT_LINK} inline-flex items-center gap-1 text-ui-xs`}
            >
              Website <IconExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </div>
      ),
    },
    {
      key: 'version', header: 'Version',
      cell: (r) => {
        const v = versionVerdict(r, updates[r.extensionId])
        return (
          <div className="min-w-0">
            <div className="text-ui-sm tabular-nums text-fg">{v.running ?? '-'}</div>
            {v.upgradeTo && (
              <span className="text-ui-xs text-accent-fg" title="The project's code ships this version - upgrade this workspace to it">
                {`upgrade to ${v.upgradeTo}`}
              </span>
            )}
            {!v.upgradeTo && v.updateTo && (
              <span className="text-ui-xs text-accent-fg" title={`The registry has ${v.updateTo} - update the package, then upgrade`}>
                {`${v.updateTo} in the registry`}
              </span>
            )}
          </div>
        )
      },
    },
    {
      key: 'state', header: 'Status',
      cell: (r) => {
        const s = extensionState(r)
        return <span title={s.detail}><Badge variant={s.tone === 'neutral' ? 'neutral' : s.tone}>{s.label}</Badge></span>
      },
    },
    {
      key: 'settings', header: '', className: 'text-center', headerClassName: 'text-center',
      cell: (r) => r.settings ? (
        <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
          <Button asChild size="xs" variant="ghost" aria-label={`Settings for ${r.name}`} title="Settings">
            <Link to={`/${workspaceId}/settings/extensions/${r.extensionId}`}><IconSettings className="size-3.5" /></Link>
          </Button>
        </div>
      ) : null,
    },
  ]

  return (
    <div className="space-y-4">
      {error && <Callout variant="danger" title="Could not load the extensions">{error}</Callout>}
      <DataList<ExtensionRow>
        chrome="framed"
        columns={columns}
        rows={visible}
        rowKey={(r) => r.extensionId}
        loading={rows === null}
        onRowClick={(r) => setOpen(r)}
        search={search}
        searchPlaceholder="Search by name, id or author"
        onSearchChange={setSearch}
        filtered={search.trim() !== '' || activeFilters(FACETS, filters).length > 0}
        toolbarLeft={(
          <>
            <ListChip icon={<IconPuzzle />} label="Extensions" count={visible.length} />
            <Button size="sm" variant="ghost" icon={<IconRefresh />} aria-label="Reload the list" title="Reload" onClick={load} />
          </>
        )}
        toolbarRight={<ListFilter facets={FACETS} value={filters} onChange={setFilters} />}
        filterRow={activeFilters(FACETS, filters).length
          ? <ListFilterChips facets={FACETS} value={filters} onChange={setFilters} />
          : undefined}
        emptyState={{
          title: 'No extensions installed',
          description: 'Add an extension package to the project and install it - the CLI (tangen extension install) reviews what it asks for first.',
        }}
        filteredEmptyState={{
          title: 'No extension matches',
          description: 'Clear the filters, or search for another name.',
          action: <Button size="sm" variant="secondary" onClick={() => { setFilters(clearedFilters(FACETS)); setSearch('') }}>Clear filters</Button>,
        }}
      />
      <Text variant="help">
        Installing, upgrading, enabling and uninstalling happen through the CLI, which reviews the grants an extension asks for and records what you approved in tangen.lock.
      </Text>
      <ExtensionSheet row={open} workspaceId={workspaceId!} update={open ? updates[open.extensionId] : undefined} onClose={() => setOpen(null)} />
    </div>
  )
}

// ── The sheet: three tabs, one shape each ────────────────────────────────────

function ExtensionSheet({ row, workspaceId, update, onClose }: {
  row: ExtensionRow | null
  workspaceId: string
  update?: UpdateVerdict
  onClose: () => void
}) {
  const [detail, setDetail] = useState<ExtensionDetail | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    setDetail(null); setFailed(null)
    if (!row) return
    adminFetch<{ data: ExtensionDetail | null }>(`/extensions/${row.extensionId}`)
      .then((r) => setDetail(r.data))
      .catch((e) => setFailed((e as Error).message))
  }, [row?.extensionId])

  if (!row) return null
  const state = extensionState(row)
  const v = versionVerdict(row, update)
  const review = detail?.grants?.review
  const grants = [...(review?.required ?? []), ...(review?.optional ?? [])]

  return (
    <Sheet open onOpenChange={(next: boolean) => { if (!next) onClose() }}>
      <SheetContent side="right" className="w-[560px]">
        <SheetHeader>
          <SheetTitle>
            <span className="flex items-center gap-2">
              <ExtensionGlyph row={row} className="size-4.5" />
              {row.name}
              <Badge variant={state.tone === 'neutral' ? 'neutral' : state.tone}>{state.label}</Badge>
            </span>
          </SheetTitle>
          <SheetDescription>{row.kind === 'connector-pack' ? 'Connector pack' : 'Extension'}</SheetDescription>
        </SheetHeader>

        <SheetBody className="p-0">
          <Tabs defaultValue="overview">
            <TabsList className="px-5">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="permissions">
                {grants.length > 0 ? `Permissions · ${grants.length}` : 'Permissions'}
              </TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
            </TabsList>

            {/* Overview: what it is, and whether anything newer exists. */}
            <TabsContent value="overview" className="space-y-5 px-5 py-5">
              {failed && <Callout variant="warning" title="Could not read its manifest">{failed}</Callout>}
              {row.description && <p className="text-ui-sm leading-relaxed text-fg-muted">{row.description}</p>}
              <Callout variant={state.tone === 'error' ? 'danger' : state.tone === 'warning' ? 'warning' : 'info'} title={state.label}>
                {state.detail}
              </Callout>
              <Panel rows>
                <Row label="Id" value={<InlineCode>{row.extensionId}</InlineCode>} />
              <Row label="Author" value={row.author ?? 'Not declared'} />
                <Row label="Website" value={row.homepage
                  ? <a href={row.homepage} target="_blank" rel="noreferrer noopener" className={TEXT_LINK}>{row.homepage}</a>
                  : 'Not declared'} />
                <Row label="Licence" value={row.license ?? 'Not declared'} />
              </Panel>
              <Panel rows>
                <Row label="Running here" value={v.running ?? 'Not recorded'} />
                <Row label="In the project" value={row.codeVersion ?? 'The code is not present'} />
                <Row label="In the registry" value={update ? (update.latest ?? update.message ?? 'No answer') : 'Not checked yet'} />
              </Panel>
              {v.upgradeTo && (
                <Callout variant="info" title={`The code ships ${v.upgradeTo}`}>
                  {`Upgrade this workspace with: tangen extension upgrade ${row.extensionId}. It runs the extension's pending migrations and reviews any new grant.`}
                </Callout>
              )}
              {!v.upgradeTo && v.updateTo && (
                <Callout variant="info" title={`The registry has ${v.updateTo}`}>
                  {`Update the package first (bun add ${row.package}@${v.updateTo}), then upgrade this workspace.`}
                </Callout>
              )}
            </TabsContent>

            {/* Permissions: the grant review, one row each. */}
            <TabsContent value="permissions" className="space-y-4 px-5 py-5">
              {!review && (
                <Text variant="help">
                  {detail
                    ? 'This extension declares no grants: it runs with no authority of its own beyond the routes and pages it registers.'
                    : 'Reading its manifest…'}
                </Text>
              )}
              {review && (
                <>
                  <Text variant="help">
                    What it is allowed to do, and why it says it needs it. A tick means this installation approved it.
                  </Text>
                  <GrantSection title="Required" grants={review.required ?? []} />
                  <GrantSection title="Optional" grants={review.optional ?? []} />
                  {(review.unknown?.length ?? 0) > 0 && (
                    <Callout variant="warning" title="Grants this platform does not know">
                      {review.unknown!.join(', ')}
                    </Callout>
                  )}
                </>
              )}
            </TabsContent>

            {/* Details: what it contributes, and the installation's facts. */}
            <TabsContent value="details" className="space-y-5 px-5 py-5">
              <Panel rows>
                <Row label="Settings" value={row.settings ? 'Yes, editable here' : 'None'} />
                <Row label="Server" value={detail?.hasServer ? 'Runs server code' : 'Admin surface only'} />
                <Row label="Editor panels" value={(detail?.sidebarPanels ?? []).map((p) => p.label).join(', ') || 'None'} />
                <Row label="Field types" value={(detail?.fieldTypes ?? []).map((f) => f.label).join(', ') || 'None'} />
                <Row label="Content data" value={detail?.versionedData ? 'Versioned with the object' : 'Accumulative'} />
              </Panel>
              <Panel rows>
                <Row label="Package" value={row.package ? <InlineCode>{row.package}</InlineCode> : 'A path in this project'} />
                <Row label="Installed" value={fmt(row.installedAt)} />
                <Row label="By" value={row.installedBy ?? 'Not recorded'} />
                <Row label="Last upgraded" value={fmt(row.upgradedAt)} />
              </Panel>
            </TabsContent>
          </Tabs>
        </SheetBody>

        <SheetFooter>
          {row.settings && (
            <Button asChild size="xs" variant="secondary">
              <Link to={`/${workspaceId}/settings/extensions/${row.extensionId}`}>Settings</Link>
            </Button>
          )}
          <Button size="xs" onClick={onClose}>Close</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** One labelled fact: the label on the left, the value on the right. */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 px-4 py-2.5">
      <span className="w-32 shrink-0 text-ui-xs text-fg-subtle">{label}</span>
      <span className="min-w-0 flex-1 break-words text-right text-ui-sm text-fg">{value}</span>
    </div>
  )
}

/**
 * The grants of one kind: one line each - the grant, a mark for whether this
 * installation approved it, and the reason behind an info icon (the user,
 * 2026-09-20). A paragraph under every row made a list of eight into a wall;
 * the grant NAME is what an operator scans, and the reason is what they open
 * when one of them surprises them.
 */
function GrantSection({ title, grants }: { title: string; grants: ReviewedGrant[] }) {
  if (grants.length === 0) return null
  return (
    <div className="space-y-2">
      <p className="text-ui-xs font-semibold uppercase tracking-wider text-fg-subtle">{title}</p>
      <Panel rows>
        {grants.map((g) => (
          <div key={g.grant} className="flex items-center gap-2 px-4 py-2.5">
            <InlineCode>{g.grant}</InlineCode>
            {g.tier === 'PRIVILEGED' && <Badge variant="warning">Privileged</Badge>}
            {(g.reason || g.explanation) && <GrantReason grant={g} />}
            <span className="ml-auto shrink-0">
              {g.previouslyGranted
                ? <IconCheck className="size-4 text-success-fg" aria-label="Approved" />
                : <IconX className="size-4 text-fg-faint" aria-label="Not approved" />}
            </span>
          </div>
        ))}
      </Panel>
    </div>
  )
}

/** Why the extension says it needs this grant, and what it lets it do. */
function GrantReason({ grant }: { grant: ReviewedGrant }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="xs" variant="ghost" className="size-5 p-0" aria-label={`Why ${grant.grant} is asked for`}>
          <IconInfo className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-1.5">
        <p className="text-ui-xs font-medium text-fg">{grant.grant}</p>
        {grant.reason && <p className="text-ui-xs leading-relaxed text-fg-muted">{grant.reason}</p>}
        {grant.explanation && grant.explanation !== grant.reason && (
          <p className="text-ui-xs leading-relaxed text-fg-subtle">{grant.explanation}</p>
        )}
      </PopoverContent>
    </Popover>
  )
}

const fmt = (iso?: string | null): string => {
  if (!iso) return 'Not recorded'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'Not recorded' : d.toLocaleString()
}
