/**
 * File Name: index.ts
 * Purpose: Content AI provider registry — adapter factory, default model
 *          catalogs, and availability computation (developer config ∩ resolvable
 *          keys). Keys never appear in any returned structure.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: adapters in this directory; @tangen/types (AIConfig).
 */
import type { AIConfig, AIProviderName } from '@tangen/types'
import { resolveProviderKey } from '../../lib/ai-keys'
import type { AIProvider, AIGenerateRequest, AIStreamEvent, AIStreamOptions } from './types'
import { createAnthropicProvider } from './provider-anthropic'
import { createOpenAIProvider } from './provider-openai'
import { createGeminiProvider } from './provider-gemini'
import { instrumentProvider } from './instrument'

export type { AIProvider, AIGenerateRequest, AIImageRequest, AIImageResult, AIStreamEvent, AIStreamOptions, AIUsage } from './types'
export { AIProviderError, upstreamRequestError } from './types'
export { aiFailureCode, type AIFailureCode } from './instrument'

/**
 * Streams text from the provider when it can, buffers when it can't: yields
 * from streamText if the adapter implements it, otherwise falls back to one
 * generateText call surfaced as a single delta followed by done. Every
 * provider therefore works on every streaming surface from day one.
 */
export async function* streamOrBuffer(
  provider: AIProvider,
  req: AIGenerateRequest,
  opts?: AIStreamOptions,
): AsyncGenerator<AIStreamEvent, void, unknown> {
  if (provider.streamText) {
    yield* provider.streamText(req, opts)
    return
  }
  const result = await provider.generateText(req)
  yield { type: 'delta', text: result.text }
  yield { type: 'done', usage: result.usage }
}

/**
 * Structured twin of streamOrBuffer: yields the raw JSON text deltas from
 * streamJSON if the adapter implements it, otherwise falls back to one
 * generateJSON call surfaced as a single serialized delta followed by done.
 * The client contract is identical either way - settled entries just arrive
 * in one burst for buffered providers.
 */
export async function* streamJSONOrBuffer(
  provider: AIProvider,
  req: AIGenerateRequest,
  schema: Record<string, unknown>,
  opts?: AIStreamOptions,
): AsyncGenerator<AIStreamEvent, void, unknown> {
  if (provider.streamJSON) {
    yield* provider.streamJSON(req, schema, opts)
    return
  }
  const result = await provider.generateJSON(req, schema)
  yield { type: 'delta', text: JSON.stringify(result.value) }
  yield { type: 'done', usage: result.usage }
}

export const ALL_PROVIDERS: AIProviderName[] = ['anthropic', 'openai', 'gemini', 'deepseek', 'kimi', 'qwen']

/** OpenAI-compatible chat endpoints (reuse the OpenAI adapter with a base URL). */
const COMPATIBLE_ENDPOINTS: Partial<Record<AIProviderName, string>> = {
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  kimi: 'https://api.moonshot.ai/v1/chat/completions',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
}

/** Default selectable models per provider — overridable via AIConfig.models. */
export const DEFAULT_MODELS: Record<AIProviderName, string[]> = {
  anthropic: ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  kimi: ['kimi-k2-0711-preview', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  qwen: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
}

/**
 * Default image-generation models — overridable via AIConfig.imageModels.
 * Anthropic and the OpenAI-compatible text providers ship none (can't draw).
 */
export const DEFAULT_IMAGE_MODELS: Record<AIProviderName, string[]> = {
  anthropic: [],
  openai: ['gpt-image-1'],
  gemini: ['gemini-2.5-flash-image'],
  deepseek: [],
  kimi: [],
  qwen: [],
}

/**
 * The built-ins whose catalogued text models take an image (SEO Manager S3):
 * they advertise `vision.describe` in the registry. The OpenAI-compatible three
 * are text providers here - their vision variants are not catalogued, and a
 * capability the adapter cannot honour would be a lie at routing time.
 */
export const VISION_PROVIDERS: readonly AIProviderName[] = ['anthropic', 'openai', 'gemini']
export const supportsVision = (name: AIProviderName): boolean => VISION_PROVIDERS.includes(name)

/**
 * Creates an adapter for the named provider. DeepSeek / Kimi / Qwen are
 * OpenAI-compatible — the OpenAI adapter with their base URL.
 * @throws When the provider name is unknown.
 */
export function getProvider(name: AIProviderName, apiKey: string): AIProvider {
  // Instrumented here rather than per route: nine route files call this, and
  // an observability seam every caller has to remember is one nobody has.
  return instrumentProvider(createProvider(name, apiKey))
}

function createProvider(name: AIProviderName, apiKey: string): AIProvider {
  switch (name) {
    case 'anthropic': return createAnthropicProvider(apiKey)
    case 'openai': return createOpenAIProvider(apiKey)
    case 'gemini': return createGeminiProvider(apiKey)
    case 'deepseek':
    case 'kimi':
    case 'qwen':
      return createOpenAIProvider(apiKey, { name, chatUrl: COMPATIBLE_ENDPOINTS[name] })
    default:
      throw new Error(`Unknown AI provider: "${name}"`)
  }
}

export interface ProviderAvailability {
  name: AIProviderName
  /** true when the provider is permitted by config AND its API key resolves. */
  available: boolean
  models: string[]
  /** Image-generation models — empty when this provider cannot draw. */
  imageModels: string[]
}

/**
 * Computes which providers the admin may use.
 * No config → all providers, availability decided purely by key presence
 * (zero-config: dropping a key in .env enables that provider).
 * config.providers narrows the permitted list; config.disabled kills the feature.
 */
export function availableProviders(
  config: AIConfig | undefined,
  secrets: import('@tangen/types').SecretAccessorLike | undefined,
): ProviderAvailability[] {
  if (config?.disabled) return []
  const permitted = config?.providers ?? ALL_PROVIDERS
  return permitted.map(name => ({
    name,
    available: resolveProviderKey(name, secrets) !== undefined,
    models: config?.models?.[name] ?? DEFAULT_MODELS[name],
    imageModels: config?.imageModels?.[name] ?? DEFAULT_IMAGE_MODELS[name],
  }))
}
