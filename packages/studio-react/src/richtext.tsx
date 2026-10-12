/**
 * File Name: richtext.tsx
 * Purpose: Minimal safe renderer for the platform's richtext JSON (TipTap/
 *          ProseMirror document shape, as produced by the admin editor's
 *          getJSON()): paragraphs, headings, bold/italic/underline/link
 *          marks, bullet and ordered lists, hard breaks.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: NEVER uses dangerouslySetInnerHTML - every piece of
 *          text goes through React's escaping. Link hrefs are scheme-checked
 *          (javascript:/data: dropped) and target="_blank" links always get
 *          rel="noopener noreferrer". Unknown node types render their
 *          children so future editor nodes degrade to their text, not to a
 *          crash. A plain string value renders as one paragraph, escaped.
 */
import type { ReactNode } from 'react'
import { Fragment } from 'react'
import { safeHref } from './util'

type RichMark = { type?: string; attrs?: { href?: unknown; target?: unknown } }
type RichNode = {
  type?: string
  text?: string
  attrs?: { level?: unknown }
  marks?: RichMark[]
  content?: RichNode[]
}

/**
 * Classes to stamp on the elements a document renders, by what they are.
 * kit.richText (WF-T12) is Guided and exposes these four as Style Parts, so
 * it hands the scoped part classes in here; every other caller passes
 * nothing and the markup is byte-identical to before. An empty string is
 * the same as absent.
 */
export interface RichTextPartClasses {
  /** Every h1-h6 the document renders. */
  heading?: string
  /** Every paragraph. */
  paragraph?: string
  /** Every link mark that survived the scheme check. */
  link?: string
  /** Every list item. */
  item?: string
}

const NO_PARTS: RichTextPartClasses = {}

/** `className` for a part, or nothing - so untouched output keeps no empty attribute. */
const cls = (name: string | undefined) => (name ? { className: name } : {})

/** Wraps rendered text in its marks, innermost text outward. */
function withMarks(text: ReactNode, marks: RichMark[] | undefined, key: number, parts: RichTextPartClasses): ReactNode {
  let out = text
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold':
        out = <strong>{out}</strong>
        break
      case 'italic':
        out = <em>{out}</em>
        break
      case 'underline':
        out = <u>{out}</u>
        break
      case 'link': {
        const href = safeHref(mark.attrs?.href)
        // An unsafe href drops the WHOLE link mark: the text stays, the
        // navigation does not.
        if (!href) break
        const blank = mark.attrs?.target === '_blank'
        out = (
          <a {...cls(parts.link)} href={href} target={blank ? '_blank' : undefined} rel={blank ? 'noopener noreferrer' : undefined}>
            {out}
          </a>
        )
        break
      }
      default:
        break
    }
  }
  return <Fragment key={key}>{out}</Fragment>
}

function renderNodes(nodes: RichNode[] | undefined, parts: RichTextPartClasses): ReactNode {
  if (!nodes?.length) return null
  return nodes.map((node, i) => renderNode(node, i, parts))
}

function renderNode(node: RichNode, key: number, parts: RichTextPartClasses): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return <p key={key} {...cls(parts.paragraph)}>{renderNodes(node.content, parts)}</p>
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? Math.min(6, Math.max(1, node.attrs.level)) : 2
      const H = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      return <H key={key} {...cls(parts.heading)}>{renderNodes(node.content, parts)}</H>
    }
    case 'bulletList':
      return <ul key={key}>{renderNodes(node.content, parts)}</ul>
    case 'orderedList':
      return <ol key={key}>{renderNodes(node.content, parts)}</ol>
    case 'listItem':
      return <li key={key} {...cls(parts.item)}>{renderNodes(node.content, parts)}</li>
    case 'hardBreak':
      return <br key={key} />
    case 'text':
      return withMarks(node.text ?? '', node.marks, key, parts)
    default:
      // Unknown node: keep the words, lose the unknown wrapper.
      return <Fragment key={key}>{renderNodes(node.content, parts)}</Fragment>
  }
}

/**
 * Renders a richtext field value. Accepts the TipTap document object, a bare
 * node array, or a plain string (escaped paragraph); anything else renders
 * nothing. `partClasses` stamps a class per element kind (see
 * RichTextPartClasses); absent, the markup carries no class at all.
 */
export function RichText({ value, partClasses }: { value: unknown; partClasses?: RichTextPartClasses }): ReactNode {
  const parts = partClasses ?? NO_PARTS
  if (typeof value === 'string') return value === '' ? null : <p {...cls(parts.paragraph)}>{value}</p>
  if (Array.isArray(value)) return renderNodes(value as RichNode[], parts)
  if (value && typeof value === 'object') {
    const doc = value as RichNode
    if (doc.type === 'doc' || Array.isArray(doc.content)) return renderNodes(doc.content, parts)
  }
  return null
}
