/**
 * File Name: spacer.tsx
 * Purpose: kit.spacer - explicit vertical space from the space token family.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Server-component-safe; aria-hidden because it is
 *          purely presentational.
 */
import type { BlockNode } from '../types'
import { slot } from '../util'

export function renderSpacer(block: BlockNode) {
  const size = slot(block.size, 'md')
  return (
    <div
      className={`tg-spacer tg-space-${size}`}
      style={{ height: `var(--tg-space-${size})` }}
      aria-hidden="true"
    />
  )
}
