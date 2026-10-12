/**
 * File Name: ai.ts
 * Purpose: AI translation engine — any configured LLM provider translates the
 *          batch via structured output, steered by the workspace glossary and
 *          brand voice (the differentiator over plain machine translation).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: reuses the Content AI provider adapters (generateJSON).
 */
import type { AIProvider } from '../ai/types'
import type { AIUsage } from '../ai/types'
import type { TranslateEngine, TranslateOptions } from './types'

export interface TranslateGuidelines {
  glossary: string
  voiceTone: string
}

export function createAITranslateEngine(
  provider: AIProvider,
  model: string,
  guidelines: TranslateGuidelines,
  targetLabel: string,
): TranslateEngine & { usage?: AIUsage } {
  const engine: TranslateEngine & { usage?: AIUsage } = {
    name: `ai:${provider.name}`,

    async translate(texts: string[], opts: TranslateOptions): Promise<string[]> {
      if (texts.length === 0) return []
      const system = [
        `You are a professional translator. Translate every input text into ${targetLabel} (locale "${opts.target}").`,
        'Preserve meaning, tone, and any placeholders or formatting characters exactly.',
        'Return the translations in the same order as the inputs - one per input, never merged or split.',
        guidelines.glossary ? `Glossary - keep these terms exactly as specified:\n${guidelines.glossary}` : '',
        guidelines.voiceTone ? `Brand voice & tone:\n${guidelines.voiceTone}` : '',
      ].filter(Boolean).join('\n\n')

      const prompt = JSON.stringify({ texts })
      const schema = {
        type: 'object',
        properties: {
          translations: { type: 'array', items: { type: 'string' } },
        },
        required: ['translations'],
        additionalProperties: false,
      }

      const result = await provider.generateJSON({ system, prompt, model, maxTokens: 8192 }, schema)
      engine.usage = result.usage
      const translations = (result.value as any)?.translations
      if (!Array.isArray(translations) || translations.length !== texts.length) {
        throw new Error(`ai translate: expected ${texts.length} translations, got ${Array.isArray(translations) ? translations.length : 'none'} (count mismatch)`)
      }
      return translations.map(String)
    },
  }
  return engine
}
