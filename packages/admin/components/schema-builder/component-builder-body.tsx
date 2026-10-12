/**
 * File Name: component-builder-body.tsx
 * Purpose: SB-9 — the reusable-component builder body (new + edit). A breadcrumb
 *   bar (Components › ‹name› · Save Component) + inline name/label/description +
 *   the single-stage field canvas. Saves via the component write API.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useReducer, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { adminFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { builderReducer, toComponentDef, validateBuilderModel, type BuilderModel } from '@/lib/schema-builder-model'
import { usePageHeader } from '@/lib/page-header'
import { SchemaBuilderCanvas } from './canvas'
import { PushOverlay } from './push-overlay'
import { Button } from '@/kit'

export function ComponentBuilderBody({ initial }: { initial: BuilderModel }) {
  const params = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [model, dispatch] = useReducer(builderReducer, initial)
  // Header-hosted Save only re-registers on dep changes — read the live model via ref.
  const modelRef = useRef(model)
  modelRef.current = model
  const [saving, setSaving] = useState(false)
  const back = () => navigate(`/${params.workspaceId}/schema`)

  async function save() {
    const m = modelRef.current
    const problems = validateBuilderModel(m, { requireFields: true })
    if (problems.length) { toast.error('Fix before saving', problems[0]); return }
    setSaving(true)
    try {
      await adminFetch('/admin/schema/components', { method: 'POST', body: JSON.stringify(toComponentDef(m)) })
      toast.success(`Component "${m.label || m.name}" saved`)
      back()
    } catch (e) {
      toast.error('Save failed', e instanceof Error ? e.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  usePageHeader({
    breadcrumbs: [
      { label: 'Schema', href: `/${params.workspaceId}/schema` },
      { label: model.label || model.name || 'New component' },
    ],
    actions: (
      <Button size="sm" onClick={save} disabled={!model.name.trim() || saving}>
        {saving ? 'Saving…' : 'Save Component'}
      </Button>
    ),
  }, [model.label, model.name, saving])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PushOverlay show={saving} label={`Saving "${model.label || model.name}"…`} sublabel="Writing the component to app/components - the dev server reloads briefly." />
      <SchemaBuilderCanvas model={model} dispatch={dispatch} singleStage />
    </div>
  )
}
