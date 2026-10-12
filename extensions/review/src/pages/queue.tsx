/**
 * File Name: queue.tsx
 * Purpose: The Review page - a real work queue: Assigned to me / All in
 *          review / Done recently tabs following the platform's
 *          data-listing standard (toolbar search + stage/type filters,
 *          client-side pagination), and ONE action per row: Review, which
 *          opens the Review modal - the reviewer SEES the draft, the latest
 *          note, and the recent activity before advancing, rejecting, or
 *          assigning. Returned rows (rejected, back with the author) stay
 *          in the active tabs with a red Returned badge + the note, and
 *          their action is a read-only View. Stale terminal rows (content
 *          edited after approval) carry an amber warning dot on the stage
 *          pill and match a "stale" search. The Done tab keeps its
 *          View-activity affordance.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Built on @/kit. Rows come from the extension's queue
 *          route (which also carries the workflow definition); all acting
 *          happens inside ReviewModal (review-modal.tsx), which reloads the
 *          queue via onActed. Members without review:approve get the modal
 *          as a read view. The whole scope is fetched (the route pages at
 *          50 by default), then search/filter/pagination run client-side
 *          over it - search matches member NAMES and staleness, neither of
 *          which the route can resolve. No em dashes in UI copy.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  adminFetch, toast, useCan,
  DataList, type DataListColumn, Badge, Button, FilterDropdown, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from '@/kit'
import { DynamicIcon } from '@/kit'
import { isReturned, type WorkflowStage } from '../state'
import {
  distinctTypes, doneOutcome, fetchQueueScope, filterQueueRows, isStaleRow, QUEUE_MAX_ROWS, workflowForRow,
  memberName, queueBadge, relativeTime, resolveDefaultTab, STALE_TOOLTIP, type QueueRow, type QueueTab,
} from '../queue-model'
import { ASSIGNABLE_CAPABILITY, InitialsAvatar, useMembers } from '../dialogs'
import { ActivityDialog } from '../timeline'
import { ReviewModal } from '../review-modal'
import { useReviewHeader } from './header'

interface QueueResponse {
  data: QueueRow[]
  meta: { total: number }
  /** The primary definition (fallback for rows whose workflow is gone). */
  workflow: { id?: string; name?: string; stages: WorkflowStage[]; coveredTypes: string[] | null; configured: boolean }
  /** Every workflow in the workspace - rows resolve their own from here. */
  workflows?: Array<{ id: string; name: string; stages: WorkflowStage[] }>
}

/** Rows per page - the flows-runs/content-list standard. */
const PAGE_SIZE = 25

/** Relative timestamp with the absolute value on hover. */
function TimeAgo({ iso, className }: { iso?: string; className?: string }) {
  if (!iso) return null
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()} className={className}>
      {relativeTime(iso)}
    </time>
  )
}

