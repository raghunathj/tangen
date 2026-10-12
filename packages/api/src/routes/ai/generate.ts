/**
 * File Name: generate.ts
 * Purpose: POST /api/v1/admin/ai/generate — whole-object AI generation. Returns
 *          a preview payload (title, per-field suggestions with relation ids
 *          mapped to real objects, unresolved warnings, and proposed new
 *          related objects). NEVER writes — the admin reviews and applies.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Member JWT required; Redis rate-limited tighter than
 *          fill. Relation candidates load via the local client (limit 200).
 */
import { deploymentFor } from '../../config/service-settings'
import { Elysia, t } from 'elysia'
import { flattenFields } from '@tangen/types'
import { requireCapability } from '../../lib/member-access'
import { RequestError } from '../../lib/errors'
import { assertObjectPermission } from '../../lib/permissions'
import { enforceRateLimit } from '../../services/rate-limiter'
import { resolveProviderKey } from '../../lib/ai-keys'
import { sseResponse, type SSEStreamEvent } from '../../lib/sse'
import { createPreviewScanner } from '../../lib/json-stream-scan'
import { getProvider, availableProviders, streamJSONOrBuffer, AIProviderError, upstreamRequestError } from '../../services/ai'
import { renderGuidelines, renderValuesContext } from '../../services/ai/prompt'
import { buildObjectSchema, mapGenerateResponse, imageOfferFields, type RelationCandidates } from '../../services/ai/object-schema'
import { createLocalClient } from '../../services/local-client'
import { readSettings } from './settings'
import { resolveProviderChoice, resolveGuidelines } from './fill'

const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_SEC = 60
// Only ~60 candidates ever reach the prompt legend, so a smaller pull is both faster
// (less DB + a smaller schema enum → fewer input tokens) and no worse for the model.
const CANDIDATE_LIMIT = 50
const CANDIDATE_CACHE_TTL_SEC = 30

/**
 * Relation candidates, cached briefly in Redis (per workspace+env+type). They change
 * only when related content is created/removed; a 30s TTL trades minor staleness for
 * skipping N DB queries on every generate call. The AI output is human-reviewed before
 * apply, so a just-created/deleted id surfacing late is low-risk. No-ops without Redis.
 */
export async function loadRelationCandidatesCached(
  redis: any,
  workspaceId: string,
  typeDef: { name?: string; fields: any[] },
  tangen: { objects(type: string): any },
): Promise<RelationCandidates> {
  const key = `ai-cands:${workspaceId}:${typeDef.name}`
  if (redis) {
    try {
      const hit = await redis.get(key)
      if (hit) return new Map(JSON.parse(hit)) as RelationCandidates
    } catch { /* cache miss/parse error - fall through to a live load */ }
  }
  const candidates = await loadRelationCandidates(typeDef, tangen)
  if (redis) {
    try { await redis.set(key, JSON.stringify([...candidates]), 'EX', CANDIDATE_CACHE_TTL_SEC) } catch { /* best-effort */ }
  }
  return candidates
}

/** Loads up to CANDIDATE_LIMIT {id,title} candidates for every AI-enabled relation field. */
export async function loadRelationCandidates(
  typeDef: { fields: any[] },
  tangen: { objects(type: string): any },
): Promise<RelationCandidates> {
  const candidates: RelationCandidates = new Map()
  const rels = flattenFields(typeDef.fields as any).filter(
    (fd: any) => fd.fieldType === 'relation' && fd.config?.targetType && fd.config?.ai?.enabled !== false,
  )
  await Promise.all(
    rels.map(async (fd: any) => {
      try {
        const result = await tangen
          .objects(fd.config.targetType)
          .status('any')
          .props(['id', 'title'])
          .limit(CANDIDATE_LIMIT)
          .get()
        candidates.set(
          fd.name,
          (result.data as any[]).map(r => ({ id: String(r.id), title: String(r.title ?? r.id) })),
        )
      } catch {
        // target table missing etc. — field simply won't be generatable
      }
    }),
  )
  return candidates
}

