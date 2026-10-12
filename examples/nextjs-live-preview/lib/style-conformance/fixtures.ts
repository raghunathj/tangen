/**
 * File Name: fixtures.ts
 * Purpose: The Studio style-conformance fixture set - every Style panel
 *          control expressed as a block tree, a class set and the browser
 *          result it must produce.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: ONE source of truth for the conformance page and the
 *          Playwright matrix. A control is not implemented because the UI
 *          exists, the value saves, the JSON holds the property or the CSS
 *          holds the declaration - the browser-computed result is the
 *          verdict, so every fixture states that result as data.
 *
 *          Fixtures are deliberately dull: fixed sizes, labelled children,
 *          no decoration that could mask a layout failure. Class names are
 *          namespaced per fixture (`<id>__<name>`) because every fixture
 *          shares one page, and two fixtures naming a class `hero` would
 *          silently cross-style each other.
 *
 *          Values come from the REGISTRY (packages/studio-schema
 *          style-properties.ts). Where a matrix entry has no registry
 *          control it is recorded as unexercised in the report rather than
 *          invented here - a fixture for a control that does not exist would
 *          test the fixture, not the product.
 *
 *          Token expectations use the kit's own defaults in
 *          packages/studio-react/src/styles.css: --tg-space-md 2rem,
 *          --tg-space-lg 4rem, --tg-width-narrow 40rem, --tg-radius-md
 *          0.75rem, --tg-text-xl 1.5rem, --tg-bg-brand #4338ca,
 *          --tg-fg-brand #ffffff.
 */
import type { Check, Fixture, FixtureBlock, FixtureClass } from './types'

/* ────────────────────────────────────────────────────────────────────────
   Block builders. Every child is a labelled box so a screenshot reads.
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Every block also wears a class named after its key, so a check can point at
 * ONE element without inventing a second naming scheme. The extra class has
 * no rule of its own unless a fixture gives it one.
 */
const withKey = (key: string, classes: string[]): string[] => [...new Set([...classes, key])]

const heading = (key: string, classes: string[], text: string): FixtureBlock => ({
  _type: 'kit.heading', _key: key, level: 'h3', size: 'base', align: 'left', text,
  _studio: { classes: withKey(key, classes) },
})

const textBlock = (key: string, classes: string[], body: string): FixtureBlock => ({
  _type: 'kit.text', _key: key, size: 'base', align: 'left', body,
  _studio: { classes: withKey(key, classes) },
})

/** A kit.section: wrapper > section > inner. The inner holds the children. */
const section = (key: string, classes: string[], children: FixtureBlock[]): FixtureBlock => ({
  _type: 'kit.section', _key: key, background: 'default', padding: 'none', width: 'full',
  _studio: { classes: withKey(key, classes) }, children,
})

const buttons = (key: string, classes: string[]): FixtureBlock => ({
  _type: 'kit.buttons', _key: key, align: 'left',
  items: [{ label: 'Focus me', href: '/', variant: 'primary', size: 'md' }],
  _studio: { classes: withKey(key, classes) },
})

/** A class rule in the stored shape. */
const cls = (name: string, props: Record<string, unknown>, extra: Partial<FixtureClass> = {}): FixtureClass =>
  ({ name, props, ...extra })

/* ────────────────────────────────────────────────────────────────────────
   Check builders. Terse on purpose - there are several hundred of them.
   ──────────────────────────────────────────────────────────────────────── */

const computed = (sel: string, prop: string, expect: string, extra: Partial<Check> = {}): Check =>
  ({ kind: 'computed', sel, prop, expect, ...extra })

const rect = (sel: string, box: Check['box'], expect: number, extra: Partial<Check> = {}): Check =>
  ({ kind: 'rect', sel, box, expect, tol: 1, ...extra })

const rel = (sel: string, r: Check['rel'], sel2: string, extra: Partial<Check> = {}): Check =>
  ({ kind: 'rel', sel, rel: r, sel2, tol: 1.5, ...extra })

const inset = (sel: string, side: Check['side'], sel2: string, expect: number, extra: Partial<Check> = {}): Check =>
  ({ kind: 'inset', sel, side, sel2, expect, tol: 1.5, ...extra })

const order = (sels: string[], axis: 'x' | 'y'): Check => ({ kind: 'order', sels, axis })

const css = (op: Check['op'], expect?: string): Check => ({ kind: 'css', op, expect })

/* ────────────────────────────────────────────────────────────────────────
   Namespacing. `$name` in a selector becomes `.<id>__<name>`; `$name~c`
   becomes the derived content class the compiler targets.
   ──────────────────────────────────────────────────────────────────────── */

const SEL = /\$([A-Za-z][A-Za-z0-9]*)(~c)?/g

function expandSel(id: string, sel: string): string {
  return sel.replace(SEL, (_m, name: string, content: string | undefined) =>
    `.${id}__${name}${content ? '--content' : ''}`)
}

function nsBlock(id: string, block: FixtureBlock): FixtureBlock {
  const out: FixtureBlock = { ...block }
  const bag = out._studio as { classes?: unknown } | undefined
  if (bag && Array.isArray(bag.classes)) {
    out._studio = { ...bag, classes: (bag.classes as string[]).map((c) => `${id}__${c}`) }
  }
  for (const slot of ['children', 'col1', 'col2', 'col3', 'itemTemplate', 'emptyState', 'errorState']) {
    const v = out[slot]
    if (Array.isArray(v)) out[slot] = (v as FixtureBlock[]).map((b) => nsBlock(id, b))
  }
  return out
}

function nsClass(id: string, rule: FixtureClass): FixtureClass {
  return { ...rule, name: `${id}__${rule.name}` }
}

function nsCheck(id: string, check: Check): Check {
  const out: Check = { ...check }
  if (out.sel) out.sel = expandSel(id, out.sel)
  if (out.sel2) out.sel2 = expandSel(id, out.sel2)
  if (out.stateSel) out.stateSel = expandSel(id, out.stateSel)
  if (out.sels) out.sels = out.sels.map((s) => expandSel(id, s))
  if (out.preScroll) out.preScroll = { ...out.preScroll, sel: expandSel(id, out.preScroll.sel) }
  if (out.kind === 'css' && typeof out.expect === 'string') out.expect = expandSel(id, out.expect)
  return out
}

function ns(fx: Fixture): Fixture {
  return {
    ...fx,
    blocks: fx.blocks.map((b) => nsBlock(fx.id, b)),
    classes: fx.classes.map((c) => nsClass(fx.id, c)),
    published: fx.published
      ? { ...fx.published, classes: fx.published.classes.map((c) => nsClass(fx.id, c)) }
      : undefined,
    checks: fx.checks.map((c) => nsCheck(fx.id, c)),
  }
}

const ALL: Fixture[] = []
const add = (fx: Fixture): void => { ALL.push(ns(fx)) }

/* ════════════════════════════════════════════════════════════════════════
   1. REGRESSION - the reported root cause, as a permanent fixture.
   ════════════════════════════════════════════════════════════════════════ */

/** The stale published stylesheet the canvas was still honouring. */
const STALE = [cls('section', { display: 'inline', height: '343px', width: '{width.wide}' })]
const FRESH_DRAFT = [cls('section', {
  'background-color': '#ffffff', 'padding-top': '24px', 'padding-bottom': '24px',
})]
const threeSections = (): FixtureBlock[] => [
  section('s1', ['section', 's1'], [heading('h1', [], 'Section one')]),
  section('s2', ['section', 's2'], [heading('h2', [], 'Section two')]),
  section('s3', ['section', 's3'], [heading('h3', [], 'Section three')]),
]

add({
  id: 'regression-draft-replaces-published',
  group: 'regression',
  label: 'Stale published display:inline, draft REPLACES it',
  expectation: 'Three white padded sections stacked, each one unbroken block. The published display:inline and height:343px are gone.',
  blocks: threeSections(),
  classes: FRESH_DRAFT,
  published: { classes: STALE, mode: 'replace' },
  covers: ['display', 'height', 'width', 'background-color', 'padding-top', 'padding-bottom'],
  checks: [
    computed('$s1', 'display', 'block'),
    computed('$s2', 'display', 'block'),
    computed('$s3', 'display', 'block'),
    computed('$s1', 'height', '343px', { op: 'ne' }),
    computed('$s1', 'backgroundColor', 'rgb(255, 255, 255)'),
    computed('$s1', 'paddingTop', '24px'),
    { kind: 'rects', sel: '$s1', expect: 1, note: 'One unbroken box - an inline wrapper around a block section fragments' },
    rel('$s2', 'below', '$s1'),
    rel('$s3', 'below', '$s2'),
  ],
})

add({
  id: 'regression-draft-layers-over-published',
  group: 'regression',
  label: 'Stale published display:inline, draft only LAYERS (the old behaviour)',
  expectation: 'The control case. A draft only adds rules, so display:inline survives and each wrapper fragments. This is why the draft must replace the published sheet, not sit on top of it.',
  blocks: threeSections(),
  classes: FRESH_DRAFT,
  published: { classes: STALE, mode: 'layer' },
  covers: ['display'],
  checks: [
    computed('$s1', 'display', 'inline', { note: 'The stale published rule still wins - documented, not desired' }),
    { kind: 'rects', sel: '$s1', expect: 1, op: 'gt', note: 'The inline wrapper fragments around its block child' },
  ],
})

/* ════════════════════════════════════════════════════════════════════════
   2. DISPLAY - on a block WITH an inner content element and one WITHOUT.
   ════════════════════════════════════════════════════════════════════════ */

/** value -> [wrapper outer type, content inner type] per the outer/inner split. */
const DISPLAY_SPLIT: Array<[string, string, string, boolean]> = [
  // value, wrapper computed, content computed, offered by the registry
  ['block', 'block', 'block', true],
  ['flex', 'block', 'flex', true],
  ['grid', 'block', 'grid', true],
  ['inline-block', 'inline-block', 'block', true],
  // `inline` is NOT offered on a kit block (S6, display-support.ts): a stored
  // value still computes as inline, which these fixtures keep proving, and
  // the structure still cannot lay anything out on one line - which is
  // exactly why the panel does not offer it.
  ['inline', 'inline', 'block', false],
  ['none', 'none', 'none', true],
  // inline-flex and inline-grid change the OUTER type, so the wrapper keeps
  // the exact value; its children still lay out through the content element.
  ['inline-flex', 'inline-flex', 'flex', true],
  ['inline-grid', 'inline-grid', 'grid', false],
  ['contents', 'contents', 'contents', false],
]

for (const [value, outer, inner, offered] of DISPLAY_SPLIT) {
  add({
    id: `display-section-${value}`,
    group: 'display',
    label: `DISPLAY: ${value.toUpperCase()} on kit.section (has an inner content element)`,
    expectation: `Wrapper computes ${outer}, the inner content element computes ${inner}.${offered ? '' : ' (not offered by the registry; a stored value can still hold it)'}`,
    blocks: [section('p', ['p'], [
      heading('a', ['bx'], 'A'), heading('b', ['bx'], 'B'), heading('c', ['bx'], 'C'),
    ])],
    classes: [
      cls('p', { display: value, gap: '0px' }),
      cls('bx', { width: '60px', height: '40px', 'background-color': '#c7d2fe' }),
    ],
    covers: ['display'],
    checks: [
      computed('$p', 'display', outer),
      computed('$p~c', 'display', inner),
    ],
  })

  add({
    id: `display-heading-${value}`,
    group: 'display',
    label: `DISPLAY: ${value.toUpperCase()} on kit.heading (no inner content element)`,
    expectation: `The one element the block renders must compute ${value} - CSS semantics, no special case.`,
    blocks: [heading('h', ['h'], 'Heading')],
    classes: [cls('h', { display: value })],
    covers: ['display'],
    checks: [computed('$h', 'display', value)],
  })
}

/* ════════════════════════════════════════════════════════════════════════
   3. PARENT x CHILD FORMATTING CONTEXTS
   ════════════════════════════════════════════════════════════════════════ */

const BX = cls('bx', { width: '60px', height: '40px', 'background-color': '#c7d2fe' })
const BXW = cls('bxw', { height: '40px', 'background-color': '#bbf7d0' })

add({
  id: 'context-block-block',
  group: 'context',
  label: 'BLOCK > BLOCK children',
  expectation: 'Two full-width bars stacked vertically.',
  blocks: [section('p', ['p'], [heading('a', ['bxw'], 'A'), heading('b', ['bxw'], 'B')])],
  classes: [cls('p', { display: 'block' }), BXW],
  covers: ['display'],
  checks: [
    computed('$p~c', 'display', 'block'),
    rel('$b', 'below', '$a'),
    rel('$a', 'ratioCW', '$p~c', { expect: 1, tol: 0.02 }),
  ],
})

add({
  id: 'context-block-inline',
  group: 'context',
  label: 'BLOCK > INLINE children (a stored value; not offered on kit blocks)',
  expectation: 'Each child wrapper computes inline. Every kit widget renders a BLOCK element inside that wrapper, so the inline box fragments and the two never share a line - which is why S6 took `inline` off the kit blocks\' display control (display-support.ts). The fixture keeps proving a stored value is honoured; the geometry it cannot produce is asserted on inline-block, the offered alternative, in the next fixture.',
  blocks: [section('p', ['p'], [heading('a', ['inl'], 'A'), heading('b', ['inl'], 'B')])],
  classes: [cls('p', { display: 'block' }), cls('inl', { display: 'inline', 'background-color': '#fde68a' })],
  covers: ['display'],
  checks: [
    computed('$a', 'display', 'inline'),
    computed('$b', 'display', 'inline'),
  ],
})

add({
  id: 'context-block-inline-block',
  group: 'context',
  label: 'BLOCK > INLINE-BLOCK children share a line - the offered way to put kit blocks side by side inline',
  expectation: 'Two atomic inline boxes on one line, each laying its heading out inside itself.',
  blocks: [section('p', ['p'], [heading('a', ['inb'], 'A'), heading('b', ['inb'], 'B')])],
  classes: [cls('p', { display: 'block' }), cls('inb', { display: 'inline-block', width: '80px', 'background-color': '#fde68a' })],
  covers: ['display', 'width'],
  checks: [
    computed('$a', 'display', 'inline-block'),
    rel('$a', 'sameTop', '$b'),
    order(['$a', '$b'], 'x'),
  ],
})

add({
  id: 'context-block-flex',
  group: 'context',
  label: 'BLOCK > FLEX child',
  expectation: 'The child section lays ITS children out in a row.',
  blocks: [section('p', ['p'], [
    section('f', ['f'], [heading('a', ['bx'], 'A'), heading('b', ['bx'], 'B')]),
  ])],
  classes: [cls('p', { display: 'block' }), cls('f', { display: 'flex', 'flex-direction': 'row', gap: '0px' }), BX],
  covers: ['display'],
  checks: [
    computed('$f~c', 'display', 'flex'),
    rel('$a', 'sameTop', '$b'),
    rel('$b', 'rightOf', '$a'),
  ],
})

