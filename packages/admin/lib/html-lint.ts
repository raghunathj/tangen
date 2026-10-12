/**
 * File Name: html-lint.ts
 * Purpose: A lightweight, dependency-free soundness check for author HTML (the
 *          form "HTML" field) — flags unclosed, mismatched, or stray closing
 *          tags. Not a full validator: void elements and self-closed tags are
 *          allowed, and it ignores comments/doctype. Enough to catch the common
 *          "forgot a </div>" mistakes with a friendly warning.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** HTML void elements — never need a closing tag. */
const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

const TAG_RE = /<(\/)?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/)?>/g

/** Returns a list of human-readable issues; empty ⇒ looks well-formed. */
export function htmlIssues(html: string): string[] {
  if (!html || !html.trim()) return []
  const issues: string[] = []
  const stack: string[] = []
  // Strip comments so `<!-- <div> -->` doesn't confuse the tag scan.
  const src = html.replace(/<!--[\s\S]*?-->/g, '')

  let m: RegExpExecArray | null
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(src))) {
    const closing = !!m[1]
    const tag = m[2].toLowerCase()
    const selfClosed = !!m[3]
    if (VOID.has(tag) || selfClosed) continue
    if (!closing) {
      stack.push(tag)
    } else {
      if (stack.length === 0) {
        issues.push(`Stray closing tag </${tag}>`)
      } else if (stack[stack.length - 1] !== tag) {
        issues.push(`Mismatched tag: expected </${stack[stack.length - 1]}> but found </${tag}>`)
        // pop to best-effort recover
        const idx = stack.lastIndexOf(tag)
        if (idx !== -1) stack.length = idx
      } else {
        stack.pop()
      }
    }
  }
  for (const tag of stack) issues.push(`Unclosed tag <${tag}>`)
  return issues
}
