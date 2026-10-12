/**
 * File Name: fill.ts
 * Purpose: POST /api/v1/admin/ai/fill — generates a value for a single field of
 *          a content object. Suggestion-only: nothing is written; the admin
 *          applies the value in the editor. Steered by workspace guidelines,
 *          the field's ai.hint, and an optional per-request instruction.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Member JWT required; Redis rate-limited. '__title' is a
 *          pseudo-field gated by settings.titleGeneration.
 */
import { deploymentFor } from '../../config/service-settings'
import { Elysia, t } from 'elysia'
import { flattenFields } from '@tangen/types'
import type { AISettingsData, AIGuidelines, FieldDefinition } from '@tangen/types'
import { requireCapability } from '../../lib/member-access'
import { RequestError } from '../../lib/errors'
import { assertObjectPermission } from '../../lib/permissions'
import { enforceRateLimit } from '../../services/rate-limiter'
import { resolveProviderKey } from '../../lib/ai-keys'
import { sseResponse, type SSEStreamEvent } from '../../lib/sse'
import { getProvider, availableProviders, streamOrBuffer, AIProviderError, upstreamRequestError } from '../../services/ai'
import { buildFieldPrompt } from '../../services/ai/prompt'
import { jsonSchemaForField, coerceFieldValue } from '../../services/ai/coerce'
import { buildPanelPrompt } from '../../services/ai/prompt'
import { readSettings } from './settings'
import { isSafeIdent } from '@tangen/types'

const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_SEC = 60

/**
 * Field types whose fill value is PROSE (a single string the model writes
 * top-to-bottom) and can therefore token-stream. Structured field types
 * (repeater/component/select/...) stay on atomic generateJSON - partial JSON
 * streaming is explicitly out of scope. The '__title' / '__text'
 * pseudo-fields are plain text, so they stream too.
 */
export const STREAMABLE_FILL_TYPES: ReadonlySet<string> = new Set(['text', 'textarea', 'richtext'])

/** Pseudo-field descriptor used when generating the object title. */
const TITLE_FIELD: FieldDefinition = {
  name: '__title',
  label: 'Title',
  fieldType: 'text',
  config: { ai: { hint: 'A concise, specific title for this content object. No quotes, no trailing punctuation.' } } as any,
  required: false,
  previousName: [],
} as FieldDefinition

/**
 * Resolves the target field for a fill request and enforces the eligibility
 * gates: unknown fields 404, ai.enabled=false 422, and '__title' only when
 * title generation is switched on in Settings > AI.
 */
/** Generic pseudo-field for extension panels — plain text with the request's instruction as its brief. */
const TEXT_FIELD: FieldDefinition = {
  name: '__text',
  label: 'Text',
  fieldType: 'text',
  config: {} as any,
  required: false,
  previousName: [],
} as FieldDefinition

export function resolveFillField(
  typeDef: { name: string; fields: FieldDefinition[] },
  fieldName: string,
  settings: AISettingsData,
): FieldDefinition {
  if (fieldName === '__text') return TEXT_FIELD
  if (fieldName === '__title') {
    if (!settings.titleGeneration) {
      throw new RequestError('FORBIDDEN', 'AI title suggestions are disabled - enable them in Settings > AI', 403)
    }
    return TITLE_FIELD
  }

  const field = flattenFields(typeDef.fields).find(f => f.name === fieldName)
  if (!field) {
    throw new RequestError('FIELD_NOT_FOUND', `Field "${fieldName}" not found on type "${typeDef.name}"`, 404)
  }
  if ((field.config as any)?.ai?.enabled === false) {
    throw new RequestError('VALIDATION_ERROR', `AI is disabled for field "${fieldName}"`)
  }
  return field
}

/**
 * Picks the provider + model for a request. Per-request overrides (the panel's
 * picker) win when that provider is available; then the admin's Settings > AI
 * choice; then the first available provider. Model falls back per provider.
 */
/**
 * The fastest capable text model per provider — used as the default ONLY when the
 * workspace hasn't configured a model and the caller opts into speed (interactive
 * fill/generate). Anyone who sets a model in AI settings keeps it.
 */
export const FAST_MODELS: Record<string, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-5-mini',
  gemini: 'gemini-2.5-flash',
}

