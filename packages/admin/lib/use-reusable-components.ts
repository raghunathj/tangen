/**
 * File Name: use-reusable-components.ts
 * Purpose: Fetches the workspace's reusable component registry
 *   (GET /admin/schema/components) for the component-field picker in the schema
 *   builder's config Sheet.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { adminFetch } from '@/lib/api'

export interface ReusableComponent {
  name: string
  label?: string
  description?: string
  group?: string
  fields?: Array<{ name: string; fieldType: string; config?: Record<string, unknown> }>
}

/** Returns the workspace's reusable components, fetched once while `enabled`. */
export function useReusableComponents(enabled: boolean): ReusableComponent[] {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [items, setItems] = useState<ReusableComponent[]>([])
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    adminFetch<{ data: ReusableComponent[] }>('/admin/schema/components')
      .then((r) => { if (!cancelled) setItems(r.data ?? []) })
      .catch(() => { /* none / not resolvable - show empty */ })
    return () => { cancelled = true }
  }, [enabled, workspaceId])
  return items
}
