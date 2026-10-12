/**
 * File Name: provider-gemini.ts
 * Purpose: Google Gemini generateContent adapter. Structured output via
 *          generationConfig.responseSchema + responseMimeType application/json.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: plain fetch — no SDK dependency. Gemini's responseSchema
 *          is an OpenAPI subset; the schemas Tangen builds stay within it.
 */
import {
  type AIProvider, type AIGenerateRequest, type AIUsage, type AIStreamOptions,
  AIProviderError, postJSON, postStream, linkedAbort, DEFAULT_MAX_TOKENS,
  type AIVisionRequest,
} from './types'
import { parseUpstreamSSE } from '../../lib/sse'

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

export function createGeminiProvider(apiKey: string): AIProvider {
  const headers = { 'x-goog-api-key': apiKey }

  function baseBody(req: AIGenerateRequest) {
    return {
      ...(req.system ? { system_instruction: { parts: [{ text: req.system }] } } : {}),
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: { maxOutputTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS },
    }
  }

  function text(json: any): string {
    const t = json.candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof t !== 'string') throw new AIProviderError('gemini', 502, 'no text part in response')
    return t
  }

  function usage(json: any): AIUsage {
    return {
      inputTokens: Number(json?.usageMetadata?.promptTokenCount ?? 0),
      outputTokens: Number(json?.usageMetadata?.candidatesTokenCount ?? 0),
    }
  }

  /** Shared streamGenerateContent loop - streamText and streamJSON differ only in the body. */
  async function* streamContent(model: string, body: Record<string, unknown>, opts?: AIStreamOptions) {
    const { signal, release } = linkedAbort(opts?.signal)
    try {
      const url = `${BASE_URL}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
      const stream = await postStream('gemini', url, headers, body, signal)
      let finalUsage: AIUsage = { inputTokens: 0, outputTokens: 0 }
      for await (const msg of parseUpstreamSSE(stream)) {
        let json: any
        try { json = JSON.parse(msg.data) } catch { continue }
        const parts = json.candidates?.[0]?.content?.parts ?? []
        for (const p of parts) {
          if (typeof p?.text === 'string' && p.text.length > 0) yield { type: 'delta' as const, text: p.text }
        }
        if (json.usageMetadata) finalUsage = usage(json)
      }
      yield { type: 'done' as const, usage: finalUsage }
    } finally {
      release()
    }
  }

  return {
    name: 'gemini',

    async describeImage(req: AIVisionRequest) {
      const url = `${BASE_URL}/${encodeURIComponent(req.model)}:generateContent`
      const body = {
        contents: [{ role: 'user', parts: [
          { inlineData: { mimeType: req.image.mimeType, data: req.image.base64 } },
          { text: req.prompt },
        ] }],
        generationConfig: { maxOutputTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS },
      }
      const json = await postJSON('gemini', url, headers, body)
      return { text: text(json), usage: usage(json) }
    },

    async generateText(req) {
      const url = `${BASE_URL}/${encodeURIComponent(req.model)}:generateContent`
      const json = await postJSON('gemini', url, headers, baseBody(req))
      return { text: text(json), usage: usage(json) }
    },

    async *streamText(req: AIGenerateRequest, opts?: AIStreamOptions) {
      yield* streamContent(req.model, baseBody(req), opts)
    },

    async *streamJSON(req: AIGenerateRequest, schema: Record<string, unknown>, opts?: AIStreamOptions) {
      // Same responseSchema constraint as generateJSON - the part texts ARE
      // the JSON text that call would have buffered into one value.
      const body = baseBody(req)
      body.generationConfig = {
        ...body.generationConfig,
        responseMimeType: 'application/json',
        responseSchema: schema,
      } as any
      yield* streamContent(req.model, body, opts)
    },

    async generateJSON(req, schema) {
      const url = `${BASE_URL}/${encodeURIComponent(req.model)}:generateContent`
      const body = baseBody(req)
      body.generationConfig = {
        ...body.generationConfig,
        responseMimeType: 'application/json',
        responseSchema: schema,
      } as any
      const json = await postJSON('gemini', url, headers, body)
      const raw = text(json)
      try {
        return { value: JSON.parse(raw), usage: usage(json) }
      } catch {
        throw new AIProviderError('gemini', 502, 'response was not valid JSON')
      }
    },

    async generateImage(req) {
      const url = `${BASE_URL}/${encodeURIComponent(req.model)}:generateContent`
      const json = await postJSON('gemini', url, headers, {
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      })
      const parts = json?.candidates?.[0]?.content?.parts ?? []
      const inline = parts.find((p: any) => p?.inlineData?.data)?.inlineData
      if (!inline) {
        throw new AIProviderError('gemini', 502, 'no image part in response')
      }
      return {
        base64: String(inline.data),
        mimeType: String(inline.mimeType ?? 'image/png'),
        usage: usage(json),
      }
    },
  }
}
