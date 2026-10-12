/**
 * File Name: schema-ai.ts
 * Purpose: SI-2 — the inline "Build with AI" flow for the schema builder. Calls the
 *   direct POST /admin/schema/generate (single draft, a related set, or clarifying
 *   questions), and interprets the response so the modal can route: draft → load into the
 *   builder; drafts → the review page; clarify → ask, then re-send with the answer folded in.
 *   No universal router — schema AI is self-contained here.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { adminFetch } from '@/lib/api'

export type SchemaAiKind = 'type' | 'component' | 'global'

/** The shape the generate endpoint returns (one of: clarify | draft | drafts). */
export interface SchemaAiResponse {
  clarify?: { questions: string[]; brief: string }
  draft?: any
  drafts?: any[]
}

/** Fold a clarify answer back into the original brief (so references like "all 3" resolve). */
export function combineClarify(brief: string, questions: string[], answer: string): string {
  const qs = questions.length ? `\n\nYou asked:\n${questions.map((q) => `- ${q}`).join('\n')}` : ''
  return `${brief}${qs}\n\nMy answer: ${answer}`
}

/**
 * Ask the schema AI to build. `mode` is 'single' (one kind) or 'set' (whole model).
 * `skipClarify` proceeds straight to a draft.
 */
export async function generateSchema(
  opts: { prompt: string; mode: 'single' | 'set'; kind?: SchemaAiKind; skipClarify?: boolean },
): Promise<SchemaAiResponse> {
  const res = await adminFetch<{ data: SchemaAiResponse }>('/admin/schema/generate', {
    method: 'POST',
    body: JSON.stringify({
      prompt: opts.prompt,
      ...(opts.mode === 'set' ? { set: true } : { kind: opts.kind ?? 'type' }),
      ...(opts.skipClarify ? { skipClarify: true } : {}),
    }),
  })
  return res.data
}
