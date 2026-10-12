import { Link, useParams } from 'react-router-dom'
import { AdminPage, Card, Button, Text, Callout, useTheme, THEME_MODES, THEME_LABELS } from '@/kit'
import * as Icons from '@tangen/icons'

/**
 * The extension's root page (manifest path: '') — the category index.
 * Extension pages are plain React components built on the Admin Kit
 * (`@/kit`), exactly like site-developer pages.
 */

const CATEGORIES: Array<{ path: string; label: string; blurb: string; icon: keyof typeof Icons }> = [
  { path: 'lightfield', label: 'Lightfield', blurb: 'The design system: principles and the story - read first', icon: 'IconSparkles' },
  { path: 'typography', label: 'Typography', blurb: 'Headings, body, code, reading widths', icon: 'IconFileText' },
  { path: 'buttons', label: 'Buttons', blurb: 'Variants, sizes, icons pre/post, loading, confirm', icon: 'IconCheck' },
  { path: 'cards', label: 'Cards', blurb: 'Surfaces, metric cards, empty/error/loading states', icon: 'IconCopy' },
  { path: 'headers', label: 'Headers', blurb: 'Titles, breadcrumbs, actions, tabs - live', icon: 'IconChevronDown' },
  { path: 'navigation', label: 'Sidebars & nav', blurb: 'Manifest nav entries, tab bars, accordions', icon: 'IconFileList' },
  { path: 'lists', label: 'Lists', blurb: 'DataList over the DataSource contract, all adapters', icon: 'IconSearch' },
  { path: 'forms', label: 'Forms', blurb: 'Form shells, inputs, validation states, pickers', icon: 'IconEdit' },
  { path: 'feedback', label: 'Feedback', blurb: 'Toasts, callouts, confirmations, loading states', icon: 'IconInfo' },
  { path: 'images', label: 'Images & media', blurb: 'Aspect ratios, media grids, MediaPicker', icon: 'IconImage' },
  { path: 'layout', label: 'Layout', blurb: 'Dividers, spacing scale, grid recipes', icon: 'IconSettings' },
  { path: 'permissions', label: 'Permissions', blurb: 'IfCan, page access rules, useCan - live for your role', icon: 'IconLock' },
  { path: 'extending', label: 'Extending Tangen', blurb: 'Field type, editor panel, dashboard widget - copyable code', icon: 'IconEdit' },
]

/** The theme preference, through the same store the account menu uses (UI V2
 *  spec §4): light, dark or system, persisted, no flash on reload. */
function ThemePreview() {
  const mode = useTheme((t) => t.mode)
  const setMode = useTheme((t) => t.setMode)
  return (
    <Callout variant="info" title="Theme" icon={null}>
      <div className="space-y-2">
        <p>
          The whole admin runs on semantic design tokens - a theme is one set of CSS
          variables (<code className="font-mono text-xs">html.dark</code>); no component changes.
          The preference persists and <em>system</em> follows the OS.
        </p>
        <div className="flex gap-1.5">
          {THEME_MODES.map((m) => (
            <Button key={m} size="xs" variant={mode === m ? 'primary' : 'secondary'} onClick={() => setMode(m)} aria-pressed={mode === m}>
              {THEME_LABELS[m]}
            </Button>
          ))}
        </div>
      </div>
    </Callout>
  )
}

export function SinkOverviewPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const base = `/${workspaceId}/extensions/kitchen-sink`

  return (
    <AdminPage
      title="Kitchen Sink"
      description="Lightfield, the Tangen design system, and every extension surface - live, with copyable code"
    >
      <div className="max-w-3xl space-y-8">

        <p className="text-sm text-fg-muted max-w-prose">
          This extension is the reference for Lightfield, the Tangen design system, and for
          every surface an extension can contribute - these pages, content hooks, realtime,
          and install lifecycle. The three surfaces that would change your content (a custom
          field type, an editor panel, a dashboard widget) are documented as copyable code on
          the <span className="font-medium text-fg">Extending Tangen</span> page rather than
          registered live, so installing the Kitchen Sink never adds fields or panels to your
          content. Every example has a code-mode toggle: click the <span className="font-mono text-xs bg-surface-hover px-1 py-0.5 rounded">&lt;/&gt;</span> icon
          to see exactly what to paste.
        </p>

        <ThemePreview />

        <div className="grid grid-cols-2 gap-4">
          {CATEGORIES.map((c) => {
            const Icon = Icons[c.icon] as React.ComponentType<{ className?: string }>
            return (
              <Link key={c.path} to={`${base}/${c.path}`} className="group">
                <Card>
                  <div className="flex items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent-fg">
                      <Icon className="size-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-fg group-hover:text-accent-fg transition-colors">{c.label}</h3>
                      <p className="mt-0.5 text-xs text-fg-subtle">{c.blurb}</p>
                    </div>
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>

      </div>
    </AdminPage>
  )
}
