/**
 * File Name: submissions.ts
 * Purpose: The pure half of submissions: the list filter, the notes patch
 *          and the CSV export. The routes live in ./server.ts.
 *
 * Author: Raghunath J
 * License: MIT
 */
export function buildNotesUpdate(body: unknown): { notes: string | null } | null {
  if (!body || typeof body !== 'object') return null
  if (!('notes' in body)) return null
  const raw = (body as { notes?: unknown }).notes
  if (raw === null || raw === undefined) return { notes: null }
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return { notes: trimmed === '' ? null : raw }
}

export type LabelFilterOp = 'all' | 'any' | 'none' | 'contains' | 'starts' | 'ends'
const LABEL_OPS: LabelFilterOp[] = ['all', 'any', 'none', 'contains', 'starts', 'ends']

export interface SubmissionListFilter {
  formId: string | null
  from: string | null
  to: string | null
  limit: number
  offset: number
  /** Received date, newest first by default. */
  sort: 'asc' | 'desc'
  /** Labels the submission must carry, with the operator the content list uses. */
  labels: string[]
  labelsOp: LabelFilterOp
  /** The locales the form was sent in (recorded on the submission); any of them. */
  locales: string[]
  /** A given set of submissions (the export of a selection). */
  ids: string[] | null
  /** Free text over the submitted values and the notes. */
  q: string | null
}

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((s) => String(s).trim()).filter(Boolean)

export function buildSubmissionListFilter(params: Record<string, unknown>): SubmissionListFilter {
  const op = String(params.labelsOp ?? params.labelsop ?? 'all') as LabelFilterOp
  return {
    formId: (params.formId as string) ?? null,
    from: (params.from as string) ?? null,
    to: (params.to as string) ?? null,
    limit: Number(params.limit) || 25,
    offset: Number(params.offset) || 0,
    sort: params.sort === 'asc' ? 'asc' : 'desc',
    labels: list(params.labels),
    labelsOp: LABEL_OPS.includes(op) ? op : 'all',
    locales: list(params.locales ?? params.locale),
    ids: params.ids !== undefined ? list(params.ids) : null,
    q: typeof params.q === 'string' && params.q.trim() ? params.q.trim() : null,
  }
}

function csvCell(v: unknown): string {
  const str = v === null || v === undefined ? ''
    : v instanceof Date ? v.toISOString()
    : Array.isArray(v) ? v.join('; ')
    : typeof v === 'object' ? JSON.stringify(v)
    : String(v)
  return /[",\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str
}

export function buildSubmissionsCsv(
  fields: Array<{ name: string }>,
  submissions: Array<{ id: string; createdAt: unknown; ipAddress?: string | null; notes?: string | null; data: Record<string, unknown> }>,
  /** The team's labels by submission id; the `labels` column joins them with "; ". */
  labelsById: Record<string, string[]> = {},
): string {
  const known = fields.map((f) => f.name)
  const extra = new Set<string>()
  for (const s of submissions) {
    for (const k of Object.keys(s.data ?? {})) if (!known.includes(k)) extra.add(k)
  }
  // The person's answers first, then what the team added: labels and notes.
  const columns = ['id', 'createdAt', 'ipAddress', ...known, ...extra, 'labels', 'notes']
  const rows = submissions.map((s) => {
    const base: Record<string, unknown> = { id: s.id, createdAt: s.createdAt, ipAddress: s.ipAddress ?? '', labels: labelsById[s.id] ?? [], notes: s.notes ?? '' }
    return columns.map((c) => csvCell(c in base ? base[c] : (s.data ?? {})[c])).join(',')
  })
  return [columns.join(','), ...rows].join('\r\n')
}