add({
  id: 'context-flex-block-children',
  group: 'context',
  label: 'FLEX > BLOCK children',
  expectation: 'Three boxes in a row, in source order.',
  blocks: [section('p', ['p'], [heading('a', ['bx'], 'A'), heading('b', ['bx'], 'B'), heading('c', ['bx'], 'C')])],
  classes: [cls('p', { display: 'flex', 'flex-direction': 'row', gap: '0px' }), BX],
  covers: ['display', 'gap'],
  checks: [
    computed('$p~c', 'display', 'flex'),
    order(['$a', '$b', '$c'], 'x'),
    rel('$a', 'sameTop', '$c'),
  ],
})

add({
  id: 'context-flex-flex-child',
  group: 'context',
  label: 'FLEX > FLEX child',
  expectation: 'The outer row holds two children; the second is itself a row of two boxes.',
  blocks: [section('p', ['p'], [
    heading('a', ['bx'], 'A'),
    section('f', ['f'], [heading('x', ['bx'], 'X'), heading('y', ['bx'], 'Y')]),
  ])],
  classes: [cls('p', { display: 'flex', 'flex-direction': 'row', gap: '0px' }), cls('f', { display: 'flex', 'flex-direction': 'row', gap: '0px' }), BX],
  covers: ['display'],
  checks: [
    computed('$p~c', 'display', 'flex'),
    computed('$f~c', 'display', 'flex'),
    rel('$f', 'rightOf', '$a'),
    rel('$y', 'rightOf', '$x'),
    rel('$x', 'sameTop', '$y'),
  ],
})

add({
  id: 'context-grid-block-children',
  group: 'context',
  label: 'GRID > BLOCK children (2 columns)',
  expectation: 'A and B on row one, C on row two.',
  blocks: [section('p', ['p'], [heading('a', ['bxw'], 'A'), heading('b', ['bxw'], 'B'), heading('c', ['bxw'], 'C')])],
  classes: [cls('p', { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '0px' }), BXW],
  covers: ['display', 'grid-template-columns', 'gap'],
  checks: [
    computed('$p~c', 'display', 'grid'),
    rel('$a', 'sameTop', '$b'),
    rel('$b', 'rightOf', '$a'),
    rel('$c', 'below', '$a'),
    rel('$c', 'sameLeft', '$a'),
  ],
})

add({
  id: 'context-grid-flex-child',
  group: 'context',
  label: 'GRID > FLEX child',
  expectation: 'A two-column grid whose second cell is a row of two boxes.',
  blocks: [section('p', ['p'], [
    heading('a', ['bxw'], 'A'),
    section('f', ['f'], [heading('x', ['bx'], 'X'), heading('y', ['bx'], 'Y')]),
  ])],
  classes: [
    cls('p', { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '0px' }),
    cls('f', { display: 'flex', 'flex-direction': 'row', gap: '0px' }), BX, BXW,
  ],
  covers: ['display', 'grid-template-columns'],
  checks: [
    computed('$p~c', 'display', 'grid'),
    computed('$f~c', 'display', 'flex'),
    rel('$f', 'rightOf', '$a'),
    rel('$y', 'rightOf', '$x'),
  ],
})

add({
  id: 'context-inlineblock-block-child',
  group: 'context',
  label: 'INLINE-BLOCK > BLOCK child',
  expectation: 'The wrapper shrink-wraps its content instead of filling the stage.',
  blocks: [section('p', ['p'], [heading('a', ['bx'], 'A')])],
  classes: [cls('p', { display: 'inline-block' }), BX],
  covers: ['display'],
  checks: [
    computed('$p', 'display', 'inline-block'),
    computed('$p~c', 'display', 'block'),
    { kind: 'rect', sel: '$p', box: 'width', op: 'lt', expect: 900, note: 'Shrink to fit, not the full stage width' },
  ],
})

/* ════════════════════════════════════════════════════════════════════════
   4. FLEX
   ════════════════════════════════════════════════════════════════════════ */

const flexKids = (): FixtureBlock[] => [
  heading('a', ['bx'], 'A'), heading('b', ['bx'], 'B'), heading('c', ['bx'], 'C'),
]

for (const dir of ['row', 'row-reverse', 'column', 'column-reverse'] as const) {
  const axis = dir.startsWith('row') ? 'x' : 'y'
  const seq = dir.endsWith('reverse') ? ['$c', '$b', '$a'] : ['$a', '$b', '$c']
  add({
    id: `flex-direction-${dir}`,
    group: 'flex',
    label: `FLEX DIRECTION: ${dir}`,
    expectation: `Boxes read ${seq.join(' ').replace(/\$/g, '').toUpperCase()} along ${axis === 'x' ? 'the row' : 'the column'}.`,
    blocks: [section('p', ['p'], flexKids())],
    classes: [cls('p', { display: 'flex', 'flex-direction': dir, gap: '0px' }), BX],
    covers: ['display', 'flex-direction', 'gap'],
    checks: [
      computed('$p~c', 'flexDirection', dir),
      order(seq, axis),
    ],
  })
}

for (const wrap of ['nowrap', 'wrap', 'wrap-reverse'] as const) {
  add({
    id: `flex-wrap-${wrap}`,
    group: 'flex',
    label: `FLEX WRAP: ${wrap}`,
    expectation: wrap === 'nowrap'
      ? 'All three boxes squeezed onto one line.'
      : wrap === 'wrap' ? 'A and B on line one, C on line two.'
      : 'C on the top line, A and B below it.',
    blocks: [section('p', ['p'], flexKids())],
    classes: [cls('p', { display: 'flex', 'flex-direction': 'row', 'flex-wrap': wrap, gap: '0px' }), cls('bx', { width: '40%', height: '40px', 'background-color': '#c7d2fe' })],
    covers: ['display', 'flex-wrap'],
    checks: wrap === 'nowrap'
      ? [computed('$p~c', 'flexWrap', 'nowrap'), rel('$a', 'sameTop', '$c')]
      : wrap === 'wrap'
        ? [computed('$p~c', 'flexWrap', 'wrap'), rel('$a', 'sameTop', '$b'), rel('$c', 'below', '$a')]
        : [computed('$p~c', 'flexWrap', 'wrap-reverse'), rel('$a', 'sameTop', '$b'), rel('$a', 'below', '$c')],
  })
}

add({
  id: 'flex-default-direction',
  group: 'flex',
  label: 'FLEX with NO direction set - CSS says row',
  expectation: 'Display:flex on its own must lay the children out in a ROW, because row is the CSS initial value of flex-direction.',
  blocks: [section('p', ['p'], flexKids())],
  classes: [cls('p', { display: 'flex', gap: '0px' }), BX],
  covers: ['display'],
  checks: [
    computed('$p~c', 'display', 'flex'),
    computed('$p~c', 'flexDirection', 'row'),
    order(['$a', '$b', '$c'], 'x'),
    rel('$a', 'sameTop', '$c'),
  ],
})

const JUSTIFY: Array<[string, Check[]]> = [
  ['flex-start', [inset('$a', 'left', '$p~c', 0), { kind: 'inset', sel: '$c', side: 'right', sel2: '$p~c', expect: 0, op: 'gt', tol: 1.5 }]],
  ['center', [{ kind: 'inset', sel: '$a', side: 'left', sel2: '$p~c', expect: 0, op: 'gt', tol: 1.5 }, { kind: 'rel', sel: '$b', rel: 'sameCenterX', sel2: '$p~c', tol: 2, note: 'the MIDDLE box sits on the container centre line' }]],
  ['flex-end', [inset('$c', 'right', '$p~c', 0), { kind: 'inset', sel: '$a', side: 'left', sel2: '$p~c', expect: 0, op: 'gt', tol: 1.5 }]],
  ['space-between', [inset('$a', 'left', '$p~c', 0), inset('$c', 'right', '$p~c', 0), { kind: 'rel', sel: '$a', rel: 'gapX', sel2: '$b', expect: 0, op: 'gt', tol: 1.5 }]],
  ['space-around', [{ kind: 'inset', sel: '$a', side: 'left', sel2: '$p~c', expect: 0, op: 'gt', tol: 1.5 }, { kind: 'rel', sel: '$a', rel: 'gapX', sel2: '$b', expect: 0, op: 'gt', tol: 1.5 }]],
]

for (const [value, geometry] of JUSTIFY) {
  add({
    id: `flex-justify-${value}`,
    group: 'flex',
    label: `JUSTIFY CONTENT: ${value}`,
    expectation: `Three 60px boxes distributed with ${value}.`,
    blocks: [section('p', ['p'], flexKids())],
    classes: [cls('p', { display: 'flex', 'flex-direction': 'row', 'justify-content': value, gap: '0px' }), BX],
    covers: ['display', 'justify-content'],
    checks: [computed('$p~c', 'justifyContent', value), ...geometry],
  })
}

const ALIGN: Array<[string, Check[]]> = [
  ['stretch', [rel('$b', 'sameHeight', '$a')]],
  ['flex-start', [inset('$b', 'top', '$p~c', 0), rel('$b', 'taller', '$a', { op: 'lt' })]],
  ['center', [{ kind: 'rel', sel: '$b', rel: 'sameCenterY', sel2: '$a', tol: 2 }]],
  ['flex-end', [inset('$b', 'bottom', '$p~c', 0)]],
  ['baseline', [{ kind: 'inset', sel: '$b', side: 'top', sel2: '$p~c', expect: 5, op: 'gt', tol: 1.5, note: 'Baseline pushes the short box down past a padded tall sibling' }]],
]

for (const [value, geometry] of ALIGN) {
  add({
    id: `flex-align-${value}`,
    group: 'flex',
    label: `ALIGN ITEMS: ${value}`,
    expectation: `A is 80px tall with 30px top padding; B and C have no height. align-items:${value}.`,
    blocks: [section('p', ['p'], [heading('a', ['tall'], 'A'), heading('b', ['auto'], 'B'), heading('c', ['auto'], 'C')])],
    classes: [
      cls('p', { display: 'flex', 'flex-direction': 'row', 'align-items': value, gap: '0px' }),
      cls('tall', { width: '60px', height: '80px', 'padding-top': '30px', 'background-color': '#a5b4fc' }),
      cls('auto', { width: '60px', 'background-color': '#c7d2fe' }),
    ],
    covers: ['display', 'align-items'],
    checks: [computed('$p~c', 'alignItems', value), ...geometry],
  })
}

for (const value of ['auto', 'flex-start', 'center', 'flex-end', 'stretch'] as const) {
  add({
    id: `flex-alignself-${value}`,
    group: 'flex',
    label: `ALIGN SELF: ${value} on one child of a flex-start row`,
    expectation: `B overrides the row's align-items:flex-start with align-self:${value}.`,
    blocks: [section('p', ['p'], [heading('a', ['tall'], 'A'), heading('b', ['self'], 'B')])],
    classes: [
      cls('p', { display: 'flex', 'flex-direction': 'row', 'align-items': 'flex-start', gap: '0px' }),
      cls('tall', { width: '60px', height: '80px', 'background-color': '#a5b4fc' }),
      cls('self', { width: '60px', 'background-color': '#c7d2fe', 'align-self': value }),
    ],
    covers: ['align-self'],
    checks: [
      computed('$b', 'alignSelf', value),
      ...(value === 'flex-end' ? [inset('$b', 'bottom', '$p~c', 0)] : []),
      ...(value === 'stretch' ? [rel('$b', 'sameHeight', '$a')] : []),
      ...(value === 'center' ? [{ kind: 'rel', sel: '$b', rel: 'sameCenterY', sel2: '$a', tol: 2 } as Check] : []),
    ],
  })
}

add({
  id: 'flex-order',
  group: 'flex',
  label: 'ORDER: A gets order 3, B and C keep 0',
  expectation: 'The row reads B C A.',
  blocks: [section('p', ['p'], [
    heading('a', ['bx', 'ord'], 'A'), heading('b', ['bx'], 'B'), heading('c', ['bx'], 'C'),
  ])],
  classes: [
    cls('p', { display: 'flex', 'flex-direction': 'row', gap: '0px' }),
    BX,
    cls('ord', { order: '3' }),
  ],
  covers: ['order'],
  checks: [computed('$a', 'order', '3'), order(['$b', '$c', '$a'], 'x')],
})

add({
  id: 'flex-grow',
  group: 'flex',
  label: 'FLEX GROW: A grows, B and C do not',
  expectation: 'A fills the leftover space; B and C stay 60px.',
  blocks: [section('p', ['p'], [heading('a', ['grow'], 'A'), heading('b', ['bx'], 'B'), heading('c', ['bx'], 'C')])],
  classes: [
    cls('p', { display: 'flex', 'flex-direction': 'row', gap: '0px' }),
    cls('grow', { width: '60px', height: '40px', 'flex-grow': '1', 'background-color': '#fca5a5' }),
    BX,
  ],
  covers: ['flex-grow'],
  checks: [
    computed('$a', 'flexGrow', '1'),
    { kind: 'rect', sel: '$a', box: 'width', op: 'gt', expect: 200 },
    rect('$b', 'width', 60),
    inset('$c', 'right', '$p~c', 0),
  ],
})

add({
  id: 'flex-shrink',
  group: 'flex',
  label: 'FLEX SHRINK: A refuses to shrink',
  expectation: 'Three 50% children in a nowrap row. A keeps half the container, B and C absorb the overflow.',
  blocks: [section('p', ['p'], [heading('a', ['noshrink'], 'A'), heading('b', ['half'], 'B'), heading('c', ['half'], 'C')])],
  classes: [
    cls('p', { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'nowrap', gap: '0px' }),
    cls('noshrink', { width: '50%', height: '40px', 'flex-shrink': '0', 'background-color': '#fca5a5' }),
    cls('half', { width: '50%', height: '40px', 'background-color': '#c7d2fe' }),
  ],
  covers: ['flex-shrink'],
  checks: [
    computed('$a', 'flexShrink', '0'),
    rel('$a', 'ratioCW', '$p~c', { expect: 0.5, tol: 0.02 }),
    { kind: 'rel', sel: '$b', rel: 'ratioCW', sel2: '$p~c', expect: 0.5, op: 'lt', tol: 0.02 },
  ],
})

add({
  id: 'flex-combo-row-center-center',
  group: 'flex',
  label: 'COMBO: row + justify center + align center',
  expectation: 'Three boxes centred horizontally, and vertically against the tall one.',
  blocks: [section('p', ['p'], [heading('a', ['tall'], 'A'), heading('b', ['auto'], 'B'), heading('c', ['auto'], 'C')])],
  classes: [
    cls('p', { display: 'flex', 'flex-direction': 'row', 'justify-content': 'center', 'align-items': 'center', gap: '0px' }),
    cls('tall', { width: '60px', height: '80px', 'background-color': '#a5b4fc' }),
    cls('auto', { width: '60px', 'background-color': '#c7d2fe' }),
  ],
  covers: ['flex-direction', 'justify-content', 'align-items'],
  checks: [
    computed('$p~c', 'justifyContent', 'center'),
    computed('$p~c', 'alignItems', 'center'),
    { kind: 'rel', sel: '$a', rel: 'sameCenterY', sel2: '$b', tol: 2 },
    { kind: 'inset', sel: '$a', side: 'left', sel2: '$p~c', expect: 0, op: 'gt', tol: 1.5 },
  ],
})

