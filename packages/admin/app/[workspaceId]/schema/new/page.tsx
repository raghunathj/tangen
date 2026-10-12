/**
 * File Name: page.tsx (schema/new)
 * Purpose: SB-3 — the "create a content type" builder page. Reads the meta from
 *   the new-type modal (via router state), then hands off to the shared builder
 *   body (breadcrumb + two-column canvas).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { emptyModel, fromGeneratedSchema } from '@/lib/schema-builder-model'
import { SchemaBuilderBody } from '@/components/schema-builder/builder-body'
import type { NewTypeMeta } from '@/components/schema-builder/new-type-modal'

export default function SchemaBuilderNewPage() {
  const params = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  // Either the new-type modal meta, or an AI-generated draft handed off by the assistant.
  const state = useLocation().state as { meta?: NewTypeMeta; aiDraft?: any } | null
  const meta = state?.meta
  const aiDraft = state?.aiDraft

  // Reached directly (no meta, no AI draft) → bounce back to Schema.
  useEffect(() => {
    if (!meta && !aiDraft) navigate(`/${params.workspaceId}/schema`, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!meta && !aiDraft) return null
  const initial = aiDraft ? fromGeneratedSchema(aiDraft) : { ...emptyModel(meta!.name, meta!.label, meta!.description, meta!.icon), plural: meta!.plural || undefined, singleton: meta!.singleton === true }
  return <SchemaBuilderBody initial={initial} />
}