/**
 * Whole-object generation offers a title whenever the object is still
 * untitled — a new draft cannot exist without one. For already-titled
 * objects the Settings > AI title toggle decides (it also governs the
 * per-field title ✨).
 */
export function shouldIncludeTitle(titleGeneration: boolean, values: Record<string, unknown> | undefined): boolean {
  const title = String((values as any)?.title ?? '').trim()
  return titleGeneration || title.length === 0
}

/**
 * Parses the full streamed model output into the raw object the JSON mode
 * would have received from generateJSON. Tolerates markdown fences and
 * pre/post prose by falling back to the outermost brace slice.
 * @throws when no JSON object can be extracted - the caller surfaces it as a
 *         terminal error event (never a half preview).
 */
export function parseStreamedObjectText(text: string): Record<string, unknown> {
  const candidates = [text.trim()]
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate)
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    } catch { /* try the next candidate */ }
  }
  throw new Error('The model did not return valid JSON - nothing was applied')
}

const generateBodySchema = t.Object({
  type: t.String(),
  id: t.Optional(t.String()),
  prompt: t.String(),
  values: t.Optional(t.Record(t.String(), t.Any())),
  guidelinesId: t.Optional(t.String()),
  provider: t.Optional(t.String()),
  model: t.Optional(t.String()),
})

/**
 * Registers the whole-object generation endpoint. Mounted after authMiddleware.
 */
