/**
 * File Name: api.ts
 * Purpose: The Forms admin's one view of the extension's admin routes
 *          (/api/v1/admin/ext/forms/...): typed calls the pages share, and
 *          the shapes they read. Nothing here knows a component.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { adminFetch, adminFetchFile } from '@/kit'
import type { FormField, FormSettings } from '../contract'

export const BASE = '/admin/ext/forms'

export interface FormRow {
  id: string
  name: string
  slug: string
  source?: 'admin' | 'code' | string
  isLive?: boolean
  fields: FormField[]
  settings: FormSettings & Record<string, unknown>
  submissionCount?: number
  createdAt: string
  updatedAt: string
}

export interface Submission {
  id: string
  formId: string
  data: Record<string, unknown>
  ipAddress?: string | null
  notes?: string | null
  createdAt: string
}

export interface EmbedUrls {
  id: string
  slug: string
  requireApiKey: boolean
  styled: string
  appless: string
  schema: string
  submit: string
  keyedSchema: string
  keyedSubmit: string
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const formsApi = {
  list: () => adminFetch<{ data: FormRow[] }>(BASE).then((r) => r.data),
  get: (id: string) => adminFetch<{ data: FormRow }>(`${BASE}/${id}`).then((r) => r.data),
  create: (name: string) => adminFetch<{ data: FormRow }>(BASE, json({ name })).then((r) => r.data),
  patch: (id: string, body: Record<string, unknown>, locale?: string) =>
    adminFetch<{ data: FormRow }>(`${BASE}/${id}`, { ...json(body), method: 'PATCH' }, locale ? { locale } : undefined).then((r) => r.data),
  remove: (id: string) => adminFetch(`${BASE}/${id}`, { method: 'DELETE' }),
  embed: (id: string) => adminFetch<{ data: EmbedUrls }>(`${BASE}/${id}/embed`).then((r) => r.data),
  submissions: (formId: string, query: Record<string, string>) =>
    adminFetch<{ data: Submission[]; meta: { total: number } }>(`${BASE}/${formId}/submissions`, undefined, query),
  deleteSubmission: (formId: string, id: string) => adminFetch(`${BASE}/${formId}/submissions/${id}`, { method: 'DELETE' }),
  saveNotes: (formId: string, id: string, notes: string) =>
    adminFetch<{ data: Submission }>(`${BASE}/${formId}/submissions/${id}`, { ...json({ notes: notes.trim() === '' ? null : notes }), method: 'PATCH' }).then((r) => r.data),
  generate: (body: { prompt: string; mode: 'create' | 'edit'; current?: unknown }) =>
    adminFetch<{ data: { definition: Record<string, unknown>; provider: string; model: string } }>(`${BASE}/generate`, json(body)).then((r) => r.data),
  /** The CSV export as a Blob, through the same authenticated fetch the admin uses. */
  /** The CSV export as a Blob: the current filter, or a selection of ids. */
  exportCsv: async (formId: string, filter: Record<string, unknown> = {}): Promise<Blob> => {
    const res = await adminFetchFile(`${BASE}/${formId}/submissions/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(filter) })
    return res.blob()
  },
  labelSuggestions: (q: string) => adminFetch<{ data: { labels: string[] } }>('/labels/suggest', undefined, { entityType: 'submission', ...(q ? { q } : {}) }).then((r) => r.data?.labels ?? []),
}

export function relativeTime(iso: string | Date | undefined | null): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} d ago`
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatValue(v: unknown, optionLabels?: Record<string, string>): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map((x) => formatValue(x, optionLabels)).join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  if (v === true) return 'Yes'
  if (v === false) return 'No'
  const s = String(v)
  return optionLabels?.[s] ?? s
}

/** Field name → option value → option label, so a choice reads as the person saw it, not as its stored value. */
export function optionLabelsOf(fields: Array<{ name: string; options?: Array<{ value: string; label: string }> }> | undefined): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const f of fields ?? []) {
    if (!f.name || !f.options?.length) continue
    out[f.name] = Object.fromEntries(f.options.map((o) => [o.value, o.label]))
  }
  return out
}

/** Field name → label, for submissions rendered by their human labels. */
export function labelMapOf(fields: Array<{ name: string; label?: string }> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of fields ?? []) if (f.name) out[f.name] = f.label ?? f.name
  return out
}
