/**
 * File Name: use-content-types.ts
 * Purpose: Fetches the workspace's content types (GET /types) for the relation
 *   Target-type picker in the schema builder — labels shown, names stored.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { adminFetch } from '@/lib/api'

export interface ContentTypeItem {
  name: string
  label: string
  disabled?: boolean
  singleton?: boolean
  localized?: boolean
  admin?: { taxonomy?: { parentType?: string } }
  fields?: Array<{ name: string; fieldType: string; config?: Record<string, unknown> }>
}

export function useContentTypes(): ContentTypeItem[] {
  const params = useParams()
  const [types, setTypes] = useState<ContentTypeItem[]>([])
  useEffect(() => {
    adminFetch<{ data: ContentTypeItem[] }>('/types')
      .then((r) => setTypes(r.data ?? []))
      .catch(() => setTypes([]))
  }, [])
  return types
}
