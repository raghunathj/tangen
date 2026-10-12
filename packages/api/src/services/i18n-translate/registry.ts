/**
 * File Name: registry.ts (i18n-translate)
 * Purpose: The open translation engine registry (Extension Kernel K8.3,
 *          tasks/plan-extension-kernel.md). Core's `google` (available when
 *          its key resolves) and `ai` (available when an AI provider can
 *          generate text) are listed in the `translation.provider@1` shape
 *          beside the engines ACTIVE extensions contribute, each validated
 *          (an invalid one is dropped with a warning). The translate route
 *          picks by id: a contributed engine translates through its own
 *          function, refused for a language it does not serve; core engines
 *          are built by the route from their key or an AI provider.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { TranslationProviderDefinition, TranslationProviderEntry } from '@tangen/types'
import { validateTranslationProvider, CORE_TRANSLATION_ENGINES } from '@tangen/types'
import { contributions, noteContributionWarning } from '../../kernel/contributions'
import { RequestError } from '../../lib/errors'
import { resolveGoogleTranslateKey } from './google'
import type { TranslateEngine } from './types'

export interface TranslationRegistryScope {
  workspaceId: string
  activeIds: ReadonlySet<string>
  secrets: { get(key: string): string | undefined } | undefined
  /** Whether any AI provider can generate text here (the `ai` engine's availability). */
  aiAvailable: boolean
}

export function listTranslationProviders(scope: TranslationRegistryScope): TranslationProviderEntry[] {
  const out: TranslationProviderEntry[] = [
    { id: 'google', label: 'Google Translate', description: 'Google Cloud Translation v2, keyed by GOOGLE_TRANSLATE_API_KEY', source: 'core', available: Boolean(resolveGoogleTranslateKey(scope.secrets)) },
    { id: 'ai', label: 'Content AI', description: 'Your configured AI provider, with the workspace glossary and brand voice in the prompt', source: 'core', available: scope.aiAvailable },
  ]
  const taken = new Set(out.map((p) => p.id))
  for (const c of contributions<TranslationProviderDefinition>('translation.provider@1', { activeIds: scope.activeIds, workspaceId: scope.workspaceId })) {
    const issues = validateTranslationProvider(c.item)
    if (issues.length) {
      noteContributionWarning(`translation.provider@1 '${String((c.item as { id?: unknown })?.id ?? '?')}' from extension "${c.extensionId}" dropped: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`)
      continue
    }
    if (taken.has(c.item.id)) { noteContributionWarning(`translation.provider@1 from extension "${c.extensionId}" dropped: engine id '${c.item.id}' is already taken`); continue }
    taken.add(c.item.id)
    out.push({ ...c.item, source: { extensionId: c.extensionId }, available: true })
  }
  return out
}

/** What the locales route answers: the flags the Admin reads today, plus every engine with its availability. */
export function translationEnginesFor(entries: readonly TranslationProviderEntry[]): { google: boolean; ai: boolean; providers: Array<{ id: string; label: string; available: boolean; languages?: string[] }> } {
  return {
    google: entries.find((e) => e.id === 'google')?.available ?? false,
    ai: entries.find((e) => e.id === 'ai')?.available ?? false,
    providers: entries.map((e) => ({ id: e.id, label: e.label, available: e.available, ...(e.languages ? { languages: [...e.languages] } : {}) })),
  }
}

/**
 * The engine an `engine` id names. A contributed engine comes back ready
 * (refused, 422, for a target it does not serve); a core id answers null so
 * the route builds it the way it always has; an unknown id is a 422 naming
 * what exists.
 */
export function pickTranslationEngine(entries: readonly TranslationProviderEntry[], opts: { engine: string; target: string; targetLabel?: string; glossary?: string; voiceTone?: string }): TranslateEngine | null {
  if ((CORE_TRANSLATION_ENGINES as readonly string[]).includes(opts.engine)) return null
  const entry = entries.find((e) => e.id === opts.engine)
  if (!entry || !entry.translate) throw new RequestError('VALIDATION_ERROR', `Unknown translation engine '${opts.engine}' (known: ${entries.map((e) => e.id).join(', ')})`, 422)
  if (!entry.available) throw new RequestError('VALIDATION_ERROR', `Translation engine '${opts.engine}' is not available here`, 422)
  if (entry.languages && !entry.languages.includes(opts.target)) throw new RequestError('VALIDATION_ERROR', `Translation engine '${opts.engine}' does not translate into '${opts.target}' (it serves ${entry.languages.join(', ')})`, 422)
  const translate = entry.translate
  return {
    name: entry.id,
    async translate(texts, o) {
      const r = await translate(texts, { source: o.source, target: o.target, targetLabel: opts.targetLabel, glossary: opts.glossary, voiceTone: opts.voiceTone })
      if (!Array.isArray(r?.texts) || r.texts.length !== texts.length) throw new RequestError('UPSTREAM_ERROR', `Translation engine '${entry.id}' answered ${Array.isArray(r?.texts) ? r.texts.length : 'no'} texts for ${texts.length}`, 502)
      return r.texts
    },
  }
}
