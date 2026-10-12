import { AdminPage, Card } from '@/kit'
import { useSinkCrumbs } from './example'

/**
 * The gated page. Its manifest entry carries
 * access: { roles: ['owner', 'admin'] } — so this page AND its "Sink Admin"
 * sidebar entry only exist for owners/admins. Other roles get the
 * No-permission state if they hit the URL directly.
 *
 * If you can read this in the browser, the gate let you through.
 */
export function SinkAdminOnlyPage() {
  return (
    <AdminPage
      breadcrumbs={useSinkCrumbs('Sink Admin')}
      description="You can see this because your role passed the manifest access rule"
    >
      <div className="max-w-3xl">
        <Card title="Role-gated page">
          <div className="space-y-2 text-sm text-fg-muted">
            <p>This page is declared with:</p>
            <pre className="rounded-lg bg-surface-inverted text-surface text-xs p-4 overflow-x-auto">{`pages: [{
  path: 'admin',
  component: 'SinkAdminOnlyPage',
  nav: { label: 'Sink Admin', icon: 'IconShieldCheck', order: 20 },
  access: { roles: ['owner', 'admin'] },
}]`}</pre>
            <p>
              Sign in as an editor or viewer: the sidebar entry disappears and the URL renders
              the No-permission state. The same rule shape accepts{' '}
              <code className="font-mono text-xs bg-accent-muted text-accent-fg px-1 py-0.5 rounded">capability</code>{' '}
              instead of roles.
            </p>
          </div>
        </Card>
      </div>
    </AdminPage>
  )
}
