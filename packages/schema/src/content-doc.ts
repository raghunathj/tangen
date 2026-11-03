/**
 * File Name: content-doc.ts
 * Purpose: Holding a richtext document to the vocabulary - slice 1 of
 *          tasks/plan-editor.md. Pure, and the only place that decides
 *          whether a document is well formed.
 *
 *          Before this there was no answer: `validateFieldValue` had no
 *          `richtext` case, the route typed the value `t.Any()`, and the
 *          column accepts bare scalars - so a malformed document reached
 *          storage and surfaced later as an empty string out of a serializer.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: It VALIDATES and never normalizes. `object-snapshot`
 *          fingerprints the whole field value, so a document reshaped on
 *          write would make every existing object read as edited. Refusing is
 *          the only safe answer; rewriting is not.
 */
import {
  CONTENT_DOC_VOCABULARY, CONTENT_DOC_MAX_DEPTH, isContentDoc,
  type ContentDocVocabulary, type ContentDocAttr, type ContentDocContent, type ContentDocNodeSpec,
} from '@tangen/types'

/** Why a document was refused. Every case names the thing that caused it. */
export type ContentDocFailure =
  | { ok: false; reason: 'not-a-document' }
  | { ok: false; reason: 'unknown-node'; node: string; path: string }
  | { ok: false; reason: 'unknown-mark'; mark: string; path: string }
  | { ok: false; reason: 'content-not-allowed'; node: string; child: string; path: string }
  | { ok: false; reason: 'unknown-attr'; node: string; attr: string; path: string }
  | { ok: false; reason: 'bad-attr'; node: string; attr: string; path: string }
  | { ok: false; reason: 'missing-attr'; node: string; attr: string; path: string }
  | { ok: false; reason: 'bad-text'; path: string }
  | { ok: false; reason: 'too-deep'; path: string }

export type ContentDocResult = { ok: true } | ContentDocFailure

// Re-exported so one import answers "the document contract": the vocabulary
// is data in @tangen/types (the admin and the renderer read it too), the
// validator is here, and a caller should not have to know which is which.
export {
  CONTENT_DOC_VOCABULARY, CONTENT_DOC_MAX_DEPTH, contentDocNodeNames, contentDocMarkNames, isContentDoc,
} from '@tangen/types'
export type {
  ContentDocVocabulary, ContentDocNodeSpec, ContentDocMarkSpec, ContentDocAttr, ContentDocContent,
} from '@tangen/types'

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** Whether a child of `group` may sit inside a parent holding `content`. */
function admits(content: ContentDocContent, childGroup: ContentDocNodeSpec['group'], childType: string): boolean {
  // A `root` is in no group, so nothing admits it: a document holds blocks,
  // and a second document is not one of them.
  if (childGroup === 'root') return false
  if (content === 'blocks') return childGroup === 'block'
  if (content === 'inline') return childGroup === 'inline'
  // A code block holds text and nothing else - not even a hard break.
  if (content === 'text') return childType === 'text'
  return false
}

function checkAttr(spec: ContentDocAttr, value: unknown): boolean {
  switch (spec.kind) {
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) return false
      if (spec.min !== undefined && value < spec.min) return false
      if (spec.max !== undefined && value > spec.max) return false
      return true
    case 'bool': return typeof value === 'boolean'
    case 'string':
      if (typeof value !== 'string') return false
      return !spec.oneOf || spec.oneOf.includes(value)
    // A URL is checked for SHAPE here, never for safety: the serializer is
    // what refuses a dangerous scheme, because that is where the decision has
    // to hold even for a document written before this rule existed.
    case 'url': return typeof value === 'string'
  }
}

/**
 * Is this a document the vocabulary admits?
 *
 * `null`, `undefined` and a bare STRING are all legal - an empty field, and
 * the plain-text value the write path deliberately tolerates (update.ts: "a
 * richtext body can legitimately be a bare string"). A bare node ARRAY is
 * not: no writer produces one, and two readers would mis-handle it.
 */
export function validateContentDoc(
  value: unknown,
  vocabulary: ContentDocVocabulary = CONTENT_DOC_VOCABULARY,
): ContentDocResult {
  if (value === null || value === undefined || typeof value === 'string') return { ok: true }
  if (!isContentDoc(value)) return { ok: false, reason: 'not-a-document' }
  return walk(value as Record<string, unknown>, vocabulary, 'doc', 0)
}

function walk(node: Record<string, unknown>, v: ContentDocVocabulary, path: string, depth: number): ContentDocResult {
  if (depth > CONTENT_DOC_MAX_DEPTH) return { ok: false, reason: 'too-deep', path }

  const type = node.type
  if (typeof type !== 'string' || type === '') return { ok: false, reason: 'unknown-node', node: String(type ?? ''), path }
  const spec = v.nodes[type]
  if (!spec) return { ok: false, reason: 'unknown-node', node: type, path }

  // Text is the leaf and carries the marks.
  if (type === 'text') {
    if (typeof node.text !== 'string') return { ok: false, reason: 'bad-text', path }
    const marks = node.marks
    if (marks !== undefined) {
      if (!Array.isArray(marks)) return { ok: false, reason: 'bad-text', path }
      for (const raw of marks) {
        const m = obj(raw)
        const name = m?.type
        if (typeof name !== 'string' || !v.marks[name]) {
          return { ok: false, reason: 'unknown-mark', mark: typeof name === 'string' ? name : '', path }
        }
        const attrFail = checkAttrs(m!, v.marks[name]!.attrs, type, path)
        if (attrFail) return attrFail
      }
    }
    return { ok: true }
  }

  const attrFail = checkAttrs(node, spec.attrs, type, path)
  if (attrFail) return attrFail

  const content = node.content
  if (content === undefined) return { ok: true }
  if (!Array.isArray(content)) return { ok: false, reason: 'content-not-allowed', node: type, child: typeof content, path }

  for (let i = 0; i < content.length; i++) {
    const child = obj(content[i])
    const childPath = `${path}.content[${i}]`
    if (!child) return { ok: false, reason: 'unknown-node', node: '', path: childPath }
    const childType = child.type
    if (typeof childType !== 'string' || !v.nodes[childType]) {
      return { ok: false, reason: 'unknown-node', node: typeof childType === 'string' ? childType : '', path: childPath }
    }
    if (!admits(spec.content, v.nodes[childType]!.group, childType)) {
      return { ok: false, reason: 'content-not-allowed', node: type, child: childType, path: childPath }
    }
    const res = walk(child, v, childPath, depth + 1)
    if (!res.ok) return res
  }
  return { ok: true }
}

/** Declared attrs only, each the shape it declared, required ones present. */
function checkAttrs(
  holder: Record<string, unknown>,
  declared: Record<string, ContentDocAttr> | undefined,
  nodeName: string,
  path: string,
): ContentDocFailure | null {
  const attrs = obj(holder.attrs)
  const specs = declared ?? {}
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      const spec = specs[key]
      if (!spec) return { ok: false, reason: 'unknown-attr', node: nodeName, attr: key, path }
      // An absent value is the same as not set, which `required` then catches.
      if (attrs[key] === null || attrs[key] === undefined) continue
      if (!checkAttr(spec, attrs[key])) return { ok: false, reason: 'bad-attr', node: nodeName, attr: key, path }
    }
  }
  for (const [key, spec] of Object.entries(specs)) {
    if (!spec.required) continue
    const present = attrs && attrs[key] !== null && attrs[key] !== undefined
    if (!present) return { ok: false, reason: 'missing-attr', node: nodeName, attr: key, path }
  }
  return null
}
