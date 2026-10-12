/**
 * File Name: list-page.tsx
 * Purpose: <ListPage<T>> — a complete list screen in one component: AdminPage
 *          shell + useKitQuery state machine + DataList, fed by ANY
 *          DataSource (Tangen objects, custom routes, external APIs, arrays).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Part of the stable @/kit surface. For filter-bar and
 *          saved-view flows use AdminDataList directly — ListPage stays the
 *          80% path.
 */
import { useState, type ReactNode } from 'react'
import { DataList, type DataListColumn, type DataListBulkAction } from '@tangen/ui'
import { AdminPage, type AdminPageProps } from './admin-page'
import { ErrorState } from '../primitives'
import { useKitQuery, type DataSource } from '../data'

export interface ListPageProps<T> extends Omit<AdminPageProps, 'children' | 'loading' | 'flush'> {
  /** Where the rows come from — see fromObjects/fromAdminRoute/fromFetch/fromArray. */
  source: DataSource<T>
  columns: DataListColumn<T>[]
  /** Row identity (default: row.id). */
  rowKey?: (row: T) => string
  pageSize?: number
  /** Enable the toolbar search box (server-side via the DataSource). */
  searchable?: boolean
  searchPlaceholder?: string
  onRowClick?: (row: T) => void
  /**
   * Row checkboxes. Defaults to "whenever bulkActions has something in it" -
   * selecting rows that nothing can act on is a dead end the user only finds
   * by clicking. Pass it explicitly to override.
   */
  selectable?: boolean
  /**
   * Gate these per ACTION rather than hiding the whole array behind one
   * permission: an app or extension can contribute a bulk action a reader may
   * legitimately run, and a blanket check hides those with the rest.
   */
  bulkActions?: DataListBulkAction[]
  emptyState?: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }
  /** Extra toolbar content (left of the search box). */
  toolbar?: ReactNode
  /** Rendered under the list (e.g. footnotes, secondary cards). */
  footer?: ReactNode
}

/** A full list screen over any DataSource. */
export function ListPage<T>({
  source, columns, rowKey, pageSize = 25,
  searchable = true, searchPlaceholder = 'Search…',
  onRowClick, selectable, bulkActions, emptyState, toolbar, footer,
  ...page
}: ListPageProps<T>) {
  const q = useKitQuery(source, { initialPageSize: pageSize })
  // Search box needs immediate echo (controlled input); the hook debounces the fetch
  const [searchInput, setSearchInput] = useState('')

  return (
    <AdminPage {...page}>
      {q.error ? (
        <ErrorState message={q.error} retry={q.refetch} />
      ) : (
        <DataList<T>
          columns={columns}
          rows={q.rows}
          rowKey={rowKey ?? ((row: T) => String((row as { id?: unknown }).id))}
          loading={q.loading}
          skeletonRows={Math.min(pageSize, 8)}
          page={q.query.page}
          pageSize={q.query.pageSize}
          total={q.total}
          onPageChange={q.setPage}
          {...(searchable ? {
            search: searchInput,
            searchPlaceholder,
            onSearchChange: (v: string) => { setSearchInput(v); q.setSearch(v) },
          } : {})}
          sortConfig={q.query.sort ? { field: q.query.sort.field, direction: q.query.sort.direction } : undefined}
          onSortChange={(cfg) => q.setSort(cfg ? { field: cfg.field, direction: cfg.direction } : undefined)}
          onRowClick={onRowClick ? (row) => onRowClick(row) : undefined}
          selectable={selectable ?? (bulkActions?.length ?? 0) > 0}
          bulkActions={bulkActions}
          emptyState={emptyState ?? { title: 'Nothing here yet' }}
          toolbarLeft={toolbar}
        />
      )}
      {footer}
    </AdminPage>
  )
}
