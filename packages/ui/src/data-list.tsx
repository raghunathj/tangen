import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconSearch, IconArrowUp, IconArrowDown, IconChevronDown, IconChevronRight, IconExpandUpDown, IconSpinner } from '@tangen/icons'
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuSub, MenuSubTrigger, MenuSubContent } from './menu'
import { ViewBar } from './view-bar'
import { cx } from './utils'
import { Checkbox } from './checkbox'
import { Button } from './button'
import { Table, TableRoot, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from './table'
import { Dialog, DialogContent } from './dialog'

/**
 * A frozen cell (the checkbox and first columns): an opaque background that
 * follows the row's hover and selection through overlays (an inherited
 * alpha tint would let scrolled cells show through), and a soft shadow on
 * its right edge while the table is scrolled sideways, so the other columns
 * read as passing underneath.
 */
const FROZEN_CELL = [
  'bg-surface group-aria-[selected=true]/row:bg-canvas',
  'before:pointer-events-none before:absolute before:inset-0 before:transition-colors before:motion-fast',
  'group-hover/row:before:bg-surface-hover group-aria-[selected=true]/row:before:bg-transparent',
  'after:pointer-events-none after:absolute after:inset-y-0 after:left-full after:w-3 after:bg-gradient-to-r after:from-border after:to-transparent',
  'after:opacity-0 after:transition-opacity after:motion-fast group-data-[scrolled]/table:after:opacity-100',
].join(' ')
const FROZEN_HEAD = [
  'after:pointer-events-none after:absolute after:inset-y-0 after:left-full after:w-3 after:bg-gradient-to-r after:from-border after:to-transparent',
  'after:opacity-0 after:transition-opacity after:motion-fast group-data-[scrolled]/table:after:opacity-100',
].join(' ')

/** The view bar's text buttons (Filter, Sort): ghost, 13px, 28px tall. */
const GHOST_TEXT = 'inline-flex h-7 shrink-0 items-center rounded-control px-2 text-ui text-fg-muted transition-colors motion-fast hover:bg-surface-hover hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus data-[state=open]:bg-surface-selected data-[state=open]:text-fg'

// ── Types ────────────────────────────────────────────────────────────────────

export interface DataListColumn<T> {
  key: string
  header: string
  /** The column's type, drawn before the header label (a field type's icon). */
  icon?: React.ReactNode
  /** If set, the column header becomes a clickable sort trigger. */
  sortKey?: string
  cell: (row: T) => React.ReactNode
  /** Extra Tailwind classes on the <td>. */
  className?: string
  /** Extra Tailwind classes on the <th>. */
  headerClassName?: string
  /**
   * Long-content clipping (default 30 characters). Cells whose text runs
   * longer are truncated with an ellipsis and show the full value on hover.
   * Pass a number to change the threshold, or false to disable for the column.
   */
  clipAt?: number | false
}

/** Recursively extracts the plain text inside a cell's ReactNode tree. */
function nodeToText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeToText).join('')
  if (React.isValidElement(node)) return nodeToText((node.props as { children?: React.ReactNode }).children)
  return ''
}

/**
 * Keeps columns from stretching on long values: plain text is clipped at
 * `clipAt` characters with an ellipsis; rich cells (spans, chip rows) get a
 * CSS max-width truncation instead. Hover shows the full text either way.
 */
function ClippedCell({ node, clipAt }: { node: React.ReactNode; clipAt: number }) {
  const text = nodeToText(node)
  if (text.length <= clipAt) return <>{node}</>
  if (typeof node === 'string' || typeof node === 'number') {
    return <span title={text}>{text.slice(0, clipAt).trimEnd()}…</span>
  }
  return <div className="truncate max-w-[260px]" title={text}>{node}</div>
}

export interface DataListSortConfig {
  field: string
  direction: 'asc' | 'desc'
}

export interface DataListHeadingConfig {
  title: React.ReactNode
  icon?: React.ReactNode
  /** Button / element rendered on the right of the heading row. */
  action?: React.ReactNode
}

