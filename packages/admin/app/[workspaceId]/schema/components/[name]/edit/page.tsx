/**
 * File Name: page.tsx (schema/components/:name/edit)
 * Purpose: SB-9 — edit an existing reusable component. Loads the registry from
 *   /admin/schema/components, finds it by name, and reconstructs the model.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { adminFetch } from '@/lib/api'
import { useAuthStore } from '@/lib/auth'
import { fromComponentDef, type BuilderModel } from '@/lib/schema-builder-model'
import { ComponentBuilderBody } from '@/components/schema-builder/component-builder-body'

export default function EditComponentPage() {
  const params = useParams<{ workspaceId: string; name: string }>()
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)
  const [model, setModel] = useState<BuilderModel | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken) return
    adminFetch<{ data: any[] }>('/admin/schema/components')
      .then((r) => {
        const def = r.data.find((c) => c.name === params.name)
        if (!def) { setError(`Component "${params.name}" not found`); return }
        setModel(fromComponentDef(def))
      })
      .catch((e) => setError(e.message))
  }, [accessToken, params.name])

  if (error) {
    return (
      <div className="flex-1 p-8">
        <p className="text-sm text-danger-fg">{error}</p>
        <button onClick={() => navigate(`/${params.workspaceId}/schema`)} className="mt-3 text-sm text-fg-muted hover:text-fg">← Schema</button>
      </div>
    )
  }
  if (!model) return <div className="flex-1 p-8 text-sm text-fg-muted">Loading…</div>
  return <ComponentBuilderBody key={params.name} initial={model} />
}
