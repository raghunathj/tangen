/**
 * File Name: instrument.ts
 * Purpose: What an operator learns about an AI call, and what they never do
 *          (closure plan Phase 9D, Units 6 and 21). A provider failure
 *          becomes one of a bounded set of codes - the difference between a
 *          missing key, a rate limit and an upstream fault is the difference
 *          between three different fixes - and every call is observable by
 *          identity, model, surface, duration and outcome.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Wraps at getProvider, so no route changes and no route
 *          can forget. Prompts, completions, embeddings and tool arguments
 *          are never emitted; the Phase 9C attribute allow-list would drop
 *          them anyway, and not producing them is the stronger guarantee.
 */
import { emitTelemetry } from '../../telemetry/bus'
import { AIProviderError } from './types'
import type { AIProvider } from './types'

/** The bounded failure vocabulary. Each one implies a different fix. */
export type AIFailureCode =
  | 'authentication' | 'rate_limited' | 'timeout' | 'invalid_request'
  | 'provider_error' | 'unavailable' | 'cancelled' | 'error'

/** Classifies a provider failure without repeating anything the provider said. */
export function aiFailureCode(err: unknown): AIFailureCode {
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return err.name === 'TimeoutError' ? 'timeout' : 'cancelled'
  }
  if (!(err instanceof AIProviderError)) return 'error'
  const s = err.status
  if (s === 401 || s === 403) return 'authentication'
  if (s === 429) return 'rate_limited'
  if (s === 408 || s === 504) return 'timeout'
  if (s >= 400 && s < 500) return 'invalid_request'
  if (s >= 500) return 'provider_error'
  // Status 0 is "the request never reached a provider" - no response to read.
  return 'unavailable'
}

type Surface = 'text' | 'json' | 'image' | 'vision'

async function observed<T>(
  provider: string,
  model: unknown,
  surface: Surface,
  work: () => Promise<T>,
): Promise<T> {
  const started = Date.now()
  try {
    const result = await work()
    emitTelemetry({
      name: 'ai.request.completed', severity: 'info', durationMs: Date.now() - started,
      attributes: { provider, model: typeof model === 'string' ? model : 'unknown', surface, result: 'ok' },
    })
    return result
  } catch (err) {
    emitTelemetry({
      name: 'ai.request.completed', severity: 'warn', durationMs: Date.now() - started,
      attributes: { provider, model: typeof model === 'string' ? model : 'unknown', surface, result: 'error', errorCode: aiFailureCode(err) },
    })
    throw err
  }
}

/**
 * The same provider, observed. Optional methods stay optional: a wrapper that
 * invented `generateImage` would make every provider claim it can draw, and
 * the routes decide what to offer by asking whether the method is there.
 */
export function instrumentProvider(provider: AIProvider): AIProvider {
  const name = provider.name
  const wrapped: AIProvider = {
    name,
    generateText: (req) => observed(name, (req as { model?: unknown }).model, 'text', () => provider.generateText(req)),
    generateJSON: (req, schema) => observed(name, (req as { model?: unknown }).model, 'json', () => provider.generateJSON(req, schema)),
  }
  if (provider.generateImage) {
    wrapped.generateImage = (req) => observed(name, (req as { model?: unknown }).model, 'image', () => provider.generateImage!(req))
  }
  if (provider.describeImage) {
    wrapped.describeImage = (req) => observed(name, req.model, 'vision', () => provider.describeImage!(req))
  }
  // Streams are left alone: a generator's outcome is not known at call time,
  // and wrapping one to find out would buffer what the surface exists to
  // avoid. Their buffered fallback goes through generateText/generateJSON
  // above, so a non-streaming provider is covered either way.
  if (provider.streamText) wrapped.streamText = provider.streamText.bind(provider)
  if (provider.streamJSON) wrapped.streamJSON = provider.streamJSON.bind(provider)
  return wrapped
}
