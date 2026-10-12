/**
 * File Name: chunker.ts
 * Purpose: Heading-aware text chunking. Markdown splits on headings first
 *          (each chunk keeps its heading trail for context), then long
 *          sections window into ~size-word chunks with overlap. Rich values
 *          (richtext JSON, arrays, objects) flatten to text via valueToText.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Word-based sizing (≈0.75 tokens/word) keeps the
 *          package dependency-free; size/overlap come from
 *          KnowledgeConfig.chunking.
 */

export interface ChunkOptions {
  /** Target chunk size in words (default 400 ≈ 500 tokens). */
  size?: number
  /** Overlap between windows in words (default 60). */
  overlap?: number
}

export interface TextChunk {
  content: string
  index: number
}

/** Flattens any field value to plain text ('' for non-textual values). */
export function valueToText(value: unknown): string {
  if (value == null || typeof value === 'boolean') return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(valueToText).filter(Boolean).join('\n')
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    // Rich text nodes carry their copy in `text`; recurse ONLY into nested
    // structures — scalar props (type, attrs, ids) are markup, not content
    const parts: string[] = []
    if (typeof obj.text === 'string') parts.push(obj.text)
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'text' || v === null || typeof v !== 'object') continue
      const t = valueToText(v)
      if (t) parts.push(t)
    }
    return parts.join('\n')
  }
  return ''
}

function windows(words: string[], size: number, overlap: number): string[] {
  if (words.length <= size) return [words.join(' ')]
  const out: string[] = []
  const step = Math.max(size - overlap, 1)
  for (let start = 0; start < words.length; start += step) {
    out.push(words.slice(start, start + size).join(' '))
    if (start + size >= words.length) break
  }
  return out
}

/**
 * Chunks text. Markdown headings partition the document; each section chunk
 * is prefixed with its heading trail (h1 › h2 › …) so retrieval keeps
 * context; long sections window with overlap.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): TextChunk[] {
  const size = opts.size ?? 400
  const overlap = opts.overlap ?? 60
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []

  interface Section { trail: string[]; body: string[] }
  const sections: Section[] = [{ trail: [], body: [] }]
  const headingStack: Array<{ level: number; title: string }> = []

  for (const line of clean.split('\n')) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line)
    if (m) {
      const level = m[1].length
      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) headingStack.pop()
      headingStack.push({ level, title: m[2].trim() })
      sections.push({ trail: headingStack.map((h) => h.title), body: [] })
    } else {
      sections[sections.length - 1].body.push(line)
    }
  }

  const chunks: TextChunk[] = []
  for (const section of sections) {
    const body = section.body.join('\n').trim()
    if (!body) continue
    const prefix = section.trail.length ? `${section.trail.join(' › ')}\n\n` : ''
    for (const w of windows(body.split(/\s+/), size, overlap)) {
      chunks.push({ content: `${prefix}${w}`, index: chunks.length })
    }
  }
  return chunks
}

/** Stable content hash for skip-unchanged checks (FNV-1a, hex). */
export function contentHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