export function ReviewQueuePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { hasCapability } = useCan()
  const canApprove = hasCapability('review:approve' as never)
  const canManage = hasCapability('review:manage' as never)
  const members = useMembers()
  // Assignees must be able to ACT - only capability holders are offered.
  const assignableMembers = useMembers(ASSIGNABLE_CAPABILITY)

  const [tab, setTab] = useState<QueueTab | null>((searchParams.get('tab') as QueueTab | null) ?? null)
  const [rows, setRows] = useState<QueueRow[]>([])
  const [workflow, setWorkflow] = useState<{ stages: WorkflowStage[] } | null>(null)
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string; stages: WorkflowStage[] }> | null>(null)
  const [workflowFilter, setWorkflowFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [truncated, setTruncated] = useState(false)
  const [stageFilter, setStageFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [reviewing, setReviewing] = useState<QueueRow | null>(null)
  const [viewing, setViewing] = useState<QueueRow | null>(null)

  // First visit without an explicit tab: land on "Assigned to me" when it
  // has items, otherwise on "All in review".
  useEffect(() => {
    if (tab) return
    adminFetch<QueueResponse>('/admin/ext/review/queue', undefined, { scope: 'mine' })
      .then((r) => { setWorkflow(r.workflow); setWorkflows(r.workflows ?? null); setTab(resolveDefaultTab(r.meta.total)) })
      .catch(() => setTab('all'))
  }, [tab])

  const reload = useCallback((quiet = false) => {
    if (!tab) return
    if (!quiet) setLoading(true)
    // The route pages at 50 by default; fetch the WHOLE scope so filters,
    // search and the row count below cover every item, not the first page.
    fetchQueueScope(async (limit, offset) => {
      const r = await adminFetch<QueueResponse>('/admin/ext/review/queue', undefined,
        { scope: tab, limit: String(limit), offset: String(offset) })
      // The workflow set rides along with every page; take it from the first.
      if (offset === 0) { setWorkflow(r.workflow); setWorkflows(r.workflows ?? null) }
      return r
    })
      .then((res) => { setRows(res.rows); setTruncated(res.truncated) })
      .catch((e) => toast.error('Could not load the review queue', (e as Error).message))
      .finally(() => setLoading(false))
  }, [tab])
  useEffect(() => { reload() }, [reload])

  const switchTab = (id: string) => {
    setTab(id as QueueTab)
    setStageFilter('')
    setTypeFilter('')
    setSearch('')
    setPage(1)
    setSearchParams(id === 'all' ? {} : { tab: id }, { replace: true })
  }

  // W2: Workflows is a real route now, so it is a LINK tab supplied by the
  // shared header hook - the queue only owns its three scope tabs.
  useReviewHeader({ workspaceId, canManage, activeTab: tab ?? 'all', onTabChange: switchTab })

  const wf = workflow ?? { stages: [] }
  // Active tabs show in-review rows PLUS returned ones (rejected, waiting on
  // the author's resubmit); completed cycles stay Done-only.
  const visible = tab === 'done' ? rows : rows.filter((r) => r.stageId || isReturned(r))
  const filtered = filterQueueRows(visible, {
    stage: stageFilter || undefined,
    type: typeFilter || undefined,
    workflow: workflowFilter || undefined,
    search, workflows, primary: wf, members,
  })
  // Multi-workflow workspaces only: with one workflow the UI stays as it was.
  const multiWorkflow = (workflows?.length ?? 0) > 1
  const wfForRow = (row: QueueRow) => workflowForRow(workflows, row, wf)
  // Stage filter options follow the workflow filter; unfiltered, every
  // workflow's stages are offered (ids are unique per workflow).
  const stageOptions = (() => {
    if (workflowFilter) return workflows?.find((w) => w.id === workflowFilter)?.stages ?? []
    if (!workflows || workflows.length <= 1) return wf.stages
    const seen = new Set<string>()
    return workflows.flatMap((w) => w.stages).filter((s) => !seen.has(s.id) && seen.add(s.id))
  })()
  const types = distinctTypes(rows)

  // Client-side pagination over the filtered set (the queue route returns
  // the whole scope; revisit with server-side limit/offset past ~500 rows).
  const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, maxPage)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const filtersActive = Boolean(stageFilter || typeFilter || search.trim())

  const titleColumn: DataListColumn<QueueRow> = {
    key: 'title', header: 'Content', clipAt: false,
    cell: (r) => (
      <div className="min-w-0 py-0.5">
        <p className="max-w-[320px] truncate font-medium text-fg">{r.title || r.objectId}</p>
        <p className="mt-0.5 text-xs text-fg-subtle">{r.typeName}</p>
      </div>
    ),
  }

  const activityButton = (r: QueueRow) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="xs" variant="ghost" aria-label="View activity"
          onClick={() => setViewing(r)}
        >
          <DynamicIcon name="IconHistory" className="size-3.5 text-fg-subtle" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">View activity</TooltipContent>
    </Tooltip>
  )

  const activeColumns: DataListColumn<QueueRow>[] = [
    titleColumn,
    {
      key: 'stage', header: 'Stage', clipAt: false,
      cell: (r) => {
        const badge = queueBadge(wfForRow(r), r)
        // A stale terminal row keeps its stage pill but gains an amber
        // warning dot; the title carries the explanation on hover.
        const stale = isStaleRow(r)
        return (
          <div>
            <span
              title={stale ? STALE_TOOLTIP : undefined}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
            >
              {badge.label}
              {stale && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />}
            </span>
            {isReturned(r) && r.rejectedNote && (
              <p className="mt-0.5 max-w-[280px] truncate text-xs text-fg-subtle" title={r.rejectedNote}>
                {r.rejectedNote}
              </p>
            )}
            {multiWorkflow && (
              <p className="mt-0.5 truncate text-[11px] text-fg-subtle">{wfForRow(r).name ?? ''}</p>
            )}
          </div>
        )
      },
    },
    {
      key: 'assignee', header: 'Assignee', clipAt: false,
      cell: (r) => {
        if (!r.assigneeId) {
          return <span className="text-xs text-fg-subtle">Unassigned</span>
        }
        const name = memberName(members ?? null, r.assigneeId)
        return (
          <span className="flex items-center gap-2">
            <InitialsAvatar name={name} seed={r.assigneeId} />
            <span className="max-w-[140px] truncate text-xs text-fg">{name}</span>
          </span>
        )
      },
    },
    {
      key: 'submitted', header: 'Submitted', clipAt: false,
      cell: (r) => (
        <div className="text-xs text-fg-muted">
          <p className="max-w-[140px] truncate">{memberName(members ?? null, r.submittedBy || null)}</p>
          <TimeAgo iso={r.submittedAt} className="text-fg-subtle" />
        </div>
      ),
    },
    {
      key: 'updated', header: 'Updated', clipAt: false,
      cell: (r) => <TimeAgo iso={r.updatedAt} className="text-xs text-fg-subtle" />,
    },
    {
      key: 'ops', header: '', clipAt: false, className: 'text-right',
      cell: (r) => (
        <div className="flex items-center justify-end whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          <Button size="xs" onClick={() => setReviewing(r)}>{isReturned(r) ? 'View' : 'Review'}</Button>
        </div>
      ),
    },
  ]

  const doneColumns: DataListColumn<QueueRow>[] = [
    titleColumn,
    {
      key: 'outcome', header: 'Outcome', clipAt: false,
      cell: (r) => {
        const o = doneOutcome(r)
        if (!o) return <Badge variant="neutral">Done</Badge>
        return o.kind === 'published'
          ? (
            <div>
              <Badge variant="success">Published</Badge>
              {o.qualification && (
                <p className={`mt-0.5 text-xs ${o.qualification.complete ? 'text-success-fg' : 'text-warning-fg'}`}>
                  {o.qualification.complete
                    ? `All ${o.qualification.stages.length} stages passed`
                    : 'Not all stages verified'}
                </p>
              )}
            </div>
          )
          : (
            <div>
              <Badge variant="error">Rejected</Badge>
              {o.note && <p className="mt-0.5 max-w-[280px] truncate text-xs text-fg-subtle">{o.note}</p>}
            </div>
          )
      },
    },
    {
      key: 'by', header: 'By', clipAt: false,
      cell: (r) => {
        const outcome = doneOutcome(r)
        const byId = outcome?.byId ?? null
        // Non-member actors (a Flow, the platform) render their label, no avatar.
        if (!byId) return <span className="text-xs text-fg-subtle">{outcome?.actorLabel || 'System'}</span>
        const name = memberName(members ?? null, byId)
        return (
          <span className="flex items-center gap-2">
            <InitialsAvatar name={name} seed={byId} />
            <span className="max-w-[140px] truncate text-xs text-fg-muted">{name}</span>
          </span>
        )
      },
    },
    {
      key: 'at', header: 'Completed', clipAt: false,
      cell: (r) => <TimeAgo iso={doneOutcome(r)?.at ?? r.updatedAt} className="text-xs text-fg-subtle" />,
    },
    {
      key: 'ops', header: '', clipAt: false, className: 'text-right',
      cell: (r) => (
        <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
          {activityButton(r)}
        </div>
      ),
    },
  ]

  const emptyStates: Record<QueueTab, { title: string; description: string }> = {
    mine: {
      title: 'Nothing assigned to you',
      description: 'Items land here when someone assigns you a review. Check All in review for unassigned work.',
    },
    all: {
      title: 'Nothing in review',
      description: 'Editors submit drafts from the Review panel in the object editor. Submitted items line up here for reviewers.',
    },
    done: {
      title: 'No completed reviews yet',
      description: 'Published and rejected items from recent review cycles show up here.',
    },
  }

  return (
    <TooltipProvider delayDuration={300}>
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-6 space-y-3">
        {truncated && (
          <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-xs text-warning-fg">
            This queue is deeper than {QUEUE_MAX_ROWS.toLocaleString()} items. You are seeing the
            most recently updated {QUEUE_MAX_ROWS.toLocaleString()}: narrow it with the stage or
            type filter to reach the rest.
          </p>
        )}
        <DataList<QueueRow>
          columns={tab === 'done' ? doneColumns : activeColumns}
          rows={pageRows}
          rowKey={(r) => r.objectId}
          loading={loading || tab === null}
          onRowClick={(r) => navigate(`/${workspaceId}/objects/${r.typeName}/${r.objectId}`)}
          emptyState={filtersActive
            ? { title: 'No matching items', description: 'Nothing matches your search or filters.' }
            : emptyStates[(tab as QueueTab | null) ?? 'all']}
          toolbarLeft={tab !== 'done' ? (
            <div className="flex flex-wrap items-center gap-2">
              {multiWorkflow && (
                <FilterDropdown
                  label="Workflow"
                  options={[{ value: '', label: 'All workflows' }, ...(workflows ?? []).map((w) => ({ value: w.id, label: w.name }))]}
                  value={workflowFilter}
                  onChange={(v) => { setWorkflowFilter(v); setStageFilter(''); setPage(1) }}
                />
              )}
              <FilterDropdown
                label="Stage"
                options={[{ value: '', label: 'All stages' }, ...stageOptions.map((s) => ({ value: s.id, label: s.name }))]}
                value={stageFilter}
                onChange={(v) => { setStageFilter(v); setPage(1) }}
              />
              <FilterDropdown
                label="Type"
                options={[{ value: '', label: 'All types' }, ...types.map((t) => ({ value: t, label: t }))]}
                value={typeFilter}
                onChange={(v) => { setTypeFilter(v); setPage(1) }}
              />
            </div>
          ) : undefined}
          search={search}
          searchPlaceholder="Search the queue…"
          onSearchChange={(v) => { setSearch(v); setPage(1) }}
          page={safePage}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={setPage}
        />
      </div>

      {reviewing && (
        <ReviewModal
          row={reviewing}
          workflow={wfForRow(reviewing)}
          members={members}
          assignableMembers={assignableMembers}
          canApprove={canApprove}
          workspaceId={workspaceId!}
          onClose={() => setReviewing(null)}
          onActed={() => reload(true)}
        />
      )}
      {viewing && (
        <ActivityDialog
          title={viewing.title}
          history={viewing.history}
          workflow={wfForRow(viewing)}
          members={members ?? null}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
    </TooltipProvider>
  )
}
