/**
 * File Name: page.tsx (schema/:typeName/edit)
 * Purpose: SB-3 — edit an existing content type in the builder. Loads the type
 *   from /types, reconstructs the builder model (fields + stages + width + icon +
 *   description), and hands off to the shared builder body.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { adminFetch } from '@/lib/api'
import { useAuthStore } from '@/lib/auth'
import { fromObjectType, type BuilderModel } from '@/lib/schema-builder-model'
import { SchemaBuilderBody } from '@/components/schema-builder/builder-body'
import { Button, Callout } from '@/kit'

export default function SchemaBuilderEditPage() {
  const params = useParams<{ workspaceId: string; typeName: string }>()
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)
  const [model, setModel] = useState<BuilderModel | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken) return
    adminFetch<{ data: any[] }>('/types')
      .then((r) => {
        const def = r.data.find((t) => t.name === params.typeName)
        if (!def) { setError(`Type "${params.typeName}" not found`); return }
        setModel(fromObjectType(def))
      })
      .catch((e) => setError(e.message))
  }, [accessToken, params.typeName])

  if (error) {
    return (
      <div className="flex-1 space-y-3 p-8">
        <Callout variant="danger">{error}</Callout>
        <Button variant="secondary" size="sm" onClick={() => navigate(`/${params.workspaceId}/schema`)}>Back to Schema</Button>
      </div>
    )
  }
  if (!model) return <div className="flex-1 p-8 text-sm text-fg-muted">Loading…</div>

  // key forces a fresh reducer when switching types.
  return <SchemaBuilderBody key={params.typeName} initial={model} existing />
}