export function resolveProviderChoice(
  settings: AISettingsData,
  providers: { name: string; available: boolean; models: string[] }[],
  override?: { provider?: string; model?: string },
  opts?: { preferFast?: boolean },
): { name: string; model: string } {
  const overridden = override?.provider
    ? providers.find(p => p.name === override.provider && p.available)
    : undefined
  if (override?.provider && !overridden) {
    throw new RequestError('VALIDATION_ERROR', `Provider "${override.provider}" is not available`, 400)
  }
  const chosen = overridden
    ?? (settings.provider ? providers.find(p => p.name === settings.provider && p.available) : undefined)
  const provider = chosen ?? providers.find(p => p.available)
  if (!provider) {
    throw new RequestError('VALIDATION_ERROR', 'No AI provider is available - configure an API key', 400)
  }
  let model: string | null = null
  if (overridden && override?.model && provider.models.includes(override.model)) model = override.model
  if (!model) {
    const configured = settings.provider === provider.name ? settings.model : null
    const fast = opts?.preferFast ? FAST_MODELS[provider.name] : undefined
    // User's configured model wins; otherwise a fast default (if opted-in + available), else the provider's first.
    model = configured ?? (fast && provider.models.includes(fast) ? fast : provider.models[0])
  }
  if (!model) {
    throw new RequestError('VALIDATION_ERROR', `No model available for provider "${provider.name}"`, 400)
  }
  return { name: provider.name, model }
}

/** Resolves the guideline profile for a request (unknown id → first profile). */
export function resolveGuidelines(settings: AISettingsData, guidelinesId?: string): AIGuidelines {
  const profile = (guidelinesId ? settings.profiles.find(p => p.id === guidelinesId) : undefined)
    ?? settings.profiles[0]
  return profile?.guidelines ?? { audience: '', voiceTone: '', glossary: '', legal: '', general: '' }
}

export interface PanelField { name: string; label: string; fieldType: string; config?: Record<string, unknown> }

const MAX_PANEL_FIELDS = 20

/** Validates panel fields and builds one JSON schema over all of them. */
export function buildPanelFieldsSchema(fields: PanelField[]): Record<string, unknown> {
  if (!Array.isArray(fields) || fields.length === 0 || fields.length > MAX_PANEL_FIELDS) {
    throw new RequestError('VALIDATION_ERROR', `panelFields must contain 1–${MAX_PANEL_FIELDS} fields`)
  }
  const properties: Record<string, unknown> = {}
  for (const f of fields) {
    if (!isSafeIdent(String(f.name))) {
      throw new RequestError('VALIDATION_ERROR', `Invalid panel field name: "${String(f.name)}"`)
    }
    const single = jsonSchemaForField(f as any) as any // throws for unsupported types
    properties[f.name] = single.properties.value
  }
  return { type: 'object', properties }
}

/** Coerces a provider's panel output per field; missing/invalid values are dropped. */
export function coercePanelValues(fields: PanelField[], raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const f of fields) {
    const v = (raw as Record<string, unknown>)[f.name]
    if (v === null || v === undefined) continue
    try {
      out[f.name] = coerceFieldValue(f as any, v)
    } catch { /* bad value - skip the field, keep the rest */ }
  }
  return out
}

const fillBodySchema = t.Object({
  type: t.String(),
  id: t.Optional(t.String()),
  field: t.String(),
  instruction: t.Optional(t.String()),
  values: t.Optional(t.Record(t.String(), t.Any())),
  guidelinesId: t.Optional(t.String()),
  provider: t.Optional(t.String()),
  model: t.Optional(t.String()),
  panelFields: t.Optional(t.Array(t.Object({
    name: t.String(),
    label: t.String(),
    fieldType: t.String(),
    config: t.Optional(t.Record(t.String(), t.Any())),
  }))),
  panelLabel: t.Optional(t.String()),
  panelInstructions: t.Optional(t.String()),
})

/**
 * Registers the per-field AI fill endpoint. Mounted after authMiddleware.
 */
