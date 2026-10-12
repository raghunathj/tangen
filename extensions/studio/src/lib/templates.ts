/**
 * File Name: templates.ts
 * Purpose: The B-T7 template gallery - starter landing-page sections built
 *   strictly from the Builder Kit vocabulary (hero, features, social proof,
 *   CTA, FAQ). Served as ordinary Studio presets: the server seeds them into
 *   the extension store once per workspace, after which marketers
 *   rename, edit, or delete them like any preset they saved themselves.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Every value must stay legal against builder-kit.ts -
 *   select props use token slots / option values verbatim, richtext props
 *   store the ProseMirror doc shape the editor stores (never bare strings).
 *   templates.test.ts validates every template against the kit defs, so a
 *   drift here fails the build, not a marketer's page.
 */
import { mintBlockKey } from './presets'

type Block = Record<string, unknown>

/** The editor's stored richtext shape: one doc, one paragraph per string. */
const rt = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
})

const block = (type: string, props: Record<string, unknown>): Block => ({
  _key: mintBlockKey(),
  _type: type,
  ...props,
})

const row = (props: Record<string, unknown>) => ({ _key: mintBlockKey(), ...props })

/** One starter section: a name for the preset list + a kit.section tree. */
export interface KitTemplate {
  name: string
  block: Block
}

/**
 * The starter gallery, fresh `_key`s on every call. Copy is a real skeleton
 * a marketer edits in place - benefit-led and generic on purpose, never
 * lorem ipsum, never facts that pretend to be theirs.
 */
export function kitTemplates(): KitTemplate[] {
  return [
    {
      name: 'Hero band',
      block: block('kit.section', {
        background: 'brand', padding: 'xl', width: 'normal',
        children: [
          block('kit.heading', { text: 'Launch your next idea faster', level: 'h1', size: '3xl', align: 'center' }),
          block('kit.text', { body: rt('Everything you need to go from brief to live page, with your brand doing the heavy lifting.'), size: 'lg', align: 'center' }),
          block('kit.buttons', {
            align: 'center',
            items: [
              row({ label: 'Get started', href: '/signup', variant: 'primary', size: 'lg' }),
              row({ label: 'See how it works', href: '/product', variant: 'ghost', size: 'lg' }),
            ],
          }),
        ],
      }),
    },
    {
      name: 'Features grid',
      block: block('kit.section', {
        background: 'default', padding: 'lg', width: 'normal',
        children: [
          block('kit.heading', { text: 'Why teams choose us', level: 'h2', size: '2xl', align: 'center' }),
          block('kit.spacer', { size: 'md' }),
          block('kit.iconList', {
            columns: '3',
            items: [
              row({ icon: 'spark', title: 'Fast to launch', body: 'Go live in days, not quarters, with pages your team assembles itself.' }),
              row({ icon: 'shield', title: 'On-brand by default', body: 'Every section pulls from your design tokens, so nothing ships off-palette.' }),
              row({ icon: 'globe', title: 'Grows with you', body: 'Localize, personalize, and publish to every market from one place.' }),
            ],
          }),
        ],
      }),
    },
    {
      name: 'Social proof',
      block: block('kit.section', {
        background: 'muted', padding: 'lg', width: 'normal',
        children: [
          block('kit.heading', { text: 'Loved by teams like yours', level: 'h2', size: '2xl', align: 'center' }),
          block('kit.spacer', { size: 'md' }),
          block('kit.row', {
            layout: '2', gap: 'lg', align: 'top',
            col1: [
              block('kit.text', { body: rt('"We shipped our campaign site in an afternoon - and it looked like our brand, not a template."', '- A happy customer, Head of Marketing'), size: 'base', align: 'left' }),
            ],
            col2: [
              block('kit.text', { body: rt('"The first tool our designers and marketers actually agree on."', '- Another customer, Creative Director'), size: 'base', align: 'left' }),
            ],
            col3: [],
          }),
        ],
      }),
    },
    {
      name: 'Call to action',
      block: block('kit.section', {
        background: 'accent', padding: 'xl', width: 'narrow',
        children: [
          block('kit.heading', { text: 'Ready to see it for yourself?', level: 'h2', size: '2xl', align: 'center' }),
          block('kit.text', { body: rt('Start free, invite the team, and publish your first page today.'), size: 'base', align: 'center' }),
          block('kit.buttons', {
            align: 'center',
            items: [row({ label: 'Start free', href: '/signup', variant: 'primary', size: 'lg' })],
          }),
        ],
      }),
    },
    {
      name: 'FAQ',
      block: block('kit.section', {
        background: 'default', padding: 'lg', width: 'narrow',
        children: [
          block('kit.heading', { text: 'Frequently asked questions', level: 'h2', size: '2xl', align: 'left' }),
          block('kit.spacer', { size: 'sm' }),
          block('kit.accordion', {
            items: [
              row({ title: 'How long does setup take?', body: rt('Most teams publish their first page the same day they connect their content.') }),
              row({ title: 'Can I use my own components?', body: rt('Yes - your developers can register site sections alongside the built-in kit, and both appear in the palette.') }),
              row({ title: 'What about our brand guidelines?', body: rt('Styling is bound to your design tokens, so every page stays inside the system your team defined.') }),
            ],
          }),
        ],
      }),
    },
  ]
}
