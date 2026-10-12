/**
 * File Name: workflow-detail.tsx
 * Purpose: One workflow's builder - the screen a row on the Workflows list
 *          opens. Name, the stage pipeline, and which content types run
 *          through it, saved on its own through PATCH workflows/:workflowId
 *          and removed through DELETE, so editing one workflow never
 *          rewrites the others.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Cross-workflow rules (a type belongs to ONE workflow;
 *          only one catch-all default) are properties of the whole SET, which
 *          this screen cannot see - the server validates the set on every
 *          per-workflow save and its message names the other workflow. So
 *          draftProblems only checks what one screen can know, and the
 *          server's 422 surfaces as a toast. No em dashes in UI copy.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  adminFetch, toast, useCan, Button, ConfirmDialog, Input, Text, Callout,
  usePageHeaderActions, usePageHeader,
} from '@/kit'
import { DynamicIcon } from '@/kit'
import type { ReviewWorkflow } from '../workflows'
import {
  draftsFromWorkflows, draftProblems, oneWorkflowInput, type DraftWorkflow,
} from '../settings-model'
import { StagePipeline, CoverageEditor, Toggle } from './workflow-settings'
import { reviewBase } from './header'

interface WorkflowsResponse {
  data: { workflows: ReviewWorkflow[]; configured: boolean; canManage: boolean }
}

interface TypeItem {
  name: string
  label?: string
  admin?: { menu?: { icon?: string } }
}

export function WorkflowDetailPage() {
  const { workspaceId, workflowId } = useParams<{ workspaceId: string; workflowId: string }>()
  const navigate = useNavigate()
  const { hasCapability } = useCan()
  const canManage = hasCapability('review:manage' as never)
  const base = reviewBase(workspaceId)

  const [draft, setDraft] = useState<DraftWorkflow | null>(null)
  const [siblings, setSiblings] = useState<DraftWorkflow[]>([])
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [types, setTypes] = useState<TypeItem[]>([])
  const [configured, setConfigured] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [missing, setMissing] = useState(false)
  const [roleOptions, setRoleOptions] = useState<Array<{ slug: string; name: string }>>([])

  const load = useCallback(() => {
    if (!workflowId) return
    Promise.all([
      adminFetch<WorkflowsResponse>('/admin/ext/review/workflows'),
      adminFetch<{ data: TypeItem[] }>('/types').catch(() => ({ data: [] as TypeItem[] })),
      // Roles need manage:members or manage:roles; without them the stage
      // role picker simply does not render rather than erroring.
      adminFetch<{ data: Array<{ slug: string; name: string }> }>('/roles')
        .catch(() => ({ data: [] as Array<{ slug: string; name: string }> })),
    ]).then(([wf, ts, roles]) => {
      setRoleOptions(roles.data ?? [])
      const all = draftsFromWorkflows(wf.data.workflows)
      const mine = all.find((w) => w.id === workflowId) ?? null
      setMissing(!mine)
      setDraft(mine)
      // Siblings let the coverage picker disable types another workflow owns
      // instead of letting the save fail on them.
      setSiblings(all)
      setTerminalId(mine?.stages[mine.stages.length - 1]?.id ?? null)
      setConfigured(wf.data.configured)
      setTypes(ts.data)
    }).catch((e) => toast.error('Could not load the workflow', (e as Error).message))
  }, [workflowId])
  useEffect(load, [load])

  usePageHeader({
    breadcrumbs: [
      { label: 'Review', href: base },
      { label: 'Workflows', href: `${base}/workflows` },
      { label: draft?.name?.trim() || 'Workflow' },
    ],
    icon: <DynamicIcon name="IconShieldCheck" className="size-4" />,
  }, [base, draft?.name])

  const problems = useMemo(() => (draft ? draftProblems(draft) : []), [draft])

  const patch = (p: Partial<DraftWorkflow>) => setDraft((d) => (d ? { ...d, ...p } : d))

  const save = async () => {
    if (!draft || problems.length > 0) return
    setSaving(true)
    try {
      const res = await adminFetch<{ data: { workflow: ReviewWorkflow } }>(
        `/admin/ext/review/workflows/${workflowId}`,
        { method: 'PATCH', body: JSON.stringify(oneWorkflowInput(draft)) },
      )
      const [saved] = draftsFromWorkflows([res.data.workflow])
      setDraft(saved)
      setTerminalId(saved.stages[saved.stages.length - 1]?.id ?? null)
      setConfigured(true)
      toast.success('Workflow saved')
    } catch (e) {
      // Cross-workflow conflicts land here: the server names the other one.
      toast.error('Could not save', (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    try {
      await adminFetch(`/admin/ext/review/workflows/${workflowId}`, { method: 'DELETE' })
      toast.success('Workflow deleted')
      navigate(`${base}/workflows`)
    } catch (e) {
      toast.error('Could not delete', (e as Error).message)
    }
  }

  usePageHeaderActions(
    canManage && draft ? (
      <div className="flex items-center gap-2">
        <Button
          size="sm" variant="secondary" onClick={() => setDeleteOpen(true)}
          icon={<DynamicIcon name="IconTrash" className="size-[15px] text-danger-fg" />}
        >
          Delete
        </Button>
        <Button size="sm" onClick={save} disabled={saving || problems.length > 0}>
          {saving ? 'Saving…' : 'Save workflow'}
        </Button>
      </div>
    ) : null,
    [canManage, draft, saving, problems.length],
  )

  if (!canManage) {
    return <div className="p-6"><Text variant="help">You do not have permission to manage review workflows.</Text></div>
  }
  if (missing) {
    return (
      <div className="p-6 space-y-3">
        <Text variant="help">That workflow no longer exists.</Text>
        <Button size="sm" variant="secondary" onClick={() => navigate(`${base}/workflows`)}>
          Back to workflows
        </Button>
      </div>
    )
  }
  if (!draft) return <div className="p-6"><Text variant="help">Loading the workflow…</Text></div>

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-6 space-y-6">
        {!configured && (
          <Callout variant="info" title="Seeded from code">
            Until you save, covered types follow the Types that require review setting (Settings, Extensions, Review). Saving here takes over.
          </Callout>
        )}

        <div className="max-w-md space-y-1.5">
          <label htmlFor="wf-name" className="text-sm font-medium text-fg">Name</label>
          <Input
            id="wf-name"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Workflow name"
          />
        </div>

        {/* Park it without losing the stages. Saying what it means matters:
            this LIFTS the review gate for everything it covers. */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <Toggle
            checked={!draft.draft}
            onChange={(live) => patch({ draft: !live })}
            label={draft.draft ? 'Draft' : 'Live'}
          />
          <p className="mt-1.5 text-xs text-fg-subtle">
            {draft.draft
              ? 'Parked. Nothing runs through this workflow, so the content it covers publishes without review until you set it live.'
              : 'Running. Content it covers must clear this workflow before it can be published.'}
          </p>
        </div>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
          <StagePipeline
            stages={draft.stages}
            terminalId={terminalId}
            roleOptions={roleOptions}
            onChange={(next) => patch({ stages: next })}
          />
          <CoverageEditor
            draft={draft}
            drafts={siblings.map((w) => (w.key === draft.key ? draft : w))}
            types={types}
            onChange={patch}
          />
        </div>

        {problems.length > 0 && (
          <p className="text-xs text-warning-fg">{problems[0]}</p>
        )}
      </div>

      <ConfirmDialog
        open={deleteOpen} onOpenChange={setDeleteOpen}
        title={`Delete "${draft.name.trim() || 'this workflow'}"?`}
        message="Anything currently in review under this workflow is taken out of review and has to be submitted again. Content already published is untouched."
        confirmLabel="Delete workflow"
        variant="destructive"
        onConfirm={remove}
      />
    </div>
  )
}
