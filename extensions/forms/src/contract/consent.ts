/**
 * File Name: consent.ts
 * Purpose: The `consent` field's two rules, in one pure place: what its copy
 *   may contain, and what counts as consent having been given.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: DOM-free, so the server, the embed runtime and the
 *   builder's preview all answer identically - the operator sees in the
 *   preview exactly the markup a visitor gets.
 *
 *   `consentHtml` REBUILDS the markup from what it recognised rather than
 *   letting the author's string through with the bad parts cut out. A
 *   subtractive sanitizer is a list of the attacks someone thought of; this
 *   one can only ever emit the six tags and three attributes below, so an
 *   `onclick`, a `<script>`, a `<style>`, a `srcdoc` or a mangled `java\tscript:`
 *   is not refused - it never had a path to the output. The same stance the
 *   platform takes in `safeRedirectTarget` (./logic.ts) and in the richtext
 *   renderer's scheme check.
 */

/** Inline formatting consent copy may use. Everything else loses its tag and keeps its text. */
export const CONSENT_TAGS = ['a', 'strong', 'b', 'em', 'i', 'u', 'br'] as const

/** Tags that carry no closing half. */
const VOID_TAGS = new Set(['br'])

/**
 * The schemes a consent link may carry - the richtext vocabulary's set
 * (`CONTENT_DOC_HREF_SCHEMES`), named here because the contract is
 * dependency-free by design and this list is the same answer.
 */
const HREF_SCHEMES = ['http', 'https', 'mailto', 'tel']

/** `&` only when it is not already an entity, so `&amp;` survives one pass and `AT&T` is escaped. */
function escapeText(s: string): string {
  return s
    .replace(/&(?!#\d+;|#x[0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]*;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * A link target that is safe to emit: a relative path, a fragment, or an
 * absolute URL in one of the allowed schemes. Control characters and spaces
 * are removed before the scheme is read, because `java&#9;script:` is one URL to a
 * browser and another string to a naive test.
 */
export function safeConsentHref(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (raw === '') return null
  if (raw.startsWith('#')) return raw
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw
  const stripped = raw.replace(/[\u0000- ]/g, '').toLowerCase()
  const scheme = stripped.match(/^([a-z][a-z0-9+.-]*):/)?.[1]
  // No scheme and no leading slash: a bare relative path like `privacy.html`.
  if (!scheme) return /^[a-z0-9._~%-]/i.test(raw) ? raw : null
  return HREF_SCHEMES.includes(scheme) ? raw : null
}

/** Attribute pairs inside one tag; quoted, apostrophed and bare values alike. */
const ATTR_RE = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>=`]+)))?/g

function attrsOf(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  ATTR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR_RE.exec(body))) {
    out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return out
}

/** The index of the `>` that closes the tag opened at `lt`, respecting quoted values. */
function tagEnd(src: string, lt: number): number {
  let quote: string | null = null
  for (let i = lt + 1; i < src.length; i++) {
    const ch = src[i]!
    if (quote) { if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '>') return i
  }
  return -1
}

/**
 * The consent copy as markup that is safe to put in a label: the recognised
 * inline tags rebuilt, every other tag dropped with its text kept, and links
 * limited to the allowed schemes. A link that opens a new tab always carries
 * `rel="noopener noreferrer"` - the consent text points at a privacy policy,
 * and a page opened from a form must not reach back into it.
 */
export function consentHtml(raw: unknown): string {
  const src = typeof raw === 'string' ? raw : ''
  if (src === '') return ''
  const allowed = new Set<string>(CONSENT_TAGS)
  const open: string[] = []
  let out = ''
  let i = 0

  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt === -1) { out += escapeText(src.slice(i)); break }
    out += escapeText(src.slice(i, lt))

    // A `<` that cannot begin a tag is a less-than sign the author typed, as
    // it is for a browser: `5 < 6 & 7 > 2` is text, not a mangled element.
    if (!/[a-zA-Z/!]/.test(src[lt + 1] ?? '')) { out += '&lt;'; i = lt + 1; continue }

    // A comment can hide a `>`, so it is matched before the tag grammar.
    if (src.startsWith('<!--', lt)) {
      const close = src.indexOf('-->', lt + 4)
      i = close === -1 ? src.length : close + 3
      continue
    }
    const gt = tagEnd(src, lt)
    // An unterminated tag: everything after it is markup we cannot read, so
    // it is dropped rather than guessed at.
    if (gt === -1) break
    const inner = src.slice(lt + 1, gt).trim()
    i = gt + 1

    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim().toLowerCase()
      const at = open.lastIndexOf(name)
      if (at === -1) continue                     // never opened (or was dropped)
      while (open.length > at) out += `</${open.pop()}>`
      continue
    }

    const name = inner.match(/^[a-zA-Z][a-zA-Z0-9]*/)?.[0]?.toLowerCase()
    if (!name || !allowed.has(name)) continue     // the tag goes, its text stays
    const body = inner.slice(name.length).replace(/\/$/, '')

    if (VOID_TAGS.has(name)) { out += `<${name}>`; continue }

    if (name === 'a') {
      const attrs = attrsOf(body)
      const href = safeConsentHref(attrs.href)
      // No usable destination: the text stays, the navigation does not.
      if (!href) continue
      const blank = attrs.target === '_blank'
      const title = attrs.title ? ` title="${escapeAttr(attrs.title)}"` : ''
      out += `<a href="${escapeAttr(href)}"${title}${blank ? ' target="_blank" rel="noopener noreferrer"' : ''}>`
      open.push('a')
      continue
    }

    out += `<${name}>`
    open.push(name)
  }

  while (open.length > 0) out += `</${open.pop()}>`
  return out
}

/** The consent copy as plain text - the submission record and the a11y name. */
export function consentText(raw: unknown): string {
  return consentHtml(raw)
    .replace(/<br>/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Whether a submitted value means "the box was ticked".
 *
 * Strict on purpose. The embed sends `'true'` or `''`, but a form is also
 * submitted straight to the API by a site that renders the fields itself, and
 * there `consent: false`, `'false'` or `'no'` must read as NOT given - a
 * required consent field that accepted any non-empty string would record a
 * refusal as agreement, which is the one thing this field exists to prevent.
 */
export function isConsentGiven(value: unknown): boolean {
  if (value === true) return true
  if (typeof value === 'number') return value === 1
  const s = String(value ?? '').trim().toLowerCase()
  return s === 'true' || s === 'on' || s === '1' || s === 'yes'
}

/**
 * The fields as they may leave the server: a consent field's copy narrowed to
 * what `consentHtml` keeps.
 *
 * The embed runtime sanitizes again before it touches `innerHTML`, so this is
 * not what protects the platform's own renderer. It is what protects the
 * OTHER renderer: a site that reads the schema route and lays the fields out
 * itself (the appless path) receives markup that is already safe, instead of
 * a string whose safety depends on a sanitizer the site author has to know to
 * call. Sanitizing on the way out rather than on the way in also means a form
 * written before this release is served safely without rewriting a stored
 * definition, and the builder still shows the author the text they typed.
 */
export function publicConsentFields<T extends { type: string; content?: string }>(fields: readonly T[]): T[] {
  return fields.map((f) => (f.type === 'consent' && typeof f.content === 'string'
    ? { ...f, content: consentHtml(f.content) }
    : f))
}