export interface DataListEmptyStateConfig {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}

/**
 * What a list says when a request FAILED. Without this a failed load renders
 * as "No results", so an outage reads as "you have no content" (closure plan
 * Phase 8B, finding 8B-5).
 */
export interface DataListErrorConfig {
  /** The server's safe message. Never a stack. */
  message: string
  /** The request id, when the caller has one worth quoting in a report. */
  requestId?: string
  /** Retry the load. Omit when retrying cannot help. */
  onRetry?: () => void
}

/** Structural type for an app-defined admin UI component entry in the registry.
 *  Compatible with React.ComponentType<AdminUIComponentProps> from @tangen/types. */
export type DataListUIComponent = React.ComponentType<{
  ids?: string[]
  onClose?: () => void
  [key: string]: unknown
}>

/** Discriminated union — four modes for bulk actions. */
/** Shared selection-limit fields for all leaf action types. */
interface BulkActionLimits {
  /** Disable this action when more than N rows are selected. */
  maxSelect?: number
  /** Disable this action when fewer than N rows are selected. */
  minSelect?: number
}

export type DataListBulkActionLeaf =
  | BulkActionLimits & {
      key: string
      label: string
      icon?: React.ReactNode
      variant?: 'default' | 'destructive'
      type?: 'action'
      onClick: (ids: string[]) => void | Promise<void>
    }
  | BulkActionLimits & {
      key: string
      label: string
      icon?: React.ReactNode
      variant?: 'default' | 'destructive'
      type: 'modal'
      /** Called with the selected IDs. Render the modal interior only — DataList
       *  provides the Dialog shell (overlay, chrome, close button). */
      renderModal: (ids: string[], onClose: () => void) => React.ReactNode
    }
  | BulkActionLimits & {
      key: string
      label: string
      icon?: React.ReactNode
      variant?: 'default' | 'destructive'
      type: 'export'
      /** Absolute or relative URL. DataList POSTs JSON and downloads the response as a file. */
      exportApi: string
      /** Extra HTTP headers (e.g. Authorization: Bearer token). */
      exportHeaders?: Record<string, string>
      /** Body payload factory. Defaults to `{ ids }`. */
      exportPayload?: (ids: string[]) => unknown
    }
  | BulkActionLimits & {
      key: string
      label: string
      icon?: React.ReactNode
      variant?: 'default' | 'destructive'
      type: 'component'
      /** Key in the componentRegistry prop. If not found the button is hidden. */
      component: string
      /** Extra props merged into the component alongside ids, onClose, and componentContext. */
      modalProps?: Record<string, unknown>
    }

export type DataListBulkAction =
  | DataListBulkActionLeaf
  | {
      key: string
      label: string
      icon?: React.ReactNode
      type: 'group'
      /** Actions nested under this label in the dropdown. Groups cannot be nested. */
      children: DataListBulkActionLeaf[]
    }
  | {
      key: string
      type: 'section'
      /** Section heading shown as a small label above the items below it. */
      label: string
    }

export interface DataListProps<T> {
  /**
   * How much chrome the list wears. `none` (default): chromeless, flush to
   * its column, the grid the content lists use. `framed`: a raised card
   * with a border, a shadow and rounded corners around the table, for a
   * list inside a page section.
   */
  chrome?: 'none' | 'framed' | 'compact'
  /** @deprecated Use `chrome="framed"`. */
  framed?: boolean
  // ── Data ──
  columns: DataListColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string

  // ── State ──
  loading?: boolean
  skeletonRows?: number

  // ── Row interaction ──
  /** Fired when a row is clicked. Cell renderers must call e.stopPropagation()
   *  on interactive children (links, buttons, inputs, checkboxes). */
  onRowClick?: (row: T, e: React.MouseEvent<HTMLTableRowElement>) => void

  // ── Pagination (fully controlled) ──
  page?: number
  pageSize?: number
  total?: number
  onPageChange?: (page: number) => void

