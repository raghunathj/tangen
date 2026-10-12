/**
 * File Name: form-options.ts
 * Purpose: Resolves form field options from data sources — the declarative
 *   `optionsFrom: { source: 'content', ... }` (published objects via the local
 *   tangen client) today; code-level option functions join via the forms
 *   behavior registry (Forms v2 Phase 4). One resolver feeds the public
 *   schema endpoint, embed rendering, and submit-time membership validation.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: results are Redis-cached briefly (public embeds may
 *   resolve on every render); limits are clamped server-side.
 */
import type { FormField, FormFieldOption } from './contract'

const MAX_OPTIONS = 200
const CACHE_TTL_SECONDS = 60

export interface FormOptionsDeps {
  /** Local tangen client scoped to the form's workspace/env. */
  tangen: { objects: (type: string) => any } | null
  /** Code-side option functions for this form (forms behavior registry). */
  optionFns?: Record<string, (ctx: { tangen: unknown; env: string; workspaceId: string }) => Promise<Array<{ label: string; value: string }>> | Array<{ label: string; value: string }>>
  workspaceId?: string
  env?: string
  redis?: {
    get: (k: string) => Promise<string | null>
    set: (k: string, v: string, mode: string, ttl: number) => Promise<unknown>
  } | null
  /** Cache key scope (workspace:env) — required when redis is provided. */
  cacheScope?: string
}

/**
 * Resolves one field's options: static list as-is; `optionsFrom` content
 * sources query published objects and map label/value fields.
 */
export async function resolveFormFieldOptions(
  field: FormField,
  deps: FormOptionsDeps,
): Promise<FormFieldOption[] | undefined> {
  // Tier 2: a code-side option function registered for this field wins
  const fn = deps.optionFns?.[field.name]
  if (fn) {
    const out = await fn({ tangen: deps.tangen, env: deps.env ?? '', workspaceId: deps.workspaceId ?? '' })
    return (out ?? []).map((o) => ({ label: String(o.label), value: String(o.value) }))
  }

  const from = field.optionsFrom
  if (!from || from.source !== 'content' || !deps.tangen) return field.options

  const labelField = from.labelField ?? 'title'
  const valueField = from.valueField ?? 'id'
  const limit = Math.min(Math.max(1, from.limit ?? 100), MAX_OPTIONS)

  const cacheKey = deps.redis && deps.cacheScope
    ? `tangen:formopts:${deps.cacheScope}:${JSON.stringify([from.type, labelField, valueField, from.filter, from.sort, limit])}`
    : null
  if (cacheKey) {
    const cached = await deps.redis!.get(cacheKey).catch(() => null)
    if (cached) {
      try { return JSON.parse(cached) as FormFieldOption[] } catch { /* fall through */ }
    }
  }

  let q = deps.tangen.objects(from.type).status('published').limit(limit)
  if (from.filter) q = q.where(from.filter)
  q = q.sort(from.sort ?? 'title', 'asc')

  const result = await q.get()
  const options: FormFieldOption[] = (result.data ?? [])
    .map((row: Record<string, unknown>) => ({
      label: String(row[labelField] ?? row.title ?? row.id ?? ''),
      value: String(row[valueField] ?? row.id ?? ''),
    }))
    .filter((o: FormFieldOption) => o.value !== '')

  if (cacheKey) {
    deps.redis!.set(cacheKey, JSON.stringify(options), 'EX', CACHE_TTL_SECONDS).catch(() => {})
  }
  return options
}

/**
 * Returns a copy of the fields with every `optionsFrom` materialized into a
 * concrete options list (used by schema/embed responses and before submit).
 */
export async function materializeFormOptions(
  fields: FormField[],
  deps: FormOptionsDeps,
): Promise<FormField[]> {
  return Promise.all(fields.map(async (f) => {
    if (!f.optionsFrom && !deps.optionFns?.[f.name]) return f
    const options = await resolveFormFieldOptions(f, deps).catch(() => f.options)
    return { ...f, options: options ?? [] }
  }))
}

/**
 * Choice fields with a known options list only accept listed values (empty
 * passes — required-ness is validateField's concern).
 */
export function validateOptionMembership(field: FormField, value: unknown): string | null {
  if (!['select', 'multiselect', 'radio'].includes(field.type)) return null
  const options = field.options
  if (!options || options.length === 0) return null
  const allowed = new Set(options.map((o) => o.value))
  const values = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [String(value)]
  for (const v of values) {
    if (!allowed.has(String(v))) return `${field.label}: "${v}" is not a valid option`
  }
  return null
}
