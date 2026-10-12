/**
 * File Name: locales.ts
 * Purpose: GET /api/v1/admin/i18n/locales — tells the admin panel whether
 *          localization is enabled, which locales are authorable (default
 *          first), and which translation engines have resolvable keys.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Member JWT required. Config authored in
 *          app/config/localization.ts (tangen enable localization).
 */
import { resolvedFor } from '../../config/state'
import { resolveGoogleTranslateKey } from '../../services/i18n-translate/google'
import { Elysia } from 'elysia'
import type { LocalizationConfig, LocaleDef } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { availableProviders } from '../../services/ai'
import { listTranslationProviders, translationEnginesFor } from '../../services/i18n-translate/registry'
import { extensionWiringDeps } from '../../services/extension-server'

export interface ResolvedLocalization {
  enabled: boolean
  defaultLocale: string
  /** Default locale first, then the rest in declared order — deduped, junk dropped. */
  locales: LocaleDef[]
}

/**
 * Normalizes a developer-authored LocalizationConfig: guarantees the default
 * locale leads the list, drops junk/duplicate entries, and collapses to
 * disabled when the config is absent or switched off.
 */
export function resolveLocalization(config: LocalizationConfig | undefined | null): ResolvedLocalization {
  if (!config || config.enabled !== true) {
    return { enabled: false, defaultLocale: config?.defaultLocale || 'en', locales: [] }
  }
  const defaultLocale = String(config.defaultLocale || 'en').trim() || 'en'

  const seen = new Set<string>()
  const rest: LocaleDef[] = []
  let defaultDef: LocaleDef = { code: defaultLocale, label: defaultLocale }
  for (const entry of config.locales ?? []) {
    if (!entry || typeof entry !== 'object') continue
    const code = String((entry as any).code ?? '').trim()
    if (!code || seen.has(code)) continue
    seen.add(code)
    const def = { code, label: String((entry as any).label ?? code) || code }
    if (code === defaultLocale) defaultDef = def
    else rest.push(def)
  }

  return { enabled: true, defaultLocale, locales: [defaultDef, ...rest] }
}

/**
 * Registers the locales endpoints. Mounted after authMiddleware.
 *
 * Public discovery — GET /api/v1/i18n/locales — answers "which languages does
 * this workspace serve?" for ANY authenticated caller (API key or member): the
 * shape a site needs for a language switcher or per-locale static builds.
 * Engine availability stays on the admin variant only.
 */
export const i18nLocalesRoute = (app: Elysia) =>
  app.get('/api/v1/i18n/locales', async (ctx: any) => {
    const { workspaceId, workspaceProjects } = ctx
    const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
    return { data: resolveLocalization(project?.localization ?? project?.config?.localization) }
  })
  .get('/api/v1/admin/i18n/locales', async (ctx: any) => {
    const { workspaceId, memberId, workspaceProjects } = ctx
    if (!memberId) {
      throw new RequestError('FORBIDDEN', 'Localization info is admin-panel only', 403)
    }

    const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
    const resolved = resolveLocalization(project?.localization ?? project?.config?.localization)

    // Translation-engine availability - key presence only, never key material,
    // through this deployment's secret accessor.
    const secrets = resolvedFor(String(workspaceId))?.secrets
    const googleKey = resolveGoogleTranslateKey(secrets)
    const aiAvailable = availableProviders(project?.ai ?? project?.config?.ai, secrets).some(p => p.available)

    return {
      data: {
        ...resolved,
        // K8.3: every engine the Admin may offer - the flags it reads today, plus the contributed ones.
        engines: translationEnginesFor(listTranslationProviders({ workspaceId, activeIds: new Set(extensionWiringDeps()?.activeIds ? await extensionWiringDeps()!.activeIds!(workspaceId).catch(() => [] as string[]) : []), secrets, aiAvailable })),
      },
    }
  })
