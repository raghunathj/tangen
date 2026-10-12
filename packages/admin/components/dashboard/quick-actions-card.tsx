import { Link } from 'react-router-dom'
import { DynamicIcon } from '@/components/dynamic-icon'
import { IconPlus, IconExternalLink } from '@tangen/icons'
import { clsx } from 'clsx'
import type { ColSpan } from '@/lib/dashboard-prefs'
import { WidgetCard } from '@/components/dashboard/widget-card'

function ActionIcon({ name, className }: { name?: string; className?: string }) {
  if (name) return <DynamicIcon name={name} className={className} />
  return <IconPlus className={className} />
}

function isAbsolute(href: string) {
  return /^https?:\/\//.test(href)
}

interface QuickAction {
  label: string
  href: string
  icon?: string
  external?: boolean
}

interface Props {
  actions: QuickAction[]
  workspaceId: string
  icon?: string | { src: string }
  colSpan?: ColSpan
}

const BUTTON_CLASS = clsx(
  'flex items-center gap-2 rounded-lg border border-border px-3 py-2',
  'text-fg hover:border-accent/30 hover:bg-accent-muted hover:text-accent-fg',
  'transition-colors',
)

const GRID_COLS: Record<ColSpan, string> = {
  1: 'grid-cols-2',
  2: 'grid-cols-3',
  3: 'grid-cols-4',
}

export function QuickActionsCard({ actions, workspaceId, icon, colSpan = 1 }: Props) {
  return (
    <WidgetCard icon={icon ? <DynamicIcon name={icon} /> : undefined} title="Quick actions">
      <div className={clsx('grid gap-2', GRID_COLS[colSpan])}>
        {actions.map((action) => {
          const abs = isAbsolute(action.href)
          const opensNewTab = abs || action.external

          if (opensNewTab) {
            return (
              <a
                key={action.href}
                href={action.href}
                target="_blank"
                rel="noopener noreferrer"
                className={BUTTON_CLASS}
              >
                <ActionIcon name={action.icon} className="size-3.5 shrink-0" />
                <span className="flex-1 truncate text-xs font-medium">{action.label}</span>
                <IconExternalLink className="size-3 shrink-0 opacity-40" />
              </a>
            )
          }

          return (
            <Link
              key={action.href}
              to={`/${workspaceId}${action.href}`}
              className={BUTTON_CLASS}
            >
              <ActionIcon name={action.icon} className="size-3.5 shrink-0" />
              <span className="truncate text-xs font-medium">{action.label}</span>
            </Link>
          )
        })}
      </div>
    </WidgetCard>
  )
}
