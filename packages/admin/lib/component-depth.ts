/**
 * File Name: component-depth.ts
 * Purpose: Defines the maximum nesting depth for component blocks and a guard to enforce it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None
 */

// TODO: make MAX_COMPONENT_DEPTH configurable via tangen.config.ts instead of a hardcoded constant
/** Maximum number of nested component levels allowed in the block editor. */
export const MAX_COMPONENT_DEPTH = 3

/**
 * Returns true when the given depth has reached the component nesting limit.
 * @param depth - Current nesting depth of the component being rendered
 */
export function isAtMaxDepth(depth: number): boolean {
  return depth >= MAX_COMPONENT_DEPTH
}
