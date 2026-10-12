import { AdminPage, Card } from '@/kit'
import { Example, ExampleStack, useSinkCrumbs } from './example'

/** Dividers, spacers & grids — the layout recipes; Tailwind is the API. */

const Block = ({ label }: { label: string }) => (
  <div className="rounded-md bg-accent-muted border border-accent/30 border-dashed px-3 py-2 text-xs text-accent-fg text-center">
    {label}
  </div>
)

export function SinkLayoutPage() {
  return (
    <AdminPage breadcrumbs={useSinkCrumbs('Layout')}>
      <ExampleStack>

        <Example
          title="Horizontal rules"
          description="Section separation - a border, a labeled divider, or a section gap (no rule at all)"
          code={`<hr className="border-border" />

<div className="flex items-center gap-3">
  <div className="h-px flex-1 bg-border" />
  <span className="text-xs text-fg-subtle uppercase tracking-wide">or</span>
  <div className="h-px flex-1 bg-border" />
</div>`}
        >
          <div className="space-y-6">
            <hr className="border-border" />
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-fg-subtle uppercase tracking-wide">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          </div>
        </Example>

        <Example
          title="Spacing - stacks, not spacers"
          description="Parents own the gaps: space-y-* for vertical stacks, gap-* in flex/grid. No empty spacer divs."
          code={`<div className="space-y-4">        // vertical stack
<div className="flex items-center gap-2">   // inline row
<div className="space-y-8">        // between page sections
// The scale: 1=4px 2=8px 3=12px 4=16px 6=24px 8=32px`}
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Block label="space-y-2 (8px)" />
              <Block label="…" />
              <Block label="…" />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1"><Block label="flex" /></div>
              <div className="flex-1"><Block label="gap-2" /></div>
              <div className="flex-1"><Block label="row" /></div>
            </div>
          </div>
        </Example>

        <Example
          title="Grid recipes"
          description="Equal columns, weighted spans, and the main + rail split"
          code={`<div className="grid grid-cols-3 gap-4">…</div>

<div className="grid grid-cols-3 gap-4">
  <div className="col-span-2">main</div>
  <div>rail</div>
</div>

// Responsive: stack on small screens
<div className="grid grid-cols-1 md:grid-cols-3 gap-4">…</div>`}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <Block label="1/3" /><Block label="1/3" /><Block label="1/3" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2"><Block label="col-span-2 - main content" /></div>
              <Block label="rail" />
            </div>
          </div>
        </Example>

        <Example
          title="Page width & scroll"
          description="AdminPage owns the scroll container; you own the max width"
          code={`<AdminPage title="…">
  <div className="max-w-3xl space-y-8">   // reading pages
  <div className="max-w-5xl …">           // wide tables/dashboards
  // full-bleed lists: <AdminPage flush> + your own padding
</AdminPage>`}
        >
          <Card>
            <p className="text-sm text-fg-muted">
              Every sink page body is <code className="font-mono text-xs bg-accent-muted text-accent-fg px-1 py-0.5 rounded">max-w-3xl</code> -
              resize the window and the header bar stays fixed while only this area scrolls.
            </p>
          </Card>
        </Example>

      </ExampleStack>
    </AdminPage>
  )
}
