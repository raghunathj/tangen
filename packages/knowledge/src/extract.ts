/**
 * File Name: extract.ts
 * Purpose: Document text extraction for the knowledge base. Core handles
 *          TEXT-NATIVE formats only (markdown, txt, html, csv, json);
 *          binary formats (PDF, DOCX) come from extractor packages
 *          (e.g. @tangen/knowledge-pdf) declared in
 *          KnowledgeConfig.extractors — per the zero-dep-core philosophy.
 *          Unextractable documents are skipped with a reason, never an
 *          error: a scanned PDF must not break an index run.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** Contract for extractor packages (PDF/DOCX/…). */
export interface DocumentExtractor {
  name: string
  /** Exact MIME types this extractor handles. */
  mimeTypes: string[]
  extract: (bytes: Uint8Array, filename: string) => Promise<string>
}

export interface ExtractResult {
  ok: boolean
  text?: string
  /** Why the document was skipped (missing extractor, empty, …). */
  skipped?: string
}

const TEXT_NATIVE: Record<string, (raw: string) => string> = {
  'text/markdown': (raw) => raw,
  'text/plain': (raw) => raw,
  'text/csv': (raw) => raw,
  'application/json': (raw) => {
    try { return JSON.stringify(JSON.parse(raw), null, 1) } catch { return raw }
  },
  'text/html': (raw) => raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim(),
}

/** Extensions that imply a text-native MIME when servers report octet-stream. */
const EXT_MIME: Record<string, string> = {
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain',
  csv: 'text/csv', json: 'application/json', html: 'text/html', htm: 'text/html',
}

export async function extractText(
  filename: string,
  mimeType: string,
  bytes: Uint8Array,
  extractors: DocumentExtractor[] = [],
): Promise<ExtractResult> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const mime = TEXT_NATIVE[mimeType] ? mimeType : (EXT_MIME[ext] ?? mimeType)

  const native = TEXT_NATIVE[mime]
  if (native) {
    const text = native(new TextDecoder().decode(bytes)).trim()
    return text ? { ok: true, text } : { ok: false, skipped: 'document is empty after extraction' }
  }

  const extractor = extractors.find((e) => e.mimeTypes.includes(mimeType))
  if (extractor) {
    try {
      const text = (await extractor.extract(bytes, filename)).trim()
      return text ? { ok: true, text } : { ok: false, skipped: `no text found by ${extractor.name}` }
    } catch (e) {
      return { ok: false, skipped: `${extractor.name} failed: ${(e as Error).message}` }
    }
  }

  return {
    ok: false,
    skipped: `no extractor for ${mimeType} - text-native formats work out of the box; add an extractor package (e.g. @tangen/knowledge-pdf) for binary documents`,
  }
}
