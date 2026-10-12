/**
 * File Name: optimize.ts
 * Purpose: The AI optimisation ACTION (plan-seo-manager-v2 V6, user decision
 *          5): one object in, a PROPOSAL out. It never touches the published
 *          snapshot; `apply` writes the draft, which is what Tangen publishes
 *          next, so a human still sees it before a visitor does. One object
 *          per call by design - a later bulk run walks selected objects
 *          through this same function rather than growing a second path.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionServerCtx } from '@tangen/cms'
import { cleanProposal, optimizePrompt, OPTIMIZE_SCHEMA, OPTIMIZE_SYSTEM, type SeoProposal } from '../lib/optimize'
import { pickMetadata, readStored, writeDraft } from '../lib/metadata'

export type OptimizeResult =
  | { ok: true; proposal: SeoProposal; applied: boolean; provider: string; model: string }
  | { ok: false; reason: string }

/** The text a provider is given: the object's own string fields, nothing fetched. */
function contentOf(object: Record<string, unknown>): string {
  return Object.entries(object)
    .filter(([key, value]) => typeof value === 'string' && !['id', 'slug', 'status', 'title'].includes(key))
    .map(([, value]) => value as string)
    .join(' ')
}

/**
 * Proposes SEO values for one object. With `apply` the proposal is written to
 * the object's DRAFT (never its published snapshot); without it nothing is
 * stored and the caller shows the proposal for review.
 */
export async function optimizeObject(ctx: ExtensionServerCtx, input: { type: string; id: string; apply?: boolean; locale?: string | null }): Promise<OptimizeResult> {
  const type = String(input.type ?? '').trim()
  const id = String(input.id ?? '').trim()
  if (!type || !id) return { ok: false, reason: 'type and id are required' }
  if (!ctx.ai?.generateJSON) return { ok: false, reason: 'Writing metadata with AI needs the ai:generate grant and an AI provider: approve the grant with `tangen extension upgrade seo --approve-optional ai:generate`, then choose a provider under Settings > AI.' }
  if (!ctx.tangen) return { ok: false, reason: 'The content client is not available to this extension.' }

  let object: Record<string, unknown>
  try {
    const res = await ctx.tangen.objects(type as never).status('any').find(id)
    object = (res.data ?? {}) as Record<string, unknown>
  } catch { return { ok: false, reason: `No ${type} with id ${id}.` } }

  const stored = readStored(await ctx.store.get(id))
  const current = pickMetadata(stored.draft, input.locale ?? null)
  let generated: { value: unknown; provider: string; model: string }
  try {
    generated = await ctx.ai.generateJSON({
      system: OPTIMIZE_SYSTEM,
      prompt: optimizePrompt({
        title: (object.title as string | null) ?? null,
        content: contentOf(object),
        focusKeyword: current.focusKeyword ?? null,
        locale: input.locale ?? null,
      }),
      jsonSchema: OPTIMIZE_SCHEMA,
    })
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
  const proposal = cleanProposal(generated.value)
  if (!proposal.title && !proposal.description) return { ok: false, reason: 'The provider returned nothing usable for this page.' }

  if (input.apply) {
    const base: Record<string, unknown> = { ...stored.draft.base }
    if (proposal.title) base.title = proposal.title
    if (proposal.description) base.description = proposal.description
    if (proposal.answerSummary) base.answerSummary = proposal.answerSummary
    await ctx.store.put(id, writeDraft(stored, { ...stored.draft, base }) as unknown as Record<string, unknown>)
  }
  return { ok: true, proposal, applied: Boolean(input.apply), provider: generated.provider, model: generated.model }
}
