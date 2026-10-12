/**
 * File Name: page.tsx (schema/components/new)
 * Purpose: SB-9 — author a new reusable component. Reads name/label/description
 *   from the new-component modal (router state), then the single-stage builder.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { emptyModel, fromGeneratedSchema } from '@/lib/schema-builder-model'
import { ComponentBuilderBody } from '@/components/schema-builder/component-builder-body'
import type { NewTypeMeta } from '@/components/schema-builder/new-type-modal'

export default function NewComponentPage() {
  const params = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const state = useLocation().state as { meta?: NewTypeMeta; aiDraft?: any } | null
  const meta = state?.meta
  const aiDraft = state?.aiDraft

  useEffect(() => {
    if (!meta && !aiDraft) navigate(`/${params.workspaceId}/schema`, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!meta && !aiDraft) return null
  const initial = aiDraft ? fromGeneratedSchema(aiDraft) : emptyModel(meta!.name, meta!.label, meta!.description)
  return <ComponentBuilderBody initial={initial} />
}
