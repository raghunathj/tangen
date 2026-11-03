/**
 * File Name: content-doc.ts
 * Purpose: What a richtext document IS - slice 1 of tasks/plan-editor.md.
 *          The vocabulary of nodes and marks a `richtext` field may hold,
 *          declared as DATA rather than implied by whichever editor happens
 *          to be installed.
 *
 *          This is today's shape written down, not a new format: the same
 *          node and mark names the admin's editor already produces. Nothing
 *          stored needs migrating.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure types and one frozen table. The validator lives in
 *          `@tangen/schema` beside the path grammar; the HTML renderer reads
 *          this table in `@tangen/api`, so adding a node adds its HTML.
 *
 *          Data, not code, is the whole point. An extension will contribute a
 *          node by DECLARING one (slice 5), and the platform renders it
 *          without executing anything the extension wrote - which is both the
 *          security property and what keeps the vocabulary independent of any
 *          one editor engine.
 */

/** What a node may hold. `text` is the leaf; `none` is void (`hardBreak`, `image`). */
export type ContentDocContent = 'blocks' | 'inline' | 'text' | 'none'

/**
 * An attribute a node may carry, and the shape it must have.
 *
 * Deliberately four kinds and no expression language. A declaration richer
 * than this would be code wearing a data costume, and the point of the
 * contribution point is that it cannot be.
 */
export type ContentDocAttr =
  | { kind: 'string'; required?: boolean; /** A closed set, when there is one. */ oneOf?: readonly string[] }
  | { kind: 'int'; required?: boolean; min?: number; max?: number }
  | { kind: 'bool'; required?: boolean }
  | { kind: 'url'; required?: boolean }

export interface ContentDocNodeSpec {
  /**
   * Where the node may appear: a block sits in `blocks`, an inline in
   * `inline`, and `root` appears in nothing at all.
   *
   * `root` exists because `doc` is not a block. Calling it one made every
   * container admit a second document inside itself, and made the editor's
   * schema offer `doc` as the thing to fill a block with - which recursed
   * until the stack ran out. A root belongs to no group, and an extension
   * cannot declare one (`richtext-nodes.ts` accepts `block` and `inline`
   * only), so the vocabulary has exactly one.
   */
  group: 'block' | 'inline' | 'root'
  content: ContentDocContent
  /**
   * The element this node becomes. `null` renders children with no wrapper
   * (`doc`). A `{level}`-style hole names an attr, which is the one
   * substitution the spec allows - it exists for `heading` and stops there.
   */
  tag: string | null
  /** No closing tag and no children (`<br>`, `<hr>`, `<img>`). */
  void?: boolean
  attrs?: Record<string, ContentDocAttr>
  /** Attrs that reach the HTML element, mapped to their attribute name. */
  htmlAttrs?: Record<string, string>
}

export interface ContentDocMarkSpec {
  tag: string
  attrs?: Record<string, ContentDocAttr>
  htmlAttrs?: Record<string, string>
}

export interface ContentDocVocabulary {
  nodes: Record<string, ContentDocNodeSpec>
  marks: Record<string, ContentDocMarkSpec>
}

/** A document nests no deeper than this. Bounds the validator and the renderer. */
export const CONTENT_DOC_MAX_DEPTH = 40

/**
 * The built-in vocabulary: exactly what the admin editor's extension list can
 * produce. Twelve nodes, six marks.
 *
 * `heading` is the only node whose element depends on an attribute, and its
 * `level` is bounded here - which is also the fix for a serializer that
 * emitted `<h9>` for whatever a document happened to carry.
 */
export const CONTENT_DOC_VOCABULARY: ContentDocVocabulary = Object.freeze({
  nodes: Object.freeze({
    doc:            { group: 'root',   content: 'blocks', tag: null },
    paragraph:      { group: 'block',  content: 'inline', tag: 'p' },
    heading:        { group: 'block',  content: 'inline', tag: 'h{level}', attrs: { level: { kind: 'int', required: true, min: 1, max: 6 } } },
    blockquote:     { group: 'block',  content: 'blocks', tag: 'blockquote' },
    bulletList:     { group: 'block',  content: 'blocks', tag: 'ul' },
    orderedList:    { group: 'block',  content: 'blocks', tag: 'ol' },
    listItem:       { group: 'block',  content: 'blocks', tag: 'li' },
    // Text only: a code block's contents are never marked up.
    codeBlock:      { group: 'block',  content: 'text',   tag: 'pre' },
    horizontalRule: { group: 'block',  content: 'none',   tag: 'hr', void: true },
    image:          { group: 'block',  content: 'none',   tag: 'img', void: true,
                      attrs: { src: { kind: 'string', required: true }, alt: { kind: 'string' } },
                      htmlAttrs: { src: 'src', alt: 'alt' } },
    text:           { group: 'inline', content: 'none',   tag: null },
    hardBreak:      { group: 'inline', content: 'none',   tag: 'br', void: true },
  } as Record<string, ContentDocNodeSpec>),
  marks: Object.freeze({
    bold:      { tag: 'strong' },
    italic:    { tag: 'em' },
    underline: { tag: 'u' },
    strike:    { tag: 's' },
    code:      { tag: 'code' },
    // `rel` is carried so an authored "open in new tab" keeps its
    // noopener/noreferrer through the HTML serialize, as docs/fields.md says.
    link:      { tag: 'a',
                 attrs: { href: { kind: 'url', required: true }, target: { kind: 'string' }, rel: { kind: 'string' } },
                 htmlAttrs: { href: 'href', target: 'target', rel: 'rel' } },
  } as Record<string, ContentDocMarkSpec>),
}) as ContentDocVocabulary

