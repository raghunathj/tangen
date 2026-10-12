/**
 * File Name: types.ts
 * Purpose: Common types for the Content AI provider adapters — one request shape,
 *          one provider interface, regardless of the upstream API.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types (AIProviderName).
 */
import type { AIProviderName } from '@tangen/types'
import { RequestError } from '../../lib/errors'

export interface AIGenerateRequest {
  /** System prompt (guidelines, role). */
  system?: string
  /** User prompt (task + context). */
  prompt: string
  /** Provider model id, e.g. 'claude-sonnet-5'. */
  model: string
  /** Output token cap (default 2048). */
  maxTokens?: number
  /** Reasoning-effort hint for models that reason (OpenAI gpt-5/o-series:
   *  reasoning_effort + verbosity). Providers/models without the concept
   *  ignore it. Content-generation surfaces pass 'low' - a reasoning model
   *  at default effort turns a 15s draft into minutes. */
  effort?: 'minimal' | 'low' | 'medium' | 'high'
}

/** Token accounting for one provider call. */
export interface AIUsage {
  inputTokens: number
  outputTokens: number
}

export interface AITextResult { text: string; usage: AIUsage }
export interface AIJSONResult { value: unknown; usage: AIUsage }

/** One event of a token stream: 0..n text deltas, then exactly one done. */
export type AIStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; usage: AIUsage }

/** Options for streaming calls — the signal aborts the upstream fetch. */
export interface AIStreamOptions { signal?: AbortSignal }

export interface AIImageRequest {
  /** What to draw. */
  prompt: string
  /** Provider image model id, e.g. 'gpt-image-1'. */
  model: string
  size?: '1024x1024' | '1536x1024' | '1024x1536'
}

export interface AIImageResult {
  /** Raw image bytes, base64-encoded (no data: prefix). */
  base64: string
  mimeType: string
  usage?: AIUsage
}

/**
 * A provider adapter. generateJSON constrains the model to the given JSON
 * schema (tool-use / response_format / responseSchema per provider) and
 * returns the parsed object plus token usage. generateImage is optional —
 * not every provider can draw (Anthropic omits it).
 */
/** One image for a vision call (SEO Manager S3): the bytes, base64-encoded (no data: prefix), and their type. */
export interface AIVisionRequest {
  image: { base64: string; mimeType: string }
  /** What to say about it (an alt text, a caption, ...). */
  prompt: string
  /** A multimodal text model of the provider, e.g. 'claude-sonnet-5'. */
  model: string
  maxTokens?: number
}

export interface AIProvider {
  readonly name: AIProviderName
  generateText(req: AIGenerateRequest): Promise<AITextResult>
  generateJSON(req: AIGenerateRequest, schema: Record<string, unknown>): Promise<AIJSONResult>
  generateImage?(req: AIImageRequest): Promise<AIImageResult>
  /** OPTIONAL vision: describe one image (S3). Only the multimodal built-ins offer it; see `VISION_PROVIDERS`. */
  describeImage?(req: AIVisionRequest): Promise<AITextResult>
  /**
   * OPTIONAL native token streaming for prose (generateText's streaming twin).
   * Yields 0..n deltas then one done with usage. Providers without it still
   * work everywhere via streamOrBuffer's buffered fallback.
   */
  streamText?(req: AIGenerateRequest, opts?: AIStreamOptions): AsyncGenerator<AIStreamEvent, void, unknown>
  /**
   * OPTIONAL native token streaming for STRUCTURED output (generateJSON's
   * streaming twin) - the same schema constraint, but the raw JSON text
   * arrives as deltas instead of one buffered value. Providers without it
   * still work everywhere via streamJSONOrBuffer's buffered fallback.
   */
  streamJSON?(req: AIGenerateRequest, schema: Record<string, unknown>, opts?: AIStreamOptions): AsyncGenerator<AIStreamEvent, void, unknown>
}

/** Uniform provider failure — carries upstream status + message for a 502. */
export class AIProviderError extends Error {
  constructor(
    public readonly provider: AIProviderName,
    public readonly status: number,
    message: string,
    /** Upstream Retry-After (seconds form), when the provider sent one. */
    public readonly retryAfterSeconds?: number,
  ) {
    super(`${provider} (${status}): ${message}`)
    this.name = 'AIProviderError'
  }
}

/** Seconds-form Retry-After, or undefined (the HTTP-date form is rare and skipped). */
function retryAfterFrom(res: Response): number | undefined {
  const raw = res.headers.get('retry-after')
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * Maps a provider failure to the client-facing RequestError WITHOUT flattening
 * everything to 502. A 502 says "the upstream is broken"; an upstream 429
 * means "slow down", and telling a client the wrong one invites it to retry
 * straight back into the limit (finding #12). Retry-After travels in details;
 * the error middleware turns it into a real response header.
 */
export function upstreamRequestError(e: AIProviderError): RequestError {
  if (e.status === 429) {
    return new RequestError(
      'UPSTREAM_RATE_LIMITED', e.message, 429, undefined,
      e.retryAfterSeconds !== undefined ? { retryAfterSeconds: e.retryAfterSeconds } : undefined,
    )
  }
  if (e.status === 408 || e.status === 504 || e.status === 524) {
    return new RequestError('UPSTREAM_TIMEOUT', e.message, 504)
  }
  return new RequestError('UPSTREAM_ERROR', e.message, 502)
}

/** POSTs JSON and returns parsed JSON, throwing AIProviderError on non-2xx. */
export async function postJSON(
  provider: AIProviderName,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message =
      json?.error?.message ?? json?.error?.error?.message ?? json?.message ?? res.statusText ?? 'request failed'
    throw new AIProviderError(provider, res.status, String(message), retryAfterFrom(res))
  }
  return json
}

/**
 * POSTs JSON expecting an SSE stream back; returns the raw body stream.
 * Non-2xx responses are read as JSON and thrown as AIProviderError — a
 * failed stream START is a normal provider error, only MID-stream failures
 * become `error` events.
 */
export async function postStream(
  provider: AIProviderName,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...headers },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })
  if (!res.ok) {
    const json: any = await res.json().catch(() => ({}))
    const message =
      json?.error?.message ?? json?.error?.error?.message ?? json?.message ?? res.statusText ?? 'request failed'
    throw new AIProviderError(provider, res.status, String(message), retryAfterFrom(res))
  }
  if (!res.body) throw new AIProviderError(provider, 502, 'no response body for stream')
  return res.body
}

/**
 * Links a caller's AbortSignal to a fresh controller for one upstream fetch.
 * Call `release()` in the generator's finally: it aborts the upstream request
 * (no-op if already finished) and detaches the listener — so both client
 * disconnects (iterator.return) and explicit aborts stop the provider call.
 */
export function linkedAbort(signal?: AbortSignal): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController()
  const forward = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', forward, { once: true })
  return {
    signal: controller.signal,
    release: () => {
      signal?.removeEventListener('abort', forward)
      controller.abort()
    },
  }
}

export const DEFAULT_MAX_TOKENS = 2048
