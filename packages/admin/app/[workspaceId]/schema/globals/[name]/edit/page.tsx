/**
 * File Name: page.tsx (schema/globals/:name/edit)
 * Purpose: SB-7 — edit an existing global. Loads the globals array from
 *   /admin/schema/globals, finds it by name, and reconstructs the model.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { adminFetch } from '@/lib/api'
import { useAuthStore } from '@/lib/auth'
import { fromGlobalDef, type BuilderModel } from '@/lib/schema-builder-model'
import { GlobalsBuilderBody } from '@/components/schema-builder/globals-builder-body'

export default function EditGlobalPage() {
  const params = useParams<{ workspaceId: string; name: string }>()
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)
  const [model, setModel] = useState<BuilderModel | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken) return
    adminFetch<{ data: any[] }>('/admin/schema/globals')
      .then((r) => {
        const def = r.data.find((g) => g.name === params.name)
        if (!def) { setError(`Global "${params.name}" not found`); return }
        setModel(fromGlobalDef(def))
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

  if (!model) return null
  return <GlobalsBuilderBody initial={model} />
}
