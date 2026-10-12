
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { IconPlus, IconKey } from '@tangen/icons'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { adminFetch } from '@/lib/api'
import { usePageHeaderActions } from '@/lib/page-header'
import { useAuthStore } from '@/lib/auth'
import { isKeyRevoked, formatKeyStatus } from '@/lib/api-keys'
import type { ApiKey } from '@tangen/types'
import { Callout, DataList, type DataListColumn } from '@tangen/ui'
import { FilterBar } from '@/components/object-list/filter-bar'
import type { FieldFilter, FilterableField } from '@/components/object-list/types'

const PAGE_SIZE = 20

function fmt(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_VARIANT = {
  Active:  'success',
  Expired: 'warning',
  Revoked: 'error',
} as const

/** Fields offered in the shared FilterBar's "Add filter" dropdown. */
const FILTER_FIELDS: FilterableField[] = [
  {
    name: 'status', label: 'Status', fieldType: 'select',
    options: [
      { label: 'Active', value: 'Active' },
      { label: 'Expired', value: 'Expired' },
      { label: 'Revoked', value: 'Revoked' },
    ],
  },
  { name: 'expiresAt', label: 'Expires', fieldType: 'date' },
  { name: 'lastUsedAt', label: 'Last used', fieldType: 'date' },
]

/** Applies FilterBar field filters to a key (client-side list). */
function matchesFilters(key: ApiKey, filters: FieldFilter[]): boolean {
  for (const f of filters) {
    if (f.fieldName === 'status') {
      const vals = Array.isArray(f.value) ? f.value as string[] : f.value ? [String(f.value)] : []
      if (vals.length > 0) {
        const hit = vals.includes(formatKeyStatus(key))
        const negated = ['nin', 'ne'].includes(f.operator)
        if (negated ? hit : !hit) return false
      }
    }
    if (f.fieldType === 'date') {
      const raw = f.fieldName === 'expiresAt' ? key.expiresAt : key.lastUsedAt
      const range = (f.value ?? {}) as { from?: string; to?: string }
      if (!range.from && !range.to) continue
      if (!raw) return false
      const day = raw.slice(0, 10)
      if (range.from && day < range.from) return false
      if (range.to && day > range.to) return false
    }
  }
  return true
}

export default function ApiKeysPage() {
  const params = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)

  // Page CTA lives in the header bar (title comes from Settings > API Keys breadcrumb)
  usePageHeaderActions(
    <Button
      icon={<IconPlus className="size-[15px]" />}
      size="xs"
      onClick={() => navigate(`/${params.workspaceId}/settings/api-keys/new`)}
    >
      Create API key
    </Button>,
    [params.workspaceId],
  )

  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // Deep links (dashboard widget) preset filters: ?status=Active|Expired|Revoked
  // or ?expiring=7d (an expiresAt range covering the next 7 days).
  const [fieldFilters, setFieldFilters] = useState<FieldFilter[]>(() => {
    const sp = new URLSearchParams(window.location.search)
    const status = sp.get('status')
    if (status && ['Active', 'Expired', 'Revoked'].includes(status)) {
      return [{ fieldName: 'status', fieldLabel: 'Status', fieldType: 'select', operator: 'in', value: [status], options: FILTER_FIELDS[0].options }]
    }
    if (sp.get('expiring')) {
      const today = new Date()
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const in7 = new Date(today.getTime() + 7 * 86_400_000)
      return [{ fieldName: 'expiresAt', fieldLabel: 'Expires', fieldType: 'date', operator: 'between', value: { from: fmt(today), to: fmt(in7) } }]
    }
    return []
  })
  const [page, setPage] = useState(1)

  const fetchKeys = useCallback(() => {
    if (!accessToken) return
    setLoading(true)
    adminFetch<{ data: ApiKey[] }>('/api-keys')
      .then((r) => setKeys(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [accessToken])

  useEffect(() => { fetchKeys() }, [fetchKeys])

  useEffect(() => { setPage(1) }, [search, fieldFilters])

  const filteredKeys = useMemo(() => {
    const q = search.trim().toLowerCase()
    return keys.filter((k) => {
      if (q && !k.label.toLowerCase().includes(q) && !k.keyPrefix.toLowerCase().includes(q)) return false
      return matchesFilters(k, fieldFilters)
    })
  }, [keys, search, fieldFilters])

  const filtersActive = fieldFilters.length > 0

  const paginatedKeys = useMemo(
    () => filteredKeys.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredKeys, page],
  )

  // K8: the identity a key is a credential of, by name.
  const [identityNames, setIdentityNames] = useState<Record<string, string>>({})
  useEffect(() => {
    adminFetch<{ data: Array<{ id: string; name: string }> }>('/admin/identities')
      .then((r) => setIdentityNames(Object.fromEntries(r.data.map((i) => [i.id, i.name]))))
      .catch(() => {})
  }, [])
  const columns = useMemo<DataListColumn<ApiKey>[]>(() => [
    {
      key: 'label',
      header: 'Label',
      cell: (key) => {
        const revoked = isKeyRevoked(key)
        return (
          <span className={revoked ? 'line-through text-fg-subtle' : 'font-medium text-fg'}>
            {key.label}
          </span>
        )
      },
    },
    {
      key: 'prefix',
      header: 'Prefix',
      cell: (key) => <span className="font-mono text-xs text-fg-muted">{key.keyPrefix}…</span>,
    },
    {
      key: 'actsAs',
      header: 'Acts as',
      cell: (key) => {
        const idn = (key as { identityId?: string | null }).identityId
        return <span className="text-xs text-fg-muted">{idn ? (identityNames[idn] ?? idn) : 'itself'}</span>
      },
    },
    {
      key: 'status',
      header: 'Status',
      cell: (key) => {
        const status = formatKeyStatus(key)
        return <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>
      },
    },
    {
      key: 'lastUsed',
      header: 'Last used',
      cell: (key) => <span className="text-fg-subtle text-xs">{fmt(key.lastUsedAt)}</span>,
    },
    {
      key: 'expires',
      header: 'Expires',
      cell: (key) => <span className="text-fg-subtle text-xs">{fmt(key.expiresAt)}</span>,
    },
  ], [identityNames])

  // The settings list (2026-09-08): a titled section, then the compact list.
  return (
    <div className="space-y-3">
      <header>
        <h2 className="text-sm font-semibold text-fg">API keys</h2>
        <p className="mt-1 text-sm text-fg-subtle">Keys authenticate headless clients. Scope each one to objects, media, forms or your own declared resources.</p>
      </header>
      {error && (
        <Callout variant="danger">{error}</Callout>
      )}

      <DataList
        columns={columns}
        rows={paginatedKeys}
        rowKey={(k) => k.id}
        loading={loading}
        onRowClick={(key) => navigate(`/${params.workspaceId}/settings/api-keys/${key.id}`)}
        search={search}
        searchPlaceholder="Search by label…"
        onSearchChange={setSearch}
        chrome="compact"
        toolbarRight={(
          <FilterBar
            mode="icon"
            activeFilters={fieldFilters}
            dateFilters={{}}
            filterableFields={FILTER_FIELDS}
            systemFilters={false}
            onFiltersChange={(filters) => setFieldFilters(filters)}
          />
        )}
        filterRow={filtersActive ? (
          <FilterBar
            mode="chips"
            activeFilters={fieldFilters}
            dateFilters={{}}
            filterableFields={FILTER_FIELDS}
            systemFilters={false}
            onFiltersChange={(filters) => setFieldFilters(filters)}
          />
        ) : undefined}
        page={page}
        pageSize={PAGE_SIZE}
        total={filteredKeys.length}
        onPageChange={setPage}
        emptyState={{
          icon: <IconKey className="size-8 text-fg-faint" />,
          title: search || filtersActive ? 'No keys match your filters' : 'No API keys yet',
          description: search || filtersActive
            ? undefined
            : 'Keys authenticate headless clients - scope them to objects, media, forms, or your own declared resources.',
        }}
      />
    </div>
  )
}
