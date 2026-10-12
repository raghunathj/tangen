/**
 * File Name: google.ts
 * Purpose: Google Cloud Translation v2 engine — plain fetch, no SDK. Batches
 *          all texts in one request; format 'text' so markup is never invented.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: key via GOOGLE_TRANSLATE_API_KEY (env custom vars take
 *          precedence over process env, same as the AI provider keys).
 */
import type { TranslateEngine, TranslateOptions } from './types'

const API_URL = 'https://translation.googleapis.com/language/translate/v2'

/** The Google Translate key, through the deployment's secret accessor (ai.translate.apiKey); never from the process environment. */
export function resolveGoogleTranslateKey(secrets: { get(key: string): string | undefined } | undefined): string | undefined {
  return secrets?.get('ai.translate.apiKey') || undefined
}

export function createGoogleTranslateEngine(apiKey: string, referer?: string): TranslateEngine {
  return {
    name: 'google',

    async translate(texts: string[], opts: TranslateOptions): Promise<string[]> {
      if (texts.length === 0) return []
      // Browser-type keys are referrer-restricted - ai.translate.referer
      // (GOOGLE_TRANSLATE_REFERER) lets a server call present an allowed
      // referrer. Prefer an IP-restricted or unrestricted server key.
      const res = await fetch(`${API_URL}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(referer ? { Referer: referer } : {}) },
        body: JSON.stringify({
          q: texts,
          target: opts.target,
          ...(opts.source ? { source: opts.source } : {}),
          format: 'text',
        }),
      })
      const json = await res.json().catch(() => ({})) as any
      if (!res.ok) {
        const message = json?.error?.message ?? res.statusText ?? 'translation failed'
        throw new Error(`google translate (${res.status}): ${message}`)
      }
      const translations = json?.data?.translations
      if (!Array.isArray(translations) || translations.length !== texts.length) {
        throw new Error('google translate: response count mismatch')
      }
      return translations.map((t: any) => String(t.translatedText ?? ''))
    },
  }
}
