/**
 * File Name: use-form.ts
 * Purpose: One form in the admin: loaded once, edited in memory (name,
 *          fields, settings, the per-locale translation drafts), saved as one
 *          PATCH plus one PATCH per touched locale. The builder and every
 *          settings section share it, so a form has one save path.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from '@/kit'
import type { FormField, FormSettings } from '../contract'
import { formsApi, type FormRow } from './api'

export type Translations = Record<string, any>

export interface FormState {
  loading: boolean
  saving: boolean
  error: string | null
  row: FormRow | null
  name: string
  source: 'admin' | 'code'
  isLive: boolean
  fields: FormField[]
  settings: FormSettings & Record<string, unknown>
  translations: Translations
  dirty: boolean
  readOnly: boolean
  setName: (name: string) => void
  setFields: (fields: FormField[]) => void
  updateField: (field: FormField) => void
  updateSettings: (patch: Partial<FormSettings> & Record<string, unknown>) => void
  replaceDefinition: (def: { name?: string; fields?: FormField[]; steps?: unknown; settings?: Record<string, unknown> }) => void
  translate: (locale: string, path: string[], value: string) => void
  /** Save what changed; `publish` flips the live state alongside. */
  save: (opts?: { publish?: boolean }) => Promise<boolean>
  setLive: (next: boolean) => Promise<void>
  reload: () => Promise<void>
}

const DEFAULT_SETTINGS: FormSettings & Record<string, unknown> = { notifications: [], uniqueBy: null }

/** Sets `value` at `path` inside the locale's draft, dropping empty strings. */
function setIn(t: Translations, locale: string, path: string[], value: string): Translations {
  const next = { ...t, [locale]: { ...(t[locale] ?? {}) } }
  let node: Record<string, any> = next[locale]
  for (let i = 0; i < path.length - 1; i++) {
    node[path[i]!] = { ...(node[path[i]!] ?? {}) }
    node = node[path[i]!]
  }
  node[path[path.length - 1]!] = value || undefined
  return next
}

export function useForm(formId: string | undefined): FormState {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [row, setRow] = useState<FormRow | null>(null)
  const [name, setNameState] = useState('')
  const [source, setSource] = useState<'admin' | 'code'>('admin')
  const [isLive, setIsLive] = useState(false)
  const [fields, setFieldsState] = useState<FormField[]>([])
  const [settings, setSettings] = useState<FormSettings & Record<string, unknown>>(DEFAULT_SETTINGS)
  const [translations, setTranslations] = useState<Translations>({})
  const [dirtyLocales, setDirtyLocales] = useState<Set<string>>(new Set())
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    if (!formId) return
    setLoading(true)
    setError(null)
    try {
      const r = await formsApi.get(formId)
      setRow(r)
      setNameState(r.name)
      setSource(r.source === 'code' ? 'code' : 'admin')
      setIsLive(r.isLive === true)
      setFieldsState(r.fields ?? [])
      setSettings({ ...DEFAULT_SETTINGS, ...(r.settings ?? {}) })
      setTranslations({ ...((r.settings as { __i18n?: Translations })?.__i18n ?? {}) })
      setDirtyLocales(new Set())
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the form')
    } finally {
      setLoading(false)
    }
  }, [formId])

  useEffect(() => { void load() }, [load])

  const setName = useCallback((n: string) => { setNameState(n); setDirty(true) }, [])
  const setFields = useCallback((f: FormField[]) => { setFieldsState(f); setDirty(true) }, [])
  const updateField = useCallback((f: FormField) => { setFieldsState((cur) => cur.map((x) => (x.id === f.id ? f : x))); setDirty(true) }, [])
  const updateSettings = useCallback((patch: Record<string, unknown>) => { setSettings((s) => ({ ...s, ...patch })); setDirty(true) }, [])
  const replaceDefinition = useCallback((def: { name?: string; fields?: FormField[]; steps?: unknown; settings?: Record<string, unknown> }) => {
    if (typeof def.name === 'string' && def.name) setNameState(def.name)
    if (Array.isArray(def.fields)) setFieldsState(def.fields)
    setSettings((s) => ({ ...s, ...(def.settings ?? {}), steps: (def.steps as FormSettings['steps']) ?? undefined, notifications: (def.settings as FormSettings | undefined)?.notifications ?? s.notifications }))
    setDirty(true)
  }, [])
  const translate = useCallback((locale: string, path: string[], value: string) => {
    setTranslations((t) => setIn(t, locale, path, value))
    setDirtyLocales((prev) => new Set(prev).add(locale))
    setDirty(true)
  }, [])

  const save = useCallback(async (opts?: { publish?: boolean }): Promise<boolean> => {
    if (!formId) return false
    if (source === 'code') {
      toast.error('Defined in code', 'Edit app/forms and run tangen push; the builder only previews and embeds it.')
      return false
    }
    setSaving(true)
    try {
      const { __i18n: _i18n, ...plain } = settings as Record<string, unknown>
      const body: Record<string, unknown> = { name, fields, settings: plain }
      if (opts?.publish !== undefined) body.isLive = opts.publish
      const updated = await formsApi.patch(formId, body)
      for (const locale of dirtyLocales) {
        await formsApi.patch(formId, { i18n: translations[locale] ?? {} }, locale)
          .catch((e) => toast.error(`Could not save ${locale} translations`, (e as Error).message))
      }
      setRow(updated)
      setDirtyLocales(new Set())
      setDirty(false)
      if (opts?.publish !== undefined) setIsLive(opts.publish)
      toast.success(opts?.publish === true ? 'Form published' : opts?.publish === false ? 'Form unpublished' : 'Form saved')
      return true
    } catch (e) {
      toast.error('Could not save the form', (e as Error).message)
      return false
    } finally {
      setSaving(false)
    }
  }, [formId, source, name, fields, settings, translations, dirtyLocales])

  const setLive = useCallback(async (next: boolean) => {
    if (!formId) return
    if (source === 'code') { toast.error('Defined in code', `Set isLive: ${next} in app/forms/${row?.slug ?? 'the form'}.ts and run tangen push.`); return }
    setSaving(true)
    try {
      await formsApi.patch(formId, { isLive: next })
      setIsLive(next)
      toast.success(next ? 'Form published' : 'Form unpublished', next ? 'It accepts submissions now.' : 'It no longer accepts submissions.')
    } catch (e) {
      toast.error('Could not change the status', (e as Error).message)
    } finally {
      setSaving(false)
    }
  }, [formId, source, row?.slug])

  return {
    loading, saving, error, row, name, source, isLive, fields, settings, translations, dirty,
    readOnly: source === 'code',
    setName, setFields, updateField, updateSettings, replaceDefinition, translate, save, setLive, reload: load,
  }
}
