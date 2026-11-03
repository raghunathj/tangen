/**
 * File Name: richtext-serializer.ts
 * Purpose: Renders a richtext document to HTML or plain text, and applies the
 *          per-field `serialize` hints a content read asked for.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Slice 2 of tasks/plan-editor.md. The element each node
 *          becomes is read from CONTENT_DOC_VOCABULARY rather than decided by
 *          a switch statement here, so a node ADDED to the vocabulary renders
 *          with no edit to this file - which is what lets slice 5 render a
 *          node an extension merely DECLARED, without executing anything the
 *          extension wrote.
 *
 *          Two defects are closed here, and both exist because the validator
 *          cannot help with a document that was stored before it did:
 *          an `href` is scheme-checked (`javascript:` used to survive into
 *          emitted HTML), and a heading level is clamped to 1-6 (`<h9>` used
 *          to be emitted for whatever a document happened to carry).
 */
import {
  CONTENT_DOC_VOCABULARY, safeDocHref, contentDocText, URL_BEARING_HTML_ATTRS,
  type SerializeHint, type ContentDocVocabulary, type ContentDocNodeSpec,
} from '@tangen/types'

interface DocMark {
  type: string
  attrs?: Record<string, unknown>
}

interface DocNode {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: DocMark[]
  content?: DocNode[]
}

/** `'` too: an attribute may be single-quoted by a consumer re-parsing this. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** The attributes a spec says reach the element, escaped, in declaration order. */
function htmlAttrs(
  attrs: Record<string, unknown> | undefined,
  map: Record<string, string> | undefined,
): string {
  if (!map || !attrs) return ''
  let out = ''
  for (const [key, name] of Object.entries(map)) {
    const value = attrs[key]
    if (value === null || value === undefined || value === '') continue
    // Every URL-bearing attribute has its scheme checked HERE, not at the one
    // call site that remembered to. The link mark did; the image node's `src`
    // did not, and slice 5 of tasks/plan-editor.md lets an extension declare a
    // node with its own `htmlAttrs` - so "the link mark checks its href" was
    // about to stop being a sufficient answer (security audit S7). An
    // attribute that does not survive the check is DROPPED: the element keeps
    // its text and loses the navigation.
    if (URL_BEARING_HTML_ATTRS.has(name)) {
      const safe = safeDocHref(value)
      if (!safe) continue
      out += ` ${name}="${escapeHtml(safe)}"`
      continue
    }
    out += ` ${name}="${escapeHtml(String(value))}"`
  }
  return out
}

/**
 * The element for a node, resolving the one substitution the spec allows:
 * `h{level}` reads `attrs.level`. Clamped by the attr's own declared bounds,
 * so the vocabulary is what decides the range rather than this function.
 */
function tagFor(spec: ContentDocNodeSpec, node: DocNode): string | null {
  if (!spec.tag) return null
  const hole = /\{([a-zA-Z0-9_]+)\}/.exec(spec.tag)
  if (!hole) return spec.tag
  const attrName = hole[1]!
  const declared = spec.attrs?.[attrName]
  const raw = Number(node.attrs?.[attrName])
  let value = Number.isFinite(raw) ? Math.trunc(raw) : NaN
  if (declared?.kind === 'int') {
    const min = declared.min ?? 1
    const max = declared.max ?? 6
    value = Number.isNaN(value) ? min : Math.min(max, Math.max(min, value))
  } else if (Number.isNaN(value)) {
    return null
  }
  return spec.tag.replace(hole[0], String(value))
}

function applyMarks(text: string, marks: DocMark[], v: ContentDocVocabulary): string {
  let out = text
  for (const mark of marks) {
    const spec = v.marks[mark.type]
    if (!spec) continue
    // A link whose href is not safe to emit loses the MARK, not the text.
    if (spec.htmlAttrs?.href) {
      const href = safeDocHref(mark.attrs?.href)
      if (!href) continue
      out = `<${spec.tag}${htmlAttrs({ ...mark.attrs, href }, spec.htmlAttrs)}>${out}</${spec.tag}>`
      continue
    }
    out = `<${spec.tag}${htmlAttrs(mark.attrs, spec.htmlAttrs)}>${out}</${spec.tag}>`
  }
  return out
}

function renderChildren(node: DocNode, v: ContentDocVocabulary): string {
  return (node.content ?? []).map((child) => renderNode(child, v)).join('')
}

function renderNode(node: DocNode, v: ContentDocVocabulary): string {
  const spec = v.nodes[node.type]
  // An unknown node degrades to its children: a wrapper is lost, prose is not.
  if (!spec) return renderChildren(node, v)

  if (node.type === 'text') {
    const escaped = escapeHtml(node.text ?? '')
    return node.marks?.length ? applyMarks(escaped, node.marks, v) : escaped
  }

  const tag = tagFor(spec, node)
  if (!tag) return renderChildren(node, v)
  if (spec.void) return `<${tag}${htmlAttrs(node.attrs, spec.htmlAttrs)}>`
  // Text-only content is never marked up - a code block is the case.
  const inner = spec.content === 'text' ? escapeHtml(collectText(node, v)) : renderChildren(node, v)
  // `pre` carries its own `code` element, which is HTML's shape for it.
  if (node.type === 'codeBlock') return `<${tag}><code>${inner}</code></${tag}>`
  return `<${tag}${htmlAttrs(node.attrs, spec.htmlAttrs)}>${inner}</${tag}>`
}

/**
 * Plain text is `contentDocText` now - one walker for the whole platform.
 * It also fixes a defect this file had: list items ran together, so a bullet
 * list of `one two three` extracted as `onetwothree`.
 */
const collectText = (node: DocNode, _v: ContentDocVocabulary): string => contentDocText(node)

/**
 * Renders a richtext document as an HTML string.
 * @param json - the document (unknown at the call site; checked internally)
 * @param vocabulary - the node and mark vocabulary; defaults to the built-in one
 * @returns an HTML string, or '' for a null or unusable input
 */
export function tiptapToHtml(json: unknown, vocabulary: ContentDocVocabulary = CONTENT_DOC_VOCABULARY): string {
  if (json == null) return ''
  try {
    return renderNode(json as DocNode, vocabulary)
  } catch {
    return ''
  }
}

/**
 * Extracts plain text from a richtext document, stripping all markup.
 * @param json - the document (unknown at the call site; checked internally)
 * @param vocabulary - the node and mark vocabulary; defaults to the built-in one
 * @returns a trimmed plain-text string, or '' for a null or unusable input
 */
export function tiptapToText(json: unknown, vocabulary: ContentDocVocabulary = CONTENT_DOC_VOCABULARY): string {
  if (json == null) return ''
  try {
    return collectText(json as DocNode, vocabulary).trim()
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
 * Applies per-field serialization hints to content rows, converting richtext
 * values to html or text as asked.
 * @param rows - the raw content rows
 * @param hints - dot-notation field path to the format wanted
 * @returns a new array of rows with the named fields serialized
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
