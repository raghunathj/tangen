import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { IconRefresh, IconEdit, IconCheck, IconHome, IconLock } from '@tangen/icons'
import { Callout, Button } from '@/kit'
import { usePageHeader } from '@/lib/page-header'
import { clsx } from 'clsx'
import { adminFetch } from '@/lib/api'
import { useAuthStore } from '@/lib/auth'
import { formatStatValue } from '@/lib/dashboard'
import { useCapabilities } from '@/lib/use-capabilities'
import { roleMeta } from '@/lib/role-meta'
import {
  makePrefsKey,
  getPrefs,
  setPrefs,
  mergePrefs,
  applyPrefs,
  type ColSpan,
  type RowSpan,
  type DashboardPrefs,
} from '@/lib/dashboard-prefs'
import { WidgetShell, WidgetDragOverlay } from '@/components/dashboard/widget-shell'
import { WidgetCard } from '@/components/dashboard/widget-card'
import { StatGroupCard } from '@/components/dashboard/stat-group-card'
import { QuickActionsCard } from '@/components/dashboard/quick-actions-card'
import { ContentOverviewCard } from '@/components/dashboard/content-overview-card'
import { ActivityFeedCard } from '@/components/dashboard/activity-feed-card'
import { ExtensionWidgetCard } from '@/components/dashboard/extension-widget-card'
import { DynamicIcon } from '@/components/dynamic-icon'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardWidget {
  id: string
  type: string
  title: string
  description?: string
  value?: number
  unit?: string
  icon?: string
  stats?: Array<{ label: string; value: number; unit?: string; tone?: 'success' | 'danger' | 'warning' | 'neutral'; href?: string }>
  tone?: 'success' | 'danger' | 'warning' | 'neutral'
  href?: string
  actions?: Array<{ label: string; href: string; icon?: string; external?: boolean }>
  data?: {
    types: Array<{ name: string; label: string; counts: Record<string, number>; total: number }>
    totals: { total: number; published: number; draft: number; scheduled: number; archived: number }
  }
  items?: Array<{
    id: string; category: string; action: string; actorName: string | null
    actorType: string | null; typeName: string | null; objectId: string | null
    objectTitle: string | null; targetLabel: string | null; createdAt: string
  }>
  retentionDays?: number
  columns?: Array<{ key: string; label: string }>
  rows?: Record<string, unknown>[]
  dataPath?: string
  widgetType?: string
  /** The member's role may not view this widget's data - render a locked card. */
  restricted?: boolean
}

type PositionedWidget = DashboardWidget & { colSpan: ColSpan; rowSpan: RowSpan }

interface DashboardResponse {
  data: { widgets: DashboardWidget[] }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-4 p-6 pt-11 animate-pulse">
      <div className="col-span-2 h-48 bg-surface-hover rounded-xl" />
      <div className="h-32 bg-surface-hover rounded-xl" />
      <div className="col-span-2 h-64 bg-surface-hover rounded-xl" />
      <div className="space-y-4">
        <div className="h-36 bg-surface-hover rounded-xl" />
        <div className="h-36 bg-surface-hover rounded-xl" />
      </div>
    </div>
  )
}

const STAT_TONE_CLS: Record<string, string> = {
  success: 'text-success-fg',
  danger: 'text-danger-fg',
  warning: 'text-warning-fg',
  neutral: 'text-fg',
}

function StatCard({ widget, workspaceId}: { widget: DashboardWidget; workspaceId: string; }) {
  const navigate = useNavigate()
  const href = (widget as any).href as string | undefined
  return (
    <WidgetCard
      icon={(widget as any).icon ? <DynamicIcon name={(widget as any).icon} /> : undefined}
      title={widget.title}
      description={widget.description}
      onOpen={href ? () => navigate(`/${workspaceId}${href.startsWith('/') ? href : `/${href}`}`) : undefined}
    >
      {/* The figure is the point of the card, so it gets the size and the
          tighter tracking, and the label above it stays quiet. */}
      <p className={`text-3xl font-semibold tracking-tight tabular-nums ${STAT_TONE_CLS[(widget as any).tone ?? 'neutral']}`}>
        {formatStatValue(widget.value ?? 0, widget.unit)}
      </p>
    </WidgetCard>
  )
}

