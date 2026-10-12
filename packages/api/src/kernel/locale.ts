/**
 * File Name: locale.ts
 * Purpose: The locale axis of one execution (kernel plan §7), resolved once
 *          from what the request asked for, the workspace's localization and
 *          the actor's kind. It never throws: a locale the execution cannot
 *          use is recorded on `invalid`, and an operation refuses on that.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Reuses the two resolvers the routes call today
 *          (resolveReadLocales / resolveLocaleParam) so the execution and a
 *          route that still resolves its own agree exactly.
 */
import type { ActorContext, LocaleContext, LocalizationConfig } from '@tangen/types'
import { resolveReadLocales, resolveLocaleParam } from '../services/i18n'

export function baseLocaleContext(localization: LocalizationConfig | null | undefined, requested: string | null = null): LocaleContext {
  const enabled = localization?.enabled === true
  return { requested, enabled, default: enabled ? (localization?.defaultLocale ?? null) : null, read: { mode: 'base' }, write: null, invalid: null }
}

export function resolveLocaleContext(input: {
  requested: string | null | undefined
  localization: LocalizationConfig | null | undefined
  actor: ActorContext
}): LocaleContext {
  const requested = typeof input.requested === 'string' && input.requested.trim() ? input.requested.trim() : null
  const base = baseLocaleContext(input.localization, requested)
  if (requested === null) return base
  const isMember = input.actor.identity.kind === 'member'
  try {
    const read = resolveReadLocales(requested, input.localization, { isMember })
    // A map read (`all`, a comma list) is a read shape, never a write target;
    // a single code is both, checked the way the write routes check it.
    const write = read?.mode === 'map' ? null : resolveLocaleParam(requested, input.localization, isMember)
    return {
      ...base,
      read: read === null ? { mode: 'base' } : read.mode === 'overlay' ? { mode: 'overlay', locale: read.locale } : { mode: 'map', locales: read.locales },
      write: write === null || write === 'all' ? null : write,
    }
  } catch (err) {
    return { ...base, invalid: err instanceof Error ? err.message : String(err) }
  }
}