add({
  id: 'flex-combo-column-between-stretch',
  group: 'flex',
  label: 'COMBO: column + space-between + align stretch',
  expectation: 'Boxes stack and stretch to full width. NOTE: the column has no free space because height lands on the outer wrapper, not on this content element, so space-between has nothing to distribute.',
  blocks: [section('p', ['p'], [heading('a', ['bxw'], 'A'), heading('b', ['bxw'], 'B'), heading('c', ['bxw'], 'C')])],
  classes: [
    cls('p', { display: 'flex', 'flex-direction': 'column', 'justify-content': 'space-between', 'align-items': 'stretch', height: '260px', gap: '0px' }),
    BXW,
  ],
  covers: ['flex-direction', 'justify-content', 'align-items', 'height'],
  checks: [
    computed('$p~c', 'justifyContent', 'space-between'),
    computed('$p', 'height', '260px'),
    rel('$a', 'ratioCW', '$p~c', { expect: 1, tol: 0.02 }),
    { kind: 'rel', sel: '$a', rel: 'gapY', sel2: '$b', expect: 0, op: 'gt', tol: 1.5, note: 'Free space only exists if the height reached the flex container' },
  ],
})

add({
  id: 'flex-combo-row-wrap-gap',
  group: 'flex',
  label: 'COMBO: row + wrap + gap 24px',
  expectation: 'Two 40% boxes on line one separated by exactly 24px, the third wraps below with a 24px row gap.',
  blocks: [section('p', ['p'], flexKids())],
  classes: [
    cls('p', { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '24px' }),
    cls('bx', { width: '40%', height: '40px', 'background-color': '#c7d2fe' }),
  ],
  covers: ['flex-wrap', 'gap'],
  checks: [
    computed('$p~c', 'gap', '24px'),
    rel('$a', 'gapX', '$b', { expect: 24, tol: 1 }),
    rel('$a', 'gapY', '$c', { expect: 24, tol: 1 }),
  ],
})

add({
  id: 'flex-combo-mixed-grow',
  group: 'flex',
  label: 'COMBO: row with grow 1 / grow 2 / fixed',
  expectation: 'B takes twice the leftover space A does; C stays 60px.',
  blocks: [section('p', ['p'], [heading('a', ['g1'], 'A'), heading('b', ['g2'], 'B'), heading('c', ['bx'], 'C')])],
  classes: [
    cls('p', { display: 'flex', 'flex-direction': 'row', gap: '0px' }),
    cls('g1', { height: '40px', 'flex-grow': '1', 'background-color': '#fca5a5' }),
    cls('g2', { height: '40px', 'flex-grow': '2', 'background-color': '#fdba74' }),
    BX,
  ],
  covers: ['flex-grow'],
  checks: [
    rect('$c', 'width', 60),
    rel('$b', 'ratioW', '$a', { expect: 2, tol: 0.05 }),
  ],
})

add({
  id: 'flex-combo-orders',
  group: 'flex',
  label: 'COMBO: row with orders 2 / 1 / 0',
  expectation: 'The row reads C B A.',
  blocks: [section('p', ['p'], [heading('a', ['o2'], 'A'), heading('b', ['o1'], 'B'), heading('c', ['o0'], 'C')])],
  classes: [
    cls('p', { display: 'flex', 'flex-direction': 'row', gap: '0px' }),
    cls('o2', { width: '60px', height: '40px', order: '2', 'background-color': '#fca5a5' }),
    cls('o1', { width: '60px', height: '40px', order: '1', 'background-color': '#fdba74' }),
    cls('o0', { width: '60px', height: '40px', order: '0', 'background-color': '#c7d2fe' }),
  ],
  covers: ['order'],
  checks: [order(['$c', '$b', '$a'], 'x')],
})

add({
  id: 'flex-combo-fixed-plus-grow',
  group: 'flex',
  label: 'COMBO: fixed 120px child + growing child',
  expectation: 'A stays exactly 120px however wide the row is; B eats the rest.',
  blocks: [section('p', ['p'], [heading('a', ['fixed'], 'A'), heading('b', ['g1'], 'B')])],
  classes: [
    cls('p', { display: 'flex', 'flex-direction': 'row', gap: '0px' }),
    cls('fixed', { width: '120px', height: '40px', 'flex-grow': '0', 'flex-shrink': '0', 'background-color': '#fca5a5' }),
    cls('g1', { height: '40px', 'flex-grow': '1', 'background-color': '#c7d2fe' }),
  ],
  covers: ['width', 'flex-grow', 'flex-shrink'],
  checks: [
    rect('$a', 'width', 120),
    inset('$b', 'right', '$p~c', 0),
    { kind: 'rect', sel: '$b', box: 'width', op: 'gt', expect: 300 },
  ],
})

/* ════════════════════════════════════════════════════════════════════════
   5. GRID - only what the registry exposes.
   ════════════════════════════════════════════════════════════════════════ */

const gridKids = (): FixtureBlock[] => [
  heading('a', ['bxw'], 'A'), heading('b', ['bxw'], 'B'),
  heading('c', ['bxw'], 'C'), heading('d', ['bxw'], 'D'),
]

const GRID_TEMPLATES: Array<[string, string, Check[]]> = [
  ['1col', '1fr', [rel('$b', 'below', '$a'), rel('$a', 'ratioCW', '$p~c', { expect: 1, tol: 0.02 })]],
  ['2col', '1fr 1fr', [rel('$b', 'rightOf', '$a'), rel('$c', 'below', '$a'), rel('$a', 'sameWidth', '$b')]],
  ['3col', '1fr 1fr 1fr', [rel('$c', 'rightOf', '$b'), rel('$d', 'below', '$a'), rel('$a', 'sameWidth', '$c')]],
  ['4col', '1fr 1fr 1fr 1fr', [rel('$d', 'rightOf', '$c'), rel('$a', 'sameTop', '$d')]],
  ['1fr2fr', '1fr 2fr', [rel('$b', 'ratioW', '$a', { expect: 2, tol: 0.05 })]],
  ['auto1fr', 'auto 1fr', [rel('$b', 'rightOf', '$a'), rel('$b', 'wider', '$a')]],
  ['repeat3', 'repeat(3, 1fr)', [rel('$c', 'rightOf', '$b'), rel('$a', 'sameWidth', '$b'), rel('$d', 'below', '$a')]],
  ['minmax', 'minmax(100px, 1fr) 1fr', [rel('$b', 'rightOf', '$a'), { kind: 'rect', sel: '$a', box: 'width', op: 'gte', expect: 100 }]],
]

for (const [id, template, geometry] of GRID_TEMPLATES) {
  add({
    id: `grid-template-${id}`,
    group: 'grid',
    label: `GRID TEMPLATE COLUMNS: ${template}`,
    expectation: `Four boxes placed into tracks "${template}".`,
    blocks: [section('p', ['p'], gridKids())],
    classes: [cls('p', { display: 'grid', 'grid-template-columns': template, gap: '0px' }), BXW],
    covers: ['display', 'grid-template-columns'],
    checks: [computed('$p~c', 'display', 'grid'), ...geometry],
  })
}

add({
  id: 'grid-justify-center',
  group: 'grid',
  label: 'GRID + JUSTIFY CONTENT: center',
  expectation: 'Two 100px tracks centred in the container.',
  blocks: [section('p', ['p'], [heading('a', ['bxw'], 'A'), heading('b', ['bxw'], 'B')])],
  classes: [cls('p', { display: 'grid', 'grid-template-columns': '100px 100px', 'justify-content': 'center', gap: '0px' }), BXW],
  covers: ['grid-template-columns', 'justify-content'],
  checks: [
    computed('$p~c', 'justifyContent', 'center'),
    rect('$a', 'width', 100),
    { kind: 'rel', sel: '$a', rel: 'sameCenterX', sel2: '$p~c', tol: 60 },
    { kind: 'inset', sel: '$a', side: 'left', sel2: '$p~c', expect: 0, op: 'gt', tol: 1.5 },
  ],
})

add({
  id: 'grid-align-center',
  group: 'grid',
  label: 'GRID + ALIGN ITEMS: center',
  expectation: 'A short cell centres vertically against a tall neighbour.',
  blocks: [section('p', ['p'], [heading('a', ['tall'], 'A'), heading('b', ['auto'], 'B')])],
  classes: [
    cls('p', { display: 'grid', 'grid-template-columns': '1fr 1fr', 'align-items': 'center', gap: '0px' }),
    cls('tall', { height: '90px', 'background-color': '#a5b4fc' }),
    cls('auto', { 'background-color': '#c7d2fe' }),
  ],
  covers: ['align-items'],
  checks: [
    computed('$p~c', 'alignItems', 'center'),
    { kind: 'rel', sel: '$b', rel: 'sameCenterY', sel2: '$a', tol: 2 },
  ],
})

add({
  id: 'grid-gap',
  group: 'grid',
  label: 'GRID + GAP 32px',
  expectation: 'Exactly 32px between columns and rows.',
  blocks: [section('p', ['p'], gridKids())],
  classes: [cls('p', { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '32px' }), BXW],
  covers: ['gap'],
  checks: [
    computed('$p~c', 'gap', '32px'),
    rel('$a', 'gapX', '$b', { expect: 32, tol: 1 }),
    rel('$a', 'gapY', '$c', { expect: 32, tol: 1 }),
  ],
})

/* ════════════════════════════════════════════════════════════════════════
   6. SIZING
   ════════════════════════════════════════════════════════════════════════ */

const sized = (id: string, label: string, props: Record<string, unknown>, checks: Check[], covers: string[]): void => {
  add({
    id: `sizing-${id}`,
    group: 'sizing',
    label,
    expectation: label,
    blocks: [section('p', ['p'], [heading('s', ['s'], 'S')])],
    classes: [cls('p', { display: 'block' }), cls('s', { 'background-color': '#c7d2fe', ...props })],
    covers,
    checks,
  })
}

sized('width-px', 'WIDTH: 200px', { width: '200px', height: '40px' }, [computed('$s', 'width', '200px'), rect('$s', 'width', 200)], ['width'])
sized('width-pct', 'WIDTH: 50%', { width: '50%', height: '40px' }, [rel('$s', 'ratioCW', '$p~c', { expect: 0.5, tol: 0.01 })], ['width'])
sized('width-rem', 'WIDTH: 10rem', { width: '10rem', height: '40px' }, [rect('$s', 'width', 160)], ['width'])
sized('width-em', 'WIDTH: 10em with font-size 20px', { width: '10em', height: '40px', 'font-size': '20px' }, [rect('$s', 'width', 200)], ['width', 'font-size'])
sized('width-vw', 'WIDTH: 10vw at a 1280px viewport', { width: '10vw', height: '40px' }, [{ ...rect('$s', 'width', 128), viewport: { width: 1280, height: 900 } }], ['width'])
sized('height-vh', 'HEIGHT: 30vh at a 900px viewport', { width: '100px', height: '30vh' }, [{ ...rect('$s', 'height', 270), viewport: { width: 1280, height: 900 } }], ['height'])
sized('width-auto', 'WIDTH: auto', { width: 'auto', height: '40px' }, [rel('$s', 'ratioCW', '$p~c', { expect: 1, tol: 0.02 })], ['width'])
sized('height-px', 'HEIGHT: 120px', { width: '100px', height: '120px' }, [computed('$s', 'height', '120px'), rect('$s', 'height', 120)], ['height'])
sized('minwidth', 'WIDTH 100px + MIN WIDTH 300px', { width: '100px', 'min-width': '300px', height: '40px' }, [rect('$s', 'width', 300)], ['width', 'min-width'])
sized('maxwidth', 'WIDTH 400px + MAX WIDTH 200px', { width: '400px', 'max-width': '200px', height: '40px' }, [rect('$s', 'width', 200)], ['width', 'max-width'])
sized('minheight', 'HEIGHT 20px + MIN HEIGHT 90px', { width: '100px', height: '20px', 'min-height': '90px' }, [rect('$s', 'height', 90)], ['height', 'min-height'])
sized('maxheight', 'HEIGHT 200px + MAX HEIGHT 60px', { width: '100px', height: '200px', 'max-height': '60px' }, [rect('$s', 'height', 60)], ['height', 'max-height'])
sized('height-pct-auto-parent', 'HEIGHT: 50% inside an auto-height parent', { width: '100px', height: '50%' }, [computed('$s', 'height', '0px', { op: 'ne', note: 'A percentage height against an indefinite parent resolves to auto' })], ['height'])
sized('width-fit-content', 'WIDTH: fit-content', { width: 'fit-content', height: '40px' }, [{ kind: 'rect', sel: '$s', box: 'width', op: 'lt', expect: 900 }], ['width'])
sized('width-min-content', 'WIDTH: min-content', { width: 'min-content', height: '40px' }, [{ kind: 'rect', sel: '$s', box: 'width', op: 'lt', expect: 200 }], ['width'])
sized('width-max-content', 'WIDTH: max-content', { width: 'max-content', height: '40px' }, [{ kind: 'rect', sel: '$s', box: 'width', op: 'lt', expect: 900 }], ['width'])

add({
  id: 'sizing-width-in-flex',
  group: 'sizing',
  label: 'WIDTH 200px on a flex item (no grow, no shrink pressure)',
  expectation: 'The item is exactly 200px inside a flex row.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S'), heading('t', ['t'], 'T')])],
  classes: [
    cls('p', { display: 'flex', 'flex-direction': 'row', gap: '0px' }),
    cls('s', { width: '200px', height: '40px', 'background-color': '#c7d2fe' }),
    cls('t', { width: '60px', height: '40px', 'background-color': '#bbf7d0' }),
  ],
  covers: ['width'],
  checks: [rect('$s', 'width', 200)],
})

add({
  id: 'sizing-width-in-grid',
  group: 'sizing',
  label: 'WIDTH 50% on a grid item',
  expectation: 'The item fills half its track, not half the container.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S'), heading('t', ['t'], 'T')])],
  classes: [
    cls('p', { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '0px' }),
    cls('s', { width: '50%', height: '40px', 'background-color': '#c7d2fe' }),
    cls('t', { height: '40px', 'background-color': '#bbf7d0' }),
  ],
  covers: ['width'],
  checks: [rel('$s', 'ratioW', '$t', { expect: 0.5, tol: 0.02 })],
})

add({
  id: 'sizing-grow-plus-width',
  group: 'sizing',
  label: 'WIDTH 100px + FLEX GROW 1',
  expectation: 'Grow wins over the base width: the item ends up far wider than 100px.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S'), heading('t', ['t'], 'T')])],
  classes: [
    cls('p', { display: 'flex', 'flex-direction': 'row', gap: '0px' }),
    cls('s', { width: '100px', height: '40px', 'flex-grow': '1', 'background-color': '#c7d2fe' }),
    cls('t', { width: '60px', height: '40px', 'background-color': '#bbf7d0' }),
  ],
  covers: ['width', 'flex-grow'],
  checks: [{ kind: 'rect', sel: '$s', box: 'width', op: 'gt', expect: 300 }],
})

/* ════════════════════════════════════════════════════════════════════════
   7. BOX MODEL
   ════════════════════════════════════════════════════════════════════════ */

