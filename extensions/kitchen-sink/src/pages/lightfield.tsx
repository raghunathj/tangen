import { AdminPage, Heading, Text, Callout, Divider, Card } from '@/kit'
import { useSinkCrumbs } from './example'

/**
 * Lightfield — the introduction and the story. The first page a developer
 * should read: what the design system is, the rules that hold it together,
 * and why it exists. Everything else in the Kitchen Sink is a demonstration
 * of these ideas.
 */

const PRINCIPLES: Array<{ title: string; body: string }> = [
  {
    title: 'Tokens, never literals',
    body:
      'Every colour, space and radius is a semantic token - text-fg-muted, bg-surface, border-border. Nothing hardcodes a gray. A palette change, a font swap or dark mode is one set of CSS variables and touches no markup.',
  },
  {
    title: 'One component per job',
    body:
      'There is one Button, one Input, one Menu, one Sheet. Variants and sizes are props, not new components. When a surface needs a control the kit already has, you reach for the same one every other screen uses.',
  },
  {
    title: 'An elevation ladder',
    body:
      'Depth is a fixed ladder - a subtle grey page, white raised cards and inputs, grey sunken wells, then popovers, sheets and dialogs stacked by a single z-index scale. Layers never fight because the ladder decides the order.',
  },
  {
    title: 'Feedback that respects the work',
    body:
      'Persistent conditions get persistent UI - an empty state, a callout, a disabled control with a reason. Only transient results become a toast. A missing configuration is never a toast that scrolls away.',
  },
  {
    title: 'The same kit for extensions',
    body:
      'Everything you see here is @/kit, the exact surface a site developer imports. An extension page and a core page are built from the same parts, so the product stays coherent no matter who wrote the screen.',
  },
]

export function SinkLightfieldPage() {
  return (
    <AdminPage breadcrumbs={useSinkCrumbs('Lightfield')}>
      <div className="max-w-3xl space-y-8 pb-16">

        <div className="space-y-3">
          <Heading level={2}>Lightfield</Heading>
          <Text className="max-w-prose">
            Lightfield is the Tangen design system - the tokens, the components and the
            rules that make every screen of the admin feel like one product. It is not a
            theme layered on at the end. It is the vocabulary the admin is written in, and
            the same vocabulary your extensions and site-developer pages are written in.
          </Text>
        </div>

        <Callout variant="info" title="One system, one import">
          <Text>
            Everything on these Kitchen Sink pages comes from <code className="font-mono">@/kit</code>.
            There is no separate &quot;internal&quot; component set. The Button on a core settings
            page and the Button on your extension page are the same Button.
          </Text>
        </Callout>

        <div className="space-y-4">
          <Heading level={3}>The principles</Heading>
          <div className="grid gap-3">
            {PRINCIPLES.map((p) => (
              <Card key={p.title}>
                <Heading level={4}>{p.title}</Heading>
                <Text variant="help" className="mt-1 max-w-prose">{p.body}</Text>
              </Card>
            ))}
          </div>
        </div>

        <Divider label="the story" />

        <div className="space-y-4">
          <Heading level={3}>Why it exists</Heading>
          <Text className="max-w-prose">
            The admin did not start with a design system. It started, like most tools do, with
            a page at a time - a settings screen here, a content editor there, each built by
            whoever needed it that week. It worked, and then it did not. Two screens grew two
            slightly different greys. A dialog on one page closed on outside-click and on
            another it did not. A dropdown rendered behind a sheet because nobody owned the
            order of layers. None of these were bugs exactly. They were the absence of a
            decision, made a hundred times over.
          </Text>
          <Text className="max-w-prose">
            Lightfield is the set of decisions we stopped re-making. The structure - the shell,
            the surfaces, the spacing - comes from studying tools that get density right for
            people who live in them all day. The feel of feedback - toasts that carry an action,
            a promise toast that resolves, motion that a reduced-motion preference can switch off
            - comes from studying tools that treat a moment of waiting as something to design,
            not paper over. The name is the idea: a field of light, an even surface where nothing
            is arbitrarily brighter or darker than the job it is doing.
          </Text>
          <Text className="max-w-prose">
            The rule that carries the most weight is the smallest one: no literal colours. It
            sounds like housekeeping. It is what let the entire admin gain a dark mode without a
            single component changing, and it is what lets a workspace someday carry its own
            palette. A token is a promise that the answer to &quot;what colour is this?&quot; lives in one
            place, so it can change in one place. Every other principle is a version of the same
            promise applied to a different axis - one component per job, one elevation ladder, one
            kit for everyone.
          </Text>
          <Text className="max-w-prose">
            The Kitchen Sink is where that promise gets tested in the open. Every page here is a
            live component next to the exact code that produced it. If the two ever disagree,
            the system is lying, and you will see it here first. That is the point of a reference
            extension: not to show off the parts, but to keep them honest.
          </Text>
        </div>

      </div>
    </AdminPage>
  )
}
