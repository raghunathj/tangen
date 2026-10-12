import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import type { ColSpan } from '@/lib/dashboard-prefs'
import { DynamicIcon } from '@/components/dynamic-icon'
import { WidgetCard } from '@/components/dashboard/widget-card'

interface TypeSummary {
  name: string
  label: string
  counts: Record<string, number>
  total: number
}

interface ContentTotals {
  total: number
  published: number
  draft: number
  scheduled: number
  archived: number
}

interface ContentOverviewData {
  types: TypeSummary[]
  totals: ContentTotals
}

interface Props {
  title: string
  data: ContentOverviewData
  workspaceId: string
  colSpan?: ColSpan
  icon?: string | { src: string }
}

const STATUS_COLOR: Record<string, string> = {
  published: 'bg-success-muted text-success-fg',
  draft:     'bg-surface-hover text-fg-muted',
  scheduled: 'bg-info-muted text-info-fg',
  archived:  'bg-warning-muted text-warning-fg',
}

function StatusPill({ status, count }: { status: string; count: number }) {
  if (!count) return null
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLOR[status] ?? 'bg-surface-hover text-fg-muted')}>
      {count} {status}
    </span>
  )
}

export function ContentOverviewCard({ title, data, workspaceId, icon, colSpan = 1 }: Props) {
  const compact = colSpan === 1
  if (data.types.length === 0) {
    return (
      <WidgetCard icon={icon ? <DynamicIcon name={icon} /> : undefined} title={title}>
        <p className="text-ui-sm text-fg-subtle">No content types defined yet.</p>
      </WidgetCard>
    )
  }

  return (
    <WidgetCard
      flush
      icon={icon ? <DynamicIcon name={icon} /> : undefined}
      title={title}
      action={(
        <div className="flex items-center gap-3 text-ui-xs text-fg-muted">
          <span><span className="font-semibold text-fg tabular-nums">{data.totals.total.toLocaleString()}</span> total</span>
          {data.totals.published > 0 && (
            <span className="text-success-fg"><span className="font-semibold tabular-nums">{data.totals.published.toLocaleString()}</span> published</span>
          )}
        </div>
      )}
    >
      <div className="divide-y divide-border-subtle border-t border-border-subtle">
        {data.types.map((t) => (
          <Link
            key={t.name}
            to={`/${workspaceId}/objects/${t.name}`}
            className="flex items-center gap-3 px-4 py-2.5 transition-colors motion-fast hover:bg-surface-hover"
          >
            <span className="flex-1 text-sm font-medium text-fg">{t.label}</span>
            <span className="text-sm tabular-nums text-fg-muted">{t.total.toLocaleString()}</span>
            {!compact && (
              <div className="flex items-center gap-1.5 ml-2">
                {['published', 'draft', 'scheduled', 'archived'].map((s) =>
                  t.counts[s] ? <StatusPill key={s} status={s} count={t.counts[s]} /> : null
                )}
              </div>
            )}
          </Link>
        ))}
      </div>
    </WidgetCard>
  )
}