add({
  id: 'boxmodel-padding-sides',
  group: 'boxmodel',
  label: 'PADDING: 10 / 20 / 30 / 40 per side',
  expectation: 'The four paddings are independent and the inner text sits inside all four.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('s', { 'padding-top': '10px', 'padding-right': '20px', 'padding-bottom': '30px', 'padding-left': '40px', 'background-color': '#c7d2fe' }),
  ],
  covers: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  checks: [
    computed('$s', 'paddingTop', '10px'),
    computed('$s', 'paddingRight', '20px'),
    computed('$s', 'paddingBottom', '30px'),
    computed('$s', 'paddingLeft', '40px'),
    inset('$s .tg-heading', 'left', '$s', 0),
  ],
})

add({
  id: 'boxmodel-margin-sides',
  group: 'boxmodel',
  label: 'MARGIN: 12 / 24 / 36 / 48 per side',
  expectation: 'The box is inset from its container by the four margins.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S'), heading('t', ['t'], 'T')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('s', { 'margin-top': '12px', 'margin-right': '24px', 'margin-bottom': '36px', 'margin-left': '48px', height: '40px', 'background-color': '#c7d2fe' }),
    cls('t', { height: '40px', 'background-color': '#bbf7d0' }),
  ],
  covers: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  checks: [
    computed('$s', 'marginTop', '12px'),
    computed('$s', 'marginRight', '24px'),
    computed('$s', 'marginBottom', '36px'),
    computed('$s', 'marginLeft', '48px'),
    inset('$s', 'left', '$p~c', 48),
    inset('$s', 'right', '$p~c', 24),
    rel('$s', 'gapY', '$t', { expect: 36, tol: 1 }),
  ],
})

add({
  id: 'boxmodel-negative-margin',
  group: 'boxmodel',
  label: 'MARGIN LEFT: -20px',
  expectation: 'The box hangs 20px outside its container content box.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S')])],
  classes: [cls('p', { display: 'block' }), cls('s', { 'margin-left': '-20px', height: '40px', 'background-color': '#c7d2fe' })],
  covers: ['margin-left'],
  checks: [computed('$s', 'marginLeft', '-20px'), inset('$s', 'left', '$p~c', -20)],
})

add({
  id: 'boxmodel-auto-margins',
  group: 'boxmodel',
  label: 'MARGIN LEFT/RIGHT: auto with a 200px width',
  expectation: 'The box is centred: equal space either side.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S')])],
  classes: [cls('p', { display: 'block' }), cls('s', { width: '200px', height: '40px', 'margin-left': 'auto', 'margin-right': 'auto', 'background-color': '#c7d2fe' })],
  covers: ['margin-left', 'margin-right'],
  checks: [
    rect('$s', 'width', 200),
    { kind: 'rel', sel: '$s', rel: 'sameCenterX', sel2: '$p~c', tol: 2 },
  ],
})

add({
  id: 'boxmodel-border-sides',
  group: 'boxmodel',
  label: 'BORDER: solid, per-side widths 2 / 4 / 6 / 8',
  expectation: 'Four different border widths, all in the same colour.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('s', {
      'border-style': 'solid', 'border-color': '#4338ca',
      'border-top-width': '2px', 'border-right-width': '4px',
      'border-bottom-width': '6px', 'border-left-width': '8px',
      width: '200px', height: '40px', 'background-color': '#e0e7ff',
    }),
  ],
  covers: ['border-style', 'border-color', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  checks: [
    computed('$s', 'borderTopWidth', '2px'),
    computed('$s', 'borderRightWidth', '4px'),
    computed('$s', 'borderBottomWidth', '6px'),
    computed('$s', 'borderLeftWidth', '8px'),
    computed('$s', 'borderTopStyle', 'solid'),
    computed('$s', 'borderTopColor', 'rgb(67, 56, 202)'),
    rect('$s', 'width', 200, { note: 'border-box: the kit ships no box-sizing, and both hosts set border-box globally' }),
    rect('$s', 'height', 40, { note: 'border-box: borders eat into the declared size' }),
  ],
})

/* ════════════════════════════════════════════════════════════════════════
   8. TOKENS - the reference is the source of truth, the var is derived.
   ════════════════════════════════════════════════════════════════════════ */

add({
  id: 'tokens-literal-vs-ref',
  group: 'tokens',
  label: 'TOKEN vs LITERAL: padding-left 64px against {space.lg}',
  expectation: 'Identical geometry. --tg-space-lg is 4rem, so both are 64px.',
  blocks: [section('p', ['p'], [heading('lit', ['lit'], 'literal'), heading('tok', ['tok'], 'token')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('lit', { 'padding-left': '64px', height: '40px', 'background-color': '#c7d2fe' }),
    cls('tok', { 'padding-left': '{space.lg}', height: '40px', 'background-color': '#bbf7d0' }),
  ],
  covers: ['padding-left'],
  checks: [
    computed('$lit', 'paddingLeft', '64px'),
    computed('$tok', 'paddingLeft', '64px'),
    css('contains', 'padding-left:var(--tg-space-lg)'),
  ],
})

add({
  id: 'tokens-gap',
  group: 'tokens',
  label: 'TOKEN: gap {space.md}',
  expectation: 'A 32px gap between the boxes (--tg-space-md is 2rem).',
  blocks: [section('p', ['p'], [heading('a', ['bx'], 'A'), heading('b', ['bx'], 'B')])],
  classes: [cls('p', { display: 'flex', 'flex-direction': 'row', gap: '{space.md}' }), BX],
  covers: ['gap'],
  checks: [computed('$p~c', 'gap', '32px'), rel('$a', 'gapX', '$b', { expect: 32, tol: 1 })],
})

add({
  id: 'tokens-width',
  group: 'tokens',
  label: 'TOKEN: width {width.narrow}',
  expectation: '640px wide (--tg-width-narrow is 40rem).',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S')])],
  classes: [cls('p', { display: 'block' }), cls('s', { width: '{width.narrow}', height: '40px', 'background-color': '#c7d2fe' })],
  covers: ['width'],
  checks: [rect('$s', 'width', 640)],
})

add({
  id: 'tokens-radius',
  group: 'tokens',
  label: 'TOKEN: border-top-left-radius {radius.md}',
  expectation: '12px corner (--tg-radius-md is 0.75rem).',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S')])],
  classes: [cls('p', { display: 'block' }), cls('s', { 'border-top-left-radius': '{radius.md}', width: '120px', height: '60px', 'background-color': '#4338ca' })],
  covers: ['border-top-left-radius'],
  checks: [computed('$s', 'borderTopLeftRadius', '12px')],
})

add({
  id: 'tokens-palette-split',
  group: 'tokens',
  label: 'TOKEN: {palette.brand} resolves to bg on a background and fg on text',
  expectation: 'Background #4338ca, text #ffffff, from ONE token reference.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'Brand')])],
  classes: [cls('p', { display: 'block' }), cls('s', { 'background-color': '{palette.brand}', color: '{palette.brand}', width: '200px', height: '40px' })],
  covers: ['background-color', 'color'],
  checks: [
    computed('$s', 'backgroundColor', 'rgb(67, 56, 202)'),
    computed('$s .tg-heading', 'color', 'rgb(255, 255, 255)'),
    css('contains', '$s{background-color:var(--tg-bg-brand)'),
  ],
})

add({
  id: 'tokens-wrong-family',
  group: 'tokens',
  label: 'TOKEN: a palette reference on a spacing property is DROPPED',
  expectation: 'padding-left stays 0. A wrong-family reference must never reach the stylesheet.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S')])],
  classes: [cls('p', { display: 'block' }), cls('s', { 'padding-left': '{palette.brand}', height: '40px', 'background-color': '#c7d2fe' })],
  covers: ['padding-left'],
  checks: [
    computed('$s', 'paddingLeft', '0px'),
    css('notContains', 'padding-left:var(--tg-bg-brand)'),
  ],
})

add({
  id: 'tokens-at-breakpoint',
  group: 'tokens',
  label: 'TOKEN at a BREAKPOINT: padding-top base 0, tablet {space.md}',
  expectation: '0px at desktop, 32px at tablet and mobile.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('s', { 'padding-top': { base: '0px', tablet: '{space.md}' }, height: '40px', 'background-color': '#c7d2fe' }),
  ],
  covers: ['padding-top'],
  checks: [
    { ...computed('$s', 'paddingTop', '0px'), viewport: { width: 1280, height: 900 } },
    { ...computed('$s', 'paddingTop', '32px'), viewport: { width: 900, height: 900 } },
    { ...computed('$s', 'paddingTop', '32px'), viewport: { width: 600, height: 900 } },
  ],
})

add({
  id: 'tokens-at-state',
  group: 'tokens',
  label: 'TOKEN at a STATE: background base #eeeeee, hover {palette.brand}',
  expectation: 'Grey normally, #4338ca on hover, grey again after.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'Hover me')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('s', { 'background-color': { base: '#eeeeee', hover: { base: '{palette.brand}' } }, width: '200px', height: '40px' }),
  ],
  covers: ['background-color'],
  checks: [
    computed('$s', 'backgroundColor', 'rgb(238, 238, 238)'),
    { ...computed('$s', 'backgroundColor', 'rgb(67, 56, 202)'), state: 'hover' },
  ],
})

/* ════════════════════════════════════════════════════════════════════════
   9. POSITION
   ════════════════════════════════════════════════════════════════════════ */

add({
  id: 'position-static',
  group: 'position',
  label: 'POSITION: static with offsets set',
  expectation: 'Offsets are ignored on a static box - it stays in flow.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S'), heading('t', ['t'], 'T')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('s', { position: 'static', top: '40px', left: '40px', height: '40px', 'background-color': '#c7d2fe' }),
    cls('t', { height: '40px', 'background-color': '#bbf7d0' }),
  ],
  covers: ['position', 'top', 'left'],
  checks: [computed('$s', 'position', 'static'), inset('$s', 'left', '$p~c', 0), inset('$s', 'top', '$p~c', 0)],
})

add({
  id: 'position-relative',
  group: 'position',
  label: 'POSITION: relative, top 20 left 30',
  expectation: 'The box shifts 20 down and 30 right; the box after it does NOT move.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S'), heading('t', ['t'], 'T')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('s', { position: 'relative', top: '20px', left: '30px', height: '40px', 'background-color': '#c7d2fe' }),
    cls('t', { height: '40px', 'background-color': '#bbf7d0' }),
  ],
  covers: ['position', 'top', 'left'],
  checks: [
    computed('$s', 'position', 'relative'),
    inset('$s', 'left', '$p~c', 30),
    inset('$s', 'top', '$p~c', 20),
    inset('$t', 'top', '$p~c', 40, { note: 'The static sibling keeps its flow position' }),
  ],
})

add({
  id: 'position-absolute-in-relative',
  group: 'position',
  label: 'CONTAINING BLOCK: relative parent > absolute child',
  expectation: 'The child is placed 10 from the top and 20 from the left of the PARENT.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'abs')])],
  classes: [
    cls('p', { display: 'block', position: 'relative', height: '160px', 'background-color': '#f1f5f9' }),
    cls('s', { position: 'absolute', top: '10px', left: '20px', width: '80px', height: '40px', 'background-color': '#c7d2fe' }),
  ],
  covers: ['position', 'top', 'left', 'height'],
  checks: [
    computed('$s', 'position', 'absolute'),
    { kind: 'inset', sel: '$s', side: 'left', sel2: '$p', expect: 20, tol: 1.5 },
    { kind: 'inset', sel: '$s', side: 'top', sel2: '$p', expect: 10, tol: 1.5 },
  ],
})

add({
  id: 'position-absolute-right-bottom',
  group: 'position',
  label: 'OFFSETS: right 12 and bottom 18 on an absolute child',
  expectation: 'The child hugs the bottom-right of its positioned parent.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'abs')])],
  classes: [
    cls('p', { display: 'block', position: 'relative', height: '160px', 'background-color': '#f1f5f9' }),
    cls('s', { position: 'absolute', right: '12px', bottom: '18px', width: '80px', height: '40px', 'background-color': '#c7d2fe' }),
  ],
  covers: ['position', 'right', 'bottom'],
  checks: [
    computed('$s', 'right', '12px'),
    computed('$s', 'bottom', '18px'),
    { kind: 'inset', sel: '$s', side: 'right', sel2: '$p', expect: 12, tol: 1.5 },
    { kind: 'inset', sel: '$s', side: 'bottom', sel2: '$p', expect: 18, tol: 1.5 },
  ],
})

add({
  id: 'position-absolute-in-static',
  group: 'position',
  label: 'CONTAINING BLOCK: static parent > absolute child',
  expectation: 'With no positioned ancestor the child resolves against the initial containing block, so it lands at 10 / 20 from the document origin.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'abs')])],
  classes: [
    cls('p', { display: 'block', height: '160px', 'background-color': '#f1f5f9' }),
    cls('s', { position: 'absolute', top: '10px', left: '20px', width: '80px', height: '40px', 'background-color': '#c7d2fe' }),
  ],
  covers: ['position', 'top', 'left'],
  checks: [computed('$s', 'position', 'absolute'), rect('$s', 'left', 20, { tol: 2 })],
  harnessOnly: true,
})

add({
  id: 'position-fixed',
  group: 'position',
  label: 'CONTAINING BLOCK: viewport > fixed child',
  expectation: 'The box pins to 15 from the top and 25 from the left of the VIEWPORT.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'fixed')])],
  classes: [
    cls('p', { display: 'block', height: '120px', 'background-color': '#f1f5f9' }),
    cls('s', { position: 'fixed', top: '15px', left: '25px', width: '80px', height: '40px', 'background-color': '#fca5a5' }),
  ],
  covers: ['position', 'top', 'left'],
  checks: [computed('$s', 'position', 'fixed'), rect('$s', 'top', 15), rect('$s', 'left', 25)],
  harnessOnly: true,
})

add({
  id: 'position-sticky',
  group: 'position',
  label: 'CONTAINING BLOCK: scrolling parent > sticky child',
  expectation: 'Scroll the parent 100px and the sticky box stays pinned to the parent top.',
  blocks: [section('p', ['p'], [
    heading('s', ['s'], 'sticky'),
    heading('t1', ['tallish'], 'one'), heading('t2', ['tallish'], 'two'), heading('t3', ['tallish'], 'three'),
  ])],
  classes: [
    cls('p', { display: 'block', height: '150px', overflow: 'auto', 'background-color': '#f1f5f9' }),
    cls('s', { position: 'sticky', top: '0px', height: '40px', 'background-color': '#fca5a5' }),
    cls('tallish', { height: '120px', 'background-color': '#e0e7ff' }),
  ],
  covers: ['position', 'top', 'overflow', 'height'],
  checks: [
    computed('$s', 'position', 'sticky'),
    { kind: 'inset', sel: '$s', side: 'top', sel2: '$p', expect: 0, tol: 2, preScroll: { sel: '$p', top: 100 } },
  ],
  harnessOnly: true,
})

