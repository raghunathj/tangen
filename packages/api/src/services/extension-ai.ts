/**
 * File Name: extension-ai.ts
 * Purpose: The ExtensionServerCtx.ai seam — hands extension server code the
 *          platform's OWN AI surfaces instead of letting each extension fork
 *          them: structured generateJSON bound to Settings > AI provider
 *          resolution (same path as schema/forms generation), the field
 *          schema/coercion bridge from services/ai/coerce, and best-effort
 *          knowledge retrieval (workspace RAG) that softens every
 *          not-configured/not-indexed state to "no facts".
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Wired per workspace × env by buildExtensionCtx
 *          (packages/api/src/index.ts). Provider errors map through
 *          upstreamRequestError so an extension route surfaces the same
 *          honest 429/504/502 story as the core AI routes.
 */
import { embeddingsSettingsFor } from '../config/service-settings'
import { deploymentFor } from '../config/service-settings'
import type { ExtensionAIClient, ExtensionAIField, ExtensionAIFact } from '@tangen/types'
import { readSettings } from '../routes/ai/settings'
import { resolveProviderChoice } from '../routes/ai/fill'
import { AIProviderError, upstreamRequestError } from './ai'
import { listAiProviders } from './ai/registry'
import { RequestError } from '../lib/errors'
import type { AiProviderEntry, AiCapability } from '@tangen/types'
import { pickAiProvider } from '@tangen/types'
import { jsonSchemaForField, coerceFieldValue } from './ai/coerce'
import { knowledgeExec } from './knowledge-sync'

/** Default output cap for extension generations (matches schema generation). */
const DEFAULT_MAX_TOKENS = 8000
/** Retrieval ceiling — extensions get facts, not the whole index. */
const MAX_RETRIEVE_K = 12

/**
 * Unwrapped VALUE schema for one field — the platform's own field bridge
 * (jsonSchemaForField wraps in `{ value }`; extensions compose raw shapes).
 * Null for field types that cannot be generated (media, relations, …).
 */
export function extensionFieldSchema(field: ExtensionAIField): Record<string, unknown> | null {
  try {
    const wrapped = jsonSchemaForField(field as never) as { properties?: { value?: Record<string, unknown> } }
    return wrapped.properties?.value ?? null
  } catch {
    return null
  }
}

/** Coerce raw provider output into a valid stored value (throws when it cannot). */
export function extensionCoerceField(field: ExtensionAIField, raw: unknown): unknown {
  return coerceFieldValue(field as never, raw)
}

/**
 * Best-effort workspace RAG for extension prompts. Every "cannot retrieve"
 * state — package missing, knowledge disabled, no index, model mismatch,
 * embed failure — returns [] instead of throwing: retrieval seasons a
 * generation, it must never block one.
 */
export async function retrieveKnowledgeFacts(
  db: unknown,
  project: unknown,
  workspaceId: string,
  query: string,
  k = 6,
): Promise<ExtensionAIFact[]> {
  try {
    const knowledge = await import('@tangen/knowledge')
    const config = knowledge.resolveKnowledgeConfig(project as never)
    if (!config.enabled) return []
    const embeddings = knowledge.requireEmbeddingsConfig(config)
    const adapter = knowledge.getEmbeddingAdapter(embeddingsSettingsFor(project as never, embeddings))
    const store = knowledge.createKnowledgeStore(knowledgeExec(db))
    // Vector-space pin, same rule as /knowledge/search: a mismatched index
    // would return nonsense, so it counts as "nothing to retrieve".
    const meta = await store.getMeta(workspaceId).catch(() => undefined)
    if (!meta || meta.dimensions !== adapter.dimensions || `${meta.provider}/${meta.model}` !== adapter.name) return []
    const [vector] = await adapter.embed([query])
    const hits = await store.search(workspaceId, vector, {
      k: Math.min(Math.max(1, k), MAX_RETRIEVE_K),
      // Extension routes run on member sessions - workspace-internal knowledge is in scope.
      audiences: ['internal', 'public'],
      qaBoost: config.qaBoost,
    })
    return hits.map((h) => ({
      content: h.content,
      title: (h.metadata?.title as string | undefined) ?? (h.metadata?.path as string | undefined) ?? null,
    }))
  } catch {
    return []
  }
}

