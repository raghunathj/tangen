/**
 * File Name: workflow-list.tsx
 * Purpose: The Workflows screen - the workspace's review workflows as a data
 *          list (name, coverage, stages, publish gate), one row per workflow,
 *          clicking one opens its builder. "Add workflow" lives in the crumb
 *          bar and creates through POST workflows before navigating into the
 *          new record, the same shape the Forms list uses.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: review:manage only - the header hook hides the tab for
 *          everyone else and this page refuses directly too, since a route is
 *          reachable by URL. Coverage strings come from settings-model
 *          (workflowListRows), so the wording is unit-tested rather than
 *          inlined here. No em dashes in UI copy.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  adminFetch, toast, useCan, Button, DataList, Badge, Text, Callout,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Input,
  usePageHeaderActions, type DataListColumn,
} from '@/kit'
import { DynamicIcon } from '@/kit'
import type { ReviewWorkflow } from '../workflows'
import { draftsFromWorkflows, uncoveredTypeNames, workflowListRows, type WorkflowListRow } from '../settings-model'
import { reviewBase, useReviewHeader } from './header'

interface WorkflowsResponse {
  data: { workflows: ReviewWorkflow[]; configured: boolean; canManage: boolean }
}

interface TypeItem { name: string }

export function WorkflowListPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const { hasCapability } = useCan()
  const canManage = hasCapability('review:manage' as never)
  const base = reviewBase(workspaceId)

  const [workflows, setWorkflows] = useState<ReviewWorkflow[] | null>(null)
  const [types, setTypes] = useState<string[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  useReviewHeader({ workspaceId, canManage, activeTab: null })

  const load = useCallback(() => {
    Promise.all([
      adminFetch<WorkflowsResponse>('/admin/ext/review/workflows'),
      adminFetch<{ data: TypeItem[] }>('/types').catch(() => ({ data: [] as TypeItem[] })),
    ])
      .then(([wf, ts]) => { setWorkflows(wf.data.workflows); setTypes(ts.data.map((t) => t.name)) })
      .catch((e) => toast.error('Could not load the workflows', (e as Error).message))
  }, [])
  useEffect(load, [load])

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await adminFetch<{ data: { workflow: ReviewWorkflow } }>(
        '/admin/ext/review/workflows',
        {
          method: 'POST',
          body: JSON.stringify({
            name,
            // A new workflow claims nothing until someone assigns types to it,
            // so it cannot collide with an existing one on creation.
            coveredTypes: [],
            stages: [{ name: 'Review', color: 'amber' }, { name: 'Approved', color: 'green' }],
          }),
        },
      )
      setCreateOpen(false)
      setNewName('')
      navigate(`${base}/workflows/${res.data.workflow.id}`)
    } catch (e) {
      toast.error('Could not create the workflow', (e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  usePageHeaderActions(
    canManage ? (
      <Button
        size="sm"
        icon={<DynamicIcon name="IconPlus" className="size-[15px]" />}
        onClick={() => setCreateOpen(true)}
      >
        Add workflow
      </Button>
    ) : null,
    [canManage],
  )

  const rows = useMemo(
    () => (workflows ? workflowListRows(workflows, types) : []),
    [workflows, types],
  )

  // A set-level warning, so it belongs on the list rather than on any one
  // workflow's screen: with no catch-all default, whatever nothing claims
  // publishes with no review at all.
  const uncovered = useMemo(
    () => (workflows ? uncoveredTypeNames(draftsFromWorkflows(workflows), types) : []),
    [workflows, types],
  )

  const columns: DataListColumn<WorkflowListRow>[] = [
    {
      key: 'name', header: 'Workflow', clipAt: false,
      cell: (r) => (
        <div className="min-w-0 py-0.5">
          <p className="truncate font-medium text-fg">{r.name || 'Untitled workflow'}</p>
          <p className="mt-0.5 text-xs text-fg-subtle">{r.coverage}</p>
        </div>
      ),
    },
    {
      key: 'stages', header: 'Stages',
      cell: (r) => <span className="text-sm text-fg-muted">{r.stageCount}</span>,
    },
    {
      key: 'gate', header: 'Publish gate',
      cell: (r) => <span className="text-sm text-fg-muted">{r.terminalStageName}</span>,
    },
    {
      key: 'state', header: '',
      cell: (r) => (
        <div className="flex items-center gap-1.5">
          {r.draft && <Badge variant="warning">Draft</Badge>}
          {r.isDefault && !r.draft && <Badge variant="neutral">Default</Badge>}
        </div>
      ),
    },
  ]

  if (!canManage) {
    return (
      <div className="p-6">
        <Text variant="help">You do not have permission to manage review workflows.</Text>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-6 space-y-3">
        {uncovered.length > 0 && (
          <Callout variant="warning" title={`${uncovered.length} content ${uncovered.length === 1 ? 'type is' : 'types are'} not reviewed`}>
            No workflow covers {uncovered.slice(0, 6).join(', ')}{uncovered.length > 6 ? ', and more' : ''}. They publish without review. Add them to a workflow, or set one workflow to cover all remaining content objects.
          </Callout>
        )}
        <DataList<WorkflowListRow>
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={workflows === null}
          onRowClick={(r) => navigate(`${base}/workflows/${r.id}`)}
          emptyState={{
            title: 'No workflows yet',
            description: 'A workflow is the set of stages content moves through before it can be published.',
          }}
        />
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add workflow</DialogTitle></DialogHeader>
          <div className="px-6 py-4 space-y-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') create() }}
              placeholder="Legal review"
              aria-label="Workflow name"
              autoFocus
            />
            <Text variant="help">
              It starts with two stages and reviews nothing until you assign content types to it.
            </Text>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={creating || !newName.trim()}>
              {creating ? 'Creating…' : 'Create workflow'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
