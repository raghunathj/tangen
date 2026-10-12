import { AdminPage, Card, Badge, DataList, useKitQuery, fromArray, type DataListColumn } from '@/kit'
import { useState } from 'react'
import { Example, ExampleStack, useSinkCrumbs } from './example'

/** Lists — DataList over the DataSource contract, all five adapters. */

const DEMO_ROWS = [
  { id: '1', name: 'Aurora survey', status: 'published', owner: 'meera', updated: '2026-07-01' },
  { id: '2', name: 'Beacon launch page', status: 'draft', owner: 'dev', updated: '2026-07-03' },
  { id: '3', name: 'Cascade pricing', status: 'published', owner: 'meera', updated: '2026-06-28' },
  { id: '4', name: 'Delta changelog', status: 'archived', owner: 'ravi', updated: '2026-05-19' },
  { id: '5', name: 'Ember newsletter', status: 'draft', owner: 'dev', updated: '2026-07-08' },
  { id: '6', name: 'Fjord docs hub', status: 'published', owner: 'ravi', updated: '2026-07-10' },
]
const demoSource = fromArray(DEMO_ROWS, { searchFields: ['name', 'owner'] })

const COLUMNS: DataListColumn<(typeof DEMO_ROWS)[number]>[] = [
  { key: 'name', header: 'Name', sortKey: 'name', cell: (r) => <span className="font-medium text-fg">{r.name}</span> },
  {
    key: 'status', header: 'Status',
    cell: (r) => (
      <Badge variant={r.status === 'published' ? 'success' : r.status === 'draft' ? 'neutral' : 'warning'}>
        {r.status}
      </Badge>
    ),
  },
  { key: 'owner', header: 'Owner', cell: (r) => r.owner },
  { key: 'updated', header: 'Updated', sortKey: 'updated', cell: (r) => <span className="tabular-nums text-fg-muted">{r.updated}</span> },
]

export function SinkListsPage() {
  const q = useKitQuery(demoSource, { initialPageSize: 4 })
  const [searchInput, setSearchInput] = useState('')

  return (
    <AdminPage breadcrumbs={useSinkCrumbs('Lists')}>
      <ExampleStack>

        <Example
          title="DataList on a DataSource"
          description="Search, sort (Name/Updated), and paging below run client-side on fromArray - swap the source and nothing else changes"
          code={`import { DataList, useKitQuery, fromArray } from '@/kit'

const source = fromArray(rows, { searchFields: ['name', 'owner'] })
const q = useKitQuery(source, { initialPageSize: 4 })
const [searchInput, setSearchInput] = useState('')

<DataList
  columns={columns}
  rows={q.rows}
  rowKey={(r) => r.id}
  loading={q.loading}
  page={q.query.page} pageSize={q.query.pageSize} total={q.total}
  onPageChange={q.setPage}
  search={searchInput}
  onSearchChange={(v) => { setSearchInput(v); q.setSearch(v) }}
  sortConfig={q.query.sort}
  onSortChange={(cfg) => q.setSort(cfg ?? undefined)}
  emptyState={{ title: 'No matches' }}
/>`}
        >
          <Card flush>
            <DataList
              columns={COLUMNS}
              rows={q.rows}
              rowKey={(r) => r.id}
              loading={q.loading}
              page={q.query.page}
              pageSize={q.query.pageSize}
              total={q.total}
              onPageChange={q.setPage}
              search={searchInput}
              searchPlaceholder="Search name or owner…"
              onSearchChange={(v) => { setSearchInput(v); q.setSearch(v) }}
              sortConfig={q.query.sort}
              onSortChange={(cfg) => q.setSort(cfg ?? undefined)}
              emptyState={{ title: 'No matches' }}
            />
          </Card>
        </Example>

        <Example
          title="The other four adapters"
          description="Same DataSource shape - Tangen objects, custom tables, admin routes, external APIs"
          code={`import { fromObjects, fromTable, fromAdminRoute, fromFetch, useAdminClient, ListPage } from '@/kit'

// Tangen content objects
const objects = fromObjects(useAdminClient(), 'article', {
  searchField: 'title', baseFilters: { status: 'published' },
})
// Custom tables
const table = fromTable(useAdminClient(), 'audit_log')
// A custom admin route (admin auth handled for you)
const route = fromAdminRoute('/admin/pincode/report')
// ANY external API — plain fetch + a mapper
const github = fromFetch(
  (q) => \`https://api.github.com/search/issues?q=repo:o/r&page=\${q.page}&per_page=\${q.pageSize}\`,
  (json) => ({ rows: json.items, total: json.total_count }),
)

// Or skip the wiring entirely — ListPage is a full screen in one component:
<ListPage title="Articles" source={objects} columns={columns} />`}
        >
          <p className="text-sm text-fg-muted">
            The live table above and these adapters return the same
            <code className="font-mono text-xs bg-accent-muted text-accent-fg px-1 py-0.5 rounded mx-1">{'{ rows, total }'}</code>
            shape, so a screen built on one source renders any other. Full guide: docs/admin-kit.md.
          </p>
        </Example>

      </ExampleStack>
    </AdminPage>
  )
}