export interface ExtensionAIDeps {
  db: unknown
  workspaceId: string
  /** The workspace project (ai config + envCustom + knowledge config live here). */
  project: Record<string, unknown> | undefined
  /** The providers this workspace can see (K8.1): built-ins plus what active extensions contribute. Default: the built-ins only. */
  providers?: () => AiProviderEntry[]
  /** The workspace's AI settings (preferred provider + model); injectable for tests. */
  readSettings?: () => Promise<{ provider?: string | null; model?: string | null }>
}

const unavailable = (capability: AiCapability) =>
  new RequestError('AI_CAPABILITY_UNAVAILABLE', `No available AI provider advertises ${capability}; enable one under Settings → AI or install an extension that provides it`, 501)

/** Build the ctx.ai client for one workspace × env. */
export function makeExtensionAI(deps: ExtensionAIDeps): ExtensionAIClient {
  const { db, workspaceId, project } = deps
  const p = project as { ai?: unknown; config?: { ai?: unknown } } | undefined
  const envVars = () => deploymentFor(project as never)?.secrets
  const providersOf = (): AiProviderEntry[] => deps.providers
    ? deps.providers()
    : listAiProviders({ workspaceId, activeIds: new Set(), config: (p?.ai ?? p?.config?.ai) as never, secrets: envVars() })
  const settingsOf = () => deps.readSettings ? deps.readSettings() : readSettings(db as never, workspaceId)
  return {
    fieldSchema: extensionFieldSchema,
    coerceField: extensionCoerceField,
    retrieve: (query, opts) => retrieveKnowledgeFacts(db, project, workspaceId, query, opts?.k),
    generateJSON: async (args) => {
      const settings = await settingsOf()
      const all = providersOf()
      // The registry routes by capability (K8.1): the workspace preference when it advertises json, else the first that does.
      const chosen = pickAiProvider(all, { capability: 'json.generate', preferred: settings.provider ?? null })
      if (!chosen) throw unavailable('json.generate')
      // Fast default when the workspace configured no model - an interactive
      // surface (a marketer waiting on a dialog) beats maximum deliberation.
      const legacy = resolveProviderChoice(settings as never, all.map((p) => ({ name: p.id, available: p.available, models: p.models })), { provider: chosen.id }, { preferFast: true })
      const model = settings.provider === chosen.id && settings.model ? settings.model : legacy.model
      try {
        const result = await chosen.json!.generate(
          { system: args.system, prompt: args.prompt, model, maxTokens: args.maxTokens ?? DEFAULT_MAX_TOKENS, effort: 'low' },
          args.jsonSchema,
        )
        return { value: result.value, usage: result.usage, provider: chosen.id, model }
      } catch (e) {
        if (e instanceof AIProviderError) throw upstreamRequestError(e)
        throw e
      }
    },
    vision: {
      describe: async (args) => {
        const settings = await settingsOf()
        const chosen = pickAiProvider(providersOf(), { capability: 'vision.describe', preferred: settings.provider ?? null })
        if (!chosen) throw unavailable('vision.describe')
        const model = args.model ?? (settings.provider === chosen.id && settings.model ? settings.model : chosen.models[0] ?? '')
        try {
          const r = await chosen.vision!.describe({ image: args.image, prompt: args.prompt, model, maxTokens: args.maxTokens })
          return { text: r.text, usage: r.usage, provider: chosen.id, model }
        } catch (e) {
          if (e instanceof AIProviderError) throw upstreamRequestError(e)
          throw e
        }
      },
    },
    embeddings: {
      generate: async (args) => {
        const settings = await settingsOf()
        const chosen = pickAiProvider(providersOf(), { capability: 'embeddings.generate', preferred: settings.provider ?? null })
        if (!chosen) throw unavailable('embeddings.generate')
        const r = await chosen.embeddings!.generate({ input: args.input, model: args.model })
        return { vectors: r.vectors, model: r.model, provider: chosen.id }
      },
    },
    providers: () => providersOf().map((p) => ({ id: p.id, label: p.label, capabilities: [...p.capabilities], models: [...p.models], available: p.available })),
  }
}
