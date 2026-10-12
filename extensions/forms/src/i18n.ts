/**
 * File Name: forms-i18n.ts
 * Purpose: Form definition localization — translations live under
 *   settings.__i18n[locale] (globals pattern): per-field label/placeholder/
 *   helpText/option labels, per-form success/submit texts, and validation
 *   message overrides so client-facing errors localize too. Read overlays
 *   fall back per value; __i18n never leaks to public responses.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: mirrors services/i18n.ts localizeGlobalData /
 *   mergeGlobalLocaleData.
 */
import type { FormField, FormRecord, FormSettings } from './contract'
import { DEFAULT_FORM_MESSAGES, type FormMessages } from './contract'

/** The fields whose default value is text a locale may say differently. */
export const TEXT_LIKE = new Set(['text', 'textarea', 'email', 'phone', 'hidden'])

export interface FormLocalePatch {
  fields?: Record<string, {
    label?: string
    placeholder?: string
    helpText?: string
    patternMessage?: string
    /** The field's own validation messages, per rule (`validation.messages`). */
    messages?: Record<string, string>
    /** A locale's own pre-filled value, for the text-like fields. */
    defaultValue?: string
    options?: Record<string, string>
    /** Presentational HTML content override (type 'html'). */
    content?: string
  }>
  settings?: {
    successTitle?: string
    successMessage?: string
    submitButtonText?: string
    /** Form description (FL-4). */
    description?: string
    /** schedule.notYetOpenMessage (FL-4) — nested onto settings.schedule. */
    notYetOpenMessage?: string
    /** schedule.closedMessage (FL-4). */
    closedMessage?: string
    /** entryLimit.limitMessage (FL-4). */
    limitMessage?: string
  }
  /** Per-confirmation title/message overrides, keyed by confirmation id. */
  confirmations?: Record<string, { title?: string; message?: string }>
  /** Per-step title/description/next-button overrides, keyed by step id. */
  steps?: Record<string, { title?: string; description?: string; nextButtonText?: string }>
  messages?: Partial<FormMessages>
}

type I18nMap = Record<string, FormLocalePatch>

function i18nOf(settings: FormSettings | Record<string, unknown> | undefined): I18nMap {
  const map = (settings as any)?.__i18n
  return map && typeof map === 'object' ? map as I18nMap : {}
}

/**
 * Returns the form with the locale's translations overlaid (per-value
 * fallback to the default language) and __i18n stripped from settings.
 */
