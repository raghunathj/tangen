/**
 * File Name: richtext-schema.ts
 * Purpose: Tangen's document vocabulary, compiled into a ProseMirror schema -
 *          slice 7 of tasks/plan-editor.md.
 *
 *          This is the file that makes the engine swap an adaptation rather
 *          than a rewrite. `CONTENT_DOC_VOCABULARY` already says what a node
 *          is called, what it may hold, which attributes it carries and what
 *          element it becomes; a ProseMirror node spec wants exactly those
 *          four things. So the editor's schema is DERIVED, and an extension's
 *          contributed node (slice 5) compiles the same way with no code of
 *          its own running here.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure - no DOM, no view, no editor. That is deliberate:
 *          it means the schema is testable under `bun test` rather than only
 *          in the browser lane, and a vocabulary change that would break the
 *          editor fails in the fast suite.
 *
 *          The editor's schema is STRICTER than the stored format in one
 *          place, and `CONTAINS` below says where and why. A validator must
 *          accept what is already in a database; an editor must refuse to
 *          BUILD nonsense. Those are different jobs and this is the only
 *          place they disagree.
 */
import { Schema, type MarkSpec, type NodeSpec, type DOMOutputSpec, type ParseRule } from 'prosemirror-model'
import { CONTENT_DOC_VOCABULARY, type ContentDocAttr, type ContentDocMarkSpec, type ContentDocNodeSpec, type ContentDocVocabulary } from '@tangen/types'

/**
 * Where the editor is stricter than the format.
 *
 * The vocabulary says a list holds `blocks`, which is true of what may be
 * STORED - and `<ul><p>text</p></ul>` is exactly what a list command would
 * produce if the editor believed it, because ProseMirror picks the shortest
 * wrapping that satisfies the content expression. So the three list nodes
 * name their children here. Everything else compiles from the vocabulary
 * alone, including a contributed node, which gets the permissive default.
 */
const CONTAINS: Record<string, string> = {
  bulletList: 'listItem+',
  orderedList: 'listItem+',
  // The ProseMirror convention: a list item opens with a paragraph, so typing
  // in one has somewhere to go, and may then hold anything (a nested list).
  listItem: 'paragraph block*',
}

/**
 * Extra ways to RECOGNISE a node or mark that the vocabulary does not name,
 * because the vocabulary says what Tangen WRITES and this says what a paste
 * may carry. `<b>` from a word processor and `<strong>` are the same mark;
 * refusing the first would silently drop formatting on paste.
 */
