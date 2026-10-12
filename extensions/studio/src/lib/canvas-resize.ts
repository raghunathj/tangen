/**
 * File Name: canvas-resize.ts
 * Purpose: Reaching the parent of what is selected on the Canvas.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Reaching the parent is how anyone works in a nested
 *          tree - without it, selecting a section means hunting for it in the
 *          Structure panel every time. Pure, so the tree walk is tested apart
 *          from React.
 *
 *          This file once also held on-canvas resize arithmetic. The handles
 *          were removed: dragging an element's edges is a Framer and Figma
 *          convention, not a Webflow one, and a fixed pixel size is usually
 *          the wrong thing to set on responsive content. Width and height are
 *          typed in the Size section, as in Webflow. The file name stays so
 *          nothing importing the parent walk has to move.
 */

export interface Box {
  top: number
  left: number
  width: number
  height: number
}

/**
 * A block's location in the tree: alternating array indices and child-array
 * prop names, matching `BlockPath` in ops.ts.
 */
type Path = Array<number | string>

/**
 * The path of the container holding this block, or null at the top level.
 *
 * A path ends with an index, and the two steps before it are the parent's
 * child-array name and the parent's own index - so a parent is always two
 * steps back. Anything shorter is top level, and anything malformed returns
 * null rather than producing a selection that points nowhere.
 */
export function parentPath(path: Path): Path | null {
  if (path.length < 3) return null
  const parent = path.slice(0, -2)
  // A well-formed path alternates index, name, index, so a parent must end on
  // an index.
  return typeof parent[parent.length - 1] === 'number' ? parent : null
}

/** Every container above this block, outermost first. */
export function ancestorPaths(path: Path): Path[] {
  const out: Path[] = []
  let current = parentPath(path)
  while (current) {
    out.unshift(current)
    current = parentPath(current)
  }
  return out
}

/**
 * Whether a drag actually changed the box.
 *
 * A click on a handle is a pointer-down and a pointer-up with no movement in
 * between, and it must write NOTHING: the first version committed width and
 * height regardless, which minted a class for a block nobody meant to style.
 */
export function sizeChanged(from: Box, to: Box): boolean {
  return from.width !== to.width || from.height !== to.height
}
