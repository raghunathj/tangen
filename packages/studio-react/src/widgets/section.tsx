/**
 * File Name: section.tsx
 * Purpose: kit.section - the outermost layout block: token background,
 *          vertical padding, a width-constrained inner container, and nested
 *          child blocks.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Server-component-safe (no 'use client', no hooks).
 *          Token slots emit BOTH a class (tg-bg-*, tg-pad-*, tg-width-*) and
 *          an inline var() reference, so site-extended slots work by defining
 *          only the CSS custom properties, per the phase 2 contract.
 */
import { contentClassNames, textClassNames } from '../render'
import type { BlockNode, RenderContext } from '../types'
import { slot } from '../util'

export function renderSection(block: BlockNode, ctx: RenderContext) {
  const bg = slot(block.background, 'default')
  const pad = slot(block.padding, 'md')
  const width = slot(block.width, 'normal')
  return (
    <section
      className={`tg-section tg-bg-${bg} tg-pad-${pad}`}
      style={{
        paddingTop: `var(--tg-space-${pad})`,
        paddingBottom: `var(--tg-space-${pad})`,
      }}
    >
      <div className={[`tg-section__inner tg-width-${width}`, ...contentClassNames(block), ...textClassNames(block)].join(' ')} style={{ maxWidth: `var(--tg-width-${width})` }}>
        {ctx.renderList(block.children)}
      </div>
    </section>
  )
}
