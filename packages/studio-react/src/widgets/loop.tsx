/**
 * File Name: loop.tsx
 * Purpose: kit.loop - renders the item template once per resolved record,
 *          with $bind descriptors substituted, in a grid or list.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Server-component-safe. Data arrives ALREADY resolved
 *          (see loop.ts) so this stays a plain synchronous render. Records
 *          are untrusted content: nothing here interpolates a record value
 *          into a class name or a style - bindings only ever land in the
 *          template's own props, which each widget escapes as it always has.
 */
import type { BlockNode, RenderContext } from '../types'
import { oneOf, slot } from '../util'
import { bindBlock } from '../binding'
import { instanceBlock } from '../instance'
import { withPartClasses } from '../parts'

const COLUMNS = ['1', '2', '3', '4'] as const

export function renderLoop(block: BlockNode, ctx: RenderContext) {
  const layout = oneOf(block.layout, ['grid', 'list'] as const, 'grid')
  const columns = oneOf(block.columns, COLUMNS, '3')
  const gap = slot(block.gap, 'md')
  const pagination = oneOf(block.pagination, ['none', 'loadMore', 'pages'] as const, 'none')

  const key = typeof block._key === 'string' ? block._key : ''
  const result = ctx.loopData?.[key]
  const template = Array.isArray(block.itemTemplate) ? block.itemTemplate : []

  // A query that failed shows its own slot; an unresolved loop (the site
  // never called resolveStudioData) renders the container and nothing else,
  // which is honest - it is not "empty", it was never asked.
  if (result?.error) return <div className="tg-loop tg-loop--error">{ctx.renderList(block.errorState)}</div>
  if (!result) return <div className="tg-loop" />

  const rows = result.data
  if (rows.length === 0) return <div className="tg-loop tg-loop--empty">{ctx.renderList(block.emptyState)}</div>

  const cls = [
    'tg-loop',
    `tg-loop--${layout}`,
    layout === 'grid' ? `tg-loop-cols-${columns}` : '',
    `tg-gap-${gap}`,
  ].filter(Boolean).join(' ')

  // The `item` Style Part is each rendered row - the element holding one
  // record's template, which is what a designer means by "the card".
  const itemClass = withPartClasses('tg-loop-item', block, 'item')

  return (
    <>
      <div className={cls} style={{ gap: `var(--tg-space-${gap})` }}>
        {rows.map((item, i) => (
          <div key={i} className={itemClass}>
            {ctx.renderList(template.map((t) => instanceBlock(bindBlock(t as BlockNode, item), i)))}
          </div>
        ))}
      </div>
      {pagination === 'pages' && (
        <div className="tg-loop-pages" data-total={result.meta?.total ?? rows.length} />
      )}
    </>
  )
}