  // ── Search (controlled; debouncing is the caller's responsibility) ──
  search?: string
  searchPlaceholder?: string
  onSearchChange?: (value: string) => void

  // ── Sort (controlled) ──
  sortConfig?: DataListSortConfig
  /** Cycles: none → asc → desc → none. Passes undefined when cycling off. */
  onSortChange?: (sort: DataListSortConfig | undefined) => void

  // ── Multi-select + bulk actions ──
  /** Prepend a checkbox column. */
  selectable?: boolean
  /** Controlled selection — list of row IDs. */
  selectedIds?: string[]
  /** Called when selection changes. DataList auto-calls with [] on page change. */
  onSelectionChange?: (ids: string[]) => void
  /** Actions shown in the bulk bar when selectedIds.length > 0. */
  bulkActions?: DataListBulkAction[]
  /**
   * Where the bulk actions go while rows are selected. Unset, they replace
   * the toolbar's left side. Given an element (the Admin passes its page
   * header's `#page-selection` slot), they render there instead and the
   * toolbar keeps its filters, the way a selection reads in the header.
   */
  bulkActionsContainer?: HTMLElement | null

  // ── Customisation ──
  /** Shown when the collection itself is empty: an invitation to create one. */
  emptyState?: DataListEmptyStateConfig
  /**
   * Shown when a search or filter matched nothing, which is a different
   * situation with a different action: clear the filter, not create a first
   * row (Phase 8B, finding 8B-4). Falls back to `emptyState` when absent.
   */
  filteredEmptyState?: DataListEmptyStateConfig
  /**
   * True when a search or filter is narrowing the list. `search` alone is
   * detected automatically; pass this when the caller owns other filters.
   */
  filtered?: boolean
  /** The load failed: an error with a reason and a retry, never an empty list. */
  error?: DataListErrorConfig
  heading?: DataListHeadingConfig

  // ── The view bar (one 44px row): left slot, then right slot, Sort, search ──
  toolbarLeft?: React.ReactNode
  toolbarRight?: React.ReactNode
  /** A second row under the view bar (active filter chips); rendered only when given. */
  filterRow?: React.ReactNode

  // ── App-defined component registry (for type:'component' bulk actions) ──
  /** Map of slug → React component. Injected by AdminDataList via the Vite virtual module.
   *  DataList stays framework-agnostic — it never imports from the registry directly. */
  componentRegistry?: Record<string, DataListUIComponent>
  /** Extra props merged into every component-type bulk action render alongside ids + onClose.
   *  Use to pass env, workspaceId, typeName, or any other context the component needs. */
  componentContext?: Record<string, unknown>
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function SortIcon({ col, sortConfig }: { col: DataListColumn<unknown>; sortConfig?: DataListSortConfig }) {
  if (!col.sortKey) return null
  const active = sortConfig?.field === col.sortKey
  // Arrows, not chevrons: a chevron under a header reads as a dropdown. Idle
  // shows the up-down hint on hover only; active shows the one direction.
  if (!active) {
    return <IconExpandUpDown className="size-3.5 shrink-0 text-fg-subtle opacity-0 transition-opacity motion-fast group-hover:opacity-60 group-focus-visible:opacity-60" aria-hidden />
  }
  return sortConfig?.direction === 'asc'
    ? <IconArrowUp   className="size-3.5 shrink-0 text-fg" aria-hidden />
    : <IconArrowDown className="size-3.5 shrink-0 text-fg" aria-hidden />
}

async function triggerExport(
  action: Extract<DataListBulkAction, { type: 'export' }>,
  ids: string[],
) {
  const payload = action.exportPayload?.(ids) ?? { ids }
  const res = await fetch(action.exportApi, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(action.exportHeaders ?? {}) },
    body: JSON.stringify(payload),
  })
  if (!res.ok) return
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match       = disposition.match(/filename="?([^";]+)"?/)
  const filename    = match?.[1]?.trim() ?? 'export.csv'
  const url         = URL.createObjectURL(blob)
  const a           = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Bulk action bar ───────────────────────────────────────────────────────────