add({
  id: 'position-zindex',
  group: 'position',
  label: 'Z INDEX: the higher one paints on top',
  expectation: 'Two overlapping absolute boxes; the z-index 5 box is the one you hit.',
  blocks: [section('p', ['p'], [heading('lo', ['lo'], 'low'), heading('hi', ['hi'], 'high')])],
  classes: [
    cls('p', { display: 'block', position: 'relative', height: '160px', 'background-color': '#f1f5f9' }),
    cls('lo', { position: 'absolute', top: '20px', left: '20px', width: '120px', height: '80px', 'z-index': '1', 'background-color': '#fca5a5' }),
    cls('hi', { position: 'absolute', top: '40px', left: '40px', width: '120px', height: '80px', 'z-index': '5', 'background-color': '#86efac' }),
  ],
  covers: ['position', 'z-index'],
  checks: [
    computed('$hi', 'zIndex', '5'),
    computed('$lo', 'zIndex', '1'),
    { kind: 'elementAt', sel: '$hi', sel2: '$lo', note: 'probe the centre of the LOW box, which the high one overlaps' },
  ],
  harnessOnly: true,
})

/* ════════════════════════════════════════════════════════════════════════
   10. OVERFLOW
   ════════════════════════════════════════════════════════════════════════ */

const overflowKids = (): FixtureBlock[] => [
  heading('k1', ['bxw'], 'one'), heading('k2', ['bxw'], 'two'),
  heading('k3', ['bxw'], 'three'), heading('k4', ['bxw'], 'four'),
]

for (const value of ['visible', 'hidden', 'scroll', 'auto'] as const) {
  const scrollable = value === 'scroll' || value === 'auto'
  add({
    id: `overflow-${value}`,
    group: 'overflow',
    label: `OVERFLOW: ${value} on a 120px box with 240px of content`,
    expectation: value === 'visible'
      ? 'Content spills below the box.'
      : value === 'hidden' ? 'Content is clipped and cannot be scrolled.'
      : 'Content is clipped and CAN be scrolled.',
    blocks: [section('p', ['p'], overflowKids())],
    classes: [
      cls('p', { display: 'block', height: '120px', overflow: value, 'background-color': '#f1f5f9' }),
      cls('bxw', { height: '60px', 'background-color': '#c7d2fe' }),
    ],
    covers: ['overflow', 'height'],
    checks: [
      computed('$p', 'overflow', value),
      { kind: 'scroll', sel: '$p', metric: 'clientHeight', expect: 120, tol: 1 },
      { kind: 'scroll', sel: '$p', metric: 'scrollHeight', op: 'gt', expect: 120 },
      { kind: 'scroll', sel: '$p', metric: 'scrollTop', op: value === 'visible' ? 'eq' : 'gt', expect: 0, preScroll: { sel: '$p', top: 50 }, note: value === 'visible' ? 'not a scroll container' : 'a scroll container, with or without a scrollbar' },
    ],
    harnessOnly: true,
  })
}

/* ════════════════════════════════════════════════════════════════════════
   11. TYPOGRAPHY - every registry property, and inheritance.
   ════════════════════════════════════════════════════════════════════════ */

const typo = (id: string, label: string, props: Record<string, unknown>, checks: Check[], covers: string[], fonts?: Fixture['fonts']): void => {
  add({
    id: `typography-${id}`,
    group: 'typography',
    label,
    expectation: label,
    blocks: [section('p', ['p'], [heading('h', ['h'], 'Heading sample'), textBlock('t', ['t'], 'Body sample text')])],
    classes: [cls('p', { display: 'block' }), cls('h', props), cls('t', props)],
    covers,
    checks,
    fonts,
  })
}

// font-family is tokens-only: a literal family nothing loads is exactly the
// dead control the inventory found, so the fixture names a configured font.
typo('font-family', 'FONT FAMILY: the {font.serif} token, a Georgia stack', { 'font-family': '{font.serif}' }, [
  { kind: 'computed', sel: '$h .tg-heading', prop: 'fontFamily', expect: 'Georgia', op: 'contains' },
  { kind: 'computed', sel: '$t .tg-text', prop: 'fontFamily', expect: 'Georgia', op: 'contains' },
  css('contains', '$h--text{font-family:var(--tg-font-serif)}'),
], ['font-family'], [{ name: 'serif', stack: 'Georgia, serif' }])

typo('font-size', 'FONT SIZE: 40px', { 'font-size': '40px' }, [
  computed('$h', 'fontSize', '40px', { note: 'an absolute size is declared on the wrapper too, so em units there resolve against it' }),
  computed('$h .tg-heading', 'fontSize', '40px', { note: 'must reach the heading the designer sees' }),
  computed('$t .tg-text', 'fontSize', '40px', { note: 'must reach the body text' }),
], ['font-size'])

// Typography lands on the element the text lives in (.name--text), never on
// the wrapper div: that is what lets it outrank the kit's own size classes.
typo('font-weight', 'FONT WEIGHT: 300', { 'font-weight': '300' }, [
  computed('$h .tg-heading', 'fontWeight', '300'),
  computed('$t .tg-text', 'fontWeight', '300'),
], ['font-weight'])

typo('line-height', 'LINE HEIGHT: 2', { 'line-height': '2' }, [
  computed('$h .tg-heading', 'lineHeight', '32px', { note: 'the heading is 16px at size base, so 2 computes to 32px' }),
], ['line-height'])

typo('letter-spacing', 'LETTER SPACING: 4px', { 'letter-spacing': '4px' }, [
  computed('$h .tg-heading', 'letterSpacing', '4px'),
  computed('$t .tg-text', 'letterSpacing', '4px'),
], ['letter-spacing'])

typo('text-align', 'TEXT ALIGN: center', { 'text-align': 'center' }, [
  computed('$h .tg-heading', 'textAlign', 'center'),
  computed('$t .tg-text', 'textAlign', 'center'),
], ['text-align'])

typo('color', 'COLOUR: #b91c1c', { color: '#b91c1c' }, [
  computed('$h .tg-heading', 'color', 'rgb(185, 28, 28)'),
  computed('$t .tg-text', 'color', 'rgb(185, 28, 28)'),
], ['color'])

typo('text-transform', 'TEXT TRANSFORM: uppercase', { 'text-transform': 'uppercase' }, [
  computed('$h .tg-heading', 'textTransform', 'uppercase'),
  computed('$t .tg-text', 'textTransform', 'uppercase'),
], ['text-transform'])

typo('text-decoration', 'TEXT DECORATION: underline', { 'text-decoration': 'underline' }, [
  { kind: 'computed', sel: '$h .tg-heading', prop: 'textDecorationLine', expect: 'underline' },
], ['text-decoration'])

add({
  id: 'typography-inheritance',
  group: 'typography',
  label: 'INHERITANCE: colour on the parent, one child overrides',
  expectation: 'Both children inherit red; the second is blue because it says so.',
  blocks: [section('p', ['p'], [heading('a', ['a'], 'Inherits red'), heading('b', ['b'], 'Overrides blue')])],
  classes: [
    cls('p', { display: 'block', color: '#b91c1c' }),
    cls('a', {}),
    cls('b', { color: '#1d4ed8' }),
  ],
  covers: ['color'],
  checks: [
    computed('$p~c', 'color', 'rgb(185, 28, 28)'),
    computed('$a', 'color', 'rgb(185, 28, 28)'),
    computed('$b .tg-heading', 'color', 'rgb(29, 78, 216)'),
    computed('$a .tg-heading', 'color', 'rgb(185, 28, 28)'),
  ],
})

/* ════════════════════════════════════════════════════════════════════════
   12. PAINT - background, borders, radius, effects.
   ════════════════════════════════════════════════════════════════════════ */

const paint = (id: string, label: string, props: Record<string, unknown>, checks: Check[], covers: string[]): void => {
  add({
    id: `paint-${id}`,
    group: 'paint',
    label,
    expectation: label,
    blocks: [section('p', ['p'], [heading('s', ['s'], 'S')])],
    classes: [cls('p', { display: 'block' }), cls('s', { width: '200px', height: '80px', ...props })],
    covers,
    checks,
  })
}

paint('background-color', 'BACKGROUND COLOUR: #4338ca', { 'background-color': '#4338ca' },
  [computed('$s', 'backgroundColor', 'rgb(67, 56, 202)')], ['background-color'])

paint('background-image', 'BACKGROUND IMAGE: linear-gradient', { 'background-image': 'linear-gradient(90deg, #f87171, #60a5fa)' },
  [{ kind: 'computed', sel: '$s', prop: 'backgroundImage', expect: 'linear-gradient', op: 'contains' }], ['background-image'])

for (const size of ['auto', 'cover', 'contain'] as const) {
  paint(`background-size-${size}`, `BACKGROUND SIZE: ${size}`,
    { 'background-image': 'linear-gradient(90deg, #f87171, #60a5fa)', 'background-size': size },
    [computed('$s', 'backgroundSize', size)], ['background-size'])
}
for (const pos of ['center', 'top', 'bottom', 'left', 'right'] as const) {
  paint(`background-position-${pos}`, `BACKGROUND POSITION: ${pos}`,
    { 'background-image': 'linear-gradient(90deg, #f87171, #60a5fa)', 'background-size': 'contain', 'background-position': pos },
    [{ kind: 'computed', sel: '$s', prop: 'backgroundPosition', expect: '%', op: 'contains' }], ['background-position'])
}
for (const rep of ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'] as const) {
  paint(`background-repeat-${rep}`, `BACKGROUND REPEAT: ${rep}`,
    { 'background-image': 'linear-gradient(90deg, #f87171, #60a5fa)', 'background-repeat': rep },
    [computed('$s', 'backgroundRepeat', rep)], ['background-repeat'])
}
for (const style of ['none', 'solid', 'dashed', 'dotted'] as const) {
  paint(`border-style-${style}`, `BORDER STYLE: ${style}`,
    { 'border-style': style, 'border-color': '#4338ca', 'border-top-width': '4px', 'border-right-width': '4px', 'border-bottom-width': '4px', 'border-left-width': '4px' },
    [computed('$s', 'borderTopStyle', style)], ['border-style'])
}

paint('radius-corners', 'RADIUS: 4 / 8 / 16 / 24 per corner',
  { 'border-top-left-radius': '4px', 'border-top-right-radius': '8px', 'border-bottom-right-radius': '16px', 'border-bottom-left-radius': '24px', 'background-color': '#4338ca' },
  [
    computed('$s', 'borderTopLeftRadius', '4px'),
    computed('$s', 'borderTopRightRadius', '8px'),
    computed('$s', 'borderBottomRightRadius', '16px'),
    computed('$s', 'borderBottomLeftRadius', '24px'),
  ], ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'])

paint('opacity', 'OPACITY: 0.35', { opacity: '0.35', 'background-color': '#4338ca' },
  [computed('$s', 'opacity', '0.35')], ['opacity'])

paint('box-shadow', 'BOX SHADOW: 0 4px 12px rgba(0,0,0,0.4)',
  { 'box-shadow': '0 4px 12px rgba(0,0,0,0.4)', 'background-color': '#e0e7ff' },
  [{ kind: 'computed', sel: '$s', prop: 'boxShadow', expect: '12px', op: 'contains' }], ['box-shadow'])

paint('transform-multi', 'TRANSFORM: translateX(30px) rotate(15deg) - two functions compose',
  { transform: 'translateX(30px) rotate(15deg)', 'background-color': '#c7d2fe' },
  [
    { kind: 'computed', sel: '$s', prop: 'transform', expect: 'matrix', op: 'contains' },
    { kind: 'computed', sel: '$s', prop: 'transform', expect: 'matrix(1, 0, 0, 1, 30, 0)', op: 'ne', note: 'a rotation must be in the matrix too' },
  ], ['transform'])

paint('transition', 'TRANSITION: background-color 300ms ease',
  { transition: 'background-color 300ms ease', 'background-color': '#c7d2fe' },
  [computed('$s', 'transitionDuration', '0.3s')], ['transition'])

for (const cursor of ['auto', 'pointer', 'default', 'not-allowed'] as const) {
  paint(`cursor-${cursor}`, `CURSOR: ${cursor}`, { cursor, 'background-color': '#e0e7ff' },
    [computed('$s', 'cursor', cursor)], ['cursor'])
}

add({
  id: 'paint-opacity-vs-display-none',
  group: 'paint',
  label: 'OPACITY 0 vs DISPLAY none are different things',
  expectation: 'The transparent box still occupies its space; the display:none box does not.',
  blocks: [section('p', ['p'], [
    heading('o', ['o'], 'opacity 0'), heading('after1', ['bxw'], 'after opacity'),
  ]), section('q', ['q'], [
    heading('n', ['n'], 'display none'), heading('after2', ['bxw'], 'after none'),
  ])],
  classes: [
    cls('p', { display: 'block' }), cls('q', { display: 'block' }),
    cls('o', { opacity: '0', height: '60px', 'background-color': '#4338ca' }),
    cls('n', { display: 'none', height: '60px', 'background-color': '#4338ca' }),
    BXW,
  ],
  covers: ['opacity', 'display'],
  checks: [
    { kind: 'rects', sel: '$o', expect: 1 },
    { kind: 'rects', sel: '$n', expect: 0 },
    { kind: 'inset', sel: '$after1', side: 'top', sel2: '$p~c', expect: 60, tol: 1.5 },
    { kind: 'inset', sel: '$after2', side: 'top', sel2: '$q~c', expect: 0, tol: 1.5 },
  ],
})

/* ════════════════════════════════════════════════════════════════════════
   13. STATES
   ════════════════════════════════════════════════════════════════════════ */

add({
  id: 'states-hover',
  group: 'states',
  label: 'HOVER: background and colour change, then restore',
  expectation: 'Grey until hovered, indigo while hovered, grey again after.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'Hover target')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('s', {
      'background-color': { base: '#eeeeee', hover: { base: '#4338ca' } },
      color: { base: '#111111', hover: { base: '#ffffff' } },
      width: '240px', height: '60px',
    }),
  ],
  covers: ['background-color', 'color'],
  checks: [
    computed('$s', 'backgroundColor', 'rgb(238, 238, 238)'),
    { ...computed('$s', 'backgroundColor', 'rgb(67, 56, 202)'), state: 'hover' },
    // S9: the pointer is over the WRAPPER (its padding, say), and the text
    // inside changes colour. The wrapper's hover rule sets a custom property
    // scoped to the class and the text element reads it - no combinator. The
    // earlier version of this check read `color` on the wrapper div itself,
    // which carries no text and so no colour: the wrong element, retargeted.
    { ...computed('$s .tg-heading', 'color', 'rgb(255, 255, 255)'), state: 'hover', stateSel: '$s', note: 'hover the block, read the text' },
    css('contains', '$s:hover{background-color:#4338ca;--tg-'),
    css('contains', '--color:#ffffff}'),
    css('notContains', '--text:hover'),
  ],
  harnessOnly: true,
})

add({
  id: 'states-hover-layout',
  group: 'states',
  label: 'HOVER on a LAYOUT property: padding grows on hover',
  expectation: 'Padding 0 normally, 24px while hovered.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'Hover target')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('s', { 'padding-left': { base: '0px', hover: { base: '24px' } }, 'background-color': '#e0e7ff', height: '60px' }),
  ],
  covers: ['padding-left'],
  checks: [
    computed('$s', 'paddingLeft', '0px'),
    { ...computed('$s', 'paddingLeft', '24px'), state: 'hover' },
  ],
  harnessOnly: true,
})

