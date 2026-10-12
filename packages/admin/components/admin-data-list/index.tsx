
import { useState, useMemo, useCallback, type ReactNode } from 'react'
import { clsx } from 'clsx'
import {
  DataList, type DataListProps, type DataListBulkAction,
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
  Button, toast,
  Menu, MenuTrigger, MenuContent, MenuItem,
} from '@tangen/ui'
import { IconMoreHorizontal } from '@tangen/icons'
import { ViewDropdown } from '@/components/object-list/view-dropdown'
import { FilterBar } from '@/components/object-list/filter-bar'
import { type LabelFilterOp } from '@/components/object-list/filter-bar'
import { SaveViewDialog } from '@/components/object-list/save-view-dialog'
import { useAuthStore } from '@/lib/auth'
import { usePageHeaderSelection, usePageHeaderStore } from '@/lib/page-header'
import { useLocaleStore } from '@/lib/locale'
import { adminFetch } from '@/lib/api'
import { APP_UI_REGISTRY } from '@/lib/app-ui-registry'
import type { Status, SavedView, FilterableField, FieldFilter, DateFilters } from '@/components/object-list/types'

// ── Types ────────────────────────────────────────────────────────────────────

export type { Status, SavedView, FilterableField, FieldFilter, DateFilters }

/**
 * Discriminated union for per-row dropdown actions.
 *
 * - `'modal'`     — opens a Dialog; `renderModal` receives the row and a close callback
 *                   and should return DialogHeader + body + DialogFooter JSX.
 * - `'action'`    — calls `onClick(row)` directly with no confirmation UI.
 * - `'confirm'`   — shows an auto-generated confirmation Dialog before calling `onConfirm(row)`.
 * - `'admin-api'` — POSTs to a custom admin-authenticated route with `{ id, typeName}`.
 *                   AdminDataList injects the auth header and shows a toast with the response.
 *
 * Extension and site developers can add actions of any type to the `rowActions` prop.
 */
export type RowAction<T> =
  | {
      type: 'modal'
      key: string
      label: string
      variant?: 'default' | 'destructive'
      renderModal: (row: T, onClose: () => void) => ReactNode
    }
  | {
      type: 'action'
      key: string
      label: string
      variant?: 'default' | 'destructive'
      onClick: (row: T) => void | Promise<void>
    }
  | {
      type: 'confirm'
      key: string
      label: string
      variant?: 'default' | 'destructive'
      title?: string | ((row: T) => string)
      message?: string | ((row: T) => string)
      confirmLabel?: string
      onConfirm: (row: T) => void | Promise<void>
    }
  | {
      type: 'admin-api'
      key: string
      label: string
      variant?: 'default' | 'destructive'
      /** Route path relative to the API root, e.g. `/posts/publish-and-email`.
       *  AdminDataList POSTs `{ id, typeName }` + any extra `payload` fields. */
      route: string
      /** Extra fields merged into the POST body alongside `{ id, typeName }`. */
      payload?: Record<string, unknown>
      /** Toast text shown on success when the response has no `.message` field. */
      successMessage?: string
      /** Toast text shown when the request fails. */
      errorMessage?: string
    }

/**
 * Extends `DataListBulkAction` with an `'admin-api'` variant.
 *
 * - All four `DataListBulkAction` types (`'action'`, `'modal'`, `'export'`, `'component'`) work as-is.
 * - `'admin-api'` — POSTs to a custom admin-authenticated route with `{ ids, typeName }`.
 *   AdminDataList injects the auth header, tracks loading state in the bulk bar,
 *   and shows a toast with the response message.
 *
 * @example
 * ```ts
 * const bulkActions: AdminBulkAction[] = [
 *   {
 *     type: 'admin-api',
 *     key: 'publish-and-email',
 *     label: 'Publish & Email',
 *     route: '/posts/publish-and-email',
 *     successMessage: 'Published and emails sent',
 *   },
 * ]
 * ```
 */
