import { AdminPage, Heading, Text, Label, InlineCode, Divider, CodeBlock } from '@/kit'
import { Example, ExampleStack, useSinkCrumbs } from './example'

/**
 * Typography — the token-backed atoms. Use these instead of raw text-*
 * classes: a font swap, palette change, or dark mode then never touches
 * your markup.
 */
export function SinkTypographyPage() {
  return (
    <AdminPage breadcrumbs={useSinkCrumbs('Typography')}>
      <ExampleStack>

        <Example
          title="Heading"
          description="Four levels - page titles live in the header bar, so in-page headings start small"
          code={`import { Heading } from '@/kit'

<Heading level={1}>Page-level heading</Heading>
<Heading level={2}>Section heading</Heading>
<Heading level={3}>Card heading</Heading>
<Heading level={4}>Eyebrow / group label</Heading>
// semantic tag ≠ visual scale? override: <Heading level={3} as="h2">`}
        >
          <div className="space-y-3">
            <Heading level={1}>Page-level heading</Heading>
            <Heading level={2}>Section heading</Heading>
            <Heading level={3}>Card heading</Heading>
            <Heading level={4}>Eyebrow / group label</Heading>
          </div>
        </Example>

        <Example
          title="Text"
          description="body for reading copy, strong for emphasis, help for hints under controls"
          code={`import { Text } from '@/kit'

<Text>Primary body copy.</Text>
<Text variant="strong">Emphasized inline text.</Text>
<Text variant="help">Help text under a field or control.</Text>`}
        >
          <div className="space-y-2">
            <Text>Primary body copy - most reading text in the admin.</Text>
            <Text variant="strong">Emphasized inline text for names and values.</Text>
            <Text variant="help">Help text under a field or control.</Text>
          </div>
        </Example>

        <Example
          title="Label & InlineCode"
          code={`import { Label, InlineCode } from '@/kit'

<Label htmlFor="email" required>Email</Label>
<Text>Call <InlineCode>POST /api/v1/pincode/check</InlineCode> to check.</Text>`}
        >
          <div className="space-y-3">
            <Label htmlFor="sink-demo-email" required>Email</Label>
            <Text>Call <InlineCode>POST /api/v1/pincode/check</InlineCode> to check serviceability.</Text>
          </div>
        </Example>

        <Example
          title="CodeBlock & data"
          description="Dark copyable panel; numbers that align in columns get tabular-nums"
          code={`import { CodeBlock } from '@/kit'

<CodeBlock code={'{ "serviceable": true }'} />
<span className="text-3xl font-semibold text-fg tabular-nums">1,024</span>`}
        >
          <div className="space-y-3">
            <CodeBlock code={`{ "serviceable": true, "city": "New Delhi" }`} />
            <p className="text-3xl font-semibold text-fg tabular-nums">1,024</p>
          </div>
        </Example>

        <Example
          title="Divider"
          code={`import { Divider } from '@/kit'

<Divider />
<Divider label="or" />`}
        >
          <div className="space-y-6">
            <Divider />
            <Divider label="or" />
          </div>
        </Example>

        <Example
          title="Reading width & the token rule"
          description="Semantic utilities only - literal grays don't theme"
          code={`// ✓ themable                     // ✗ frozen in light mode
<p className="text-fg-muted">     <p className="text-fg-muted">
<div className="bg-surface">      <div className="bg-white">
<div className="border-border">   <div className="border-border">

// Reading width: max-w-prose (~65ch) for long-form text
<Text className="max-w-prose">…</Text>`}
        >
          <Text className="max-w-prose">
            Everything on this page uses the semantic tokens, which is why the
            experimental dark toggle on the Kitchen Sink overview restyles it
            without a single markup change. New admin code should never hardcode
            a gray.
          </Text>
        </Example>

      </ExampleStack>
    </AdminPage>
  )
}