add({
  id: 'states-focus',
  group: 'states',
  label: 'FOCUS: the class carries a :focus background',
  expectation: 'Focusing the button inside must show the focus background. The class sits on the block WRAPPER, and a div is not focusable.',
  blocks: [section('p', ['p'], [buttons('b', ['s'])])],
  classes: [
    cls('p', { display: 'block' }),
    cls('s', { 'background-color': { base: '#eeeeee', focus: { base: '#16a34a' } }, height: '60px' }),
  ],
  covers: ['background-color'],
  checks: [
    css('contains', '$s:focus-within{background-color:#16a34a}'),
    computed('$s', 'backgroundColor', 'rgb(238, 238, 238)'),
    { ...computed('$s', 'backgroundColor', 'rgb(22, 163, 74)'), state: 'focus', stateSel: '$s .tg-btn' },
  ],
  harnessOnly: true,
})

/* ════════════════════════════════════════════════════════════════════════
   14. BREAKPOINTS - the real viewport, not a simulation.
   ════════════════════════════════════════════════════════════════════════ */

const DESKTOP = { width: 1280, height: 900 }
const TABLET = { width: 900, height: 900 }
const MOBILE = { width: 600, height: 900 }

add({
  id: 'breakpoints-base-only',
  group: 'breakpoints',
  label: 'BREAKPOINT: base only',
  expectation: '200px wide at every width.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S')])],
  classes: [cls('p', { display: 'block' }), cls('s', { width: '200px', height: '40px', 'background-color': '#c7d2fe' })],
  covers: ['width'],
  checks: [
    { ...rect('$s', 'width', 200), viewport: DESKTOP },
    { ...rect('$s', 'width', 200), viewport: TABLET },
    { ...rect('$s', 'width', 200), viewport: MOBILE },
  ],
  harnessOnly: true,
})

add({
  id: 'breakpoints-tablet-override',
  group: 'breakpoints',
  label: 'BREAKPOINT: base 200px, tablet 120px (mobile inherits tablet)',
  expectation: '200 at desktop, 120 at tablet, 120 at mobile.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S')])],
  classes: [cls('p', { display: 'block' }), cls('s', { width: { base: '200px', tablet: '120px' }, height: '40px', 'background-color': '#c7d2fe' })],
  covers: ['width'],
  checks: [
    { ...rect('$s', 'width', 200), viewport: DESKTOP },
    { ...rect('$s', 'width', 120), viewport: TABLET },
    { ...rect('$s', 'width', 120), viewport: MOBILE, note: 'no mobile override, so it inherits tablet' },
  ],
  harnessOnly: true,
})

add({
  id: 'breakpoints-mobile-only',
  group: 'breakpoints',
  label: 'BREAKPOINT: base 200px, mobile 80px (tablet keeps base)',
  expectation: '200 at desktop, 200 at tablet, 80 at mobile.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S')])],
  classes: [cls('p', { display: 'block' }), cls('s', { width: { base: '200px', mobile: '80px' }, height: '40px', 'background-color': '#c7d2fe' })],
  covers: ['width'],
  checks: [
    { ...rect('$s', 'width', 200), viewport: DESKTOP },
    { ...rect('$s', 'width', 200), viewport: TABLET },
    { ...rect('$s', 'width', 80), viewport: MOBILE },
  ],
  harnessOnly: true,
})

add({
  id: 'breakpoints-all-three',
  group: 'breakpoints',
  label: 'BREAKPOINT: base 200 / tablet 120 / mobile 80',
  expectation: 'Each breakpoint uses its own value.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S')])],
  classes: [cls('p', { display: 'block' }), cls('s', { width: { base: '200px', tablet: '120px', mobile: '80px' }, height: '40px', 'background-color': '#c7d2fe' })],
  covers: ['width'],
  checks: [
    { ...rect('$s', 'width', 200), viewport: DESKTOP },
    { ...rect('$s', 'width', 120), viewport: TABLET },
    { ...rect('$s', 'width', 80), viewport: MOBILE },
  ],
  harnessOnly: true,
})

add({
  id: 'breakpoints-display-per-breakpoint',
  group: 'breakpoints',
  label: 'BREAKPOINT x DISPLAY: flex at desktop, block at mobile',
  expectation: 'A row on desktop and tablet, a stack on mobile.',
  blocks: [section('p', ['p'], [heading('a', ['bx'], 'A'), heading('b', ['bx'], 'B')])],
  classes: [cls('p', { display: { base: 'flex', mobile: 'block' }, 'flex-direction': 'row', gap: '0px' }), BX],
  covers: ['display'],
  checks: [
    { ...computed('$p~c', 'display', 'flex'), viewport: DESKTOP },
    { ...rel('$b', 'rightOf', '$a'), viewport: DESKTOP },
    { ...computed('$p~c', 'display', 'block'), viewport: MOBILE },
    { ...rel('$b', 'below', '$a'), viewport: MOBILE },
  ],
  harnessOnly: true,
})

add({
  id: 'breakpoints-x-state',
  group: 'breakpoints',
  label: 'BREAKPOINT x STATE: hover colour differs at tablet',
  expectation: 'Hover is indigo at desktop and green at tablet.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'Hover me')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('s', { 'background-color': { base: '#eeeeee', hover: { base: '#4338ca', tablet: '#16a34a' } }, width: '240px', height: '60px' }),
  ],
  covers: ['background-color'],
  checks: [
    { ...computed('$s', 'backgroundColor', 'rgb(67, 56, 202)'), state: 'hover', viewport: DESKTOP },
    { ...computed('$s', 'backgroundColor', 'rgb(22, 163, 74)'), state: 'hover', viewport: TABLET },
    { ...computed('$s', 'backgroundColor', 'rgb(238, 238, 238)'), viewport: TABLET },
  ],
  harnessOnly: true,
})

/* ════════════════════════════════════════════════════════════════════════
   15. CLASS CASCADE - deterministic by emitted source order.
   ════════════════════════════════════════════════════════════════════════ */

add({
  id: 'cascade-two-classes-same-property',
  group: 'cascade',
  label: 'CASCADE: .card and .featured both set display',
  expectation: 'Classes emit alphabetically, so `featured` is written after `card` and wins. Grid, not flex.',
  blocks: [section('p', ['card', 'featured'], [heading('a', ['bxw'], 'A'), heading('b', ['bxw'], 'B')])],
  classes: [
    cls('card', { display: 'flex', 'flex-direction': 'row', gap: '0px' }),
    cls('featured', { display: 'grid', 'grid-template-columns': '1fr', gap: '0px' }),
    BXW,
  ],
  covers: ['display'],
  checks: [
    computed('$card~c', 'display', 'grid'),
    rel('$b', 'below', '$a'),
  ],
})

add({
  id: 'cascade-order-is-by-name-not-application',
  group: 'cascade',
  label: 'CASCADE: order is by CLASS NAME, not by the order the block wears them',
  expectation: 'The block lists zeta first and alpha second, yet zeta wins because z sorts after a.',
  blocks: [section('p', ['zeta', 'alpha'], [heading('s', ['bxw'], 'S')])],
  classes: [
    cls('zeta', { 'background-color': '#16a34a', display: 'block' }),
    cls('alpha', { 'background-color': '#b91c1c', display: 'block' }),
    BXW,
  ],
  covers: ['background-color'],
  checks: [computed('$zeta', 'backgroundColor', 'rgb(22, 163, 74)')],
})

