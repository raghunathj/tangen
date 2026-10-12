import { useNavigate } from 'react-router-dom'
import { formatStatValue } from '@/lib/dashboard'
import { DynamicIcon } from '@/components/dynamic-icon'
import { WidgetCard } from '@/components/dashboard/widget-card'

interface Stat {
  label: string
  value: number
  unit?: string
  /** Colors the value: success (green) / danger (red) / warning (amber). */
  tone?: 'success' | 'danger' | 'warning' | 'neutral'
  /** Admin-relative deep link (workspace/env prefix added on click). */
  href?: string
}

interface Props {
  title: string
  description?: string
  stats: Stat[]
  icon?: string | { src: string }
  workspaceId?: string
}

const TONE_CLS: Record<NonNullable<Stat['tone']>, string> = {
  success: 'text-success-fg',
  danger: 'text-danger-fg',
  warning: 'text-warning-fg',
  neutral: 'text-fg',
}

export function StatGroupCard({ title, description, stats, icon, workspaceId}: Props) {
  const navigate = useNavigate()
  const go = (to: string) => {
    if (/^https?:\/\//.test(to)) { window.open(to, '_blank', 'noopener'); return }
    if (workspaceId) navigate(`/${workspaceId}${to.startsWith('/') ? to : `/${to}`}`)
  }
  return (
    <WidgetCard
      icon={icon ? <DynamicIcon name={icon} /> : undefined}
      title={title}
      description={description}
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {stats.map((s) => {
          const linkable = Boolean(s.href && workspaceId)
          return (
            <div
              key={s.label}
              className={linkable ? 'cursor-pointer group/stat' : undefined}
              onClick={linkable ? () => go(s.href!) : undefined}
              role={linkable ? 'link' : undefined}
            >
              <dt className={`text-ui-xs text-fg-muted ${linkable ? 'group-hover/stat:text-accent-fg group-hover/stat:underline' : ''}`}>{s.label}</dt>
              <dd className={`mt-0.5 text-lg font-semibold tracking-tight tabular-nums ${TONE_CLS[s.tone ?? 'neutral']}`}>
                {formatStatValue(s.value, s.unit)}
              </dd>
            </div>
          )
        })}
      </dl>
    </WidgetCard>
  )
}