export const aiFillRoute = (app: Elysia) =>
  app.post('/api/v1/admin/ai/fill', async (ctx: any) => {
    const { db, redis, schema, workspaceId, memberId, workspaceProjects, body } = ctx

    if (!memberId) {
      throw new RequestError('FORBIDDEN', 'AI fill is admin-panel only', 403)
    }
    assertObjectPermission(ctx.permissions, 'write')
    requireCapability(ctx, 'use:ai')   // K0: through the one guard, so an implying extension capability counts
    await enforceRateLimit(redis, workspaceId, `ai-fill:${memberId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC)

    const typeDef = schema?.types?.find((td: any) => td.name === body.type)
    if (!typeDef || typeDef.disabled) {
      throw new RequestError('TYPE_NOT_FOUND', `Type "${body.type}" not found in schema`, 404)
    }

    const settings = await readSettings(db, workspaceId)

    // Extension-panel mode: generate all of a panel's declared fields at once
    if (Array.isArray(body.panelFields) && body.panelFields.length > 0) {
      const panelFields = body.panelFields as PanelField[]
      const schema_ = buildPanelFieldsSchema(panelFields)
      const project_ = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
      const envVars_ = deploymentFor(project_)?.secrets
      const providers_ = availableProviders(project_?.ai ?? project_?.config?.ai, envVars_)
      const choice_ = resolveProviderChoice(settings, providers_, { provider: body.provider, model: body.model })
      const { system, user } = buildPanelPrompt({
        guidelines: resolveGuidelines(settings, body.guidelinesId),
        panelLabel: body.panelLabel ?? 'panel',
        fields: panelFields,
        values: (body.values ?? {}) as Record<string, unknown>,
        instruction: body.instruction,
        panelInstructions: body.panelInstructions,
      })
      let panelResult: { value: unknown; usage: { inputTokens: number; outputTokens: number } }
      try {
        panelResult = await getProvider(choice_.name as any, resolveProviderKey(choice_.name as any, envVars_)!)
          .generateJSON({ system, prompt: user, model: choice_.model, maxTokens: 4096, effort: 'low' }, schema_)
      } catch (e) {
        if (e instanceof AIProviderError) throw upstreamRequestError(e)
        throw e
      }
      const values = coercePanelValues(panelFields, panelResult.value)
      return { data: { value: values, provider: choice_.name, model: choice_.model, usage: panelResult.usage } }
    }

    const field = resolveFillField(typeDef, body.field, settings)

    const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
    const envVars = deploymentFor(project)?.secrets
    const providers = availableProviders(project?.ai ?? project?.config?.ai, envVars)
    const choice = resolveProviderChoice(settings, providers, { provider: body.provider, model: body.model })

    const key = resolveProviderKey(choice.name as any, envVars)!
    const provider = getProvider(choice.name as any, key)

    const { system, user } = buildFieldPrompt({
      guidelines: resolveGuidelines(settings, body.guidelinesId),
      typeDef,
      field,
      values: (body.values ?? {}) as Record<string, unknown>,
      instruction: body.instruction,
    })

    // long-form field types need headroom (reasoning models spend completion tokens on reasoning)
    const maxTokens = ['richtext', 'repeater', 'component'].includes(field.fieldType) ? 8192 : undefined

    // ── Streaming path (opt-in via ?stream=1 / Accept, prose fields only) ────
    // Prose streams via streamOrBuffer (plain text, no JSON schema); the final
    // done event carries the coerced value (markdown → richtext doc included)
    // plus usage, so the client applies exactly what the JSON path would have.
    const wantsStream = String(ctx.query?.stream ?? '') === '1'
      || String(ctx.request?.headers?.get?.('accept') ?? '').includes('text/event-stream')
    if (wantsStream && STREAMABLE_FILL_TYPES.has(field.fieldType)) {
      const signal = ctx.request?.signal as AbortSignal | undefined
      // The JSON path carries the markdown hint in the schema description;
      // the prose path states it in the prompt instead.
      const prompt = field.fieldType === 'richtext'
        ? `${user}\n\nWrite the content as markdown (paragraphs, ## headings, - lists). Output the markdown only.`
        : user
      return sseResponse((async function* (): AsyncGenerator<SSEStreamEvent> {
        yield { event: 'meta', data: { provider: choice.name, model: choice.model, field: field.name } }
        let full = ''
        for await (const ev of streamOrBuffer(provider, { system, prompt, model: choice.model, maxTokens, effort: 'low' }, { signal })) {
          if (ev.type === 'delta') {
            full += ev.text
            yield { event: 'delta', data: { text: ev.text } }
          } else {
            // Coercion failure throws → sseResponse emits a terminal error event
            const value = coerceFieldValue(field, full)
            yield { event: 'done', data: { usage: ev.usage, value } }
          }
        }
      })())
    }

    let result: { value: unknown; usage: { inputTokens: number; outputTokens: number } }
    try {
      result = await provider.generateJSON({ system, prompt: user, model: choice.model, maxTokens }, jsonSchemaForField(field))
    } catch (e) {
      if (e instanceof AIProviderError) {
        throw upstreamRequestError(e)
      }
      throw e
    }

    const value = coerceFieldValue(field, (result.value as any)?.value)

    return { data: { value, provider: choice.name, model: choice.model, usage: result.usage } }
  }, { body: fillBodySchema })