add({
  id: 'cascade-merge-non-conflicting',
  group: 'cascade',
  label: 'CASCADE: two classes contributing different properties both apply',
  expectation: 'Width from one class, height and background from the other.',
  blocks: [section('p', ['p'], [heading('s', ['w', 'h'], 'S')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('w', { width: '220px' }),
    cls('h', { height: '70px', 'background-color': '#c7d2fe' }),
  ],
  covers: ['width', 'height'],
  checks: [rect('$w', 'width', 220), rect('$w', 'height', 70)],
})

add({
  id: 'cascade-state-across-classes',
  group: 'cascade',
  label: 'CASCADE: base from one class, hover from another',
  expectation: 'Grey normally, red on hover, with the two declarations coming from different classes.',
  blocks: [section('p', ['p'], [heading('s', ['base', 'over'], 'Hover me')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('base', { 'background-color': '#eeeeee', width: '240px', height: '60px' }),
    cls('over', { 'background-color': { hover: { base: '#b91c1c' } } }),
  ],
  covers: ['background-color'],
  checks: [
    computed('$base', 'backgroundColor', 'rgb(238, 238, 238)'),
    { ...computed('$base', 'backgroundColor', 'rgb(185, 28, 28)'), state: 'hover' },
  ],
  harnessOnly: true,
})

add({
  id: 'cascade-breakpoint-across-classes',
  group: 'cascade',
  label: 'CASCADE: base from one class, tablet override from another',
  expectation: 'A media block always sits after every base rule, so the tablet override wins however the classes sort.',
  blocks: [section('p', ['p'], [heading('s', ['zbase', 'aover'], 'S')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('zbase', { width: '200px', height: '40px', 'background-color': '#c7d2fe' }),
    cls('aover', { width: { tablet: '90px' } }),
  ],
  covers: ['width'],
  checks: [
    { ...rect('$zbase', 'width', 200), viewport: DESKTOP },
    { ...rect('$zbase', 'width', 90), viewport: TABLET },
  ],
  harnessOnly: true,
})

/* ════════════════════════════════════════════════════════════════════════
   16. NESTED STRESS
   ════════════════════════════════════════════════════════════════════════ */

add({
  id: 'nested-grid-flex-grid-block',
  group: 'nested',
  label: 'NESTED: grid > flex > grid > block',
  expectation: 'Four formatting contexts, each doing its own job.',
  blocks: [section('l1', ['l1'], [
    section('l2', ['l2'], [
      section('l3', ['l3'], [heading('a', ['bxw'], 'A'), heading('b', ['bxw'], 'B')]),
      heading('sib', ['bx'], 'sib'),
    ]),
  ])],
  classes: [
    cls('l1', { display: 'grid', 'grid-template-columns': '1fr', gap: '0px' }),
    cls('l2', { display: 'flex', 'flex-direction': 'row', gap: '0px' }),
    cls('l3', { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '0px', 'flex-grow': '1' }),
    BX, BXW,
  ],
  covers: ['display', 'grid-template-columns', 'flex-grow'],
  checks: [
    computed('$l1~c', 'display', 'grid'),
    computed('$l2~c', 'display', 'flex'),
    computed('$l3~c', 'display', 'grid'),
    rel('$b', 'rightOf', '$a'),
    rel('$sib', 'rightOf', '$l3'),
  ],
})

add({
  id: 'nested-flex-absolute-child',
  group: 'nested',
  label: 'NESTED: flex row with an absolutely positioned child',
  expectation: 'The absolute child leaves the flex flow entirely and sits at 10/10 in the positioned ancestor.',
  blocks: [section('p', ['p'], [heading('a', ['bx'], 'A'), heading('abs', ['abs'], 'ABS'), heading('b', ['bx'], 'B')])],
  classes: [
    cls('p', { display: 'flex', 'flex-direction': 'row', gap: '0px', position: 'relative', height: '140px' }),
    cls('abs', { position: 'absolute', top: '10px', left: '10px', width: '80px', height: '30px', 'background-color': '#fca5a5' }),
    BX,
  ],
  covers: ['position', 'display'],
  checks: [
    computed('$abs', 'position', 'absolute'),
    rel('$b', 'rightOf', '$a', { note: 'the absolute child is out of flow, so A and B are adjacent' }),
    { kind: 'inset', sel: '$abs', side: 'left', sel2: '$p', expect: 10, tol: 1.5 },
  ],
})

add({
  id: 'nested-grid-loop-flex-card',
  group: 'nested',
  label: 'NESTED: grid > kit.loop > flex card',
  expectation: 'Three loop rows, each a flex card with an icon box and a label side by side.',
  blocks: [section('p', ['p'], [
    {
      _type: 'kit.loop', _key: 'loop1', layout: 'grid', columns: '3', gap: 'none', pagination: 'none',
      _studio: { classes: ['loop'] },
      itemTemplate: [
        section('card', ['card'], [heading('icon', ['bx'], 'I'), heading('label', ['bx'], 'L')]),
      ],
      emptyState: [], errorState: [],
    },
  ])],
  classes: [
    cls('p', { display: 'grid', 'grid-template-columns': '1fr', gap: '0px' }),
    cls('loop', {}),
    cls('card', { display: 'flex', 'flex-direction': 'row', gap: '0px' }),
    BX,
  ],
  loopData: { loop1: { data: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }] } },
  covers: ['display'],
  checks: [
    { kind: 'count', sel: '$card', expect: 3 },
    computed('$card~c', 'display', 'flex'),
    rel('$label', 'rightOf', '$icon'),
  ],
})

/* ════════════════════════════════════════════════════════════════════════
   17. PROTECTION - the compiler is the boundary, not the panel.
   ════════════════════════════════════════════════════════════════════════ */

const PROTECTIONS = {
  'site.checkout': { level: 'locked', parts: { root: {} } },
  'site.card': { level: 'guided', parts: { root: { properties: ['background-color', 'color', 'padding-top'] }, price: { properties: ['color'] } } },
}

add({
  id: 'protection-locked-root',
  group: 'protection',
  label: 'PROTECTION: a Locked Block root takes background but refuses display / position / overflow / height',
  expectation: 'background-color compiles and paints; the four dangerous properties never reach the CSS, and the other declarations in the same rule survive.',
  blocks: [section('p', ['p'], [heading('s', ['guard'], 'Locked root')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('guard', {
      'background-color': '#4338ca', color: '#ffffff', 'padding-top': '16px',
      display: 'flex', position: 'absolute', overflow: 'hidden', height: '400px',
    }, { target: { blockType: 'site.checkout', kind: 'root' } }),
  ],
  protections: PROTECTIONS,
  covers: ['background-color', 'color', 'padding-top', 'display', 'position', 'overflow', 'height'],
  checks: [
    computed('$guard', 'backgroundColor', 'rgb(67, 56, 202)'),
    computed('$guard .tg-heading', 'color', 'rgb(255, 255, 255)'),
    computed('$guard', 'paddingTop', '16px'),
    computed('$guard', 'display', 'block'),
    computed('$guard', 'position', 'static'),
    computed('$guard', 'overflow', 'visible'),
    css('notContains', 'display:flex'),
    css('notContains', 'position:absolute'),
    css('notContains', 'overflow:hidden'),
    css('notContains', 'height:400px'),
    css('contains', 'background-color:#4338ca'),
    css('noCombinator'),
  ],
})

add({
  id: 'protection-guided-part',
  group: 'protection',
  label: 'PROTECTION: a Guided Block part takes only the properties its author listed',
  expectation: 'The price part accepts colour and refuses everything else. Its selector is a scoped class that names neither the block nor the part.',
  blocks: [section('p', ['p'], [heading('s', ['bxw'], 'Guided part')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('price', { color: '#b91c1c', width: '300px', 'background-color': '#000000' },
      { target: { blockType: 'site.card', kind: 'part', part: 'price' } }),
    BXW,
  ],
  protections: PROTECTIONS,
  covers: ['color', 'width', 'background-color'],
  checks: [
    css('contains', 'color:#b91c1c'),
    css('notContains', 'width:300px'),
    css('notContains', 'background-color:#000000'),
    css('notContains', '.price'),
    css('notContains', 'site.card'),
    css('noCombinator'),
  ],
})

add({
  id: 'protection-internal-refused',
  group: 'protection',
  label: 'PROTECTION: an internal target compiles to nothing at all',
  expectation: 'Everything aimed at an internal part of a protected Block is refused, so the rule is dropped rather than emitted empty.',
  blocks: [section('p', ['p'], [heading('s', ['bxw'], 'Internal target')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('inner', { color: '#b91c1c', 'padding-top': '8px' },
      { target: { blockType: 'site.checkout', kind: 'internal' } }),
    BXW,
  ],
  protections: PROTECTIONS,
  covers: ['color', 'padding-top'],
  checks: [css('notContains', 'color:#b91c1c'), css('noCombinator')],
})

add({
  id: 'protection-breakpoint-and-state',
  group: 'protection',
  label: 'PROTECTION x BREAKPOINT x STATE: a refusal holds at every breakpoint and state',
  expectation: 'height is refused on a Locked root, so no base rule, no media block and no :hover rule may carry it. background-color survives in all three.',
  blocks: [section('p', ['p'], [heading('s', ['guard'], 'Locked')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('guard', {
      height: { base: '100px', tablet: '200px', hover: { base: '300px' } },
      'background-color': { base: '#4338ca', tablet: '#16a34a', hover: { base: '#b91c1c' } },
    }, { target: { blockType: 'site.checkout', kind: 'root' } }),
  ],
  protections: PROTECTIONS,
  covers: ['height', 'background-color'],
  checks: [
    css('notContains', 'height:100px'),
    css('notContains', 'height:200px'),
    css('notContains', 'height:300px'),
    css('contains', 'background-color:#4338ca'),
    css('contains', 'background-color:#16a34a'),
    css('contains', 'background-color:#b91c1c'),
    computed('$guard', 'height', '100px', { op: 'ne' }),
    css('noCombinator'),
  ],
})

/* ════════════════════════════════════════════════════════════════════════
   18. DRAFT vs PUBLISHED - the same fixture down both paths.
   ════════════════════════════════════════════════════════════════════════ */

add({
  id: 'publish-parity-layout',
  group: 'publish',
  label: 'DRAFT vs PUBLISHED: a flex section with a token gap',
  expectation: 'The published artifact must compute exactly what the draft computes. Same classes on the same elements, same geometry.',
  blocks: [section('p', ['p'], [heading('a', ['bx'], 'A'), heading('b', ['bx'], 'B')])],
  classes: [cls('p', { display: 'flex', 'flex-direction': 'row', gap: '{space.md}' }), BX],
  covers: ['display', 'gap'],
  checks: [
    { kind: 'count', sel: '$p', expect: 1, note: 'the class must be ON the element in both paths' },
    computed('$p~c', 'display', 'flex'),
    computed('$p~c', 'gap', '32px'),
    rel('$b', 'rightOf', '$a'),
    rel('$a', 'gapX', '$b', { expect: 32, tol: 1 }),
  ],
  harnessOnly: true,
})

add({
  id: 'publish-parity-paint',
  group: 'publish',
  label: 'DRAFT vs PUBLISHED: background, radius and padding',
  expectation: 'Identical paint on both paths.',
  blocks: [section('p', ['p'], [heading('s', ['s'], 'S')])],
  classes: [
    cls('p', { display: 'block' }),
    cls('s', { 'background-color': '{palette.brand}', 'border-top-left-radius': '{radius.md}', 'padding-left': '{space.lg}', height: '60px' }),
  ],
  covers: ['background-color', 'border-top-left-radius', 'padding-left'],
  checks: [
    { kind: 'count', sel: '$s', expect: 1 },
    computed('$s', 'backgroundColor', 'rgb(67, 56, 202)'),
    computed('$s', 'borderTopLeftRadius', '12px'),
    computed('$s', 'paddingLeft', '64px'),
  ],
  harnessOnly: true,
})

/* ════════════════════════════════════════════════════════════════════════
   19. ELEMENTS (WF-T12) - each new kit element proves display, spacing and
   typography land where its structure says they must.
   ════════════════════════════════════════════════════════════════════════ */

/** A kit.container: wrapper > .tg-container (the content element) > children. */
const container = (key: string, classes: string[], children: FixtureBlock[], width = 'full'): FixtureBlock => ({
  _type: 'kit.container', _key: key, width,
  _studio: { classes: withKey(key, classes) }, children,
})

add({
  id: 'element-container-width',
  group: 'sizing',
  label: 'kit.container: the width token constrains the CONTENT element',
  expectation: 'The box computes max-width 640px (narrow, 40rem) and sits centred; the wrapper stays full width.',
  blocks: [section('p', ['p'], [container('c', ['c'], [heading('h', ['bxw'], 'In a narrow box')], 'narrow')])],
  classes: [cls('p', { display: 'block' }), cls('c', {}), BXW],
  covers: [],
  checks: [
    { kind: 'count', sel: '$c', expect: 1 },
    computed('$c .tg-container', 'maxWidth', '640px'),
    rel('$c .tg-container', 'sameCenterX', '$c'),
    rel('$c', 'ratioCW', '$p~c', { expect: 1, tol: 0.02 }),
  ],
})

add({
  id: 'element-container-display-flex',
  group: 'display',
  label: 'kit.container: display flex lands on the content element, so the children sit side by side',
  expectation: 'Wrapper stays block; the box computes flex; A and B share a row.',
  blocks: [section('p', ['p'], [container('c', ['c'], [heading('a', ['bx'], 'A'), heading('b', ['bx'], 'B')])])],
  classes: [cls('p', { display: 'block' }), cls('c', { display: 'flex', gap: '16px' }), BX],
  covers: ['display', 'gap'],
  checks: [
    computed('$c', 'display', 'block'),
    computed('$c~c', 'display', 'flex'),
    computed('$c~c', 'gap', '16px'),
    rel('$b', 'rightOf', '$a'),
    rel('$a', 'gapX', '$b', { expect: 16, tol: 1 }),
    css('noCombinator'),
  ],
})

add({
  id: 'element-container-spacing',
  group: 'boxmodel',
  label: 'kit.container: padding and margin land on the wrapper',
  expectation: 'The wrapper computes padding-top 24px and margin-top 12px; the box inside is inset by the padding.',
  blocks: [section('p', ['p'], [container('c', ['c'], [heading('h', ['bxw'], 'Padded')])])],
  classes: [cls('p', { display: 'block' }), cls('c', { 'padding-top': '24px', 'padding-left': '20px', 'margin-top': '12px' }), BXW],
  covers: ['padding-top', 'padding-left', 'margin-top'],
  checks: [
    computed('$c', 'paddingTop', '24px'),
    computed('$c', 'marginTop', '12px'),
    inset('$c .tg-container', 'left', '$c', 20),
    css('contains', '$c{'),
    css('notContains', '$c~c{padding-top'),
  ],
})

add({
  id: 'element-container-typography',
  group: 'typography',
  label: 'kit.container: typography on the class reaches the children by inheritance',
  expectation: 'The heading inside computes the colour and text-align set on the container class.',
  blocks: [section('p', ['p'], [container('c', ['c'], [heading('h', ['bxw'], 'Inherited')])])],
  classes: [cls('p', { display: 'block' }), cls('c', { color: '#b91c1c', 'text-align': 'center' }), BXW],
  covers: ['color', 'text-align'],
  checks: [
    computed('$c .tg-heading', 'color', 'rgb(185, 28, 28)'),
    computed('$c .tg-heading', 'textAlign', 'center'),
    css('contains', '$c--text{'),
    css('noCombinator'),
  ],
})

/** A kit.div: wrapper > .tg-div (the content element) > children. Nothing of its own. */
const box = (key: string, classes: string[], children: FixtureBlock[]): FixtureBlock => ({
  _type: 'kit.div', _key: key, _studio: { classes: withKey(key, classes) }, children,
})

add({
  id: 'element-div-bare',
  group: 'sizing',
  label: 'kit.div: a bare box is as wide as its parent and as tall as its children',
  expectation: 'The box computes display block with no padding, and its width equals the section content width.',
  blocks: [section('p', ['p'], [box('d', ['d'], [heading('h', ['bxw'], 'In a bare box')])])],
  classes: [cls('p', { display: 'block' }), cls('d', {}), BXW],
  covers: [],
  checks: [
    { kind: 'count', sel: '$d', expect: 1 },
    computed('$d .tg-div', 'display', 'block'),
    computed('$d .tg-div', 'paddingTop', '0px'),
    rel('$d', 'ratioCW', '$p~c', { expect: 1, tol: 0.02 }),
    rel('$d', 'sameHeight', '$h'),
  ],
})

add({
  id: 'element-div-display-flex',
  group: 'display',
  label: 'kit.div: display flex on the class is the whole layout',
  expectation: 'The box computes flex with the gap; A and B sit on one row.',
  blocks: [section('p', ['p'], [box('d', ['d'], [heading('a', ['bx'], 'A'), heading('b', ['bx'], 'B')])])],
  classes: [cls('p', { display: 'block' }), cls('d', { display: 'flex', gap: '24px', 'justify-content': 'space-between' }), BX],
  covers: ['display', 'gap', 'justify-content'],
  checks: [
    computed('$d', 'display', 'block'),
    computed('$d~c', 'display', 'flex'),
    computed('$d~c', 'justifyContent', 'space-between'),
    rel('$b', 'rightOf', '$a'),
    css('noCombinator'),
  ],
})

add({
  id: 'element-div-spacing',
  group: 'boxmodel',
  label: 'kit.div: padding, margin and a background make a card',
  expectation: 'The wrapper paints the background and computes the padding; the heading is inset by it.',
  blocks: [section('p', ['p'], [box('d', ['d'], [heading('h', ['bxw'], 'Card')])])],
  classes: [cls('p', { display: 'block' }), cls('d', { 'padding-top': '16px', 'padding-left': '16px', 'margin-bottom': '8px', 'background-color': '#4338ca' }), BXW],
  covers: ['padding-top', 'padding-left', 'margin-bottom', 'background-color'],
  checks: [
    computed('$d', 'paddingTop', '16px'),
    computed('$d', 'marginBottom', '8px'),
    computed('$d', 'backgroundColor', 'rgb(67, 56, 202)'),
    inset('$h', 'left', '$d', 16),
    css('contains', 'background-color:#4338ca'),
  ],
})

add({
  id: 'element-div-typography',
  group: 'typography',
  label: 'kit.div: typography on the class reaches the children',
  expectation: 'The text inside computes the colour set on the box class (font size is the text block\'s own token, which must win).',
  blocks: [section('p', ['p'], [box('d', ['d'], [textBlock('t', ['t'], 'Body in a box')])])],
  classes: [cls('p', { display: 'block' }), cls('d', { color: '#b91c1c' }), cls('t', {})],
  covers: ['color'],
  checks: [
    computed('$t .tg-text', 'color', 'rgb(185, 28, 28)'),
    css('contains', '$d--text{'),
    css('noCombinator'),
  ],
})

/** A kit.link: wrapper > a.tg-link (the text element). */
const link = (key: string, classes: string[], text: string, href = '/'): FixtureBlock => ({
  _type: 'kit.link', _key: key, text, href, _studio: { classes: withKey(key, classes) },
})

add({
  id: 'element-link-display-inline',
  group: 'display',
  label: 'kit.link: INLINE is honoured - two links share a line',
  expectation: 'Both wrappers compute inline; B sits to the right of A on the same line. The one kit block where inline is offered.',
  blocks: [section('p', ['p'], [box('d', ['d'], [link('a', ['il'], 'First link'), link('b', ['il'], 'Second link')])])],
  classes: [cls('p', { display: 'block' }), cls('d', { display: 'block' }), cls('il', { display: 'inline' })],
  covers: ['display'],
  checks: [
    computed('$a', 'display', 'inline'),
    computed('$b', 'display', 'inline'),
    rel('$b', 'rightOf', '$a'),
    rel('$a', 'sameTop', '$b'),
    css('noCombinator'),
  ],
})

add({
  id: 'element-link-spacing',
  group: 'boxmodel',
  label: 'kit.link: padding on an inline-block link grows the box',
  expectation: 'The wrapper computes inline-block with 8px padding on the left; the anchor is inset by it.',
  blocks: [section('p', ['p'], [link('l', ['l'], 'Padded link')])],
  classes: [cls('p', { display: 'block' }), cls('l', { display: 'inline-block', 'padding-left': '8px', 'padding-top': '4px' })],
  covers: ['display', 'padding-left', 'padding-top'],
  checks: [
    computed('$l', 'display', 'inline-block'),
    computed('$l', 'paddingLeft', '8px'),
    inset('$l .tg-link', 'left', '$l', 8),
  ],
})

add({
  id: 'element-link-typography',
  group: 'typography',
  label: 'kit.link: typography lands on the anchor, underline included',
  expectation: 'The anchor computes the colour, weight and no underline, set on the link class.',
  blocks: [section('p', ['p'], [link('l', ['l'], 'Styled link')])],
  classes: [cls('p', { display: 'block' }), cls('l', { color: '#b91c1c', 'font-weight': '700', 'text-decoration': 'none' })],
  covers: ['color', 'font-weight', 'text-decoration'],
  checks: [
    computed('$l .tg-link', 'color', 'rgb(185, 28, 28)'),
    computed('$l .tg-link', 'fontWeight', '700'),
    computed('$l .tg-link', 'textDecorationLine', 'none'),
    css('contains', '$l--text{'),
    css('noCombinator'),
  ],
})

/** A kit.list: wrapper > ul.tg-list > li.tg-list__item (the `item` part). */
const list = (key: string, classes: string[], texts: string[]): FixtureBlock => ({
  _type: 'kit.list', _key: key, style: 'unordered', items: texts.map((text) => ({ text })),
  _studio: { classes: withKey(key, classes) },
})

/** The kit's own declaration for kit.list, as the compiler reads it. */
const LIST_PROTECTION = {
  'kit.list': {
    level: 'guided',
    parts: {
      root: {},
      item: { properties: ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'color', 'text-transform', 'text-decoration', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-bottom'] },
    },
  },
}

add({
  id: 'element-list-display-refused',
  group: 'display',
  label: 'kit.list: display on a Guided root is refused, so the bullets stay a list',
  expectation: 'The class asked for display flex; the CSS never carries it, the wrapper computes block, and the items stack.',
  blocks: [section('p', ['p'], [list('l', ['l'], ['One', 'Two'])])],
  classes: [
    cls('p', { display: 'block' }),
    cls('l', { display: 'flex', 'padding-left': '24px' }, { target: { blockType: 'kit.list', kind: 'root' } }),
  ],
  protections: LIST_PROTECTION,
  covers: ['display', 'padding-left'],
  checks: [
    computed('$l', 'display', 'block'),
    computed('$l', 'paddingLeft', '24px'),
    css('notContains', 'display:flex'),
    css('contains', 'padding-left:24px'),
    css('noCombinator'),
  ],
})

add({
  id: 'element-list-spacing',
  group: 'boxmodel',
  label: 'kit.list: spacing on the item part reaches every <li>',
  expectation: 'Each item computes 12px of top padding from the part class; the list root is not padded by it.',
  blocks: [section('p', ['p'], [list('l', ['l'], ['One', 'Two', 'Three'])])],
  classes: [
    cls('p', { display: 'block' }),
    cls('l', { 'padding-top': '12px', 'margin-bottom': '4px' }, { target: { blockType: 'kit.list', kind: 'part', part: 'item' } }),
  ],
  protections: LIST_PROTECTION,
  covers: ['padding-top', 'margin-bottom'],
  checks: [
    { kind: 'count', sel: '$l .tg-list__item', expect: 3 },
    computed('$l .tg-list__item', 'paddingTop', '12px'),
    computed('$l .tg-list', 'paddingTop', '0px'),
    css('contains', 'padding-top:12px'),
    css('notContains', '.item'),
    css('noCombinator'),
  ],
})

add({
  id: 'element-list-typography',
  group: 'typography',
  label: 'kit.list: typography on the root reaches the items by inheritance; the part can override it',
  expectation: 'Root colour is inherited by every item; a weight aimed at the item part lands on the <li>.',
  blocks: [section('p', ['p'], [list('l', ['l', 'li'], ['One', 'Two'])])],
  classes: [
    cls('p', { display: 'block' }),
    cls('l', { color: '#b91c1c' }, { target: { blockType: 'kit.list', kind: 'root' } }),
    cls('li', { 'font-weight': '700' }, { target: { blockType: 'kit.list', kind: 'part', part: 'item' } }),
  ],
  protections: LIST_PROTECTION,
  covers: ['color', 'font-weight'],
  checks: [
    computed('$l .tg-list__item', 'color', 'rgb(185, 28, 28)'),
    computed('$l .tg-list__item', 'fontWeight', '700'),
    css('contains', '$l--text{color:#b91c1c}'),
    css('contains', 'font-weight:700'),
    css('notContains', '$li{'),
    css('noCombinator'),
  ],
})

/** A kit.richText: wrapper > div.tg-richtext > the document's elements (the parts). */
const richText = (key: string, classes: string[]): FixtureBlock => ({
  _type: 'kit.richText', _key: key,
  body: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Article title' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph with a ' }, { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: '/' } }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph.' }] },
    ],
  },
  _studio: { classes: withKey(key, classes) },
})

const TYPO_PROPS = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'color', 'text-transform', 'text-decoration']

/** The kit's own declaration for kit.richText, as the compiler reads it. */
const RICHTEXT_PROTECTION = {
  'kit.richText': {
    level: 'guided',
    parts: {
      root: {},
      heading: { properties: [...TYPO_PROPS, 'margin-top', 'margin-bottom'] },
      paragraph: { properties: [...TYPO_PROPS, 'margin-top', 'margin-bottom'] },
      link: { properties: [...TYPO_PROPS, 'transition', 'transform', 'cursor'] },
      item: { properties: [...TYPO_PROPS, 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-bottom'] },
    },
  },
}

add({
  id: 'element-richtext-display-refused',
  group: 'display',
  label: 'kit.richText: display on a Guided root is refused, so the article keeps its flow',
  expectation: 'The class asked for display grid; the CSS never carries it, the wrapper computes block, and the paragraphs stack.',
  blocks: [section('p', ['p'], [richText('r', ['r'])])],
  classes: [
    cls('p', { display: 'block' }),
    cls('r', { display: 'grid', 'padding-top': '8px' }, { target: { blockType: 'kit.richText', kind: 'root' } }),
  ],
  protections: RICHTEXT_PROTECTION,
  covers: ['display', 'padding-top'],
  checks: [
    computed('$r', 'display', 'block'),
    computed('$r', 'paddingTop', '8px'),
    css('notContains', 'display:grid'),
    css('noCombinator'),
  ],
})

add({
  id: 'element-richtext-spacing',
  group: 'boxmodel',
  label: 'kit.richText: margin on the paragraph part reaches every <p>',
  expectation: 'Each paragraph computes 24px of bottom margin from the part class; the heading keeps its own.',
  blocks: [section('p', ['p'], [richText('r', ['r'])])],
  classes: [
    cls('p', { display: 'block' }),
    cls('r', { 'margin-bottom': '24px' }, { target: { blockType: 'kit.richText', kind: 'part', part: 'paragraph' } }),
  ],
  protections: RICHTEXT_PROTECTION,
  covers: ['margin-bottom'],
  checks: [
    { kind: 'count', sel: '$r .tg-richtext > p', expect: 2 },
    computed('$r .tg-richtext > p', 'marginBottom', '24px'),
    css('contains', 'margin-bottom:24px'),
    css('notContains', '.paragraph'),
    css('noCombinator'),
  ],
})

add({
  id: 'element-richtext-typography',
  group: 'typography',
  label: 'kit.richText: root typography is inherited; the heading and link parts override it',
  expectation: 'Paragraphs inherit the root colour; the heading computes the weight aimed at the heading part; the link loses its underline from the link part.',
  blocks: [section('p', ['p'], [richText('r', ['r', 'rh', 'rl'])])],
  classes: [
    cls('p', { display: 'block' }),
    cls('r', { color: '#b91c1c' }, { target: { blockType: 'kit.richText', kind: 'root' } }),
    cls('rh', { 'font-weight': '800' }, { target: { blockType: 'kit.richText', kind: 'part', part: 'heading' } }),
    cls('rl', { 'text-decoration': 'none' }, { target: { blockType: 'kit.richText', kind: 'part', part: 'link' } }),
  ],
  protections: RICHTEXT_PROTECTION,
  covers: ['color', 'font-weight', 'text-decoration'],
  checks: [
    computed('$r .tg-richtext > p', 'color', 'rgb(185, 28, 28)'),
    computed('$r .tg-richtext > h3', 'fontWeight', '800'),
    computed('$r .tg-richtext a', 'textDecorationLine', 'none'),
    css('contains', '$r--text{color:#b91c1c}'),
    css('contains', 'font-weight:800'),
    css('notContains', '$rh{'),
    css('notContains', '$rl{'),
    css('noCombinator'),
  ],
})

/** A kit.grid: wrapper > .tg-grid (the content element) > cells. */
const grid = (key: string, classes: string[], children: FixtureBlock[], columns = '3'): FixtureBlock => ({
  _type: 'kit.grid', _key: key, columns, columnsTablet: '2', columnsMobile: '1', gap: 'none',
  _studio: { classes: withKey(key, classes) }, children,
})

add({
  id: 'element-grid-columns',
  group: 'grid',
  label: 'kit.grid: three equal columns on desktop, two on tablet, one on mobile',
  expectation: 'Desktop: A, B and C share a row at equal widths. Tablet: C wraps under A. Mobile: all three stack.',
  blocks: [section('p', ['p'], [grid('g', ['g'], [heading('a', ['bxw'], 'A'), heading('b', ['bxw'], 'B'), heading('c', ['bxw'], 'C')])])],
  classes: [cls('p', { display: 'block' }), cls('g', {}), BXW],
  covers: [],
  checks: [
    computed('$g~c', 'display', 'grid'),
    rel('$b', 'rightOf', '$a'),
    rel('$c', 'rightOf', '$b'),
    rel('$a', 'sameWidth', '$c'),
    rel('$c', 'below', '$a', { viewport: { width: 900, height: 800 } }),
    rel('$a', 'sameTop', '$b', { viewport: { width: 900, height: 800 } }),
    rel('$b', 'below', '$a', { viewport: { width: 400, height: 800 } }),
  ],
})

add({
  id: 'element-grid-display-override',
  group: 'display',
  label: 'kit.grid: a class on the content element overrides the prop columns',
  expectation: 'The class sets grid-template-columns to 1fr 2fr, so B is twice as wide as A; the kit stylesheet loses by source order.',
  blocks: [section('p', ['p'], [grid('g', ['g'], [heading('a', ['bxw'], 'A'), heading('b', ['bxw'], 'B')], '2')])],
  classes: [cls('p', { display: 'block' }), cls('g', { display: 'grid', 'grid-template-columns': '1fr 2fr' }), BXW],
  covers: ['display', 'grid-template-columns'],
  checks: [
    computed('$g', 'display', 'block'),
    computed('$g~c', 'display', 'grid'),
    rel('$b', 'ratioW', '$a', { expect: 2, tol: 0.05 }),
    css('contains', '$g~c{'),
    css('noCombinator'),
  ],
})

add({
  id: 'element-grid-spacing',
  group: 'boxmodel',
  label: 'kit.grid: padding lands on the wrapper, gap on the grid',
  expectation: 'The wrapper computes 16px of top padding; the grid computes the 24px gap set by the class, and A and B are 24px apart.',
  blocks: [section('p', ['p'], [grid('g', ['g'], [heading('a', ['bxw'], 'A'), heading('b', ['bxw'], 'B')], '2')])],
  classes: [cls('p', { display: 'block' }), cls('g', { display: 'grid', gap: '24px', 'padding-top': '16px' }), BXW],
  covers: ['gap', 'padding-top'],
  checks: [
    computed('$g', 'paddingTop', '16px'),
    computed('$g~c', 'gap', '24px'),
    rel('$a', 'gapX', '$b', { expect: 24, tol: 1 }),
    css('notContains', '$g~c{padding-top'),
  ],
})

add({
  id: 'element-grid-typography',
  group: 'typography',
  label: 'kit.grid: typography on the class reaches every cell',
  expectation: 'Both headings compute the colour and centre alignment set on the grid class.',
  blocks: [section('p', ['p'], [grid('g', ['g'], [heading('a', ['bxw'], 'A'), heading('b', ['bxw'], 'B')], '2')])],
  classes: [cls('p', { display: 'block' }), cls('g', { color: '#b91c1c', 'text-align': 'center' }), BXW],
  covers: ['color', 'text-align'],
  checks: [
    computed('$a .tg-heading', 'color', 'rgb(185, 28, 28)'),
    computed('$b .tg-heading', 'textAlign', 'center'),
    css('contains', '$g--text{'),
    css('noCombinator'),
  ],
})

/* ════════════════════════════════════════════════════════════════════════
   CUSTOM - per-section raw CSS (X-T1). The designer writes declarations on
   ONE block; the compiler scopes them to `.tg-s-<key>`, which the runtime
   stamps on that block's wrapper and no other. Block keys are NOT
   namespaced per fixture (only classes are), so the keys here are unique
   across the whole page on purpose.
   ════════════════════════════════════════════════════════════════════════ */

add({
  id: 'custom-section-css',
  group: 'custom',
  label: 'CUSTOM CSS: a section\'s own declarations reach that section and no other',
  expectation: 'The first section paints the 6px dashed red border its raw CSS declares; the second, wearing the same class, does not. The rule is one generated class, and a Guided root (the text block) refuses `display` in raw CSS with the other declarations surviving.',
  blocks: [
    { ...section('xt1a', ['xsec'], [heading('xt1h', ['bxw'], 'Has custom CSS')]),
      _studio: { classes: withKey('xt1a', ['xsec']), css: 'border: 6px dashed #dc2626; padding-top: 20px' } },
    section('xt1b', ['xsec'], [heading('xt1i', ['bxw'], 'No custom CSS')]),
    { ...textBlock('xt1c', [], 'Guided text block'),
      _studio: { classes: withKey('xt1c', []), css: 'display:flex; background-color:#fef3c7' } },
  ],
  classes: [cls('xsec', { 'padding-top': '4px' }), BXW],
  // A Guided kit.text for THIS fixture only: protection is looked up by block
  // type for raw CSS, and a rendered type is needed to prove the refusal.
  protections: { ...PROTECTIONS, 'kit.text': { level: 'guided', parts: { root: {} } } },
  covers: ['padding-top', 'background-color'],
  checks: [
    computed('$xt1a', 'borderTopWidth', '6px'),
    computed('$xt1a', 'borderTopStyle', 'dashed'),
    computed('$xt1a', 'paddingTop', '20px'),
    computed('$xt1b', 'borderTopWidth', '0px'),
    computed('$xt1b', 'paddingTop', '4px'),
    computed('$xt1c', 'backgroundColor', 'rgb(254, 243, 199)'),
    computed('$xt1c', 'display', 'block'),
    css('contains', '.tg-s-xt1a{border:6px dashed #dc2626;padding-top:20px}'),
    css('contains', '.tg-s-xt1c{background-color:#fef3c7}'),
    css('notContains', 'tg-s-xt1b'),
    css('notContains', 'display:flex'),
    css('noCombinator'),
  ],
})

add({
  id: 'custom-page-css',
  group: 'custom',
  label: 'CUSTOM CSS: a page\'s own declarations land on its top-level blocks, and nowhere else',
  expectation: 'Both top-level sections take the serif font the page CSS declares and the nested heading inherits it; the rule is an :is() list of the page\'s own block keys (no combinator, nothing new stamped). The Guided text block at top level refuses `display` from the page CSS with the font surviving.',
  blocks: [
    section('xt2a', ['xpg'], [heading('xt2h', ['bxw'], 'First section')]),
    section('xt2b', ['xpg'], [heading('xt2i', ['bxw'], 'Second section')]),
    textBlock('xt2c', [], 'Guided text block'),
  ],
  classes: [cls('xpg', { 'padding-top': '4px' }), BXW],
  pageCss: 'font-family: Georgia, serif; display: grid',
  protections: { ...PROTECTIONS, 'kit.text': { level: 'guided', parts: { root: {} } } },
  covers: ['font-family'],
  checks: [
    computed('$xt2a', 'fontFamily', 'Georgia, serif'),
    computed('$xt2b', 'fontFamily', 'Georgia, serif'),
    computed('$xt2a .tg-heading', 'fontFamily', 'Georgia, serif'),
    computed('$xt2a', 'display', 'grid'),
    computed('$xt2c', 'fontFamily', 'Georgia, serif'),
    computed('$xt2c', 'display', 'block'),
    css('contains', ':is([data-tangen-block="xt2a"],[data-tangen-block="xt2b"]){font-family:Georgia, serif;display:grid}'),
    css('contains', ':is([data-tangen-block="xt2c"]){font-family:Georgia, serif}'),
    css('noCombinator'),
  ],
})

export const FIXTURES: Fixture[] = ALL

export const GROUPS = [...new Set(FIXTURES.map((f) => f.group))]

/** Fixtures the page renders (everything the page can show without a driver). */
export const PAGE_FIXTURES = FIXTURES.filter((f) => !f.harnessOnly)

/** Registry property ids the suite exercises at least once. */
export const COVERED_PROPERTIES = [...new Set(FIXTURES.flatMap((f) => f.covers ?? []))].sort()
