/**
 * File Name: grid.tsx
 * Purpose: kit.grid - equal columns that wrap: a column count per
 *          breakpoint, a gap from the space scale, each child block a cell.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Server-component-safe. The column counts travel as
 *          CSS custom properties (--tg-grid-cols, -tablet, -mobile) on the
 *          grid element and the STYLESHEET turns them into
 *          grid-template-columns under the kit's breakpoints (mobile below
 *          48rem, tablet to 64rem, desktop above). Inline custom properties
 *          rather than an inline grid-template-columns so a designer's
 *          class on the content element - `.cards--content
 *          { grid-template-columns: ... }` - still wins: an inline
 *          declaration of the property itself would beat every class. The
 *          grid IS the content element (it wears the derived `--content`
 *          and `--text` classes), so layout and typography reach the cells.
 *          Counts are closed sets, so the classes are safe to interpolate;
 *          the gap rides the space token family as class + var().
 */
import type { CSSProperties } from 'react'
import { contentClassNames, textClassNames } from '../render'
import type { BlockNode, RenderContext } from '../types'
import { oneOf, slot } from '../util'

const COLS = ['1', '2', '3', '4'] as const
const COLS_TABLET = ['1', '2', '3'] as const
const COLS_MOBILE = ['1', '2'] as const

export function renderGrid(block: BlockNode, ctx: RenderContext) {
  const columns = oneOf(block.columns, COLS, '3')
  // Tablet narrows to the desktop count when that is smaller; mobile is one
  // column unless asked for two. Absent means the sensible default.
  const tablet = oneOf(block.columnsTablet, COLS_TABLET, columns === '1' ? '1' : '2')
  const mobile = oneOf(block.columnsMobile, COLS_MOBILE, '1')
  const gap = slot(block.gap, 'md')
  const style = {
    '--tg-grid-cols': columns,
    '--tg-grid-cols-tablet': tablet,
    '--tg-grid-cols-mobile': mobile,
    gap: `var(--tg-space-${gap})`,
  } as CSSProperties
  return (
    <div
      className={[
        `tg-grid tg-grid--${columns} tg-grid--tablet-${tablet} tg-grid--mobile-${mobile} tg-gap-${gap}`,
        ...contentClassNames(block), ...textClassNames(block),
      ].join(' ')}
      style={style}
    >
      {ctx.renderList(block.children)}
    </div>
  )
}
