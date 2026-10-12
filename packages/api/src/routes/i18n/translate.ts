/**
 * File Name: translate.ts
 * Purpose: POST /api/v1/admin/i18n/translate — machine-translates a content
 *          object's localized fields into a target locale via Google Translate
 *          or an AI provider (glossary/voice-aware). Returns a preview only —
 *          the admin reviews and applies with a locale-scoped save. NEVER
 *          writes.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: member JWT; rate-limited (translation is a paid call).
 *          v1 translates text/textarea/richtext; other localized field types
 *          come back in `skipped`.
 */
import { deploymentFor } from '../../config/service-settings'
import { Elysia, t } from 'elysia'
import { RequestError } from '../../lib/errors'
import { enforceRateLimit } from '../../services/rate-limiter'
import { availableProviders, getProvider, AIProviderError, upstreamRequestError } from '../../services/ai'
import { resolveProviderKey } from '../../lib/ai-keys'
import { readSettings } from '../ai/settings'
import { resolveGuidelines } from '../ai/fill'
import { resolveLocaleParam, projectLocalization } from '../../services/i18n'
import { collectTranslatables, assembleTranslated } from '../../services/i18n-translate/batch'
import { createGoogleTranslateEngine, resolveGoogleTranslateKey } from '../../services/i18n-translate/google'
import { listTranslationProviders, pickTranslationEngine } from '../../services/i18n-translate/registry'
import { extensionWiringDeps } from '../../services/extension-server'
import { createAITranslateEngine } from '../../services/i18n-translate/ai'

const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_SEC = 60

const bodySchema = t.Object({
  /** Content type for field-aware batching; omit to translate every string in values. */
  type: t.Optional(t.String()),
  /** Source values to translate — the editor sends the default-locale draft. */
  values: t.Record(t.String(), t.Any()),
  /** Optional subset of fields; omit to translate title + every localized field. */
  fields: t.Optional(t.Array(t.String())),
  sourceLocale: t.Optional(t.String()),
  targetLocale: t.String(),
  /** `google`, `ai`, or the id of a translation.provider@1 an active extension contributes (K8.3). */
  engine: t.String(),
  provider: t.Optional(t.String()),
  model: t.Optional(t.String()),
  guidelinesId: t.Optional(t.String()),
})

/**
 * Registers the translation endpoint. Mounted after authMiddleware.
 */
export const i18nTranslateRoute = (app: Elysia) =>
  app.post('/api/v1/admin/i18n/translate', async (ctx: any) => {
    const { db, redis, schema, workspaceId, memberId, workspaceProjects, body } = ctx
    if (!memberId) {
      throw new RequestError('FORBIDDEN', 'Translation is admin-panel only', 403)
    }
    await enforceRateLimit(redis, workspaceId, `i18n-translate:${memberId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC)

    const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
    const localization = projectLocalization(project)
    const target = resolveLocaleParam(body.targetLocale, localization, true)
    if (!target || target === 'all') {
      throw new RequestError('VALIDATION_ERROR', 'targetLocale must be a non-default locale', 422)
    }
    const targetLabel = (localization?.locales ?? []).find((l) => l.code === target)?.label ?? target

    // With a type, batching is schema-aware (localized fields + richtext);
    // without one (media/globals), every string value provided is translated.
    let typeDef = null as any
    if (body.type) {
      typeDef = schema?.types?.find((td: any) => td.name === body.type)
      if (!typeDef || typeDef.disabled) {
        throw new RequestError('TYPE_NOT_FOUND', `Type "${body.type}" not found in schema`, 404)
      }
    } else {
      const stringKeys = Object.entries(body.values ?? {})
        .filter(([, v]) => typeof v === 'string' && (v as string).trim() !== '')
        .map(([k]) => k)
      typeDef = { name: '__values', fields: stringKeys.map((k) => ({ name: k, fieldType: 'text', config: { localized: true } })) }
    }

    const { items, texts, skipped } = collectTranslatables(typeDef, body.values ?? {}, body.fields, (project?.components ?? []) as never)
    if (texts.length === 0) {
      return { data: { values: {}, skipped, engine: body.engine } }
    }

    const envVars = deploymentFor(project)?.secrets
    const source = body.sourceLocale ?? localization?.defaultLocale

    let translated: string[]
    let usage: { inputTokens: number; outputTokens: number } | undefined
    let engineName: string

    try {
      // K8.3: a contributed engine translates through its own function; core ids fall through to the branches below.
      const deps = extensionWiringDeps()
      const activeIds = new Set(deps?.activeIds ? await deps.activeIds(workspaceId).catch(() => [] as string[]) : [])
      const aiAvailable = availableProviders(project?.ai ?? project?.config?.ai, envVars).some((p) => p.available)
      const contributed = pickTranslationEngine(listTranslationProviders({ workspaceId, activeIds, secrets: envVars, aiAvailable }), { engine: String(body.engine), target, targetLabel })
      if (contributed) {
        translated = await contributed.translate(texts, { source, target })
        engineName = contributed.name
      } else if (body.engine === 'google') {
        const key = resolveGoogleTranslateKey(envVars)
        if (!key) {
          throw new RequestError('VALIDATION_ERROR', 'Google Translate is not configured - set GOOGLE_TRANSLATE_API_KEY', 422)
        }
        const engine = createGoogleTranslateEngine(key, deploymentFor(project)?.get<string>('ai.translate.referer'))
        translated = await engine.translate(texts, { source, target })
        engineName = engine.name
      } else {
        const settings = await readSettings(db, workspaceId)
        const providers = availableProviders(project?.ai ?? project?.config?.ai, envVars)
        const wanted = body.provider ?? settings.provider ?? providers.find((p) => p.available)?.name
        const providerInfo = providers.find((p) => p.available && p.name === wanted) ?? providers.find((p) => p.available)
        if (!providerInfo) {
          throw new RequestError('VALIDATION_ERROR', 'No AI provider is available for translation', 422)
        }
        const model = body.model && providerInfo.models.includes(body.model)
          ? body.model
          : (settings.provider === providerInfo.name && settings.model) || providerInfo.models[0]
        const guidelines = resolveGuidelines(settings, body.guidelinesId)
        const provider = getProvider(providerInfo.name as any, resolveProviderKey(providerInfo.name as any, envVars)!)
        const engine = createAITranslateEngine(provider, model, {
          glossary: guidelines.glossary ?? '',
          voiceTone: guidelines.voiceTone ?? '',
        }, targetLabel)
        translated = await engine.translate(texts, { source, target })
        usage = engine.usage
        engineName = engine.name
      }
    } catch (e) {
      if (e instanceof AIProviderError) throw upstreamRequestError(e)
      if (e instanceof RequestError) throw e
      throw new RequestError('UPSTREAM_ERROR', e instanceof Error ? e.message : 'translation failed', 502)
    }

    return {
      data: {
        values: assembleTranslated(items, translated),
        skipped,
        engine: engineName,
        targetLocale: target,
        ...(usage ? { usage } : {}),
      },
    }
  }, { body: bodySchema })
