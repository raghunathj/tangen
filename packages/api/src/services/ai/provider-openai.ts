/**
 * File Name: provider-openai.ts
 * Purpose: OpenAI Chat Completions adapter. Structured output via
 *          response_format json_schema. The same adapter serves any
 *          OpenAI-COMPATIBLE endpoint (DeepSeek, Kimi/Moonshot, Qwen) — pass a
 *          `name` + `chatUrl`.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: plain fetch — no SDK dependency.
 */
import type { AIProviderName } from '@tangen/types'
import {
  type AIProvider, type AIGenerateRequest, type AIUsage, type AIStreamOptions,
  AIProviderError, postJSON, postStream, linkedAbort, DEFAULT_MAX_TOKENS,
  type AIVisionRequest,
} from './types'
import { parseUpstreamSSE } from '../../lib/sse'

const API_URL = 'https://api.openai.com/v1/chat/completions'
const IMAGES_URL = 'https://api.openai.com/v1/images/generations'

/**
 * OpenAI (default) or any OpenAI-compatible provider. `chatUrl` overrides the
 * chat-completions endpoint; `name` sets the provider label in errors/usage.
 * Image generation is OpenAI-only — compatible providers pass no imageModels, so
 * the image path never routes to them.
 */
export function createOpenAIProvider(
  apiKey: string,
  opts: { name?: AIProviderName; chatUrl?: string } = {},
): AIProvider {
  const name = opts.name ?? 'openai'
  const chatUrl = opts.chatUrl ?? API_URL
  const headers = { Authorization: `Bearer ${apiKey}` }

  /** gpt-5 and o-series models accept reasoning_effort (and gpt-5 verbosity);
   *  sending either to a non-reasoning model is a 400, so gate by prefix. */
  function isReasoningModel(model: string): boolean {
    return /^(gpt-5|o\d)/.test(model)
  }

  function baseBody(req: AIGenerateRequest) {
    return {
      model: req.model,
      max_completion_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(req.effort && isReasoningModel(req.model)
        ? {
            reasoning_effort: req.effort,
            ...(req.model.startsWith('gpt-5')
              ? { verbosity: req.effort === 'minimal' || req.effort === 'low' ? 'low' : 'medium' }
              : {}),
          }
        : {}),
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        { role: 'user', content: req.prompt },
      ],
    }
  }

  function content(json: any): string {
    const text = json.choices?.[0]?.message?.content
    if (typeof text !== 'string') throw new AIProviderError(name, 502, 'no message content in response')
    return text
  }

  function usage(json: any): AIUsage {
    return {
      inputTokens: Number(json?.usage?.prompt_tokens ?? 0),
      outputTokens: Number(json?.usage?.completion_tokens ?? 0),
    }
  }

  /** Shared chat-completions stream loop - streamText and streamJSON differ only in the request body. */
  async function* streamChat(body: Record<string, unknown>, opts?: AIStreamOptions) {
    const { signal, release } = linkedAbort(opts?.signal)
    try {
      const stream = await postStream(name, chatUrl, headers, { ...body, stream: true, stream_options: { include_usage: true } }, signal)
      let finalUsage: AIUsage = { inputTokens: 0, outputTokens: 0 }
      for await (const msg of parseUpstreamSSE(stream)) {
        if (msg.data === '[DONE]') break
        let json: any
        try { json = JSON.parse(msg.data) } catch { continue }
        const text = json.choices?.[0]?.delta?.content
        if (typeof text === 'string' && text.length > 0) yield { type: 'delta' as const, text }
        if (json.usage) finalUsage = usage(json)
      }
      yield { type: 'done' as const, usage: finalUsage }
    } finally {
      release()
    }
  }

  return {
    name,

    // Only OpenAI itself: the compatible endpoints are text providers here (their vision variants are not catalogued).
    ...(name === 'openai' ? {
      async describeImage(req: AIVisionRequest) {
        const body = {
          model: req.model,
          max_completion_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:${req.image.mimeType};base64,${req.image.base64}` } },
            { type: 'text', text: req.prompt },
          ] }],
        }
        const json = await postJSON(name, chatUrl, headers, body)
        return { text: content(json), usage: usage(json) }
      },
    } : {}),

    async generateText(req) {
      const json = await postJSON(name, chatUrl, headers, baseBody(req))
      return { text: content(json), usage: usage(json) }
    },

    async *streamText(req: AIGenerateRequest, opts?: AIStreamOptions) {
      yield* streamChat(baseBody(req), opts)
    },

    async *streamJSON(req: AIGenerateRequest, schema: Record<string, unknown>, opts?: AIStreamOptions) {
      // Same json_schema constraint as generateJSON - the content deltas ARE
      // the JSON text that call would have buffered into one value.
      yield* streamChat({
        ...baseBody(req),
        response_format: { type: 'json_schema', json_schema: { name: 'emit', schema } },
      }, opts)
    },

    async generateJSON(req, schema) {
      const body = {
        ...baseBody(req),
        response_format: { type: 'json_schema', json_schema: { name: 'emit', schema } },
      }
      const json = await postJSON(name, chatUrl, headers, body)
      const text = content(json)
      try {
        return { value: JSON.parse(text), usage: usage(json) }
      } catch {
        throw new AIProviderError(name, 502, 'response was not valid JSON')
      }
    },

    async generateImage(req) {
      // Only OpenAI itself exposes the Images API — compatible providers declare
      // no imageModels, so this is unreachable for them; guard just in case.
      if (name !== 'openai') throw new AIProviderError(name, 400, `${name} does not support image generation`)
      const json = await postJSON('openai', IMAGES_URL, headers, {
        model: req.model,
        prompt: req.prompt,
        n: 1,
        ...(req.size ? { size: req.size } : {}),
      })
      const b64 = json?.data?.[0]?.b64_json
      if (typeof b64 !== 'string' || !b64) {
        throw new AIProviderError('openai', 502, 'no image data in response')
      }
      return {
        base64: b64,
        mimeType: 'image/png',
        ...(json?.usage
          ? { usage: { inputTokens: Number(json.usage.input_tokens ?? 0), outputTokens: Number(json.usage.output_tokens ?? 0) } }
          : {}),
      }
    },
  }
}