/** Shown in place of a widget whose data the member's role may not view.
 *  The card stays on the dashboard so the layout is stable for every role. */
function NoRightsCard({ widget }: { widget: DashboardWidget }) {
  return (
    <WidgetCard
      icon={(widget as any).icon ? <DynamicIcon name={(widget as any).icon} /> : undefined}
      title={widget.title}
    >
      <div className="flex items-center gap-2 text-fg-subtle">
        <IconLock className="size-4 shrink-0" aria-hidden />
        <p className="text-ui-sm">No rights to view</p>
      </div>
    </WidgetCard>
  )
}

function TableCard({ widget }: { widget: DashboardWidget }) {
  if (!widget.columns || !widget.rows) return null
  return (
    <WidgetCard
      flush
      icon={(widget as any).icon ? <DynamicIcon name={(widget as any).icon} /> : undefined}
      title={widget.title}
      description={widget.description}
    >
      {widget.rows.length === 0 ? (
        <p className="px-4 pb-4 text-ui-sm text-fg-subtle">No entries yet.</p>
      ) : (
        // Its own scroll container, like every other table in Admin: at 390px
        // three date columns ran 20px past the card and were cut off rather
        // than reachable (Phase 8B browser harness).
        <div className="overflow-x-auto border-t border-border-subtle">
        <table className="w-full text-ui-xs">
          {/* The grey earns its place here: a header row a shade under the
              card, so the columns read as headings without a second border. */}
          <thead className="bg-surface-sunken">
            <tr>
              {widget.columns.map((col) => (
                <th key={col.key} className="px-4 py-2 text-left font-medium text-fg-muted">{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {widget.rows.map((row, i) => (
              <tr key={i} className="transition-colors motion-fast hover:bg-surface-hover">
                {widget.columns!.map((col) => (
                  <td key={col.key} className="px-4 py-2.5 text-fg">{String(row[col.key] ?? '-')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </WidgetCard>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const params = useParams<{ workspaceId: string }>()
  const { flags: bootstrapFlags } = useCapabilities(params.workspaceId)
  const member = useAuthStore((s) => s.member)

  const [widgets, setWidgets] = useState<PositionedWidget[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  // Stable ref so prefs callbacks don't stale-close over old values
  const prefsKeyRef = useRef<string | null>(null)
  if (params.workspaceId && member?.memberId) {
    prefsKeyRef.current = makePrefsKey(params.workspaceId, member.memberId)
  }

  const loadWidgets = useCallback(async () => {
    try {
      const res = await adminFetch<DashboardResponse>('/admin/dashboard')
      const raw = res.data.widgets
      const key = prefsKeyRef.current
      const stored = key ? getPrefs(key) : null
      const prefs = mergePrefs(raw, stored)
      setWidgets(applyPrefs(raw, prefs))
    } catch (e: any) {
      setError(e.message ?? 'Failed to load dashboard')
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    loadWidgets().finally(() => setLoading(false))
  }, [loadWidgets])

  function savePrefs(next: PositionedWidget[]) {
    const key = prefsKeyRef.current
    if (!key) return
    const prefs: DashboardPrefs = {
      order: next.map((w) => w.id),
      colSpans: Object.fromEntries(next.map((w) => [w.id, w.colSpan])),
      rowSpans: Object.fromEntries(next.map((w) => [w.id, w.rowSpan])),
    }
    setPrefs(key, prefs)
  }

  async function handleRefresh() {
    setRefreshing(true)
    await loadWidgets().finally(() => setRefreshing(false))
  }

  // ── DnD ────────────────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    setWidgets((prev) => {
      const oldIdx = prev.findIndex((w) => w.id === active.id)
      const newIdx = prev.findIndex((w) => w.id === over.id)
      const next = arrayMove(prev, oldIdx, newIdx)
      savePrefs(next)
      return next
    })
  }

  function handleDragCancel() {
    setActiveId(null)
  }

  const activeWidget = activeId ? widgets.find((w) => w.id === activeId) : null

  function handleResize(id: string, span: ColSpan) {
    setWidgets((prev) => {
      const next = prev.map((w) => w.id === id ? { ...w, colSpan: span } : w)
      savePrefs(next)
      return next
    })
  }

  // ── Render widget content ──────────────────────────────────────────────────

  function renderContent(w: DashboardWidget, colSpan: ColSpan = 1) {
    switch (w.type) {
      case 'links':
        return (
          <QuickActionsCard
            actions={w.actions ?? []}
            workspaceId={params.workspaceId!}
            icon={(w as any).icon}
            colSpan={colSpan}
          />
        )
      case 'content-overview':
        return w.data ? (
          <ContentOverviewCard
            title={w.title}
            data={w.data}
            workspaceId={params.workspaceId!}
            icon={(w as any).icon}
            colSpan={colSpan}
          />
        ) : null
      case 'activity':
        return (
          <ActivityFeedCard
            title={w.title}
            items={w.items ?? []}
            workspaceId={params.workspaceId!}
            icon={(w as any).icon}
            colSpan={colSpan}
          />
        )
      case 'stat-group':
        return <StatGroupCard title={w.title} description={w.description} stats={w.stats ?? []} icon={(w as any).icon} workspaceId={params.workspaceId!} />
      case 'stat':
        return <StatCard widget={w} workspaceId={params.workspaceId!} />
      case 'table':
        return <TableCard widget={w} />
      case 'extension':
        if (w.restricted) return <NoRightsCard widget={w} />
        return w.dataPath ? (
          <ExtensionWidgetCard
            id={w.id}
            title={w.title}
            description={w.description}
            widgetType={(w as any).widgetType ?? 'stat'}
            dataPath={w.dataPath}
            workspaceId={params.workspaceId!}
            icon={(w as any).icon}
            href={(w as any).href}
          />
        ) : null
      default:
        return null
    }
  }

  // ── Page chrome — title/description/actions live in the header bar ─────────
  usePageHeader({
    title: 'Dashboard',
    icon: <IconHome className="size-4" />,
    description: `${roleMeta(bootstrapFlags.deploymentRole).label} deployment`,
    actions: (
      <>
        <Button size="xs" variant="secondary" onClick={handleRefresh} disabled={loading || refreshing} title="Refresh dashboard">
          <IconRefresh className={clsx(refreshing && 'animate-spin')} aria-hidden />
          Refresh
        </Button>
        <Button
          size="xs"
          variant="secondary"
          onClick={() => setEditMode((e) => !e)}
          title={editMode ? 'Done editing layout' : 'Edit widget layout'}
          className={clsx(editMode && 'border-accent/30 bg-accent-muted text-accent-fg hover:bg-accent-muted')}
        >
          {editMode
            ? <><IconCheck aria-hidden /> Done</>
            : <><IconEdit aria-hidden /> Edit layout</>
          }
        </Button>
      </>
    ),
  }, [loading, refreshing, editMode])

  // ── Layout ─────────────────────────────────────────────────────────────────

  return (
    <div className="overflow-y-auto flex-1">
      {loading ? (
        <DashboardSkeleton />
      ) : error ? (
        <div className="px-6 pt-5 pb-6">
          <Callout variant="danger">{error}</Callout>
        </div>
      ) : widgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm text-fg-subtle">No dashboard data available.</p>
        </div>
      ) : (
        <div className="px-6 pt-5 pb-6">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={widgets.map((w) => w.id)}
              strategy={rectSortingStrategy}
            >
              {/* Bento grid: dense flow backfills holes, fixed row rhythm lets
                  tall widgets span rows instead of stretching their neighbors */}
              <div className="grid grid-cols-3 gap-4 grid-flow-dense auto-rows-[minmax(9.5rem,auto)]">
                {widgets.map((w) => {
                  const content = renderContent(w, w.colSpan)
                  if (!content) return null
                  return (
                    <WidgetShell
                      key={w.id}
                      id={w.id}
                      colSpan={w.colSpan}
                      rowSpan={w.rowSpan}
                      editMode={editMode}
                      onResize={handleResize}
                    >
                      {content}
                    </WidgetShell>
                  )
                })}
              </div>
            </SortableContext>

            <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
              {activeWidget ? (
                <WidgetDragOverlay colSpan={activeWidget.colSpan}>
                  {renderContent(activeWidget, activeWidget.colSpan)}
                </WidgetDragOverlay>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}
    </div>
  )
}
