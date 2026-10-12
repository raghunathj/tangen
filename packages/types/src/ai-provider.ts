/**
 * File Name: ai-provider.ts
 * Purpose: The AI provider contract (Extension Kernel K8.1,
 *          tasks/plan-extension-kernel.md; plan-framework-extensibility §35).
 *          A provider is a contribution on `ai.provider@1` that ADVERTISES
 *          the capabilities it supports and the models it offers; core's
 *          built-ins are contributions of the same shape. A capability
 *          routes to the workspace's preferred provider when it advertises
 *          it, else to the first available one that does - vision is not a
 *          feature, it is `vision.describe` on a provider that has it. Pure.
 *
 * Author: Raghunath J
 * License: MIT
 */

export const AI_CAPABILITIES = ['text.generate', 'json.generate', 'image.generate', 'vision.describe', 'embeddings.generate'] as const
export type AiCapability = (typeof AI_CAPABILITIES)[number]

/** The grant an extension needs to contribute a provider. */
export const AI_PROVIDE_GRANT = 'ai:provide'
/** The grant a consumer needs per capability. */
export const AI_CAPABILITY_GRANTS: Record<AiCapability, string> = {
  'text.generate': 'ai:generate',
  'json.generate': 'ai:generate',
  'image.generate': 'ai:generate',
  'vision.describe': 'ai:vision',
  'embeddings.generate': 'ai:embed',
}

export interface AiTextRequest { system?: string; prompt: string; model: string; maxTokens?: number; effort?: 'minimal' | 'low' | 'medium' | 'high' }
export interface AiUsageLike { inputTokens?: number; outputTokens?: number }
export interface AiImageInput { url?: string; base64?: string; mimeType?: string }
export interface AiVisionRequest { image: AiImageInput; prompt?: string; model?: string; maxTokens?: number }
export interface AiEmbeddingsRequest { input: string[]; model?: string }
export interface AiImageGenerateRequest { prompt: string; model: string; size?: string; n?: number }

export interface AiProviderDefinition {
  /** Unique across providers: `mistral-local`, `openai`. */
  id: string
  label: string
  capabilities: AiCapability[]
  models: string[]
  imageModels?: string[]
  text?: { generate(req: AiTextRequest): Promise<{ text: string; usage?: AiUsageLike }> }
  json?: { generate(req: AiTextRequest, schema: Record<string, unknown>): Promise<{ value: unknown; usage?: AiUsageLike }> }
  image?: { generate(req: AiImageGenerateRequest): Promise<{ images: Array<{ base64?: string; url?: string; mimeType?: string }>; usage?: AiUsageLike }> }
  vision?: { describe(req: AiVisionRequest): Promise<{ text: string; usage?: AiUsageLike }> }
  embeddings?: { generate(req: AiEmbeddingsRequest): Promise<{ vectors: number[][]; model: string; usage?: AiUsageLike }> }
}

/** A provider as the registry lists it: where it came from and whether it can be used now. */
export interface AiProviderEntry extends AiProviderDefinition {
  source: 'core' | { extensionId: string }
  available: boolean
}

const IMPL: Record<AiCapability, keyof AiProviderDefinition> = {
  'text.generate': 'text', 'json.generate': 'json', 'image.generate': 'image', 'vision.describe': 'vision', 'embeddings.generate': 'embeddings',
}
const METHOD: Record<AiCapability, string> = {
  'text.generate': 'generate', 'json.generate': 'generate', 'image.generate': 'generate', 'vision.describe': 'describe', 'embeddings.generate': 'generate',
}
const ID = /^[a-z0-9][a-z0-9._-]*$/

/** Shape check: id, label, known capabilities each implemented, models a list. */
export function validateAiProvider(input: unknown): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = []
  if (!input || typeof input !== 'object') return [{ path: '', message: 'must be an object' }]
  const p = input as Partial<AiProviderDefinition> & Record<string, unknown>
  if (typeof p.id !== 'string' || !ID.test(p.id)) issues.push({ path: 'id', message: 'must be a lowercase id (letters, digits, . _ -)' })
  if (typeof p.label !== 'string' || !p.label.trim()) issues.push({ path: 'label', message: 'must be a non-empty string' })
  if (!Array.isArray(p.capabilities) || p.capabilities.length === 0) issues.push({ path: 'capabilities', message: `must list at least one of ${AI_CAPABILITIES.join(', ')}` })
  else {
    p.capabilities.forEach((c, i) => {
      if (!(AI_CAPABILITIES as readonly string[]).includes(c as string)) { issues.push({ path: `capabilities[${i}]`, message: `unknown capability '${String(c)}' (one of ${AI_CAPABILITIES.join(', ')})` }); return }
      const impl = p[IMPL[c as AiCapability]] as Record<string, unknown> | undefined
      if (!impl || typeof impl[METHOD[c as AiCapability]] !== 'function') issues.push({ path: `capabilities[${i}]`, message: `advertises ${String(c)} but implements no ${String(IMPL[c as AiCapability])}.${METHOD[c as AiCapability]}()` })
    })
  }
  if (!Array.isArray(p.models) || p.models.some((m) => typeof m !== 'string')) issues.push({ path: 'models', message: 'must be a list of model ids' })
  return issues
}

/** The provider a capability routes to: the preferred one when it advertises it and is available, else the first available that does, else null. */
export function pickAiProvider<T extends Pick<AiProviderEntry, 'id' | 'capabilities' | 'available'>>(
  providers: readonly T[],
  opts: { capability: AiCapability; preferred?: string | null },
): T | null {
  const fits = (p: T) => p.available && p.capabilities.includes(opts.capability)
  if (opts.preferred) {
    const preferred = providers.find((p) => p.id === opts.preferred)
    if (preferred && fits(preferred)) return preferred
  }
  return providers.find(fits) ?? null
}