export const aiGenerateRoute = (app: Elysia) =>
  app.post('/api/v1/admin/ai/generate', async (ctx: any) => {
    const { db, redis, schema, workspaceId, memberId, workspaceProjects, body } = ctx

    if (!memberId) {
      throw new RequestError('FORBIDDEN', 'AI generation is admin-panel only', 403)
    }
    assertObjectPermission(ctx.permissions, 'write')
    requireCapability(ctx, 'use:ai')   // K0: through the one guard, so an implying extension capability counts
    await enforceRateLimit(redis, workspaceId, `ai-generate:${memberId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC)

    const typeDef = schema?.types?.find((td: any) => td.name === body.type)
    if (!typeDef || typeDef.disabled) {
      throw new RequestError('TYPE_NOT_FOUND', `Type "${body.type}" not found in schema`, 404)
    }

    const tangen = createLocalClient({ db, redis, schema, workspaceId })
    // Settings read and relation-candidate load are independent — overlap them so the
    // LLM call starts sooner instead of after two serial awaits.
    const [settings, candidates] = await Promise.all([
      readSettings(db, workspaceId),
      loadRelationCandidatesCached(redis, workspaceId, typeDef, tangen),
    ])
    const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
    const envVars = deploymentFor(project)?.secrets
    const providers = availableProviders(project?.ai ?? project?.config?.ai, envVars)
    // Interactive fill favours speed: default to a fast model when the workspace hasn't
    // configured one (a configured model / explicit override still wins).
    const choice = resolveProviderChoice(settings, providers, { provider: body.provider, model: body.model }, { preferFast: true })

    const objectSchema = buildObjectSchema(typeDef, { candidates, includeTitle: shouldIncludeTitle(settings.titleGeneration, body.values) })

    const guidelines = renderGuidelines(resolveGuidelines(settings, body.guidelinesId))
    // Only mentioned when the type actually has offerable image fields — types
    // without them keep a byte-identical prompt and response.
    const imageFieldLabels = imageOfferFields(typeDef).map((fd: any) => String(fd.label ?? fd.name))
    const system = [
      `You are a content assistant for a CMS. You fill in the fields of a "${typeDef.label ?? typeDef.name}" content object.`,
      'Scope: if the brief targets specific fields ("add a title", "rewrite the excerpt"), output ONLY those fields and omit every other property. Otherwise fill every field you can do well and omit the rest. Follow the workspace guidelines below.',
      'Length: keep every value proportionate to the brief - concise by default. A body/richtext field gets a few tight paragraphs unless the brief explicitly asks for long-form.',
      'For relation fields choose ONLY from the listed candidate ids. Propose _create entries only when no candidate fits.',
      'Fields must not duplicate each other: when a dedicated field exists for something (e.g. an FAQ list field), put that content ONLY there - never repeat it inside the body.',
      imageFieldLabels.length > 0
        ? `Image fields (${imageFieldLabels.join(', ')}) take {"imagePrompt": "..."}: when the brief warrants artwork for one, write ONE vivid, self-contained image-generation prompt matching the brief and that field's label - subject, composition, style, mood. Never name trademarked characters, brands, logos, or real people (image providers reject them) - describe an ORIGINAL scene evocative of the brief instead. Omit the property when no image fits.`
        : '',
      guidelines,
    ].filter(Boolean).join('\n\n')

    const context = renderValuesContext((body.values ?? {}) as Record<string, unknown>)
    const user = [
      context ? `Existing content (keep what fits, improve what doesn't):\n${context}` : '',
      `Editor's brief: ${body.prompt}`,
    ].filter(Boolean).join('\n\n')

    // ── Streaming path (opt-in via ?stream=1 / Accept) ───────────────────────
    // Progressive REVEAL, not partial apply: settled entries stream out as the
    // model writes, but the terminal done event carries the authoritative
    // preview from the exact same parse/coerce path as the JSON mode below.
    const wantsStream = String(ctx.query?.stream ?? '') === '1'
      || String(ctx.request?.headers?.get?.('accept') ?? '').includes('text/event-stream')
    if (wantsStream) {
      const signal = ctx.request?.signal as AbortSignal | undefined
      const provider = getProvider(choice.name as any, resolveProviderKey(choice.name as any, envVars)!)
      // forField → target type, mirroring mapGenerateResponse's _create rules
      const relTargets = new Map<string, string>(
        flattenFields(typeDef.fields as any)
          .filter((fd: any) => fd.fieldType === 'relation' && fd.config?.targetType && fd.config?.ai?.enabled !== false)
          .map((fd: any) => [String(fd.name), String(fd.config.targetType)]),
      )
      return sseResponse((async function* (): AsyncGenerator<SSEStreamEvent> {
        yield { event: 'meta', data: { provider: choice.name, model: choice.model } }
        const scanner = createPreviewScanner()
        let full = ''
        for await (const ev of streamJSONOrBuffer(provider, { system, prompt: user, model: choice.model, maxTokens: 16000, effort: 'low' }, objectSchema, { signal })) {
          if (ev.type === 'delta') {
            full += ev.text
            yield { event: 'delta', data: { text: ev.text } }
            for (const entry of scanner.push(ev.text)) {
              if (entry.kind === 'title') {
                yield { event: 'title', data: { value: entry.value } }
              } else if (entry.kind === 'field') {
                yield { event: 'field', data: { name: entry.name, value: entry.value } }
              } else {
                const v = entry.value as { forField?: unknown; title?: unknown } | null
                const forField = String(v?.forField ?? '')
                const createTitle = String(v?.title ?? '').trim()
                const targetType = relTargets.get(forField)
                if (targetType && createTitle) {
                  yield { event: 'create', data: { index: entry.index, type: targetType, title: createTitle, forField } }
                }
              }
            }
          } else {
            yield { event: 'status', data: { phase: 'parsing' } }
            // Parse/map failure throws → sseResponse emits a terminal error event
            const preview = mapGenerateResponse(typeDef, candidates, parseStreamedObjectText(full))
            yield { event: 'done', data: { usage: ev.usage, preview } }
          }
        }
      })())
    }

    let result: { value: unknown; usage: { inputTokens: number; outputTokens: number } }
    try {
      result = await getProvider(choice.name as any, resolveProviderKey(choice.name as any, envVars)!)
        .generateJSON({ system, prompt: user, model: choice.model, maxTokens: 16000, effort: 'low' }, objectSchema)
    } catch (e) {
      if (e instanceof AIProviderError) {
        throw upstreamRequestError(e)
      }
      throw e
    }

    const preview = mapGenerateResponse(typeDef, candidates, (result.value ?? {}) as Record<string, unknown>)

    return { data: { ...preview, provider: choice.name, model: choice.model, usage: result.usage } }
  }, { body: generateBodySchema })
