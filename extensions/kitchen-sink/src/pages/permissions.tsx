import { AdminPage, Card, IfCan, useCan } from '@/kit'
import { useParams } from 'react-router-dom'
import { Example, ExampleStack, useSinkCrumbs } from './example'

/** Permissions — every gate, live: role checks respond to who YOU are. */
export function SinkPermissionsPage() {
  const { me, ready } = useCan()

  return (
    <AdminPage breadcrumbs={useSinkCrumbs('Permissions')}>
      <ExampleStack>

        <Example
          title="IfCan - inline role gate"
          description="Children for allowed roles, fallback for everyone else. What renders below depends on YOUR role."
          code={`import { IfCan } from '@/kit'

<IfCan roles={['owner', 'admin', 'editor']} fallback={<ReadOnlyNotice />}>
  <ManagementControls />
</IfCan>`}
        >
          <IfCan
            roles={['owner', 'admin', 'editor']}
            fallback={<p className="text-sm text-fg-muted">You see the read-only fallback - your role is not owner/admin/editor.</p>}
          >
            <p className="text-sm text-success-fg bg-success-muted border border-success/40 rounded-md px-3 py-2">
              You see the management branch - your role is owner, admin, or editor.
            </p>
          </IfCan>
        </Example>

        <Example
          title="Page-level access"
          description="Gate the whole page (and its nav item) - AdminPage for in-page, manifest access for extension pages"
          code={`// Custom screen:
<AdminPage title="Billing" access={{ roles: ['owner', 'admin'] }}>

// Extension page (also removes the sidebar entry for other roles):
pages: [{ path: 'admin', component: 'AdminOnlyPage',
  nav: { label: 'Sink Admin' }, access: { roles: ['owner', 'admin'] } }]`}
        >
          <p className="text-sm text-fg-muted">
            The “Sink Admin” sidebar entry is gated exactly this way - visible to owners and
            admins, gone (page AND nav) for everyone else. Capabilities work too:{' '}
            <code className="font-mono text-xs bg-accent-muted text-accent-fg px-1 py-0.5 rounded">{`access={{ capability: 'members.manage' }}`}</code>.
          </p>
        </Example>

        <Example
          title="useCan - programmatic checks"
          description="For logic that isn't a render branch: disabling controls, building menus"
          code={`import { useCan } from '@/kit'

const { me, ready, can, hasCapability, canUseExtension } = useCan()
can('write', 'objects')            // action on a resource
hasCapability('members.manage')    // capability check
canUseExtension('kitchen-sink')    // extension allow-list`}
        >
          <Card>
            <p className="text-sm text-fg-muted">
              Your session resolves to role{' '}
              <code className="font-mono text-xs bg-accent-muted text-accent-fg px-1 py-0.5 rounded">
                {ready ? (me?.role ?? 'unknown') : 'loading…'}
              </code>
              . The UI fails open while loading - the server always enforces on its side.
            </p>
          </Card>
        </Example>

      </ExampleStack>
    </AdminPage>
  )
}
