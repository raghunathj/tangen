/**
 * File Name: translation-provider.ts
 * Purpose: The translation provider contract (Extension Kernel K8.3,
 *          tasks/plan-extension-kernel.md). A translation engine is a
 *          contribution on `translation.provider@1`: an id the translate
 *          route accepts as its `engine`, a label, the target languages it
 *          serves (absent = any), and `translate(texts, opts)`. Core's
 *          `google` and `ai` engines are listed in the same shape, so the
 *          Admin offers every engine from one list. Pure.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** The grant an extension needs to contribute a translation engine. */
export const TRANSLATION_PROVIDE_GRANT = 'translation:provide'
/** The engine ids core provides; a contribution may not take them. */
export const CORE_TRANSLATION_ENGINES = ['google', 'ai'] as const

export interface TranslateRequestOptions {
  /** Source locale code; absent lets the engine detect. */
  source?: string
  /** Target locale code. */
  target: string
  /** The target locale's label, for engines that prompt. */
  targetLabel?: string
  /** The workspace glossary and brand voice, for engines that can honour them. */
  glossary?: string
  voiceTone?: string
}

export interface TranslationProviderDefinition {
  /** What the translate route's `engine` names: `deepl`, `azure-translator`. */
  id: string
  label: string
  description?: string
  /** Target locale codes served; absent means any. */
  languages?: string[]
  translate(texts: string[], opts: TranslateRequestOptions): Promise<{ texts: string[]; usage?: { inputTokens?: number; outputTokens?: number } }>
}

/** An engine as the registry lists it. */
export interface TranslationProviderEntry extends Omit<TranslationProviderDefinition, 'translate'> {
  source: 'core' | { extensionId: string }
  available: boolean
  /** Present for contributed engines; core engines are built by the route from their key or an AI provider. */
  translate?: TranslationProviderDefinition['translate']
}

const ID = /^[a-z0-9][a-z0-9._-]*$/

/** Shape check: a lowercase id core does not already use, a label, optional language list, a translate function. */
export function validateTranslationProvider(input: unknown): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = []
  if (!input || typeof input !== 'object') return [{ path: '', message: 'must be an object' }]
  const p = input as Partial<TranslationProviderDefinition> & Record<string, unknown>
  if (typeof p.id !== 'string' || !ID.test(p.id)) issues.push({ path: 'id', message: 'must be a lowercase id (letters, digits, . _ -)' })
  else if ((CORE_TRANSLATION_ENGINES as readonly string[]).includes(p.id)) issues.push({ path: 'id', message: `'${p.id}' is a core engine; pick another id` })
  if (typeof p.label !== 'string' || !p.label.trim()) issues.push({ path: 'label', message: 'must be a non-empty string' })
  if (p.languages !== undefined && (!Array.isArray(p.languages) || p.languages.some((l) => typeof l !== 'string'))) issues.push({ path: 'languages', message: 'must be a list of locale codes' })
  if (typeof p.translate !== 'function') issues.push({ path: 'translate', message: 'must be a function (texts, opts) => Promise<{ texts }>' })
  return issues
}