export type AdminBulkAction =
  | DataListBulkAction
  | {
      type: 'admin-api'
      key: string
      label: string
      variant?: 'default' | 'destructive'
      icon?: ReactNode
      /** Route path relative to the API root, e.g. `/posts/publish-and-email`.
       *  AdminDataList POSTs `{ ids, typeName }` + any extra `payload` fields. */
      route: string
      /** Extra fields merged into the POST body alongside `{ ids, typeName }`. */
      payload?: Record<string, unknown>
      /** Toast text shown on success when the response has no `.message` field. */
      successMessage?: string
      /** Toast text shown when the request fails. */
      errorMessage?: string
    }

export interface AdminDataListProps<T> extends Omit<DataListProps<T>, 'toolbarLeft' | 'toolbarRight' | 'bulkActions' | 'filterRow'> {
  /** The collection's plural label, so the default view reads "All Posts". */
  collectionLabel?: string
  /** Current environment slug — passed to FilterBar for relation pickers. */

  // ── Filter / view state (controlled by the page) ──
  status: Status
  onStatusChange: (s: Status) => void
  savedViews: SavedView[]
  activeViewId: string | null
  filterableFields: FilterableField[]
  activeFilters: FieldFilter[]
  dateFilters: DateFilters
  /** Called when any field filter or date filter changes. */
  onFiltersChange: (fieldFilters: FieldFilter[], dateFilters: DateFilters) => void
  /** True when any filter, search, or status is active. Controls showing "Save view". */
  hasActiveFilters: boolean
  /** True when the active saved view differs from current filter state. Controls "Update view". */
  hasUnsavedChanges: boolean
  onSelectView: (view: SavedView) => void
  onClearActiveView: () => void
  /** Called by SaveViewDialog on submit. */
  onSaveView: (name: string, visibility: 'private' | 'shared') => Promise<void>
  /** Called when the user clicks "Update view" to persist current filters into the active view. */
  onUpdateView: () => Promise<void>
  onDeleteView: (id: string) => void

  /**
   * Per-row dropdown actions shown in a "⋮" menu column auto-appended to the table.
   * Supports 'modal', 'action', 'confirm', and 'admin-api' types — see RowAction<T>.
   * Extension and site developers can inject additional actions here.
   */
  rowActions?: RowAction<T>[]

  /**
   * Bulk actions for the multi-select bar. Accepts all DataListBulkAction types plus
   * the admin-specific `'admin-api'` type which POSTs to a custom route with admin auth.
   * AdminDataList transforms 'admin-api' actions into 'action' before passing to DataList.
   */
  bulkActions?: AdminBulkAction[]

  /** typeName passed into admin-api bulk/row action payloads for context. */
  typeName?: string

