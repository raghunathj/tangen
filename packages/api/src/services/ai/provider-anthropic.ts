/**
 * File Name: provider-anthropic.ts
 * Purpose: Anthropic Messages API adapter. Structured output via a single
 *          forced tool ("emit") whose input_schema is the requested JSON schema.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: plain fetch — no SDK dependency.
 */
import {
  type AIProvider, type AIGenerateRequest, type AIUsage, type AIStreamOptions,
  AIProviderError, postJSON, postStream, linkedAbort, DEFAULT_MAX_TOKENS,
  type AIVisionRequest,
} from './types'
import { parseUpstreamSSE } from '../../lib/sse'

const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'

export function createAnthropicProvider(apiKey: string): AIProvider {
  const headers = { 'x-api-key': apiKey, 'anthropic-version': API_VERSION }

  function baseBody(req: AIGenerateRequest) {
    return {
      model: req.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(req.system ? { system: req.system } : {}),
      messages: [{ role: 'user', content: req.prompt }],
    }
  }

  function usage(json: any): AIUsage {
    return {
      inputTokens: Number(json?.usage?.input_tokens ?? 0),
      outputTokens: Number(json?.usage?.output_tokens ?? 0),
    }
  }

  /**
   * Shared Messages stream loop - streamText and streamJSON differ only in the
   * request body and in which content_block_delta field carries the tokens
   * (text_delta.text for prose, input_json_delta.partial_json for tool input).
   */
  async function* streamMessages(
    body: Record<string, unknown>,
    pick: (delta: any) => unknown,
    opts?: AIStreamOptions,
  ) {
    const { signal, release } = linkedAbort(opts?.signal)
    try {
      const stream = await postStream('anthropic', API_URL, headers, { ...body, stream: true }, signal)
      const finalUsage: AIUsage = { inputTokens: 0, outputTokens: 0 }
      for await (const msg of parseUpstreamSSE(stream)) {
        if (!msg.data) continue
        let json: any
        try { json = JSON.parse(msg.data) } catch { continue }
        switch (json.type) {
          case 'message_start':
            finalUsage.inputTokens = Number(json.message?.usage?.input_tokens ?? 0)
            break
          case 'content_block_delta': {
            const text = pick(json.delta)
            if (typeof text === 'string' && text.length > 0) yield { type: 'delta' as const, text }
            break
          }
          case 'message_delta':
            if (json.usage?.output_tokens != null) finalUsage.outputTokens = Number(json.usage.output_tokens)
            if (json.usage?.input_tokens != null) finalUsage.inputTokens = Number(json.usage.input_tokens)
            break
          case 'error':
            throw new AIProviderError('anthropic', 502, String(json.error?.message ?? 'stream error'))
        }
      }
      yield { type: 'done' as const, usage: finalUsage }
    } finally {
      release()
    }
  }

  return {
    name: 'anthropic',

    async describeImage(req: AIVisionRequest) {
      // The image block first, the instruction after it - the order the Messages API documents.
      const body = {
        model: req.model,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: req.image.mimeType, data: req.image.base64 } },
          { type: 'text', text: req.prompt },
        ] }],
      }
      const json = await postJSON('anthropic', API_URL, headers, body)
      const text = (json.content ?? []).find((b: any) => b.type === 'text')?.text
      if (typeof text !== 'string') throw new AIProviderError('anthropic', 502, 'no text block in response')
      return { text, usage: usage(json) }
    },

    async generateText(req) {
      const json = await postJSON('anthropic', API_URL, headers, baseBody(req))
      const text = (json.content ?? []).find((b: any) => b.type === 'text')?.text
      if (typeof text !== 'string') throw new AIProviderError('anthropic', 502, 'no text block in response')
      return { text, usage: usage(json) }
    },

    async *streamText(req: AIGenerateRequest, opts?: AIStreamOptions) {
      yield* streamMessages(baseBody(req), (delta) => delta?.text, opts)
    },

    async *streamJSON(req: AIGenerateRequest, schema: Record<string, unknown>, opts?: AIStreamOptions) {
      // Same forced-tool constraint as generateJSON - the partial_json deltas
      // ARE the tool input that call would have buffered into one value.
      const body = {
        ...baseBody(req),
        tools: [{ name: 'emit', description: 'Emit the structured result.', input_schema: schema }],
        tool_choice: { type: 'tool', name: 'emit' },
      }
      yield* streamMessages(body, (delta) => delta?.partial_json, opts)
    },

    async generateJSON(req, schema) {
      const body = {
        ...baseBody(req),
        tools: [{ name: 'emit', description: 'Emit the structured result.', input_schema: schema }],
        tool_choice: { type: 'tool', name: 'emit' },
      }
      const json = await postJSON('anthropic', API_URL, headers, body)
      const toolUse = (json.content ?? []).find((b: any) => b.type === 'tool_use')
      if (!toolUse) throw new AIProviderError('anthropic', 502, 'no tool_use block in response')
      return { value: toolUse.input, usage: usage(json) }
    },
  }
}
