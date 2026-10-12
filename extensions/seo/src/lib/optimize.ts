/**
 * File Name: optimize.ts
 * Purpose: The AI optimisation action's pure half (plan-seo-manager-v2 V6,
 *          user decision 5): the JSON schema a provider is constrained to,
 *          the prompt, and the cleaning of what comes back into values the
 *          codec would accept. One object's worth at a time - a later bulk
 *          run calls the same action per object, so nothing here knows how
 *          many objects there are.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** What the provider must return, and nothing else. */
export const OPTIMIZE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description'],
  properties: {
    title: { type: 'string', description: 'An SEO title of 50 to 60 characters. No quotes, no site name suffix.' },
    description: { type: 'string', description: 'A meta description of 120 to 160 characters, plain text, one or two sentences.' },
    answerSummary: { type: 'string', description: 'Two to four factual sentences an AI answer engine could cite. Optional.' },
  },
}

export const OPTIMIZE_SYSTEM = 'You write search metadata for a real web page. Be specific and factual, never promotional. Use the page\'s own words and facts; invent nothing that is not in the content.'

export interface OptimizeInput {
  title?: string | null
  content?: string | null
  focusKeyword?: string | null
  locale?: string | null
}

/** The prompt for one page. Content is trimmed: a provider does not need the whole body to title it. */
export function optimizePrompt(input: OptimizeInput): string {
  const lines = [`Page title: ${input.title?.trim() || '(untitled)'}`]
  if (input.focusKeyword?.trim()) lines.push(`Focus keyphrase to include naturally: ${input.focusKeyword.trim()}`)
  if (input.locale) lines.push(`Write in the locale: ${input.locale}`)
  const content = (input.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 4000)
  if (content) lines.push(`Page content: ${content}`)
  lines.push('Write the SEO title, the meta description, and an answer summary for this page.')
  return lines.join('\n')
}

export interface SeoProposal {
  title?: string
  description?: string
  answerSummary?: string
}

const TITLE_MAX = 70
const DESCRIPTION_MAX = 180
const ANSWER_MAX = 600

function oneLine(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  let text = value.replace(/\s+/g, ' ').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()
  if (!text) return undefined
  if (text.length > max) {
    const cut = text.slice(0, max)
    const atWord = cut.lastIndexOf(' ')
    text = (atWord > max / 2 ? cut.slice(0, atWord) : cut).replace(/[\s,;:]+$/, '')
  }
  return text || undefined
}

/** What a provider answered, reduced to values the SEO codec would store. */
export function cleanProposal(raw: unknown): SeoProposal {
  if (!raw || typeof raw !== 'object') return {}
  const value = raw as Record<string, unknown>
  const out: SeoProposal = {}
  const title = oneLine(value.title, TITLE_MAX); if (title) out.title = title
  const description = oneLine(value.description, DESCRIPTION_MAX); if (description) out.description = description
  const answer = oneLine(value.answerSummary, ANSWER_MAX); if (answer) out.answerSummary = answer
  return out
}
