import { useState } from 'react'
import { AdminPage, TabBar, AccordionSection, ActionPill } from '@/kit'
import { Example, ExampleStack, useSinkCrumbs } from './example'

/** Sidebars & navigation — manifest nav entries and in-page nav patterns. */
export function SinkNavigationPage() {
  const [tab, setTab] = useState<'one' | 'two'>('one')
  const [open, setOpen] = useState(true)
  const [pill, setPill] = useState(true)

  return (
    <AdminPage breadcrumbs={useSinkCrumbs('Sidebars & nav')}>
      <ExampleStack>

        <Example
          title="Sidebar nav entries (manifest)"
          description="Pages with `nav` land in the Extensions section; declaring any nav replaces your automatic app entry"
          code={`// tangen.extension.ts
pages: [
  { path: '', component: 'OverviewPage',
    nav: { label: 'Kitchen Sink', icon: 'IconSparkles', order: 10 } },
  { path: 'admin', component: 'AdminOnlyPage',
    nav: { label: 'Sink Admin', order: 20 },
    access: { roles: ['owner', 'admin'] } },   // hidden from other roles
  { path: 'records/:id', component: 'RecordPage' },   // route only, no nav
]`}
        >
          <p className="text-sm text-fg-muted">
            The “Kitchen Sink” and “Sink Admin” entries in the left sidebar come from exactly this
            manifest block. Log in as a viewer and “Sink Admin” disappears - the access rule gates
            both the page and its nav item.
          </p>
        </Example>

        <Example
          title="TabBar - underline & pills"
          description="Two styles, same props: underline for page sections, pills (segmented) for view switches"
          code={`import { TabBar } from '@/kit'

const [tab, setTab] = useState<'one' | 'two'>('one')
<TabBar active={tab} onChange={setTab}
  tabs={[{ id: 'one', label: 'First' }, { id: 'two', label: 'Second', badge: 3 }]} />

<TabBar variant="pills" active={tab} onChange={setTab}
  tabs={[{ id: 'one', label: 'Grid' }, { id: 'two', label: 'List' }]} />`}
        >
          <TabBar active={tab} onChange={setTab} tabs={[{ id: 'one', label: 'First' }, { id: 'two', label: 'Second', badge: 3 }]} />
          <TabBar variant="pills" active={tab} onChange={setTab} tabs={[{ id: 'one', label: 'Grid' }, { id: 'two', label: 'List' }]} />
          <p className="text-sm text-fg-muted -mt-4">Active: {tab}</p>
        </Example>

        <Example
          title="AccordionSection"
          description="Controlled disclosure rows - settings groups, permission matrices"
          code={`<AccordionSection id="grants" label="Content permissions" summary="read, write"
  open={open} onToggle={() => setOpen(!open)}>
  …
</AccordionSection>`}
        >
          <AccordionSection id="grants" label="Content permissions" summary={open ? 'read, write' : '0 selected'} open={open} onToggle={() => setOpen(!open)}>
            <div className="flex gap-2 py-2">
              <ActionPill action="read" checked={pill} onChange={() => setPill(!pill)} />
              <ActionPill action="write" checked={!pill} onChange={() => setPill(!pill)} />
            </div>
          </AccordionSection>
        </Example>

      </ExampleStack>
    </AdminPage>
  )
}
