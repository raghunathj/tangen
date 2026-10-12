/**
 * File Name: redirects-csv.ts
 * Purpose: Redirects as a spreadsheet (plan-seo-manager-v2 V7), pure. Three
 *          columns - from, to, status - which is what an operator migrating
 *          from another CMS already has. Parsing is strict about the shape
 *          and honest about every row it could not read: a partial import
 *          says which line failed and why, rather than dropping it quietly.
 *
 * Author: Raghunath J
 * License: MIT
 */

export const REDIRECT_CSV_HEADER = 'from,to,status'

export interface CsvRedirect {
  source: string
  url: string
  status: 301 | 302
}

export interface CsvParse {
  rows: CsvRedirect[]
  /** One per line that could not be read, in file order. */
  errors: Array<{ line: number; message: string }>
}

const quote = (value: string): string => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

/** Every redirect as a CSV file, header first. An internal destination is exported as the resolved URL when there is one. */
export function toRedirectCsv(rows: ReadonlyArray<{ source: string; destination: { kind: string; url?: string }; status: number }>): string {
  const lines = [REDIRECT_CSV_HEADER]
  for (const row of rows) {
    lines.push([quote(row.source), quote(row.destination?.url ?? ''), String(row.status === 302 ? 302 : 301)].join(','))
  }
  return `${lines.join('\n')}\n`
}

/** One CSV line into fields, honouring quotes and doubled quotes. */
function splitLine(line: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1 } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { out.push(field); field = '' }
    else field += ch
  }
  out.push(field)
  return out.map((f) => f.trim())
}

/**
 * A CSV file into redirects. The header is optional but respected when
 * present; a row needs a from and a to, and a status that is 301 or 302
 * (301 when it is absent).
 */
export function parseRedirectCsv(text: string): CsvParse {
  const rows: CsvRedirect[] = []
  const errors: CsvParse['errors'] = []
  const lines = String(text ?? '').split(/\r?\n/)
  const seen = new Set<string>()
  lines.forEach((raw, index) => {
    const line = raw.trim()
    if (!line) return
    const lineNumber = index + 1
    const fields = splitLine(line)
    const [from, to, status] = fields
    if (index === 0 && from?.toLowerCase() === 'from') return
    if (!from || !to) { errors.push({ line: lineNumber, message: 'needs a from and a to' }); return }
    if (!from.startsWith('/')) { errors.push({ line: lineNumber, message: `from must be a path starting with "/" (got "${from}")` }); return }
    if (!/^https?:\/\//i.test(to)) { errors.push({ line: lineNumber, message: `to must be an http or https URL (got "${to}")` }); return }
    const code = status ? Number(status) : 301
    if (code !== 301 && code !== 302) { errors.push({ line: lineNumber, message: `status must be 301 or 302 (got "${status}")` }); return }
    if (seen.has(from)) { errors.push({ line: lineNumber, message: `"${from}" appears more than once in this file` }); return }
    seen.add(from)
    rows.push({ source: from, url: to, status: code })
  })
  return { rows, errors }
}
