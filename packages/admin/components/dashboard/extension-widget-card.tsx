import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminFetch } from '@/lib/api'
import { formatStatValue } from '@/lib/dashboard'
import { DynamicIcon } from '@/components/dynamic-icon'
import { WidgetCard } from '@/components/dashboard/widget-card'

interface StatEntry {
  label: string
  value: number
  unit?: string
  /** Colors the value: success (green) / danger (red) / warning (amber). */
  tone?: 'success' | 'danger' | 'warning' | 'neutral'
  /** Admin-relative deep link (e.g. '/extensions/flows?tab=runs&status=error'). */
  href?: string
}

interface ExtensionWidgetData {
  value?: number
  unit?: string
  tone?: StatEntry['tone']
  stats?: StatEntry[]
  rows?: Record<string, unknown>[]
  columns?: Array<{ key: string; label: string }>
  [key: string]: unknown
}

interface Props {
  id: string
  title: string
  description?: string
  widgetType: 'stat' | 'stat-group' | 'table'
  dataPath: string
  workspaceId: string
  /** An @tangen/icons name or { src } image, shown before the title. */
  icon?: string | { src: string }
  /** Admin-relative deep link for the whole card. */
  href?: string
}

const TONE_CLS: Record<NonNullable<StatEntry['tone']>, string> = {
  success: 'text-success-fg',
  danger: 'text-danger-fg',
  warning: 'text-warning-fg',
  neutral: 'text-fg',
}

export function ExtensionWidgetCard({ id, title, description, widgetType, dataPath, workspaceId, icon, href }: Props) {
  const navigate = useNavigate()
  const [data, setData] = useState<ExtensionWidgetData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    adminFetch<ExtensionWidgetData>(dataPath)
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [dataPath])

  // Admin-relative link → prefixed with the current workspace/env.
  const go = (to: string) => {
    if (/^https?:\/\//.test(to)) { window.open(to, '_blank', 'noopener'); return }
    navigate(`/${workspaceId}${to.startsWith('/') ? to : `/${to}`}`)
  }

  return (
    <WidgetCard
      icon={icon ? <DynamicIcon name={icon} /> : undefined}
      title={title}
      description={description}
      onOpen={href ? () => go(href) : undefined}
    >
      {loading && (
        <div className="space-y-2">
          <div className="h-7 w-24 animate-pulse rounded bg-surface-hover" />
        </div>
      )}

      {error && (
        <p className="text-ui-xs text-danger-fg">Failed to load widget data.</p>
      )}

      {!loading && !error && data && widgetType === 'stat' && data.value != null && (
        <p className={`text-3xl font-semibold tracking-tight tabular-nums ${TONE_CLS[data.tone ?? 'neutral']}`}>
          {formatStatValue(data.value, data.unit)}
        </p>
      )}

      {!loading && !error && data && widgetType === 'stat-group' && data.stats && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {data.stats.map((s) => (
            <div
              key={s.label}
              className={s.href ? 'cursor-pointer group/stat' : undefined}
              onClick={s.href ? (e) => { e.stopPropagation(); go(s.href!) } : undefined}
              role={s.href ? 'link' : undefined}
            >
              <dt className={`text-ui-xs text-fg-muted ${s.href ? 'group-hover/stat:text-accent-fg group-hover/stat:underline' : ''}`}>{s.label}</dt>
              <dd className={`mt-0.5 text-lg font-semibold tracking-tight tabular-nums ${TONE_CLS[s.tone ?? 'neutral']}`}>
                {formatStatValue(s.value, s.unit)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {!loading && !error && data && widgetType === 'table' && data.rows && data.columns && (
        <div className="overflow-hidden rounded-lg border border-border-subtle">
          <table className="w-full text-ui-xs">
            <thead className="bg-surface-sunken">
              <tr>
                {data.columns.map((col) => (
                  <th key={col.key} className="px-3 py-2 text-left font-medium text-fg-muted">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {data.rows.map((row, i) => (
                <tr key={i} className="transition-colors motion-fast hover:bg-surface-hover">
                  {data.columns!.map((col) => (
                    <td key={col.key} className="px-3 py-2 text-fg">
                      {String(row[col.key] ?? '-')}
                    </td>
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
