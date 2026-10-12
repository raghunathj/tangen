/**
 * File Name: use-installed-field-types.ts
 * Purpose: Fetches the workspace's custom field types (installed extensions + site
 *   `app/fields/`) from GET /admin/workspaces/:id/field-types. Shared by the Add Field
 *   modal (picker) and the field-config Sheet (which reads each type's configSchema to
 *   generate config controls).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { adminFetch } from '@/lib/api'
import type { InstalledFieldType } from '@/components/schema-builder/installed-field-types'

/** Returns the installed custom field types, fetched once while `enabled` is true. */
export function useInstalledFieldTypes(enabled: boolean): InstalledFieldType[] {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [items, setItems] = useState<InstalledFieldType[]>([])
  useEffect(() => {
    if (!enabled || !workspaceId) return
    let cancelled = false
    adminFetch<{ data: InstalledFieldType[] }>(`/admin/workspaces/${workspaceId}/field-types`)
      .then((r) => { if (!cancelled) setItems(r.data ?? []) })
      .catch(() => { /* extensions optional - silently show built-ins only */ })
    return () => { cancelled = true }
  }, [enabled, workspaceId])
  return items
}
