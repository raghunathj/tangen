/**
 * File Name: embeddings.ts
 * Purpose: Embedding provider adapters — every one a plain fetch client
 *          (zero dependencies). Paid: openai / gemini / voyage. Open &
 *          self-hosted: ollama and openai-compatible (one adapter covers
 *          vLLM, LM Studio, llama.cpp server, HF TEI, Together, …). A
 *          custom EmbeddingAdapter instance in config wins over all.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Anthropic offers no embeddings API (their docs point
 *          at Voyage). Dimensions are pinned per model — unknown models
 *          must declare `dimensions` in config so the vector column and
 *          the meta pin can be created before the first call.
 */
import type { EmbeddingAdapter, EmbeddingsConfig } from '@tangen/types'

type FetchLike = typeof fetch

/** Known model → dimensions, so common configs stay one-liners. */
const KNOWN_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  'text-embedding-004': 768,
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'bge-m3': 1024,
  'voyage-3': 1024,
  'voyage-3-lite': 512,
  'voyage-3-large': 1024,
}

const DEFAULT_MODEL: Record<string, string> = {
  openai: 'text-embedding-3-small',
  gemini: 'text-embedding-004',
  voyage: 'voyage-3-lite',
}

async function postJson(
  fetchImpl: FetchLike,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<any> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Embedding request failed (${res.status}): ${detail.slice(0, 300)}`)
  }
  return res.json()
}

/**
 * The key the caller resolved into `config.apiKey` (the API and the CLI hand
 * over material from the deployment's secret provider). Nothing here reads
 * the process: `envVar` only names what the deployment usually supplies.
 */
function requireKey(config: EmbeddingsConfig, envVar: string): string {
  const key = config.apiKey
  if (!key) throw new Error(`Embedding provider needs an API key - the deployment supplies ${envVar}, or knowledge.embeddings.apiKey names another variable.`)
  return key
}

function resolveDimensions(config: EmbeddingsConfig, model: string): number {
  const dims = config.dimensions ?? KNOWN_DIMENSIONS[model]
  if (!dims) {
    throw new Error(
      `Unknown embedding dimensions for model "${model}" - set embeddings.dimensions explicitly.`,
    )
  }
  return dims
}

/**
 * Builds the embedding adapter for a config. A custom `adapter` instance
 * wins; otherwise the named provider is constructed. Throws with the
 * provider menu semantics when nothing is configured (callers should have
 * run requireEmbeddingsConfig first).
 */
/**
 * An adapter's name split into the two columns `knowledge_meta` stores.
 *
 * A built-in adapter names itself `provider/model`. A CUSTOM adapter names
 * itself once - it is its own provider and its own model - and a model name may
 * itself contain a slash, so only the first one separates the two.
 */
export function splitAdapterName(name: string): { provider: string; model: string } {
  const at = name.indexOf('/')
  if (at === -1) return { provider: name, model: name }
  return { provider: name.slice(0, at), model: name.slice(at + 1) }
}

/**
 * The adapter name a stored vector space came from - the exact inverse of
 * `splitAdapterName`, and the only thing the pin may compare against.
 *
 * Joining unconditionally with "/" is what made `embeddings.adapter` unusable:
 * a custom adapter indexed as ("g12-local", "g12-local"), rejoined to
 * "g12-local/g12-local", and never again equalled the adapter still configured.
 * Every query answered 409 KNOWLEDGE_MODEL_MISMATCH and the rebuild the error
 * recommended wrote the same two strings back (Stage G12).
 */
export function vectorSpaceName(meta: { provider: string; model: string }): string {
  return meta.model && meta.model !== meta.provider ? `${meta.provider}/${meta.model}` : meta.provider
}

export function getEmbeddingAdapter(
  config: EmbeddingsConfig,
  fetchImpl: FetchLike = fetch,
): EmbeddingAdapter {
  if (config.adapter) return config.adapter

  const provider = config.provider
  if (!provider) throw new Error('No embedding provider configured.')
  const model = config.model ?? DEFAULT_MODEL[provider]
  if (!model) throw new Error(`embeddings.model is required for provider "${provider}".`)
  const dimensions = resolveDimensions(config, model)

  switch (provider) {
    case 'openai':
      return {
        name: `openai/${model}`, dimensions,
        embed: async (texts) => {
          const json = await postJson(fetchImpl, 'https://api.openai.com/v1/embeddings',
            { model, input: texts },
            { Authorization: `Bearer ${requireKey(config, 'OPENAI_API_KEY')}` })
          return json.data.map((d: { embedding: number[] }) => d.embedding)
        },
      }

    case 'openai-compatible': {
      if (!config.baseUrl) throw new Error("embeddings.baseUrl is required for provider 'openai-compatible'.")
      const url = `${config.baseUrl.replace(/\/$/, '')}/v1/embeddings`
      return {
        name: `openai-compatible/${model}`, dimensions,
        embed: async (texts) => {
          const headers: Record<string, string> = {}
          const key = config.apiKey
          if (key) headers.Authorization = `Bearer ${key}`
          const json = await postJson(fetchImpl, url, { model, input: texts }, headers)
          return json.data.map((d: { embedding: number[] }) => d.embedding)
        },
      }
    }

    case 'ollama': {
      const base = (config.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '')
      return {
        name: `ollama/${model}`, dimensions,
        embed: async (texts) => {
          const json = await postJson(fetchImpl, `${base}/api/embed`, { model, input: texts })
          return json.embeddings as number[][]
        },
      }
    }

    case 'gemini':
      return {
        name: `gemini/${model}`, dimensions,
        embed: async (texts) => {
          const key = requireKey(config, 'GEMINI_API_KEY')
          const json = await postJson(
            fetchImpl,
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${key}`,
            { requests: texts.map((text) => ({ model: `models/${model}`, content: { parts: [{ text }] } })) },
          )
          return json.embeddings.map((e: { values: number[] }) => e.values)
        },
      }

    case 'voyage':
      return {
        name: `voyage/${model}`, dimensions,
        embed: async (texts) => {
          const json = await postJson(fetchImpl, 'https://api.voyageai.com/v1/embeddings',
            { model, input: texts },
            { Authorization: `Bearer ${requireKey(config, 'VOYAGE_API_KEY')}` })
          return json.data.map((d: { embedding: number[] }) => d.embedding)
        },
      }

    default:
      throw new Error(`Unknown embedding provider: ${String(provider)}`)
  }
}
