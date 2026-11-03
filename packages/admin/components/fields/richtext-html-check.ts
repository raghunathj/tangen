/**
 * File Name: richtext-html-check.ts
 * Purpose: Say what HTML mode is about to throw away, by name, before it does.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `PMDOMParser.fromSchema(schema).parse(...)` keeps what
 *          the vocabulary can represent and discards the rest with NO message:
 *          ProseMirror descends into an unknown wrapper, keeps the inline text
 *          and drops the element. `<table>`, `<section>`, `<iframe>`,
 *          `<div class>` and `<span style>` all vanish in silence.
 *
 *          That contradicts the standard the rest of the format holds. Slice 4
 *          made a malformed document a 422 that NAMES the offending node; HTML
 *          mode was the one surface where content disappeared without a word.
 *
 *          Pure and DOM-free on purpose, so it is tested under `bun test`
 *          rather than only in the browser lane. The cost of that choice is
 *          stated plainly: this is a lexical scan, not a parse. It reads
 *          element and attribute NAMES out of the source, which is exactly
 *          what the report needs to name, and it never claims to know the
 *          resulting document - the editor is what produces that.
 */
import type { RecognisedHtml } from './richtext-schema'

export interface HtmlDropReport {
  /** Element names the vocabulary cannot represent. Removed; inline text kept. */
  elements: string[]
  /** `tag[attr]` for an attribute on an element that IS kept, but is not stored. */
  attributes: string[]
}

/** `<!-- ... -->` holds no elements, so it must not contribute names. */
const withoutComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')

const OPEN_TAG = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g
/**
 * One attribute at a time, VALUE INCLUDED in the match.
 *
 * Matching only the name would read `https:` out of `href="https://x.test"`,
 * which is what the first draft did and what the first test caught. Consuming
 * the value is what makes a value unable to look like a name.
 */
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]*))?/g

/**
 * What the given HTML carries that the vocabulary cannot keep.
 *
 * An attribute is only reported on an element that SURVIVES: naming
 * `div[class]` beside `div` would be two complaints about one deletion.
 */
export function htmlDropReport(html: string, recognised: RecognisedHtml): HtmlDropReport {
  const elements = new Set<string>()
  const attributes = new Set<string>()

  for (const [, rawTag, rawAttrs] of withoutComments(html).matchAll(OPEN_TAG)) {
    const tag = rawTag!.toLowerCase()
    if (!recognised.tags.has(tag)) {
      elements.add(tag)
      continue
    }
    const allowed = recognised.attrsByTag.get(tag)
    for (const [, rawName] of (rawAttrs ?? '').matchAll(ATTR)) {
      const name = rawName!.toLowerCase()
      if (!allowed?.has(name)) attributes.add(`${tag}[${name}]`)
    }
  }

  return { elements: [...elements].sort(), attributes: [...attributes].sort() }
}

/**
 * What to tell the person, or null when nothing is lost.
 *
 * The list leads. An earlier draft read "will be removed, keeping the text
 * inside: section, table", which parses as keeping the text inside those
 * elements - the opposite of the reassurance it was meant to be.
 */
export function describeHtmlDrop(report: HtmlDropReport): string | null {
  const parts: string[] = []
  if (report.elements.length) {
    const one = report.elements.length === 1
    parts.push(
      `${report.elements.join(', ')} cannot be stored. ${one ? 'It' : 'They'} will be removed and the text inside ${one ? 'it' : 'them'} kept.`,
    )
  }
  if (report.attributes.length) {
    parts.push(
      `${report.attributes.join(', ')} ${report.attributes.length === 1 ? 'is' : 'are'} not stored and will be dropped.`,
    )
  }
  return parts.length ? parts.join(' ') : null
}