export function localizeFormDefinition<T extends Pick<FormRecord, 'fields' | 'settings'>>(
  form: T,
  locale: string | null | undefined,
): T {
  const { __i18n, ...restSettings } = (form.settings ?? {}) as any
  const patch = locale ? i18nOf(form.settings)[locale] : undefined
  if (!patch) return { ...form, settings: restSettings }

  const fields = ((form.fields ?? []) as FormField[]).map((f) => {
    const t = patch.fields?.[f.id]
    if (!t) return f
    return {
      ...f,
      ...(t.label ? { label: t.label } : {}),
      ...(t.placeholder ? { placeholder: t.placeholder } : {}),
      ...(t.helpText ? { helpText: t.helpText } : {}),
      ...(t.content ? { content: t.content } : {}),
      ...(t.patternMessage && f.validation?.patternMessage
        ? { validation: { ...f.validation, patternMessage: t.patternMessage } } : {}),
      ...(t.messages && Object.keys(t.messages).length
        ? { validation: { ...f.validation, ...(t.patternMessage && f.validation?.patternMessage ? { patternMessage: t.patternMessage } : {}), messages: { ...(f.validation?.messages ?? {}), ...t.messages } } } : {}),
      ...(typeof t.defaultValue === 'string' && t.defaultValue !== '' && TEXT_LIKE.has(f.type) ? { defaultValue: t.defaultValue } : {}),
      ...(t.options && f.options
        ? { options: f.options.map((o) => ({ ...o, label: t.options![o.value] ?? o.label })) } : {}),
    }
  })

  const steps = Array.isArray(restSettings.steps) && patch.steps
    ? restSettings.steps.map((st: { id: string; title?: string; description?: string; nextButtonText?: string }) => ({
        ...st,
        ...(patch.steps![st.id]?.title ? { title: patch.steps![st.id].title } : {}),
        ...(patch.steps![st.id]?.description ? { description: patch.steps![st.id].description } : {}),
        ...(patch.steps![st.id]?.nextButtonText ? { nextButtonText: patch.steps![st.id].nextButtonText } : {}),
      }))
    : restSettings.steps

  const confirmations = Array.isArray(restSettings.confirmations) && patch.confirmations
    ? restSettings.confirmations.map((c: { id: string; title?: string; message?: string }) => ({
        ...c,
        ...(patch.confirmations![c.id]?.title ? { title: patch.confirmations![c.id].title } : {}),
        ...(patch.confirmations![c.id]?.message ? { message: patch.confirmations![c.id].message } : {}),
      }))
    : restSettings.confirmations

  // FL-4: schedule/entry-limit messages are NESTED — pull them out of the flat
  // settings spread and apply them to their sub-objects.
  const { notYetOpenMessage, closedMessage, limitMessage, ...settingsSpread } = patch.settings ?? {}
  const schedule = restSettings.schedule && (notYetOpenMessage || closedMessage)
    ? {
        ...restSettings.schedule,
        ...(notYetOpenMessage ? { notYetOpenMessage } : {}),
        ...(closedMessage ? { closedMessage } : {}),
      }
    : restSettings.schedule
  const entryLimit = restSettings.entryLimit && limitMessage
    ? { ...restSettings.entryLimit, limitMessage }
    : restSettings.entryLimit

  return {
    ...form,
    fields,
    settings: {
      ...restSettings,
      ...settingsSpread,
      ...(steps ? { steps } : {}),
      ...(confirmations ? { confirmations } : {}),
      ...(schedule ? { schedule } : {}),
      ...(entryLimit ? { entryLimit } : {}),
    },
  }
}

/** The locale's validation message catalog: English defaults + per-form overrides. */
export function formMessagesForLocale(
  form: Pick<FormRecord, 'settings'>,
  locale: string | null | undefined,
): FormMessages {
  const patch = locale ? i18nOf(form.settings)[locale] : undefined
  return { ...DEFAULT_FORM_MESSAGES, ...(patch?.messages ?? {}) }
}

/**
 * Writes a locale's translation patch into settings.__i18n[locale] —
 * deep-merged per section, defaults and other locales untouched.
 */
export function mergeFormLocaleData(
  settings: FormSettings | Record<string, unknown>,
  locale: string,
  patch: FormLocalePatch,
): Record<string, unknown> {
  const map = i18nOf(settings as FormSettings)
  const existing = map[locale] ?? {}
  const merged: FormLocalePatch = {
    fields: { ...(existing.fields ?? {}) },
    settings: { ...(existing.settings ?? {}), ...(patch.settings ?? {}) },
    messages: { ...(existing.messages ?? {}), ...(patch.messages ?? {}) },
    confirmations: { ...(existing.confirmations ?? {}), ...(patch.confirmations ?? {}) },
    steps: { ...(existing.steps ?? {}), ...(patch.steps ?? {}) },
  }
  for (const [fieldId, t] of Object.entries(patch.fields ?? {})) {
    merged.fields![fieldId] = {
      ...(existing.fields?.[fieldId] ?? {}),
      ...t,
      ...(t.options || existing.fields?.[fieldId]?.options
        ? { options: { ...(existing.fields?.[fieldId]?.options ?? {}), ...(t.options ?? {}) } } : {}),
    }
  }
  if (Object.keys(merged.fields!).length === 0) delete merged.fields
  if (Object.keys(merged.settings!).length === 0) delete merged.settings
  if (Object.keys(merged.messages!).length === 0) delete merged.messages
  if (Object.keys(merged.confirmations!).length === 0) delete merged.confirmations
  if (Object.keys(merged.steps!).length === 0) delete merged.steps

  return {
    ...(settings as Record<string, unknown>),
    __i18n: { ...map, [locale]: merged },
  }
}
