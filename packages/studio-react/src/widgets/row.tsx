/**
 * File Name: row.tsx
 * Purpose: kit.row - side-by-side columns via CSS grid. Layout presets are
 *          the contract's closed set ('1' | '2' | '3' | '1/3-2/3' |
 *          '2/3-1/3'); col2/col3 are ignored when the preset has fewer
 *          columns.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Server-component-safe. Gap rides the space token
 *          family (class + inline var()); vertical alignment is a closed
 *          enum, so it is class-only.
 */
import { contentClassNames, textClassNames } from '../render'
import type { BlockNode, RenderContext } from '../types'
import { oneOf, slot } from '../util'

const LAYOUTS = ['1', '2', '3', '1/3-2/3', '2/3-1/3'] as const

/** Layout preset -> { class-safe modifier, number of columns rendered }. */
const LAYOUT_META: Record<(typeof LAYOUTS)[number], { mod: string; cols: number }> = {
  '1': { mod: '1', cols: 1 },
  '2': { mod: '2', cols: 2 },
  '3': { mod: '3', cols: 3 },
  '1/3-2/3': { mod: '13-23', cols: 2 },
  '2/3-1/3': { mod: '23-13', cols: 2 },
}

export function renderRow(block: BlockNode, ctx: RenderContext) {
  const layout = oneOf(block.layout, LAYOUTS, '1')
  const gap = slot(block.gap, 'md')
  const align = oneOf(block.align, ['top', 'center', 'bottom'] as const, 'top')
  // Stacking: the stylesheet's default IS 'mobile' (columns below 48rem
  // collapse), so only the deviations emit a class.
  const stackOn = oneOf(block.stackOn, ['mobile', 'tablet', 'never'] as const, 'mobile')
  const stack = stackOn === 'mobile' ? '' : ` tg-stack-${stackOn}`
  const { mod, cols } = LAYOUT_META[layout]
  const columns = [block.col1, block.col2, block.col3].slice(0, cols)
  return (
    <div
      className={[`tg-row tg-row--${mod} tg-gap-${gap} tg-valign-${align}${stack}`, ...contentClassNames(block), ...textClassNames(block)].join(' ')}
      style={{ gap: `var(--tg-space-${gap})` }}
    >
      {columns.map((col, i) => (
        <div key={i} className="tg-col">
          {ctx.renderList(col)}
        </div>
      ))}
    </div>
  )
}
