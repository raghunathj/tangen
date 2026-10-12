/**
 * File Name: panels.tsx
 * Purpose: The object-editor Variants panel - shows the lineage of the
 *          current object (base: its variants + a Create variant button;
 *          variant: a link back to the base) and creates variant siblings
 *          through the extension's admin routes.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Receives the ExtensionPanelProps contract (objectId,
 *          status, refresh) from the admin editor; the route params supply
 *          workspaceId/typeName. No em dashes in UI copy.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { adminFetch, useCan, Button, Badge, toast } from '@/kit'

interface PanelProps {
  /** The object's id ('' while the editor is on /new). */
  objectId?: string
  /** Lifecycle status: draft | published | scheduled | archived. */
  status?: string
  /** Re-runs the editor's object load. */
  refresh?: () => void
}

interface LineageVariant {
  variantId: string
  title?: string
  slug?: string
  status?: string
  createdAt?: string
}

interface LineageResponse {
  role: 'base' | 'variant' | 'none'
  baseObjectId?: string
  typeName?: string
  variants?: LineageVariant[]
}

function statusBadge(status?: string) {
  if (status === 'published') return <Badge variant="success">Published</Badge>
  if (status === 'scheduled') return <Badge variant="warning">Scheduled</Badge>
  if (status === 'archived') return <Badge variant="neutral">Archived</Badge>
  return <Badge variant="neutral">Draft</Badge>
}

export function VariantLineagePanel({ objectId, refresh }: PanelProps) {
  const { workspaceId, typeName } = useParams<{ workspaceId: string; typeName: string }>()
  const { hasCapability } = useCan()
  const canManage = hasCapability('manage:variants' as never)
  const [lineage, setLineage] = useState<LineageResponse | null>(null)
  const [busy, setBusy] = useState(false)

  const editorPath = (id: string) => `/${workspaceId}/objects/${typeName}/${id}`

  const load = useCallback(() => {
    if (!objectId || !canManage) return
    adminFetch<{ data: LineageResponse }>(`/admin/ext/variants/object/${objectId}`)
      .then((r) => setLineage(r.data))
      .catch(() => setLineage(null))
  }, [objectId, canManage])
  useEffect(load, [load])

  if (!objectId) {
    return <p className="text-xs text-fg-subtle">Save this object first. Variants are created from an existing object.</p>
  }
  if (!canManage) {
    return <p className="text-xs text-fg-subtle">You need the &quot;Manage variants &amp; experiments&quot; capability to work with variants.</p>
  }

  const createVariant = async () => {
    setBusy(true)
    try {
      const r = await adminFetch<{ data: { variantId: string; title: string } }>(
        '/admin/ext/variants/create-variant',
        { method: 'POST', body: JSON.stringify({ typeName, objectId }) },
      )
      toast.success('Variant created', r.data.title)
      load()
      refresh?.()
    } catch (e) {
      toast.error('Could not create the variant', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (lineage?.role === 'variant') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge>Variant</Badge>
          <span className="text-xs text-fg-muted">This object is a variant of another object.</span>
        </div>
        <Link
          to={editorPath(lineage.baseObjectId!)}
          className="text-xs font-medium text-accent hover:underline"
        >
          Open the base object
        </Link>
        <p className="text-xs text-fg-subtle">
          Experiments and takeovers are managed from the Experiments page. Consider a noindex tag on variant slugs so search engines skip them.
        </p>
      </div>
    )
  }

  const variants = lineage?.variants ?? []
  return (
    <div className="space-y-3">
      {variants.length > 0 ? (
        <ul className="space-y-1.5">
          {variants.map((v) => (
            <li key={v.variantId} className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5">
              <Link to={editorPath(v.variantId)} className="text-xs font-medium text-fg hover:text-accent truncate">
                {v.title ?? v.variantId}
              </Link>
              {statusBadge(v.status)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-fg-subtle">
          No variants yet. A variant is a full sibling copy of this object - edit it freely, then run an A/B experiment or schedule a takeover.
        </p>
      )}
      <Button size="xs" variant="secondary" onClick={createVariant} disabled={busy}>
        {busy ? 'Creating…' : 'Create variant'}
      </Button>
    </div>
  )
}
