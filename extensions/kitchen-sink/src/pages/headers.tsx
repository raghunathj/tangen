import { useState } from 'react'
import { AdminPage, Button, Card, toast } from '@/kit'
import { Example, ExampleStack, useSinkCrumbs } from './example'

/**
 * Headers — everything AdminPage can put in the breadcrumb bar. This page
 * itself demos breadcrumbs + actions + tabs live (a page has ONE header, so
 * the variations are shown as code).
 */
export function SinkHeadersPage() {
  const [tab, setTab] = useState('scale')
  return (
    <AdminPage
      breadcrumbs={useSinkCrumbs('Headers')}
      description="This page's own header demos breadcrumbs, actions, and tabs"
      actions={<Button size="sm" variant="secondary" onClick={() => toast.info('Header action clicked')}>Header action</Button>}
      tabs={[{ id: 'scale', label: 'Examples' }, { id: 'notes', label: 'Notes' }]}
      activeTab={tab}
      onTabChange={setTab}
    >
      <ExampleStack>

        {tab === 'scale' ? (
          <>
            <Example
              title="Title + description"
              description="The minimum header - title in the breadcrumb bar, grayed description after it"
              code={`import { AdminPage } from '@/kit'

<AdminPage title="Reports" description="Weekly content performance">
  …
</AdminPage>`}
            >
              <p className="text-sm text-fg-muted">Look at the top of this page - the header bar is driven by AdminPage props, not in-page markup.</p>
            </Example>

            <Example
              title="Breadcrumbs"
              description="Parent trails for sub-pages; each crumb can link"
              code={`<AdminPage breadcrumbs={[
  { label: 'Kitchen Sink', href: \`/\${workspaceId}/extensions/kitchen-sink\` },
  { label: 'Headers' },
]}>`}
            >
              <p className="text-sm text-fg-muted">This page uses exactly that trail - click “Kitchen Sink” above to go back.</p>
            </Example>

            <Example
              title="Header actions"
              description="Right-side CTAs live in the header, not the page body"
              code={`<AdminPage title="Pin codes"
  actions={<Button size="sm">Add Pin Code</Button>}>`}
            >
              <p className="text-sm text-fg-muted">The “Header action” button top-right is wired through this prop.</p>
            </Example>

            <Example
              title="Header tabs"
              description="Tabs render in the header row; drive them with local state or the router"
              code={`const [tab, setTab] = useState('overview')

<AdminPage title="Settings"
  tabs={[{ id: 'overview', label: 'Overview' }, { id: 'advanced', label: 'Advanced' }]}
  activeTab={tab}
  onTabChange={setTab}>`}
            >
              <p className="text-sm text-fg-muted">Switch to the “Notes” tab above - this content area swaps on the same state.</p>
            </Example>
          </>
        ) : (
          <Card title="Notes tab">
            <p className="text-sm text-fg-muted">
              Tab content swapped by <code className="font-mono text-xs bg-accent-muted text-accent-fg px-1 py-0.5 rounded">activeTab</code> -
              the header stays put, only the body changes. For router-driven tabs pass{' '}
              <code className="font-mono text-xs bg-accent-muted text-accent-fg px-1 py-0.5 rounded">href</code> on the tab instead.
            </p>
          </Card>
        )}

      </ExampleStack>
    </AdminPage>
  )
}
