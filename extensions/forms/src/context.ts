/**
 * File Name: context.ts
 * Purpose: What every Forms route and task needs from the extension ctx: the
 *          database handle, the options (sender, captcha, the site's
 *          code-first behaviour), the resolved app settings, a form loaded by
 *          id or slug inside the workspace, its dynamic options materialised,
 *          the lifecycle hooks for a slug, and a public `?locale=` judged
 *          against the workspace's localization.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { and, eq } from 'drizzle-orm'
import type { ExtensionServerCtx } from '@tangen/cms'
import { forms, type FormsDb } from './tables'
import type { FormAppSettings, FormHookSet, FormRecord } from './contract'
import { buildFormsBehavior, type FormsBehavior } from './behavior'
import { appSettingsFromValues, type FormsOptions } from './settings'
import { materializeFormOptions } from './options'
import { resolveFormRef, type FormLookupQuerier } from './lookup'
import { RequestError } from './errors'

export const EXT_ID = 'forms'

export function dbOf(ctx: ExtensionServerCtx): FormsDb {
  const db = (ctx as { db?: unknown }).db
  if (!db) throw new RequestError('INTERNAL', 'forms: the extension ctx carries no database handle', 500)
  return db as FormsDb
}

/** The options a site declares for the extension: `{ forms: [defineForm(...), defineFormHooks(...)] }`. */
export function optionsOf(ctx: ExtensionServerCtx): FormsOptions & { forms?: unknown[] } {
  return (ctx.options ?? {}) as FormsOptions & { forms?: unknown[] }
}

export function behaviorOf(ctx: ExtensionServerCtx): FormsBehavior {
  return buildFormsBehavior(optionsOf(ctx).forms ?? [])
}

/** The lifecycle hooks a slug carries, from the site's code-first entries. */
export function hooksFor(ctx: ExtensionServerCtx, slug: string): Partial<FormHookSet> {
  return behaviorOf(ctx).hooksBySlug[slug] ?? {}
}

/** Sender and captcha: the manifest settings (E.8), read through ctx.settings; nothing without them. */
export async function loadAppSettings(ctx: ExtensionServerCtx): Promise<FormAppSettings> {
  return appSettingsFromValues(await ctx.settings?.get())
}

/** Id-or-slug lookup, scoped to the workspace the request resolved to. */
export function formQuerier(ctx: ExtensionServerCtx): FormLookupQuerier {
  const db = dbOf(ctx)
  return {
    byId: async (id) => (await db.select().from(forms).where(and(eq(forms.id, id), eq(forms.workspaceId, ctx.workspaceId))).limit(1))[0] ?? null,
    bySlug: (slug) => db.select().from(forms).where(and(eq(forms.slug, slug), eq(forms.workspaceId, ctx.workspaceId))),
  }
}

export async function loadForm(ctx: ExtensionServerCtx, ref: string): Promise<FormRecord> {
  return (await resolveFormRef(ref, formQuerier(ctx))) as unknown as FormRecord
}

/** A copy of the form with its dynamic options (declarative `optionsFrom` or code-side functions) materialised. */
export async function withResolvedOptions(ctx: ExtensionServerCtx, form: FormRecord): Promise<FormRecord> {
  const fields = (form.fields ?? []) as Array<{ name: string; optionsFrom?: unknown }>
  const optionFns = behaviorOf(ctx).optionsBySlugField[form.slug]
  if (!fields.some((f) => f.optionsFrom || optionFns?.[f.name])) return form
  const materialised = await materializeFormOptions(form.fields ?? [], {
    tangen: (ctx.tangen as unknown as { objects: (type: string) => unknown } | undefined) ?? null,
    optionFns: optionFns as never,
    workspaceId: ctx.workspaceId,
    cacheScope: ctx.workspaceId,
  })
  return { ...form, fields: materialised }
}

interface LocalizationLike { enabled?: boolean; defaultLocale?: string; locales?: Array<{ code?: string }> }

/**
 * A `?locale=` judged against the workspace's localization: null for the
 * base language (or none asked), the code for a known locale, a 422 for an
 * unknown one or for localization that is off. `isMember` allows `all`.
 */
export function localeOf(ctx: ExtensionServerCtx, raw: unknown, isMember = false): string | null {
  if (!raw) return null
  const locale = String(raw)
  const localization = ((ctx.workspaceConfig?.() as { localization?: LocalizationLike } | undefined)?.localization) ?? undefined
  if (!localization || localization.enabled !== true) {
    if (locale === 'all') return null
    throw new RequestError('VALIDATION_ERROR', 'Localization is not enabled for this workspace', 422)
  }
  if (locale === 'all') {
    if (!isMember) throw new RequestError('VALIDATION_ERROR', 'locale=all is admin-panel only', 422)
    return 'all'
  }
  if (locale === localization.defaultLocale) return null
  if (!(localization.locales ?? []).some((l) => l?.code === locale)) throw new RequestError('VALIDATION_ERROR', `Unknown locale "${locale}"`, 422)
  return locale
}
