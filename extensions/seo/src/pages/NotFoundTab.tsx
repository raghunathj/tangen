/**
 * File Name: NotFoundTab.tsx
 * Purpose: The 404 Monitor (plan-seo-manager-v2 V5): the paths visitors
 *          asked for that the site could not answer, busiest first, each
 *          with a Create redirect that opens the redirect form already
 *          filled in. Paths only - the page can show nothing about a
 *          visitor because nothing about one is stored.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AdminPage, Button, DataList, ListChip, Text, adminFetch, toast, useCan, useConfirm } from '@/kit'
import { IconWarning, IconHash, IconClock, IconLink } from '@tangen/icons'
import { MISS_CAP, type MissRow } from '../lib/not-found'
import { seoManagerHref, MANAGER_PAGE_SIZE } from '../lib/seo-manager-nav'

export function SeoNotFoundPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const { hasCapability } = useCan()
  const { confirm, confirmDialog } = useConfirm()
  const mayWrite = hasCapability('seo:write')

  const [rows, setRows] = useState<MissRow[]>([])
  const [meta, setMeta] = useState<{ total: number; tracked: number; cap: number }>({ total: 0, tracked: 0, cap: MISS_CAP })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ field: string; direction: 'asc' | 'desc' } | undefined>(undefined)
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await adminFetch<{ data: MissRow[]; meta: { total: number; tracked: number; cap: number } }>('/admin/ext/seo/not-found', undefined, {
        ...(sort ? { sort: sort.field, dir: sort.direction } : {}),
        limit: String(MANAGER_PAGE_SIZE), offset: String((page - 1) * MANAGER_PAGE_SIZE),
      })
      setRows(res.data ?? [])
      setMeta(res.meta ?? { total: 0, tracked: 0, cap: MISS_CAP })
    } catch (e) {
      setError((e as Error).message || 'The list of missing pages could not be loaded.')
    } finally { setLoading(false) }
  }, [sort, page])
  useEffect(() => { load() }, [load])

  const ignore = async (row: MissRow) => {
    const ok = await confirm({
      title: 'Ignore this path?',
      message: `${row.path} leaves the list and stops being counted. Nothing on the site changes.`,
      confirmLabel: 'Ignore',
    })
    if (!ok) return
    try {
      await adminFetch('/admin/ext/seo/not-found/ignore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: row.path }) })
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'That path could not be ignored') }
  }

  const columns = [
    { key: 'path', header: 'Path', icon: <IconLink />, sortKey: 'path', cell: (r: MissRow) => <span className="font-mono text-xs">{r.path}</span> },
    { key: 'hits', header: 'Requests', icon: <IconHash />, sortKey: 'hits', align: 'right' as const, cell: (r: MissRow) => <span className="tabular-nums">{r.hits.toLocaleString()}</span> },
    { key: 'firstSeenAt', header: 'First seen', icon: <IconClock />, sortKey: 'firstSeenAt', cell: (r: MissRow) => <span className="text-fg-subtle">{new Date(r.firstSeenAt).toLocaleDateString()}</span> },
    { key: 'lastSeenAt', header: 'Last seen', icon: <IconClock />, sortKey: 'lastSeenAt', cell: (r: MissRow) => <span className="text-fg-subtle">{new Date(r.lastSeenAt).toLocaleString()}</span> },
    {
      key: 'actions', header: '', align: 'right' as const,
      cell: (r: MissRow) => mayWrite ? (
        <div className="flex justify-end gap-1.5">
          <Button size="xs" variant="secondary" onClick={() => navigate(`${seoManagerHref(workspaceId, 'redirects')}?source=${encodeURIComponent(r.path)}`)}>Create redirect</Button>
          <Button size="xs" variant="ghost" onClick={() => ignore(r)}>Ignore</Button>
        </div>
      ) : null,
    },
  ]

  return (
    <AdminPage
      title="404 Monitor"
      description="Addresses visitors asked for that your site could not answer."
      access={{ capability: 'seo:read' }}
    >
      <div className="space-y-4">
        <DataList<MissRow>
          chrome="framed"
          columns={columns}
          rows={search.trim() ? rows.filter((r) => r.path.toLowerCase().includes(search.trim().toLowerCase())) : rows}
          rowKey={(r) => r.path}
          loading={loading}
          error={error ? { message: error, onRetry: load } : undefined}
          total={meta.total}
          page={page}
          pageSize={MANAGER_PAGE_SIZE}
          onPageChange={setPage}
          sortConfig={sort}
          onSortChange={setSort}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search a path"
          filtered={search.trim() !== ''}
          toolbarLeft={<ListChip icon={<IconWarning />} label="Missing pages" count={meta.total} />}
          filteredEmptyState={{
            title: `No path matches "${search}"`,
            description: 'Only the paths Tangen has recorded appear here.',
            action: <Button size="sm" variant="secondary" onClick={() => setSearch('')}>Clear search</Button>,
          }}
          emptyState={{
            title: 'No missing pages recorded',
            description: 'A path appears here when your site asks Tangen for a redirect and there is none, or when it reports the miss itself.',
          }}
        />
        <Text variant="help">
          {`Paths only: the query string is dropped and nothing about the visitor is stored. ${meta.tracked.toLocaleString()} of ${meta.cap.toLocaleString()} tracked paths in use; at the limit the least requested path makes room. Ignoring a path keeps it out of the list for good.`}
        </Text>
      </div>
      {confirmDialog}
    </AdminPage>
  )
}
