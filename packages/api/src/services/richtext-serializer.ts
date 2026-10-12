/**
 * File Name: richtext-serializer.ts
 * Purpose: Converts TipTap JSON document nodes to HTML or plain text and applies
 *          per-field serialization hints to rows returned by the content API.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Relies on the SerializeHint type from @tangen/types; no
 *                     external runtime dependencies.
 */
import type { SerializeHint } from '@tangen/types'

interface TipTapMark {
  type: string
  attrs?: Record<string, unknown>
}

interface TipTapNode {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: TipTapMark[]
  content?: TipTapNode[]
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function applyMarks(text: string, marks: TipTapMark[]): string {
  let out = text
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':      out = `<strong>${out}</strong>`; break
      case 'italic':    out = `<em>${out}</em>`; break
      case 'underline': out = `<u>${out}</u>`; break
      case 'strike':    out = `<s>${out}</s>`; break
      case 'code':      out = `<code>${out}</code>`; break
      case 'link': {
        const href = escapeHtml(String(mark.attrs?.href ?? ''))
        // Preserve target/rel (the editor's "open in new tab" toggle sets
        // target=_blank rel="noopener noreferrer") so links round-trip to HTML.
        const target = mark.attrs?.target ? ` target="${escapeHtml(String(mark.attrs.target))}"` : ''
        const rel = mark.attrs?.rel ? ` rel="${escapeHtml(String(mark.attrs.rel))}"` : ''
        out = `<a href="${href}"${target}${rel}>${out}</a>`
        break
      }
    }
  }
  return out
}

function renderChildren(node: TipTapNode): string {
  return (node.content ?? []).map(renderNode).join('')
}

function renderNode(node: TipTapNode): string {
  switch (node.type) {
    case 'doc':           return renderChildren(node)
    case 'paragraph':     return `<p>${renderChildren(node)}</p>`
    case 'heading': {
      const lvl = Number(node.attrs?.level ?? 1)
      return `<h${lvl}>${renderChildren(node)}</h${lvl}>`
    }
    case 'text': {
      const escaped = escapeHtml(node.text ?? '')
      return node.marks?.length ? applyMarks(escaped, node.marks) : escaped
    }
    case 'hardBreak':     return '<br>'
    case 'horizontalRule':return '<hr>'
    case 'blockquote':    return `<blockquote>${renderChildren(node)}</blockquote>`
    case 'bulletList':    return `<ul>${renderChildren(node)}</ul>`
    case 'orderedList':   return `<ol>${renderChildren(node)}</ol>`
    case 'listItem':      return `<li>${renderChildren(node)}</li>`
    case 'codeBlock':     return `<pre><code>${escapeHtml(collectText(node))}</code></pre>`
    case 'image': {
      const src = escapeHtml(String(node.attrs?.src ?? ''))
      const alt = escapeHtml(String(node.attrs?.alt ?? ''))
      return `<img src="${src}" alt="${alt}">`
    }
    default:              return renderChildren(node)
  }
}

function collectText(node: TipTapNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  const childText = (node.content ?? []).map(collectText).join('')
  if (['paragraph', 'heading', 'blockquote'].includes(node.type)) return childText + '\n'
  if (node.type === 'listItem') return childText
  return childText
}

/**
 * Renders a TipTap JSON document as an HTML string.
 * @param json - The TipTap document object (unknown at call-site; validated internally).
 * @returns An HTML string, or an empty string if the input is null/invalid.
 */
export function tiptapToHtml(json: unknown): string {
  if (json == null) return ''
  try {
    return renderNode(json as TipTapNode)
  } catch {
    return ''
  }
}

/**
 * Extracts plain text from a TipTap JSON document, stripping all markup.
 * @param json - The TipTap document object (unknown at call-site; validated internally).
 * @returns A trimmed plain-text string, or an empty string if the input is null/invalid.
 */
export function tiptapToText(json: unknown): string {
  if (json == null) return ''
  try {
    return collectText(json as TipTapNode).trim()
  } catch {
    return ''
  }
}

function serializeValue(value: unknown, hint: SerializeHint): unknown {
  if (value == null || hint === 'json') return value
  if (hint === 'html') return tiptapToHtml(value)
  if (hint === 'text') return tiptapToText(value)
  return value
}

/**
 * Applies per-field serialization hints to an array of content rows, converting
 * richtext JSON values to html or text as specified.
 * @param rows - The raw content rows from the database.
 * @param hints - A map of dot-notation field paths to their desired SerializeHint format.
 * @returns A new array of rows with richtext fields serialized according to the hints.
 */
export function applySerialize(
  rows: Record<string, unknown>[],
  hints: Record<string, SerializeHint> | undefined,
): Record<string, unknown>[] {
  if (!hints || Object.keys(hints).length === 0) return rows

  return rows.map(row => {
    const result = { ...row }

    for (const [path, hint] of Object.entries(hints)) {
      const parts = path.split('.')

      if (parts.length === 1) {
        if (path in result) {
          result[path] = serializeValue(result[path], hint)
        }
      } else if (parts.length === 2) {
        const [parent, child] = parts
        const parentVal = result[parent]
        if (parentVal && typeof parentVal === 'object' && !Array.isArray(parentVal)) {
          const p = parentVal as Record<string, unknown>
          result[parent] = { ...p, [child]: serializeValue(p[child], hint) }
        }
      }
    }

    return result
  })
}
