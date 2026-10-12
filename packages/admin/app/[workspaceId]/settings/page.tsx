/**
 * File Name: page.tsx (settings overview)
 * Purpose: The Settings landing: every page the member may open, under the
 *          same captions the settings tree draws (User, Workspace, Other).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { Link, useParams } from 'react-router-dom'
import { DynamicIcon } from '@/components/dynamic-icon'
import { buildSettingsNavItems, filterSettingsNavItems, groupSettingsNavItems, type SettingsNavItem } from '@/lib/settings-nav'
import { useCan } from '@/lib/use-can'
import { useNavConfig } from '@/lib/use-nav-config'
import { useSignOut } from '@/lib/use-sign-out'
import { usePageHeader } from '@/lib/page-header'

const DESCRIPTIONS: Record<string, string> = {
  'profile': 'Your name, avatar and password.',
  'preferences': 'Theme and scrollbars, saved in this browser.',
  'workspace': 'Name, locales, domains and workspace-level configuration.',
  'members': 'The humans running this workspace, their roles and permissions.',
  'api-keys': 'Keys your sites and apps use to read and write content.',
  'webhooks': 'Notify external services when content changes.',
  'search': 'Synonyms, recommendations and analytics for search.',
  'jobs': 'Scheduled jobs, cron entries and background task runs.',
  'cache': 'Schema and content cache state, with manual purge.',
  'ai': 'Providers and models, content generation, knowledge base and Q&A.',
  'config': 'The resolved configuration of this environment, with where each value came from.',
  'extensions': 'What each installed extension lets you configure: its settings, with secrets sealed.',
  'support': 'Where to ask when something is not right.',
  'docs': 'How this workspace and its content work.',
  'sign-out': 'End this session on this device.',
}

const CARD = 'group rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-accent'

function CardBody({ item }: { item: SettingsNavItem }) {
  return (
    <>
      <div className="mb-1.5 flex items-center gap-2.5">
        <DynamicIcon name={item.icon} className="size-4 text-fg-subtle transition-colors group-hover:text-accent-fg" aria-hidden />
        <span className="text-sm font-medium text-fg">{item.label}</span>
      </div>
      <p className="text-xs leading-relaxed text-fg-subtle">{DESCRIPTIONS[item.id] ?? ''}</p>
    </>
  )
}

export default function SettingsOverviewPage() {
  const params = useParams<{ workspaceId: string }>()
  const { hasCapability, me } = useCan()
  const { links } = useNavConfig()
  const signOut = useSignOut()
  const groups = groupSettingsNavItems(filterSettingsNavItems(
    buildSettingsNavItems(params.workspaceId!, { links }),
    (cap) => hasCapability(cap as never),
    me?.effectiveRole ?? me?.role,
  ))

  usePageHeader({ title: 'Settings', description: 'You, and everything that configures this workspace.' })

  return (
    <div className="flex-1 space-y-8 overflow-y-auto p-6">
      {groups.map(({ group, items }) => (
        <section key={group} aria-labelledby={`settings-group-${group}`}>
          <h2 id={`settings-group-${group}`} className="mb-3 text-ui-sm font-medium text-fg-subtle">{group}</h2>
          <div className="grid max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => {
              if (item.action === 'sign-out') {
                return <button key={item.id} type="button" onClick={() => { void signOut() }} className={CARD}><CardBody item={item} /></button>
              }
              if (item.external) {
                return <a key={item.id} href={item.href} target="_blank" rel="noreferrer" className={CARD}><CardBody item={item} /></a>
              }
              return <Link key={item.id} to={item.href} className={CARD}><CardBody item={item} /></Link>
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
