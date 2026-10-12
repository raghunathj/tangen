/**
 * File Name: globals-builder-body.tsx
 * Purpose: SB-7 — the globals builder body (new + edit). A breadcrumb bar
 *   (Schema › ‹global› · Save Global) over the single-stage field canvas. Saves
 *   via the globals write API (upserts into app/globals/index.ts) and surfaces the
 *   push result, mirroring the content-type builder.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useReducer, useRef, useState } from 'react'
import { IconX } from '@tangen/icons'
import { Button, Callout } from '@/kit'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from '@/lib/toast'
import { builderReducer, toGlobalDef, validateBuilderModel, type BuilderModel } from '@/lib/schema-builder-model'
import { saveSchemaGlobal, waitForPush } from '@/lib/schema-save'
import { usePageHeader } from '@/lib/page-header'
import { SchemaBuilderCanvas } from './canvas'
import { PushOverlay } from './push-overlay'
import { NamedIcon } from './icon-picker'

export function GlobalsBuilderBody({ initial }: { initial: BuilderModel }) {
  const params = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [model, dispatch] = useReducer(builderReducer, initial)
  // Header-hosted Save only re-registers on dep changes — read the live model via ref.
  const modelRef = useRef(model)
  modelRef.current = model
  const [saving, setSaving] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)
  const back = () => navigate(`/${params.workspaceId}/schema`)

  async function save() {
    const m = modelRef.current
    const problems = validateBuilderModel(m)
    if (problems.length) { toast.error('Fix before saving', problems[0]); return }
    setSaving(true)
    setPushError(null)
    let started = false
    try {
      const res = await saveSchemaGlobal(toGlobalDef(m))
      toast.success(`Global "${m.label || m.name}" saved`)
      started = true
      setPushing(true)
      const outcome = await waitForPush(res.pushId)
      if (outcome.status === 'ok') { toast.success('Applied (pushed)'); back() }
      else if (outcome.status === 'failed') { setPushError(outcome.output || 'Push failed - check the global and try again.'); toast.error('Saved to code, but push failed') }
      else { toast.error('Still pushing - check back in a moment') }
    } catch (e) {
      toast.error('Save failed', e instanceof Error ? e.message : undefined)
    } finally {
      setSaving(false)
      if (started) setPushing(false)
    }
  }

  usePageHeader({
    breadcrumbs: [
      { label: 'Schema', href: `/${params.workspaceId}/schema` },
      { label: model.label || model.name || 'New global', icon: <NamedIcon name={model.icon} className="size-4 text-fg-subtle" /> },
    ],
    actions: (
      <Button size="sm" onClick={save} disabled={!model.name.trim() || saving || pushing}>
        {pushing ? 'Pushing…' : saving ? 'Saving…' : 'Save Global'}
      </Button>
    ),
  }, [model.label, model.name, model.icon, saving, pushing])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PushOverlay show={pushing} label={`Applying "${model.label || model.name}"…`} />
      {pushError && (
        <Callout variant="danger" title="Push failed - global written to code but not applied" className="mx-6 mt-3" actions={<Button size="xs" variant="ghost" onClick={() => setPushError(null)} aria-label="Dismiss" icon={<IconX className="size-3.5" />} />}>
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-surface p-2 text-[11px] leading-snug whitespace-pre-wrap">{pushError}</pre>
        </Callout>
      )}
      <SchemaBuilderCanvas model={model} dispatch={dispatch} singleStage />
    </div>
  )
}