  /**
   * Locales system filter (Add filter → System → Locales) — pass both to
   * enable it. Opt-in: only lists whose rows localize (content objects).
   */
  activeLocales?: string[]
  onLocalesChange?: (codes: string[]) => void
  /** Operational-labels filter — content type + selection + operator + change handler. */
  labelType?: string
  activeLabels?: string[]
  activeLabelOp?: LabelFilterOp
  onLabelsChange?: (labels: string[], op: LabelFilterOp) => void
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Non-generic dropdown — items are pre-resolved by the caller. The menu
 * renders through a body portal with fixed positioning: the table wrapper
 * scrolls/clips (overflow-auto), so an in-flow absolute menu would extend
 * the horizontal scroll area and hide when the list is short.
 */
function RowActionsMenu({ items }: {
  items: Array<{ label: string; variant?: 'default' | 'destructive'; onClick: () => void }>
}) {
  // Hover-reveal (spec §12): the trigger is always in the DOM and positioned,
  // shown on row hover, on keyboard focus (the row's focus-within), and while
  // its menu is open - so nothing shifts and nothing is mouse-only.
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label="Row actions"
          className={clsx(
            'flex size-7 items-center justify-center rounded-control text-fg-subtle transition-[opacity,background-color,color] motion-fast',
            'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
            'hover:bg-surface-hover hover:text-fg data-[state=open]:bg-surface-selected data-[state=open]:text-fg',
            'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
          )}
        >
          <IconMoreHorizontal className="size-4" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent align="end" className="min-w-44">
        {items.map((item) => (
          <MenuItem key={item.label} destructive={item.variant === 'destructive'} onSelect={() => item.onClick()}>
            {item.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}

/** Auto-generated confirmation dialog for 'confirm' type row actions. */
function ConfirmDialogContent({ title, message, confirmLabel, variant, onConfirm, onClose }: {
  title: string
  message?: string
  confirmLabel?: string
  variant?: 'default' | 'destructive'
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  const [saving, setSaving] = useState(false)

  async function handleConfirm() {
    setSaving(true)
    try { await onConfirm() } finally { setSaving(false) }
    onClose()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {message && <DialogDescription>{message}</DialogDescription>}
      </DialogHeader>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button
          variant={variant === 'destructive' ? 'destructive' : 'primary'}
          size="sm"
          onClick={handleConfirm}
          disabled={saving}
        >
          {saving ? 'Please wait…' : (confirmLabel ?? 'Confirm')}
        </Button>
      </DialogFooter>
    </>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminDataList<T>({ status,
  onStatusChange,
  savedViews,
  activeViewId,
  filterableFields,
  activeFilters,
  dateFilters,
  onFiltersChange,
  hasActiveFilters,
  hasUnsavedChanges,
  onSelectView,
  onClearActiveView,
  onSaveView,
  onUpdateView,
  onDeleteView,
  rowActions,
  collectionLabel,
  bulkActions,
  typeName,
  activeLocales,
  onLocalesChange,
  labelType,
  activeLabels,
  activeLabelOp,
  onLabelsChange,
  ...dataListProps
}: AdminDataListProps<T>) {
  const { member } = useAuthStore()
  const localeEnabled = useLocaleStore((st) => st.enabled)
  const localeList = useLocaleStore((st) => st.locales)
  const localeDefault = useLocaleStore((st) => st.defaultLocale)
  const showLocale = Boolean(onLocalesChange && localeEnabled)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [openModal, setOpenModal] = useState<{ action: RowAction<T>; row: T } | null>(null)

  // ── Admin-API bulk action processing ──────────────────────────────────────────
  // Transform 'admin-api' bulk actions into 'action' type so DataList can handle them.
  // AdminDataList owns the auth layer — DataList stays framework-agnostic.
  const resolvedBulkActions = useMemo<DataListBulkAction[] | undefined>(() => {
    if (!bulkActions) return undefined
    return bulkActions.map((action): DataListBulkAction => {
      if (action.type !== 'admin-api') return action
      return {
        type: 'action',
        key: action.key,
        label: action.label,
        variant: action.variant,
        icon: action.icon,
        onClick: async (ids: string[]) => {
          try {
            const data = await adminFetch(
              action.route,
              {
                method: 'POST',
                body: JSON.stringify({ ids, typeName, ...action.payload }),
              },
            ) as { message?: string }
            toast.success(data?.message ?? action.successMessage ?? 'Done')
          } catch (err) {
            toast.error(action.errorMessage ?? (err instanceof Error ? err.message : 'Action failed'))
          }
        },
      }
    })
  }, [bulkActions, typeName])

  // ── Toolbar slots ──────────────────────────────────────────────────────────

  const filterProps = {
    activeFilters, dateFilters, filterableFields, onFiltersChange,
    localeOptions: showLocale ? localeList : undefined,
    activeLocales, defaultLocale: localeDefault,
    onLocalesChange: showLocale ? onLocalesChange : undefined,
    labelType, activeLabels, activeLabelOp, onLabelsChange,
  }

  // The view bar (the grid benchmark): the view switcher with the count at
  // the left; Filter (then DataList's Sort and search) at the right.
  const toolbarLeft = (
    <ViewDropdown
      status={status}
      onStatusChange={onStatusChange}
      savedViews={savedViews}
      activeViewId={activeViewId}
      hasActiveFilters={hasActiveFilters}
      onSelectView={onSelectView}
      onClearActiveView={onClearActiveView}
      onSaveView={() => setSaveDialogOpen(true)}
      onDeleteView={onDeleteView}
      currentMemberId={member?.memberId}
      count={dataListProps.total}
      collectionLabel={collectionLabel}
    />
  )
  const toolbarRight = <FilterBar mode="button" {...filterProps} />

  // The chip row shows only while a filter is active or the view has
  // unsaved changes; Reset sits in the FilterBar, the view action after it.
  const filterRow = (hasActiveFilters || hasUnsavedChanges) ? (
    <>
      <FilterBar mode="chips" {...filterProps} />
      {hasUnsavedChanges
        ? <Button size="xs" variant="primary" onClick={onUpdateView}>Update view</Button>
        : <Button size="xs" variant="secondary" className="text-accent-fg" onClick={() => setSaveDialogOpen(true)}>Save as new view</Button>}
    </>
  ) : undefined

  // ── Row actions column ─────────────────────────────────────────────────────

  const columns = rowActions?.length
    ? [
        ...(dataListProps.columns ?? []),
        {
          key: '__row_actions__',
          header: '',
          cell: (row: T) => (
            <div onClick={e => e.stopPropagation()}>
              <RowActionsMenu
                items={rowActions.map(action => ({
                  label: action.label,
                  variant: action.variant,
                  onClick: () => {
                    if (action.type === 'action') {
                      action.onClick(row)
                    } else if (action.type === 'admin-api') {
                      adminFetch(action.route, {
                        method: 'POST',
                        body: JSON.stringify({ id: (row as Record<string, unknown>).id, typeName, ...action.payload }),
                      })
                        .then((data) => toast.success((data as { message?: string })?.message ?? action.successMessage ?? 'Done'))
                        .catch((err: Error) => toast.error(action.errorMessage ?? err.message ?? 'Action failed'))
                    } else {
                      setOpenModal({ action, row })
                    }
                  },
                }))}
              />
            </div>
          ),
        },
      ]
    : (dataListProps.columns ?? [])

  // ── Modal content ──────────────────────────────────────────────────────────

  // Compute modal content — extract action/row to let TS narrow the union correctly.
  let modalContent: ReactNode = null
  if (openModal) {
    const { action, row } = openModal
    if (action.type === 'modal') {
      modalContent = action.renderModal(row, () => setOpenModal(null))
    } else if (action.type === 'confirm') {
      modalContent = (
        <ConfirmDialogContent
          title={typeof action.title === 'function' ? action.title(row) : (action.title ?? 'Confirm action')}
          message={typeof action.message === 'function' ? action.message(row) : action.message}
          confirmLabel={action.confirmLabel}
          variant={action.variant}
          onConfirm={async () => { await action.onConfirm(row) }}
          onClose={() => setOpenModal(null)}
        />
      )
    }
  }

  // The selection reads in the page header and its actions render there: the
  // header publishes its live #page-selection element through the store, so
  // a header that remounts (its skeleton, a preview mode) never strands them.
  const selectedCount = dataListProps.selectedIds?.length ?? 0
  const clearSelection = useCallback(() => dataListProps.onSelectionChange?.([]), [dataListProps.onSelectionChange])
  usePageHeaderSelection(selectedCount, dataListProps.onSelectionChange ? clearSelection : undefined)
  const selectionSlot = usePageHeaderStore((s) => s.selectionSlot)

  return (
    <>
      <DataList<T>
        {...dataListProps}
        columns={columns}
        bulkActions={resolvedBulkActions}
        bulkActionsContainer={selectionSlot}
        componentRegistry={dataListProps.componentRegistry ?? APP_UI_REGISTRY}
        toolbarLeft={toolbarLeft}
        toolbarRight={toolbarRight}
        filterRow={filterRow}
      />

      <Dialog open={!!openModal} onOpenChange={(o) => { if (!o) setOpenModal(null) }}>
        <DialogContent className="max-w-sm">
          {modalContent}
        </DialogContent>
      </Dialog>

      <SaveViewDialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        onSave={onSaveView}
      />
    </>
  )
}
