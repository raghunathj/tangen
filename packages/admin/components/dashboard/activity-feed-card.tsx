import { Link } from 'react-router-dom'
import { relativeTime } from '@/lib/dashboard'
import { clsx } from 'clsx'
import type { ColSpan } from '@/lib/dashboard-prefs'
import { DynamicIcon } from '@/components/dynamic-icon'
import { WidgetCard } from '@/components/dashboard/widget-card'

interface ActivityItem {
  id: string
  category: string
  action: string
  actorName: string | null
  actorType: string | null
  typeName: string | null
  objectId: string | null
  objectTitle: string | null
  targetLabel: string | null
  createdAt: string
}

interface Props {
  title: string
  items: ActivityItem[]
  workspaceId: string
  colSpan?: ColSpan
  icon?: string | { src: string }
}

const CATEGORY_COLOR: Record<string, string> = {
  content:    'bg-info-muted text-info-fg',
  schema:     'bg-purple-100 text-purple-600',
  members:    'bg-success-muted text-success-fg',
  webhooks:   'bg-orange-100 text-orange-600',
  'api-keys': 'bg-warning-muted text-warning-fg',
  media:      'bg-pink-100 text-pink-600',
}

interface Segment {
  text: string
  href?: string
}

function describeActivity(item: ActivityItem, workspaceId: string): Segment[] {
  const actorName = item.actorName ?? (item.actorType === 'api_key' ? 'API key' : item.actorType === 'extension' ? 'An extension' : 'System')
  // K8.5: an extension that acted is named and marked so the reader knows a plugin, not a person, did it.
  const actor: Segment = { text: item.actorType === 'extension' ? `${actorName} (extension)` : actorName }
  const { category, action } = item

  if (category === 'content') {
    const objectHref = item.objectId && item.typeName
      ? `/${workspaceId}/objects/${item.typeName}/${item.objectId}`
      : undefined
    const titleText = item.objectTitle || (item.typeName ?? 'entry')
    return [
      actor,
      { text: ` ${action} ` },
      { text: titleText, href: objectHref },
    ]
  }

  if (category === 'schema') return [actor, { text: ' pushed a schema update' }]

  if (category === 'members' && action === 'invited') {
    return [actor, { text: ' invited ' }, { text: item.targetLabel ?? 'a member' }]
  }

  if (category === 'api-keys') {
    const label = item.targetLabel ? ` "${item.targetLabel}"` : ''
    return action === 'created'
      ? [actor, { text: ` created API key${label}` }]
      : [actor, { text: ' revoked an API key' }]
  }

  if (category === 'webhooks') {
    const label = item.targetLabel ? ` "${item.targetLabel}"` : ''
    if (action === 'created') return [actor, { text: ` created webhook${label}` }]
    if (action === 'updated') return [actor, { text: ` updated webhook${label}` }]
    return [actor, { text: ' deleted a webhook' }]
  }

  if (category === 'flows') {
    const label = item.targetLabel ? ` "${item.targetLabel}"` : ' a flow'
    return [actor, { text: ` ${action} flow${label}` }]
  }

  if (category === 'media') {
    return action === 'uploaded'
      ? [actor, { text: ' uploaded ' }, { text: item.targetLabel ?? 'a file' }]
      : [actor, { text: ' deleted a file' }]
  }

  return [actor, { text: ` ${action}` }]
}

export function ActivityFeedCard({ title, items, workspaceId, icon, colSpan = 1 }: Props) {
  const showTimestamp = colSpan > 1
  return (
    <WidgetCard flush icon={icon ? <DynamicIcon name={icon} /> : undefined} title={title}>
      {items.length === 0 ? (
        <div className="px-4 pb-4">
          <p className="text-ui-sm text-fg-subtle">No recent activity.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle border-t border-border-subtle">
          {items.map((item) => {
            const segments = describeActivity(item, workspaceId)
            return (
              <li key={item.id} className="flex items-start gap-3 px-4 py-2.5">
                <span className={clsx(
                  'mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                  CATEGORY_COLOR[item.category] ?? 'bg-surface-hover text-fg-muted',
                )}>
                  {item.category === 'api-keys' ? 'keys' : item.category}
                </span>
                <span className="flex-1 text-sm text-fg leading-snug">
                  {segments.map((seg, i) =>
                    seg.href ? (
                      <Link
                        key={i}
                        to={seg.href}
                        className="font-medium text-accent-fg hover:text-accent-fg hover:underline"
                      >
                        {seg.text}
                      </Link>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    )
                  )}
                </span>
                {showTimestamp && (
                  <time className="text-xs text-fg-subtle shrink-0 mt-0.5 tabular-nums" dateTime={item.createdAt}>
                    {relativeTime(item.createdAt)}
                  </time>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </WidgetCard>
  )
}
