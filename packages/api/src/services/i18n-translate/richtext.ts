/**
 * File Name: richtext.ts
 * Purpose: ProseMirror doc text walker for translation — extracts text-node
 *          values in document order and reinserts translated ones without
 *          touching structure, attrs, or marks.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: pure; used by both translation engines so a doc costs
 *          one batch entry per text node.
 */

interface PMNode {
  type?: string
  text?: string
  content?: PMNode[]
  [key: string]: unknown
}

/** Text-node values in document order. */
export function extractRichtextTexts(doc: unknown): string[] {
  const out: string[] = []
  function walk(node: PMNode | undefined) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'text' && typeof node.text === 'string') out.push(node.text)
    for (const child of node.content ?? []) walk(child)
  }
  walk(doc as PMNode)
  return out
}

/**
 * Returns a deep copy of the doc with text-node values replaced in document
 * order. Extra translations are ignored; missing ones keep the original text.
 */
export function replaceRichtextTexts(doc: unknown, texts: string[]): any {
  let i = 0
  function walk(node: PMNode): PMNode {
    if (!node || typeof node !== 'object') return node
    const copy: PMNode = { ...node }
    if (copy.type === 'text' && typeof copy.text === 'string') {
      if (i < texts.length) copy.text = texts[i]
      i += 1
    }
    if (Array.isArray(copy.content)) copy.content = copy.content.map(walk)
    return copy
  }
  return walk(doc as PMNode)
}
