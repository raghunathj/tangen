
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  IconPlus, IconWebhook, IconToggleOff, IconToggleOn,
  IconTrash, IconListChecks, IconEdit, IconWarning,
} from '@tangen/icons'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { adminFetch } from '@/lib/api'
import { usePageHeaderActions } from '@/lib/page-header'
import { Callout, DataList, type DataListColumn } from '@tangen/ui'

const PAGE_SIZE = 20

// ── Types ─────────────────────────────────────────────────────────────────────

interface Webhook {
  id: string
  label: string
  url: string
  events: string[]
  typeNames: string[]
  enabled: boolean
  consecutiveFailures: number
  pausedReason: string | null
  createdAt: string
}

// ── Delete confirmation dialog ────────────────────────────────────────────────

function DeleteDialog({ webhook, onConfirm, onCancel, loading }: {
  webhook: Webhook; onConfirm: () => void; onCancel: () => void; loading: boolean
}) {
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onCancel() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete webhook?</DialogTitle>
          <DialogDescription className="mt-1">
            <strong>{webhook.label}</strong> will stop receiving events. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" size="sm" isLoading={loading} onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function WebhooksPage() {
  const params = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const { workspaceId} = params

  usePageHeaderActions(
    <Button
      icon={<IconPlus className="size-[15px]" />}
      size="xs"
      onClick={() => navigate(`/${workspaceId}/settings/webhooks/new`)}
    >
      Add webhook
    </Button>,
    [workspaceId],
  )

  const [hooks, setHooks] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Webhook | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const loadWebhooks = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await adminFetch<{ data: Webhook[] }>('/webhooks')
      setHooks(res.data)
    } catch (e: any) {
      setError(e.message ?? 'Failed to load webhooks')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadWebhooks() }, [loadWebhooks])

  useEffect(() => { setPage(1) }, [search])

  async function handleToggle(hook: Webhook) {
    setTogglingId(hook.id)
    try {
      const updated = await adminFetch<Webhook>(`/webhooks/${hook.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !hook.enabled }),
      })
      setHooks((prev) => prev.map((h) => h.id === hook.id ? { ...h, ...updated } : h))
    } catch {
      // noop
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete() {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await adminFetch(`/webhooks/${deleting.id}`, { method: 'DELETE' })
      setHooks((prev) => prev.filter((h) => h.id !== deleting.id))
      setDeleting(null)
    } catch {
      setDeleting(null)
      loadWebhooks()
    } finally {
      setDeleteLoading(false)
    }
  }

  const filteredHooks = useMemo(() => {
    if (!search.trim()) return hooks
    const q = search.toLowerCase()
    return hooks.filter(
      (h) => h.label.toLowerCase().includes(q) || h.url.toLowerCase().includes(q),
    )
  }, [hooks, search])

  const paginatedHooks = useMemo(
    () => filteredHooks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredHooks, page],
  )

  const columns = useMemo<DataListColumn<Webhook>[]>(() => [
    {
      key: 'label',
      header: 'Label',
      cell: (hook) => <span className="font-medium text-fg whitespace-nowrap">{hook.label}</span>,
    },
    {
      key: 'url',
      header: 'URL',
      className: 'max-w-xs',
      cell: (hook) => <span className="text-fg-muted font-mono text-xs truncate block max-w-xs">{hook.url}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (hook) => (
        <div className="flex items-center gap-1.5">
          {hook.pausedReason ? (
            <>
              <Badge variant="error">Paused</Badge>
              <span title={hook.pausedReason} className="cursor-help text-danger hover:text-danger-fg">
                <IconWarning className="size-3.5" />
              </span>
            </>
          ) : (
            <Badge variant={hook.enabled ? 'success' : 'default'}>
              {hook.enabled ? 'Active' : 'Paused'}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: '__actions__',
      header: '',
      className: 'w-28',
      cell: (hook) => (
        <div className="flex items-center gap-1 justify-end">
          <button
            onClick={() => navigate(`/${workspaceId}/settings/webhooks/${hook.id}/logs`)}
            title="View delivery logs"
            className="p-1.5 rounded-md text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors"
          >
            <IconListChecks className="size-4" />
          </button>
          <button
            onClick={() => navigate(`/${workspaceId}/settings/webhooks/${hook.id}/edit`)}
            title="Edit"
            className="p-1.5 rounded-md text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors"
          >
            <IconEdit className="size-4" />
          </button>
          <button
            onClick={() => handleToggle(hook)}
            disabled={togglingId === hook.id}
            title={hook.enabled ? 'Pause' : 'Enable'}
            className="p-1.5 rounded-md text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors disabled:opacity-40"
          >
            {hook.enabled
              ? <IconToggleOn className="size-4 text-accent-fg" />
              : <IconToggleOff className="size-4" />}
          </button>
          <button
            onClick={() => setDeleting(hook)}
            title="Delete"
            className="p-1.5 rounded-md text-fg-subtle hover:text-danger-fg hover:bg-danger-muted transition-colors"
          >
            <IconTrash className="size-4" />
          </button>
        </div>
      ),
    },
  ], [workspaceId, togglingId, handleToggle])

  // The settings list (2026-09-08): a titled section, then the compact list.
  return (
    <div className="space-y-3">
      <header>
        <h2 className="text-sm font-semibold text-fg">Webhooks</h2>
        <p className="mt-1 text-sm text-fg-subtle">Outside services to notify when content changes, with the log of every delivery.</p>
      </header>
      {error && (
        <Callout variant="danger">{error}</Callout>
      )}

      <DataList
        chrome="compact"
        columns={columns}
        rows={paginatedHooks}
        rowKey={(h) => h.id}
        loading={loading}
        search={search}
        searchPlaceholder="Search by label or URL…"
        onSearchChange={setSearch}
        page={page}
        pageSize={PAGE_SIZE}
        total={filteredHooks.length}
        onPageChange={setPage}
        emptyState={{
          icon: <IconWebhook className="size-7 text-fg-faint" />,
          title: search ? 'No webhooks match your search' : 'No webhooks yet',
          description: search ? undefined : 'Add one to start receiving event notifications.',
        }}
      />

      {deleting && (
        <DeleteDialog
          webhook={deleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
          loading={deleteLoading}
        />
      )}
    </div>
  )
}
