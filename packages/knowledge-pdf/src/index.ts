/**
 * File Name: index.ts
 * Purpose: @tangen/knowledge-pdf — PDF text extraction for the knowledge
 *          base. Satisfies the DocumentExtractor contract; wire it in the
 *          knowledge config:
 *
 *            import { pdfExtractor } from '@tangen/knowledge-pdf'
 *            defineKnowledgeConfig({ …, extractors: [pdfExtractor()] })
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: unpdf (serverless-friendly pdf.js build) — exactly
 *          the kind of dependency the zero-dep core externalizes into an
 *          optional package. Scanned/image-only PDFs yield no text and are
 *          skipped upstream with a reason (never an error).
 */
import type { DocumentExtractor } from '@tangen/knowledge'

export function pdfExtractor(): DocumentExtractor {
  return {
    name: 'pdf',
    mimeTypes: ['application/pdf'],
    extract: async (bytes: Uint8Array) => {
      const { extractText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(bytes))
      const { text } = await extractText(pdf, { mergePages: true })
      return typeof text === 'string' ? text : (text as string[]).join('\n')
    },
  }
}
