/**
 * File Name: use-richtext-vocabulary.ts
 * Purpose: The document vocabulary one workspace's editor should offer: the
 *          built-in nodes plus whatever its active extensions contribute.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Slice 5 let an extension DECLARE a richtext node and
 *          slice 8 made the validator accept it, but nothing told the browser,
 *          so a node could be stored, served and searched and still be
 *          unreachable from the editor. This is the client half: the
 *          declarations ride the Admin bootstrap read (`/admin/ui-config`),
 *          and the vocabulary is composed here.
 *
 *          `key` is the load-bearing part. A vocabulary can arrive AFTER the
 *          field has mounted, and a ProseMirror state belongs to exactly one
 *          schema, so the field remounts on a change of key rather than
 *          swapping a schema under a live document. In the ordinary case - no
 *          contributions - the key never changes and nothing remounts.
 */
import { useMemo } from 'react'
import { CONTENT_DOC_VOCABULARY, richtextNodeSpec, type ContentDocVocabulary, type ContentDocNodeSpec } from '@tangen/types'
import { useCapabilities, type RichtextContribution } from './use-capabilities'

export interface RichtextVocabulary {
  vocabulary: ContentDocVocabulary
  /**
   * Changes only when the vocabulary does. Use it as a React `key` on whatever
   * holds an editor state, so a late arrival remounts instead of corrupting.
   */
  key: string
  /** The declarations, highest priority first, for an insert menu. */
  contributions: RichtextContribution[]
}

/**
 * The contributions, as a list, whatever arrived.
 *
 * The flag is typed as an array and the capability store defaults it to one,
 * so within a coherent build this only ever passes the value through. It
 * exists because that is not the only build there is: a deployment running
 * ahead of its published packages had the hook without the store that
 * declares the flag, `flags.richtextNodes` was undefined, and every object
 * editor holding a richtext field died on `undefined.map` - for a feature
 * that deployment does not use. One absent flag should cost the contributed
 * nodes, not the editor.
 */
const listOf = (contributions: RichtextContribution[]): RichtextContribution[] =>
  Array.isArray(contributions) ? contributions : []

/** Pure, so it is tested without a store or a React tree. */
export function composeVocabulary(contributions: RichtextContribution[]): ContentDocVocabulary {
  const list = listOf(contributions)
  if (list.length === 0) return CONTENT_DOC_VOCABULARY
  const nodes: Record<string, ContentDocNodeSpec> = { ...CONTENT_DOC_VOCABULARY.nodes }
  for (const node of list) nodes[node.name] = richtextNodeSpec(node)
  return { nodes, marks: CONTENT_DOC_VOCABULARY.marks }
}

/** The names, in order, as one string. Built-in only is the empty key. */
export const vocabularyKey = (contributions: RichtextContribution[]): string =>
  listOf(contributions).map((n) => n.name).join(',')

/**
 * A starting value for every attribute a node REQUIRES.
 *
 * A required attribute has no schema default, by design: a stored document
 * must carry one, and `ContentDocAttr.required` is what says so. But inserting
 * such a node from a menu has to produce something valid, and ProseMirror
 * throws rather than inventing a value. So the declaration's own bounds supply
 * it: the first of a closed set, the minimum of a range, `false`, or an empty
 * string. Optional attributes are left alone and keep their null default.
 */
export function insertAttrsFor(node: RichtextContribution): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [name, attr] of Object.entries(node.attrs ?? {})) {
    if (!attr.required) continue
    switch (attr.kind) {
      case 'string': out[name] = attr.oneOf?.[0] ?? ''; break
      case 'int': out[name] = attr.min ?? 0; break
      case 'bool': out[name] = false; break
      case 'url': out[name] = ''; break
    }
  }
  return out
}

export function useRichtextVocabulary(workspaceId: string | undefined): RichtextVocabulary {
  const { flags } = useCapabilities(workspaceId)
  // Normalized HERE as well as in the two helpers, because the field reads
  // `contributions.length` and maps over it for the insert menu: the hook
  // owes its callers a list.
  const contributions = listOf(flags.richtextNodes)
  const key = vocabularyKey(contributions)
  // Keyed on the NAMES rather than the array identity: the store hands back a
  // new array on every bootstrap read, and remounting every field because a
  // read repeated would be a bug with no symptom but a lost caret.
  const vocabulary = useMemo(() => composeVocabulary(contributions), [key])
  return { vocabulary, key, contributions }
}