function disabledReason(action: DataListBulkActionLeaf, selectedCount: number): string | null {
  if (action.maxSelect !== undefined && selectedCount > action.maxSelect)
    return `Select at most ${action.maxSelect} item${action.maxSelect === 1 ? '' : 's'}`
  if (action.minSelect !== undefined && selectedCount < action.minSelect)
    return `Select at least ${action.minSelect} item${action.minSelect === 1 ? '' : 's'}`
  return null
}

/**
 * The bulk actions as one Menu (the same surface as every other menu and
 * the filter popovers): sections are labels, groups are submenus, a leaf
 * that the selection size rules out is disabled with the reason as its
 * title. The trigger shows the running action.
 */
function BulkActionsMenu({ selectedCount, actions, isComponentActionAvailable, onAction }: {
  selectedCount: number
  actions: DataListBulkAction[]
  isComponentActionAvailable: (action: DataListBulkAction) => boolean
  onAction: (action: DataListBulkAction) => Promise<void>
}) {
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  async function run(action: DataListBulkActionLeaf) {
    if (disabledReason(action, selectedCount)) return
    if (action.type === 'modal' || action.type === 'component') { await onAction(action); return }
    setLoadingKey(action.key)
    try { await onAction(action) } finally { if (mountedRef.current) setLoadingKey(null) }
  }

  const leaf = (action: DataListBulkActionLeaf) => {
    const reason = disabledReason(action, selectedCount)
    return (
      <MenuItem
        key={action.key}
        disabled={!!reason || !!loadingKey}
        destructive={action.variant === 'destructive'}
        title={reason ?? undefined}
        onSelect={() => { void run(action) }}
      >
        {action.icon}
        <span className="flex-1">{action.label}</span>
        {action.maxSelect !== undefined && <span className="text-ui-2xs text-fg-subtle tabular-nums">{`\u2264${action.maxSelect}`}</span>}
      </MenuItem>
    )
  }

  const visible = actions.filter(a => {
    if (a.type === 'section') return true
    if (a.type === 'group') return a.children.some(c => isComponentActionAvailable(c))
    return isComponentActionAvailable(a)
  })
  if (visible.length === 0) return null

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button type="button" size="xs" variant="secondary" disabled={!!loadingKey} data-testid="bulk-actions">
          {loadingKey ? <IconSpinner className="animate-spin" aria-hidden /> : null}
          Actions
          <IconChevronDown aria-hidden />
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        {visible.map((action, i) => {
          if (action.type === 'section') {
            return (
              <React.Fragment key={action.key}>
                {i > 0 && <MenuSeparator />}
                <MenuLabel>{action.label}</MenuLabel>
              </React.Fragment>
            )
          }
          if (action.type === 'group') {
            return (
              <MenuSub key={action.key}>
                <MenuSubTrigger>{action.icon}{action.label}</MenuSubTrigger>
                <MenuSubContent>
                  {action.children.filter(c => isComponentActionAvailable(c)).map(leaf)}
                </MenuSubContent>
              </MenuSub>
            )
          }
          return leaf(action)
        })}
      </MenuContent>
    </Menu>
  )
}

