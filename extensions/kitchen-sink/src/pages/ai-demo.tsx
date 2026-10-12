/**
 * File Name: ai-demo.tsx
 * Purpose: The AI-section registry demo — this page's nav declares
 *          `section: 'ai'`, so it renders in the AI sidebar section next to
 *          the platform's Knowledge/Q&A/Agents pages instead of under
 *          Extensions. This is how an extension ships its own AI-led
 *          feature into the section.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { usePageHeader, Card, Text, InlineCode, Callout } from '@/kit'
import { Example } from './example'

export function SinkAiDemoPage() {
  usePageHeader({
    title: 'AI section demo',
    description: 'An extension page registered into the AI sidebar section',
  })

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <Callout variant="info" title="Why this page is in the AI section">
        The AI section is a registry: any extension (or app) page whose nav sets{' '}
        <InlineCode>section: 'ai'</InlineCode> joins it - no sidebar changes needed. Tomorrow's
        AI-led features land the same way.
      </Callout>
      <Example
        title="Register a page into the AI section"
        code={`// tangen.extension.ts (manifest)
pages: [
  {
    path: 'ai-demo',
    component: 'MyAiPage',            // named export of src/index.ts
    nav: {
      label: 'My AI feature',
      icon: 'IconSparkles',
      section: 'ai',                  // ← joins the AI sidebar section
      order: 60,
    },
    access: { capability: 'manage:aiSettings' },
  },
]`}
      >
        <Card title="It renders like any platform AI page">
          <Text>
            Full page surface, RBAC-gated nav, extension-active gating - everything the
            Extensions section gives you, curated under AI.
          </Text>
        </Card>
      </Example>
    </div>
  )
}