const ALSO_PARSES: Record<string, ParseRule[]> = {
  bold: [{ tag: 'b', getAttrs: (n) => (n as HTMLElement).style.fontWeight !== 'normal' && null }, { style: 'font-weight=bold' }, { style: 'font-weight=700' }],
  italic: [{ tag: 'i' }, { style: 'font-style=italic' }],
  strike: [{ tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration=line-through' }],
  underline: [{ style: 'text-decoration=underline' }],
}

/** Marks that must not grow when you type at their edge. A link is the one. */
const NOT_INCLUSIVE = new Set(['link'])

/** The content expression for one node, from what the vocabulary says it holds. */
function contentOf(name: string, spec: ContentDocNodeSpec): string | undefined {
  if (CONTAINS[name]) return CONTAINS[name]
  switch (spec.content) {
    case 'blocks': return 'block+'
    case 'inline': return 'inline*'
    case 'text': return 'text*'
    case 'none': return undefined
  }
}

/** A ProseMirror attr default from a declared attribute. Required means no default. */
const attrDefault = (attr: ContentDocAttr): { default?: unknown } =>
  attr.required ? {} : { default: null }

const attrsOf = (declared: Record<string, ContentDocAttr> | undefined): Record<string, { default?: unknown }> | undefined => {
  if (!declared) return undefined
  const out: Record<string, { default?: unknown }> = {}
  for (const [name, attr] of Object.entries(declared)) out[name] = attrDefault(attr)
  return Object.keys(out).length ? out : undefined
}

/** The `{attr}` hole a tag may carry. `h{level}` is the only user of it. */
const HOLE = /\{(\w+)\}/

/**
 * The element names one spec can produce. A plain tag is itself; a tag with a
 * hole expands over the attribute's declared bounds - which is the same bound
 * the server serializer clamps to, from the same table.
 */
function tagsFor(spec: ContentDocNodeSpec): Array<{ tag: string; attrs?: Record<string, unknown> }> {
  if (!spec.tag) return []
  const hole = HOLE.exec(spec.tag)
  if (!hole) return [{ tag: spec.tag }]
  const attrName = hole[1]!
  const attr = spec.attrs?.[attrName]
  if (!attr || attr.kind !== 'int') return [{ tag: spec.tag }]
  const min = attr.min ?? 1
  const max = attr.max ?? min
  const out: Array<{ tag: string; attrs?: Record<string, unknown> }> = []
  for (let i = min; i <= max; i++) out.push({ tag: spec.tag.replace(HOLE, String(i)), attrs: { [attrName]: i } })
  return out
}

/** Only the attributes the vocabulary says reach the element, and only if set. */
function htmlAttrsOf(map: Record<string, string> | undefined, attrs: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  if (!map) return out
  for (const [attrName, htmlName] of Object.entries(map)) {
    const value = attrs[attrName]
    if (value !== null && value !== undefined && value !== '') out[htmlName] = String(value)
  }
  return out
}

/** Reads the declared attributes back off an element, for a paste or a setHTML. */
const getAttrsFor = (spec: { attrs?: Record<string, ContentDocAttr>; htmlAttrs?: Record<string, string> }) =>
  (dom: HTMLElement | string): Record<string, unknown> | null => {
    if (typeof dom === 'string' || !spec.htmlAttrs) return null
    const out: Record<string, unknown> = {}
    for (const [attrName, htmlName] of Object.entries(spec.htmlAttrs)) {
      const raw = dom.getAttribute(htmlName)
      if (raw === null) continue
      out[attrName] = spec.attrs?.[attrName]?.kind === 'int' ? Number(raw) : raw
    }
    return out
  }

function nodeSpecFor(name: string, spec: ContentDocNodeSpec): NodeSpec {
  const content = contentOf(name, spec)
  const tags = tagsFor(spec)
  const out: NodeSpec = {
    // A `root` gets NO ProseMirror group, and that is load-bearing rather
    // than tidy. ProseMirror fills a container by searching its content
    // group in schema order, so a `doc` that called itself a block was the
    // first candidate for filling a block - and filling a `doc` needs
    // another block. An empty blockquote exhausted the stack.
    ...(spec.group === 'root' ? {} : { group: spec.group }),
    ...(content ? { content } : {}),
    ...(spec.attrs ? { attrs: attrsOf(spec.attrs) } : {}),
  }

  // Text-only content is literal content: no marks inside it, whitespace kept,
  // and the whole block replaced rather than merged when you paste into it.
  if (spec.content === 'text') {
    out.marks = ''
    out.code = true
    out.defining = true
  }
  if (spec.content === 'inline') out.defining = true
  if (spec.content === 'none' && spec.group === 'inline') {
    out.inline = true
    out.selectable = false
  }
  if (spec.void && spec.group === 'block') out.atom = true

  if (!tags.length) return out

  out.parseDOM = tags.map(({ tag, attrs }) => ({
    tag,
    ...(attrs ? { attrs } : {}),
    ...(spec.htmlAttrs ? { getAttrs: getAttrsFor(spec) } : {}),
    ...(spec.content === 'text' ? { preserveWhitespace: 'full' as const } : {}),
  }))

  out.toDOM = (node): DOMOutputSpec => {
    const hole = spec.tag && HOLE.exec(spec.tag)
    const tag = hole ? spec.tag!.replace(HOLE, String(node.attrs[hole[1]!] ?? 1)) : spec.tag!
    const attrs = htmlAttrsOf(spec.htmlAttrs, node.attrs)
    return spec.void ? [tag, attrs] : [tag, attrs, 0]
  }
  return out
}

function markSpecFor(name: string, spec: ContentDocMarkSpec): MarkSpec {
  const out: MarkSpec = {
    ...(spec.attrs ? { attrs: attrsOf(spec.attrs) } : {}),
    ...(NOT_INCLUSIVE.has(name) ? { inclusive: false } : {}),
    parseDOM: [
      { tag: spec.tag, ...(spec.htmlAttrs ? { getAttrs: getAttrsFor(spec) } : {}) },
      ...(ALSO_PARSES[name] ?? []),
    ],
    toDOM: (mark): DOMOutputSpec => [spec.tag, htmlAttrsOf(spec.htmlAttrs, mark.attrs), 0],
  }
  return out
}

/**
 * The editor's schema for a vocabulary. `doc` is the top node and `text` is
 * ProseMirror's own leaf, both of which the vocabulary already names - so the
 * compiler recognises them rather than special-casing them away.
 */
export function richtextSchema(vocabulary: ContentDocVocabulary = CONTENT_DOC_VOCABULARY): Schema {
  const nodes: Record<string, NodeSpec> = {}
  for (const [name, spec] of Object.entries(vocabulary.nodes)) {
    // ProseMirror's text leaf: no parse rule, no toDOM, and it must come
    // early enough that inline content can reference it.
    nodes[name] = name === 'text' ? { group: 'inline' } : nodeSpecFor(name, spec)
  }
  const marks: Record<string, MarkSpec> = {}
  for (const [name, spec] of Object.entries(vocabulary.marks)) marks[name] = markSpecFor(name, spec)
  return new Schema({ nodes, marks, topNode: 'doc' })
}

/**
 * The HTML a vocabulary can RECOGNISE: element names, and the attribute names
 * each of those elements keeps.
 *
 * Derived from the same two tables the schema compiles from, so it can never
 * disagree with the parser - including `ALSO_PARSES`, without which `<b>` from
 * a word processor would be reported as dropped while the parser happily keeps
 * it, and including a contributed node, which arrives in the vocabulary.
 */
export interface RecognisedHtml {
  tags: Set<string>
  attrsByTag: Map<string, Set<string>>
}

export function recognisedHtml(vocabulary: ContentDocVocabulary = CONTENT_DOC_VOCABULARY): RecognisedHtml {
  const tags = new Set<string>()
  const attrsByTag = new Map<string, Set<string>>()

  const record = (tag: string, htmlAttrs: Record<string, string> | undefined) => {
    const name = tag.toLowerCase()
    tags.add(name)
    const set = attrsByTag.get(name) ?? new Set<string>()
    for (const htmlName of Object.values(htmlAttrs ?? {})) set.add(htmlName.toLowerCase())
    attrsByTag.set(name, set)
  }

  for (const spec of Object.values(vocabulary.nodes)) {
    for (const { tag } of tagsFor(spec)) record(tag, spec.htmlAttrs)
  }
  for (const [name, spec] of Object.entries(vocabulary.marks)) {
    if (spec.tag) record(spec.tag, spec.htmlAttrs)
    // A paste-only alias carries no attributes of its own.
    for (const rule of ALSO_PARSES[name] ?? []) if (rule.tag) record(rule.tag, undefined)
  }
  return { tags, attrsByTag }
}

/** The built-in schema, built once. */
export const RICHTEXT_SCHEMA: Schema = richtextSchema()
