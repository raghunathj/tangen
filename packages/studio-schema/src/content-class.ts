/**
 * File Name: content-class.ts
 * Purpose: The derived class a block's CONTENT element wears, so layout
 *          properties can reach the children.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Webflow's Section holds its children directly, so
 *          `display:flex` on the section lays them out. Studio's kit.section
 *          renders wrapper > section > inner > children, and the class lands
 *          on the wrapper - two levels above the children. Rather than a
 *          combinator (which the protection model forbids a stylesheet to
 *          emit) the renderer gives the element holding the children a
 *          derived class, and the compiler sends container-layout properties
 *          there. A block with no inner element wears the derived class on
 *          its wrapper, so behaviour is uniform and the compiler never needs
 *          to know a block type.
 *
 *          The `--` suffix cannot collide with a designer's class: the class
 *          name normaliser collapses every non-alphanumeric run to one `-`.
 */

export const CONTENT_CLASS_SUFFIX = '--content'

/** `hero` -> `hero--content` */
export function contentClassName(className: string): string {
  return `${className}${CONTENT_CLASS_SUFFIX}`
}

/** `hero` -> `hero--text`: the element carrying a block's text. */
export const TEXT_CLASS_SUFFIX = '--text'
export function textClassName(className: string): string {
  return `${className}${TEXT_CLASS_SUFFIX}`
}
