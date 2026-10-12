/**
 * File Name: home.tsx
 * Purpose: Studio - Home. Lists the objects a marketer can open in Studio:
 *          every object of a type that has BOTH a blocks (component) field
 *          AND live preview configured. Each row opens the Studio editor.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Type discovery is pure (src/lib/model); the preview
 *          half of eligibility is a runtime ask per type (getPreviewConfig).
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { AdminPage, Badge, Button, EmptyState, Skeleton } from '@/kit'
import { adminFetch } from '@/lib/api'
import { getPreviewConfig } from '@/lib/preview'
import { normalizeObjectData } from '@/lib/editor'
import { DynamicIcon } from '@/components/dynamic-icon'
import { clsx } from 'clsx'
import { discoverStudioTypes, type StudioType, type StudioTypeCandidate } from '../lib/model'
import { GenerateDialog } from '../components/generate-dialog'
import { NewPageDialog } from '../components/new-page-dialog'

interface ObjectRow {
  id: string
  title: string | null
  status: string
  updated_at: string | null
}

const STATUS_VARIANT: Record<string, 'success' | 'neutral' | 'default' | 'warning'> = {
  published: 'success',
  draft: 'neutral',
  scheduled: 'default',
  archived: 'warning',
}

function fmtWhen(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function StudioHomePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [studioTypes, setStudioTypes] = useState<StudioType[] | null>(null)
  const [activeType, setActiveType] = useState<string | null>(null)
  const [rows, setRows] = useState<ObjectRow[]>([])
  const [rowsLoading, setRowsLoading] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [newPageOpen, setNewPageOpen] = useState(false)

  // Discover eligible types: a blocks field (pure) AND live preview (runtime).
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await adminFetch<{ data: StudioTypeCandidate[] }>('/types')
        const candidates = discoverStudioTypes(res.data ?? [])
        const checks = await Promise.all(candidates.map(async (c) => {
          const cfg = await getPreviewConfig(c.type)
          return cfg.enabled ? c : null
        }))
        if (!alive) return
        const eligible = checks.filter((c): c is StudioType => c !== null)
        setStudioTypes(eligible)
        setActiveType((cur) => cur ?? eligible[0]?.type ?? null)
      } catch {
        if (alive) setStudioTypes([])
      }
    })()
    return () => { alive = false }
  }, [])

  // Objects of the active type.
  useEffect(() => {
    if (!activeType) { setRows([]); return }
    let alive = true
    setRowsLoading(true)
    adminFetch<{ data: Array<Record<string, unknown>>; meta?: { total: number } }>(
      `/objects/${activeType}/query`,
      { method: 'POST', body: JSON.stringify({ page: 1, limit: 50 }) },
    )
      .then((r) => { if (alive) setRows((r.data ?? []).map((d) => normalizeObjectData(d) as unknown as ObjectRow)) })
      .catch(() => { if (alive) setRows([]) })
      .finally(() => { if (alive) setRowsLoading(false) })
    return () => { alive = false }
  }, [activeType])

  const active = useMemo(() => studioTypes?.find((t) => t.type === activeType) ?? null, [studioTypes, activeType])
  const base = `/${workspaceId}/extensions/studio`

  return (
    <AdminPage
      title="Studio"
      description="Design block pages visually on the live preview"
      access={{ capability: 'studio:edit' }}
      loading={studioTypes === null}
      actions={
        (studioTypes?.length ?? 0) > 0 ? (
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setGenerateOpen(true)}>Generate page</Button>
            <Button onClick={() => setNewPageOpen(true)}>New page</Button>
          </div>
        ) : undefined
      }
    >
      {studioTypes !== null && studioTypes.length === 0 ? (
        <EmptyState
          title="No Studio-ready types"
          description="Studio opens objects of content types that have a blocks (component) field and live preview configured for this environment. Add a component field to a type and set a preview URL to get started."
        />
      ) : (
        <div className="space-y-4">
          {/* Type pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(studioTypes ?? []).map((t) => (
              <button
                key={t.type}
                type="button"
                onClick={() => setActiveType(t.type)}
                className={clsx(
                  'px-3 h-8 rounded-full text-sm font-medium border transition-colors',
                  t.type === activeType
                    ? 'bg-accent-muted text-accent-fg border-accent'
                    : 'bg-surface text-fg-muted border-border hover:bg-surface-hover',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Object list */}
          {rowsLoading ? (
            <Skeleton variant="rows" rows={5} />
          ) : rows.length === 0 ? (
            <EmptyState
              title={`No ${active?.label ?? 'pages'} yet`}
              description="Create your first one here - start blank, from a template, or describe it and let Studio draft it."
              action={<Button onClick={() => setNewPageOpen(true)}>New page</Button>}
            />
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link
                    to={`${base}/edit?type=${encodeURIComponent(active?.type ?? '')}&id=${encodeURIComponent(row.id)}`}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-surface-hover transition-colors group"
                  >
                    <span className="grid place-items-center size-9 shrink-0 rounded-lg bg-surface-sunken text-fg-muted group-hover:text-accent-fg">
                      <DynamicIcon name="RiPaintBrushLine" className="size-4.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-fg truncate">{row.title || 'Untitled'}</span>
                      <span className="block text-xs text-fg-muted">{fmtWhen(row.updated_at)}</span>
                    </span>
                    <Badge variant={STATUS_VARIANT[row.status] ?? 'neutral'}>{row.status}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <NewPageDialog
        open={newPageOpen}
        onOpenChange={setNewPageOpen}
        types={studioTypes ?? []}
        onCreated={(t, id) => navigate(`${base}/edit?type=${encodeURIComponent(t)}&id=${encodeURIComponent(id)}`)}
      />
      <GenerateDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        mode="new"
        types={studioTypes ?? []}
        onCreated={(t, id) => navigate(`${base}/edit?type=${encodeURIComponent(t)}&id=${encodeURIComponent(id)}`)}
      />
    </AdminPage>
  )
}