/** The in-toolbar selection bar: the count, the actions menu, a way out. */
function BulkActionBar({ selectedCount, onClear, ...menu }: {
  selectedCount: number
  actions: DataListBulkAction[]
  isComponentActionAvailable: (action: DataListBulkAction) => boolean
  onAction: (action: DataListBulkAction) => Promise<void>
  onClear: () => void
}) {
  return (
    <div className="flex flex-1 items-center gap-3">
      <span className="shrink-0 text-ui font-medium text-fg tabular-nums">{selectedCount} selected</span>
      <BulkActionsMenu selectedCount={selectedCount} {...menu} />
      <div className="flex-1" />
      <Button type="button" size="xs" variant="ghost" onClick={onClear}>Clear selection</Button>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DataList<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  skeletonRows = 8,
  onRowClick,
  page = 1,
  pageSize = 10,
  total = 0,
  onPageChange,
  search,
  searchPlaceholder = 'Search…',
  onSearchChange,
  sortConfig,
  onSortChange,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  bulkActions,
  bulkActionsContainer,
  emptyState,
  filteredEmptyState,
  filtered,
  error,
  heading,
  toolbarLeft,
  toolbarRight,
  filterRow,
  componentRegistry,
  componentContext,
  chrome,
  framed = false,
}: DataListProps<T>) {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 1
  const from = total > 0 ? (page - 1) * pageSize + 1 : 0
  const to   = Math.min(page * pageSize, total)

  // ── Pagination jump input ──
  const [pageJump, setPageJump] = useState(String(page))
  useEffect(() => { setPageJump(String(page)) }, [page])

  function commitPageJump() {
    const n = Math.max(1, Math.min(totalPages, parseInt(pageJump, 10) || page))
    setPageJump(String(n))
    if (n !== page) onPageChange?.(n)
  }

  // ── Auto-reset selection on page change ──
  const prevPageRef            = useRef(page)
  const onSelectionChangeRef   = useRef(onSelectionChange)
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange })

  useEffect(() => {
    if (prevPageRef.current !== page) {
      prevPageRef.current = page
      onSelectionChangeRef.current?.([])
    }
  }, [page])

  // ── Sort ──
  function handleSortClick(col: DataListColumn<T>) {
    if (!col.sortKey || !onSortChange) return
    if (!sortConfig || sortConfig.field !== col.sortKey) {
      onSortChange({ field: col.sortKey, direction: 'asc' })
    } else if (sortConfig.direction === 'asc') {
      onSortChange({ field: col.sortKey, direction: 'desc' })
    } else {
      onSortChange(undefined)
    }
  }

  // ── Multi-select ──
  const rowIds          = rows.map(row => rowKey(row))
  const allPageSelected = rowIds.length > 0 && rowIds.every(id => selectedIds.includes(id))
  const somePageSelected = rowIds.some(id => selectedIds.includes(id))
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = somePageSelected && !allPageSelected
    }
  }, [somePageSelected, allPageSelected])

  function toggleSelectAll() {
    if (allPageSelected) {
      onSelectionChange?.(selectedIds.filter(id => !rowIds.includes(id)))
    } else {
      const next = [...selectedIds]
      for (const id of rowIds) {
        if (!next.includes(id)) next.push(id)
      }
      onSelectionChange?.(next)
    }
  }

  function toggleSelectRow(id: string) {
    onSelectionChange?.(
      selectedIds.includes(id)
        ? selectedIds.filter(s => s !== id)
        : [...selectedIds, id],
    )
  }

  // ── Bulk action handling ──
  type ActiveModal =
    | Extract<DataListBulkAction, { type: 'modal' }>
    | Extract<DataListBulkAction, { type: 'component' }>

  const [activeModal, setActiveModal] = useState<ActiveModal | null>(null)

  async function handleBulkAction(action: DataListBulkAction) {
    if (action.type === 'group' || action.type === 'section') return
    const ids = [...selectedIds]
    if (action.type === 'modal') {
      setActiveModal(action)
    } else if (action.type === 'component') {
      if (!componentRegistry?.[action.component]) {
        console.warn(
          `[DataList] bulk action '${action.key}' references unknown component '${action.component}'. ` +
          'Register it in the componentRegistry prop.',
        )
        return
      }
      setActiveModal(action)
    } else if (action.type === 'export') {
      await triggerExport(action, ids)
    } else {
      await action.onClick(ids)
    }
  }

  function isComponentActionAvailable(action: DataListBulkAction): boolean {
    if (action.type === 'section') return true
    if (action.type === 'group') return action.children.some(c => isComponentActionAvailable(c))
    if (action.type !== 'component') return true
    return !!(componentRegistry?.[action.component])
  }

  const isFramed = chrome ? chrome === 'framed' : framed
  // `compact` (the settings list, 2026-09-08): a full-width search above, rows
  // with hairlines between and no vertical borders, a chevron where a row opens.
  const isCompact = chrome === 'compact'
  const compactCell = isCompact ? 'border-r-0' : ''
  // The first cells' inset, read by the Table primitive (12px on the grid, Twenty's, so
  // title, view switcher and checkboxes share one edge; 16px inside a card).
  const inset = isFramed ? '1rem' : '0.75rem'
  const sortableColumns = columns.filter(c => c.sortKey)
  // Whether the table has scrolled sideways: the frozen column shows its edge then.
  const [scrolledX, setScrolledX] = useState(false)
  const hasSelection   = selectable && selectedIds.length > 0
  // With a container, the actions leave the toolbar alone and render there.
  const hasBulkBar     = hasSelection && !bulkActionsContainer
  const bulkActionsArr = bulkActions ?? []

  return (
    <div className={cx(!isFramed && 'flex min-h-0 flex-1 flex-col')} style={{ '--tg-table-inset': inset } as React.CSSProperties} data-chrome={isFramed ? 'framed' : isCompact ? 'compact' : 'none'}>
      {/* Heading */}
      {heading && (
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {heading.icon && <span className="shrink-0 text-fg-subtle [&_svg]:size-4.5">{heading.icon}</span>}
            <h1 className="text-title-lg text-fg">{heading.title}</h1>
          </div>
          {heading.action && <div>{heading.action}</div>}
        </div>
      )}

      {/* Table card */}
      {/* Flush by default (calibration: the benchmark draws no card around a
          table); `framed` keeps the raised card for a list inside a page section. */}
      {/* Chromeless: a shrinkable column, never a stretched one, so the
          pagination follows a short table and pins only under a long one. */}
      <div className={cx(isFramed ? 'overflow-hidden rounded-lg border border-border-subtle bg-surface-raised shadow-raised' : 'flex min-h-0 flex-col')}>

        {/* Toolbar. Without a container for the bulk actions a selection
            REPLACES its left side in place (spec §16), the row keeping its
            height; with one, the filters stay and the actions go there. */}
        <ViewBar
          chrome={isFramed ? 'framed' : isCompact ? 'compact' : 'none'}
          left={toolbarLeft}
          replaceLeft={hasBulkBar ? (
            <BulkActionBar
              selectedCount={selectedIds.length}
              actions={bulkActionsArr}
              isComponentActionAvailable={isComponentActionAvailable}
              onAction={handleBulkAction}
              onClear={() => onSelectionChange?.([])}
            />
          ) : undefined}
          right={(
            <>
              {toolbarRight}
              {sortableColumns.length > 0 && onSortChange && (
                <Menu>
                  <MenuTrigger asChild>
                    <button type="button" className={cx(GHOST_TEXT, sortConfig && 'text-fg')}>Sort</button>
                  </MenuTrigger>
                  <MenuContent align="end">
                    <MenuLabel>Sort by</MenuLabel>
                    {sortableColumns.map(col => {
                      const active = sortConfig?.field === col.sortKey
                      return (
                        <MenuItem key={col.key} onSelect={() => handleSortClick(col)}>
                          <span className="flex-1">{col.header}</span>
                          {active && (sortConfig?.direction === 'asc' ? <IconArrowUp aria-hidden /> : <IconArrowDown aria-hidden />)}
                        </MenuItem>
                      )
                    })}
                    {sortConfig && (
                      <>
                        <MenuSeparator />
                        <MenuItem onSelect={() => onSortChange(undefined)}>Clear sort</MenuItem>
                      </>
                    )}
                  </MenuContent>
                </Menu>
              )}
            </>
          )}
          search={onSearchChange !== undefined ? { value: search ?? '', onChange: onSearchChange, placeholder: searchPlaceholder } : undefined}
          filterRow={filterRow}
        />

        {/* Body */}
        {loading ? (
          <div className="divide-y divide-border-subtle motion-safe:animate-pulse" aria-busy="true" aria-label="Loading">
            {Array.from({ length: skeletonRows }, (_, i) => (
              <div key={i} className="flex h-(--tg-row-h) items-center gap-4 px-4">
                {selectable && <div className="size-4 shrink-0 rounded-sm bg-surface-hover" />}
                <div className="h-3.5 rounded-sm bg-surface-hover" style={{ width: `${48 + (i % 3) * 15}%` }} />
                <div className="h-4 w-16 rounded-sm bg-surface-hover" />
                <div className="ml-auto h-3.5 w-24 rounded-sm bg-surface-hover" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
            <p className="text-ui font-medium text-fg">{"This list could not be loaded."}</p>
            <p className="max-w-prose text-ui-sm text-fg-muted">{error.message}</p>
            {error.requestId && (
              <p className="font-mono text-ui-xs text-fg-subtle">{`Request ${error.requestId}`}</p>
            )}
            {error.onRetry && (
              <div className="mt-2">
                <Button type="button" variant="secondary" size="sm" onClick={error.onRetry}>{"Try again"}</Button>
              </div>
            )}
          </div>
        ) : rows.length === 0 ? (() => {
          // An empty COLLECTION and an empty RESULT are different situations
          // with different actions (Phase 8B, finding 8B-4).
          const narrowed = filtered ?? (typeof search === 'string' && search.trim() !== '')
          const state = (narrowed ? filteredEmptyState ?? emptyState : emptyState)
          return (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-20">
              {state?.icon && (
                <div className="text-fg-faint [&_svg]:size-5">{state.icon}</div>
              )}
              <div className="text-center">
                <p className="text-ui font-medium text-fg">
                  {state?.title ?? (narrowed ? 'Nothing matches those filters' : 'No results')}
                </p>
                {state?.description && (
                  <p className="mt-1 max-w-sm text-ui-sm text-fg-muted">{state.description}</p>
                )}
              </div>
              {state?.action && <div className="mt-1">{state.action}</div>}
            </div>
          )
        })() : (
          <TableRoot
            className="group/table"
            data-scrolled={scrolledX || undefined}
            onScroll={e => { const x = e.currentTarget.scrollLeft > 0; if (x !== scrolledX) setScrolledX(x) }}
          >
            <Table>
              <TableHead>
                <TableRow>
                  {selectable && (
                    <TableHeaderCell className="sticky left-0 z-[2] w-[calc(var(--tg-table-inset,1rem)+1rem)] border-r-0 pr-0">
                      {/* A permanent column (the grid benchmark): the checkbox is the row's handle. */}
                      <Checkbox
                        checked={allPageSelected ? true : somePageSelected ? 'indeterminate' : false}
                        onCheckedChange={toggleSelectAll}
                        aria-label="Select all on page"
                        className="block"
                      />
                    </TableHeaderCell>
                  )}
                  {columns.map((col, i) => (
                    <TableHeaderCell
                      key={col.key}
                      className={cx(
                        col.sortKey ? 'group cursor-pointer select-none transition-colors motion-fast hover:text-fg' : '',
                        // The first column is frozen (the grid benchmark): the rest scroll under it.
                        i === 0 && cx(FROZEN_HEAD, selectable ? 'sticky left-[calc(var(--tg-table-inset,1rem)+1rem)] z-[2]' : 'sticky left-0 z-[2]'),
                        compactCell,
                        col.headerClassName,
                      )}
                      onClick={col.sortKey ? () => handleSortClick(col) : undefined}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {col.icon && <span className="shrink-0 text-fg-subtle [&_svg]:size-4" aria-hidden>{col.icon}</span>}
                        {col.header}
                        <SortIcon col={col as DataListColumn<unknown>} sortConfig={sortConfig} />
                      </span>
                    </TableHeaderCell>
                  ))}
                  {isCompact && onRowClick && <TableHeaderCell className="w-10 border-r-0" aria-label="Open" />}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map(row => {
                  const id         = rowKey(row)
                  const isSelected = selectedIds.includes(id)
                  return (
                    <TableRow
                      key={id}
                      onClick={onRowClick ? e => onRowClick(row, e) : undefined}
                      aria-selected={selectable ? isSelected : undefined}
                      className={cx(
                        onRowClick ? 'cursor-pointer hover:bg-surface-hover' : 'hover:bg-surface-hover',
                        isSelected ? 'bg-canvas hover:bg-canvas' : '',
                      )}
                    >
                      {selectable && (
                        <TableCell className={cx('sticky left-0 z-[1] w-[calc(var(--tg-table-inset,1rem)+1rem)] border-r-0 pr-0', FROZEN_CELL, 'after:hidden')} onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelectRow(id)}
                            aria-label="Select row"
                            className="block"
                          />
                        </TableCell>
                      )}
                      {columns.map((col, i) => (
                        <TableCell key={col.key} className={cx('text-fg', i === 0 && cx(FROZEN_CELL, selectable ? 'sticky left-[calc(var(--tg-table-inset,1rem)+1rem)] z-[1]' : 'sticky left-0 z-[1]'), compactCell, col.className)}>
                          {col.clipAt === false
                            ? col.cell(row)
                            : <ClippedCell node={col.cell(row)} clipAt={col.clipAt ?? 30} />}
                        </TableCell>
                      ))}
                      {isCompact && onRowClick && (
                        <TableCell className="w-10 border-r-0 pr-3 text-right">
                          <IconChevronRight className="inline size-4 text-fg-subtle" aria-hidden />
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableRoot>
        )}
      </div>

      {hasSelection && bulkActionsContainer && createPortal(
        <BulkActionsMenu
          selectedCount={selectedIds.length}
          actions={bulkActionsArr}
          isComponentActionAvailable={isComponentActionAvailable}
          onAction={handleBulkAction}
        />,
        bulkActionsContainer,
      )}

      {/* Pagination */}
      {!loading && total > 0 && (
        <div className={cx('flex shrink-0 items-center justify-between', isFramed ? 'mt-3 px-1' : 'border-t border-border px-3 py-2')}>
          <p className="text-ui-xs text-fg-subtle tabular-nums">
            {totalPages > 1
              ? `Showing ${from}–${to} of ${total} record${total !== 1 ? 's' : ''}`
              : `${total} record${total !== 1 ? 's' : ''} total`}
          </p>
          {totalPages > 1 && onPageChange && (
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                Previous
              </Button>
              <div className="flex items-center gap-1 text-ui-xs text-fg-muted tabular-nums">
                <input
                  type="text"
                  inputMode="numeric"
                  value={pageJump}
                  onChange={e => setPageJump(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      commitPageJump()
                      ;(e.target as HTMLInputElement).blur()
                    }
                  }}
                  onBlur={commitPageJump}
                  aria-label="Page"
                  className="h-7 w-10 rounded-control border border-border bg-surface-raised text-center text-ui-xs outline-none focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25"
                />
                <span>/ {totalPages}</span>
              </div>
              <Button type="button" variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Bulk modal - Dialog shell provided by DataList */}
      {activeModal && (
        <Dialog open={true} onOpenChange={open => { if (!open) setActiveModal(null) }}>
          <DialogContent>
            {activeModal.type === 'component'
              ? (() => {
                  const Comp = componentRegistry?.[activeModal.component]
                  if (!Comp) return null
                  return (
                    <Comp
                      ids={[...selectedIds]}
                      onClose={() => setActiveModal(null)}
                      {...(componentContext ?? {})}
                      {...(activeModal.modalProps ?? {})}
                    />
                  )
                })()
              : activeModal.renderModal([...selectedIds], () => setActiveModal(null))
            }
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