/**
 * The schemes a document's `href` may carry.
 *
 * Anything else loses the link entirely - the text stays, the navigation
 * does not. A relative or fragment href has no scheme and is always fine.
 * This lives with the vocabulary because both the validator and the HTML
 * renderer need the same answer, and because a document written before the
 * validator existed is still in a database somewhere.
 */
export const CONTENT_DOC_HREF_SCHEMES: readonly string[] = ['http', 'https', 'mailto', 'tel']

/**
 * The HTML attributes that carry a URL, and so must have their scheme checked
 * wherever one is emitted.
 *
 * It lives with the vocabulary because the vocabulary is what DECLARES which
 * attributes a node or mark emits (`htmlAttrs`), and because slice 5 of
 * tasks/plan-editor.md lets an extension declare a node with its own
 * `htmlAttrs` - at which point "the link mark checks its href" stops being a
 * sufficient answer. The renderer asks this set rather than naming `href`
 * itself, so a node that declares `src` or `poster` is covered on the day it
 * is declared and not on the day someone notices (security audit S7).
 */
export const URL_BEARING_HTML_ATTRS: ReadonlySet<string> = new Set([
  'href', 'src', 'srcset', 'action', 'formaction', 'poster', 'cite', 'data', 'background',
])

/** The href if it is safe to emit, else undefined. */
export function safeDocHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const href = value.trim()
  if (href === '') return undefined
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href)?.[1]?.toLowerCase()
  if (!scheme) return href
  return CONTENT_DOC_HREF_SCHEMES.includes(scheme) ? href : undefined
}

export const contentDocNodeNames = (v: ContentDocVocabulary = CONTENT_DOC_VOCABULARY): string[] => Object.keys(v.nodes)
export const contentDocMarkNames = (v: ContentDocVocabulary = CONTENT_DOC_VOCABULARY): string[] => Object.keys(v.marks)

/** Nodes that end a line in the readable plain-text rendering. */
const TEXT_BLOCKS = new Set([
  'paragraph', 'heading', 'blockquote', 'listItem', 'codeBlock',
])

/**
 * The plain text of a richtext document.
 *
 * One walker, where there were four. They differed only in where they put
 * whitespace, and two of them were wrong about it: the serializer's version
 * put NOTHING between list items, so `one two three` came out `onetwothree`,
 * and search's version put a space between every child whether or not the
 * document had a word boundary there.
 *
 * `separator` is the whole difference between the two legitimate purposes.
 * Readable text (the `serialize: 'text'` hint, the CSV export) wants a
 * newline between blocks; search and embedding tokens want a space, because
 * what matters there is only that words do not fuse.
 *
 * Shape-tolerant on purpose: it accepts a document, a bare node, a bare node
 * ARRAY and a plain string, because the column holds all four in practice.
 * Never throws.
 */
export function contentDocText(value: unknown, opts: { separator?: string } = {}): string {
  const separator = opts.separator ?? '\n'
  try {
    return walkText(value, separator, 0).trim()
  } catch {
    return ''
  }
}

function walkText(value: unknown, separator: string, depth: number): string {
  if (depth > CONTENT_DOC_MAX_DEPTH) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((v) => walkText(v, separator, depth + 1)).join('')
  if (!value || typeof value !== 'object') return ''
  const node = value as { type?: unknown; text?: unknown; content?: unknown }
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : ''
  if (node.type === 'hardBreak') return separator === ' ' ? ' ' : '\n'
  const inner = Array.isArray(node.content)
    ? node.content.map((v) => walkText(v, separator, depth + 1)).join('')
    : ''
  if (typeof node.type !== 'string' || !TEXT_BLOCKS.has(node.type)) return inner
  // A block that wraps blocks must not stack separators: a `listItem` holding
  // a `paragraph` ends the line once, not twice.
  return inner.endsWith(separator) ? inner : inner + separator
}

/**
 * Whether a value is a richtext DOCUMENT.
 *
 * One predicate, because `typeof v.type === 'string'` was copied into three
 * files as the answer and it is wrong: a link value (`{ type: 'internal',
 * target: {...} }`) passes it, so a link could be read as prose.
 */
export function isContentDoc(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as { type?: unknown; content?: unknown }
  return v.type === 'doc' && (v.content === undefined || Array.isArray(v.content))
}

/**
 * Whether an object inside a localization overlay is a LEAF VALUE rather than
 * a nested map of sub-field names.
 *
 * This is NOT `isContentDoc`, and the difference is a latent bug rather than
 * pedantry. The i18n overlay walk needs to know "may I descend into this?",
 * and a richtext document is only one of the leaf shapes it meets: `link` is
 * localizable too, so `{ type: 'internal', target: {...} }` is equally a
 * leaf. Narrowing this to `type === 'doc'` would route a localized link
 * inside a component block into the nested-map branch and corrupt it.
 *
 * So: a leaf is an object that names its own kind with a string `type`. Two
 * files had this as an inline check called `isRichDoc`, which is what made it
 * look interchangeable with the predicate above.
 */
export function isOverlayLeafValue(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return typeof (value as { type?: unknown }).type === 'string'
}
