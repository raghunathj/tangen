/**
 * File Name: ask.ts
 * Purpose: RAG prompt assembly — turns retrieval hits into a grounded,
 *          citation-forcing prompt. Generation itself is injected by the
 *          host (Tangen's existing AI provider adapters), keeping this
 *          package dependency-free.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Citations are numbered [1]..[n] in source order; the
 *          model is instructed to answer ONLY from the context and admit
 *          when the context doesn't cover the question.
 */
import type { KnowledgeHit } from './store'

export interface AskCitation {
  ref: number
  sourceKind: string
  sourceId: string
  sourceGroup: string
  title: string | null
  snippet: string
  score: number
}

export function buildCitations(hits: KnowledgeHit[]): AskCitation[] {
  return hits.map((h, i) => ({
    ref: i + 1,
    sourceKind: h.sourceKind,
    sourceId: h.sourceId,
    sourceGroup: h.sourceGroup,
    title: (h.metadata?.title as string | undefined) ?? (h.metadata?.path as string | undefined) ?? null,
    snippet: h.content.length > 240 ? `${h.content.slice(0, 240)}…` : h.content,
    score: h.score,
  }))
}

export function buildAskPrompt(
  question: string,
  hits: KnowledgeHit[],
  instructions?: string,
): { system: string; prompt: string } {
  const context = hits
    .map((h, i) => {
      const title = (h.metadata?.title as string | undefined) ?? (h.metadata?.path as string | undefined) ?? `${h.sourceGroup}/${h.sourceId}`
      // Curated pairs are the workspace's vetted answers — tell the model so
      const label = h.sourceKind === 'qa' ? `Curated answer - ${title}` : title
      return `[${i + 1}] (${label})\n${h.content}`
    })
    .join('\n\n---\n\n')

  const system = [
    'You answer questions using ONLY the provided context passages.',
    'Cite passages inline as [n] using the bracketed numbers.',
    "If the context does not contain the answer, say so plainly - never invent facts.",
    instructions?.trim(),
  ].filter(Boolean).join('\n')

  const prompt = `Context passages:\n\n${context}\n\nQuestion: ${question}`
  return { system, prompt }
}
