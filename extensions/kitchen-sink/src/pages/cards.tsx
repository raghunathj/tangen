import { AdminPage, Card, Badge, Button, EmptyState, ErrorState, Skeleton, Spinner, Metabox, toast } from '@/kit'
import { IconImage } from '@tangen/icons'
import { Example, ExampleStack, useSinkCrumbs } from './example'

/** Cards — surfaces, metric patterns, and the empty/error/loading states. */
export function SinkCardsPage() {
  return (
    <AdminPage breadcrumbs={useSinkCrumbs('Cards')}>
      <ExampleStack>

        <Example
          title="Card"
          description="The standard surface - title, description, a right-side action, or flush for lists"
          code={`import { Card, Badge } from '@/kit'

<Card title="Recent activity" description="Last 7 days" action={<Badge variant="neutral">live</Badge>}>
  …content…
</Card>
<Card flush>…edge-to-edge content (tables, lists)…</Card>`}
        >
          <div className="grid grid-cols-2 gap-4">
            <Card title="Recent activity" description="Last 7 days" action={<Badge variant="neutral">live</Badge>}>
              <p className="text-sm text-fg-muted">Body content with the default padding.</p>
            </Card>
            <Card flush>
              <div className="divide-y divide-border">
                {['First row', 'Second row', 'Third row'].map((r) => (
                  <div key={r} className="px-4 py-2.5 text-sm text-fg-muted">{r}</div>
                ))}
              </div>
            </Card>
          </div>
        </Example>

        <Example
          title="Metric card"
          description="Label + big tabular number - the dashboard stat pattern"
          code={`<Card>
  <div className="flex flex-col gap-2">
    <span className="text-sm font-medium text-fg-muted">Total Pin Codes</span>
    <span className="text-3xl font-semibold text-fg tabular-nums">19,101</span>
  </div>
</Card>`}
        >
          <div className="grid grid-cols-2 gap-4">
            {[['Total Pin Codes', '19,101'], ['Total Cities', '4,224']].map(([label, value]) => (
              <Card key={label}>
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-fg-muted">{label}</span>
                  <span className="text-3xl font-semibold text-fg tabular-nums">{value}</span>
                </div>
              </Card>
            ))}
          </div>
        </Example>

        <Example
          title="Metabox"
          description="Collapsible sidebar-style box - the object editor's right-rail surface"
          code={`import { Metabox } from '@/kit'

<Metabox title="Publishing" badge="draft">…</Metabox>`}
        >
          <div className="max-w-xs">
            <Metabox title="Publishing" badge="draft">
              <p className="text-sm text-fg-muted p-1">Metabox body content.</p>
            </Metabox>
          </div>
        </Example>

        <Example
          title="Empty, error & loading states"
          description="Never leave a blank region - one of these three always renders"
          code={`<EmptyState icon={<IconImage />} title="No assets yet"
  description="Upload your first file to get going."
  action={<Button size="sm">Upload</Button>} />

<ErrorState message="The upstream API returned 503" retry={refetch} />

<Skeleton variant="rows" rows={3} />
<Spinner size="sm" label="Syncing…" />`}
        >
          <div className="grid grid-cols-2 gap-4">
            <Card flush>
              <EmptyState
                icon={<IconImage />}
                title="No assets yet"
                description="Upload your first file to get going."
                action={<Button size="sm" onClick={() => toast.info('Upload clicked')}>Upload</Button>}
              />
            </Card>
            <div className="space-y-4">
              <ErrorState message="The upstream API returned 503" retry={() => toast.info('Retrying…')} />
              <Card title="Loading">
                <Skeleton variant="rows" rows={2} />
                <div className="mt-3"><Spinner size="sm" label="Syncing…" /></div>
              </Card>
            </div>
          </div>
        </Example>

      </ExampleStack>
    </AdminPage>
  )
}
