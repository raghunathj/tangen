/**
 * File Name: sheets.ts
 * Purpose: `google.sheets@1` (plan-connectors C3): the three operations another
 *          extension needs, each asserting the CAPABILITY it requires before
 *          the provider is called. A consumer passes the connection an
 *          operator chose and the ids from the pickers; it never sees a scope
 *          string, a token or a Google URL.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionServerCtx } from '@tangen/cms'
import { GOOGLE_CAPABILITIES, GOOGLE_PROVIDER, type AppendRecordsInput, type AppendRowsInput, type AppendRowsResult, type GoogleSheetsService, type SheetsSpreadsheet, type SheetsTab } from './contract'

/** The one refusal a consumer sees when nothing is configured; everything else throws by name. */
export class GoogleConnectionMissing extends Error {
  constructor(readonly connectionId: string) {
    super(`No usable Google connection '${connectionId}'. Connect Google under Settings > Connections, or choose another connection.`)
    this.name = 'GoogleConnectionMissing'
  }
}

/** An authed client over the connection an operator chose, or a refusal that says what to do. */
async function open(ctx: ExtensionServerCtx, connectionId: string, capabilities: string[]) {
  const conn = await ctx.connections?.get(GOOGLE_PROVIDER, { id: connectionId, capabilities })
  if (!conn) throw new GoogleConnectionMissing(connectionId)
  return conn
}

async function readJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let detail = body.slice(0, 200)
    try { detail = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? detail } catch { /* not JSON */ }
    throw new Error(`Google refused to ${what} (${res.status}): ${detail}`)
  }
  return (await res.json()) as T
}

export function createSheetsService(ctx: ExtensionServerCtx): GoogleSheetsService {
  return {
    async listSpreadsheets({ connectionId, query, limit }) {
      // Finding spreadsheets is Drive, not Sheets (see the capability map).
      const conn = await open(ctx, connectionId, [GOOGLE_CAPABILITIES.sheetsBrowse])
      const params = new URLSearchParams({
        q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
        fields: 'files(id,name)', pageSize: String(Math.min(Math.max(limit ?? 25, 1), 100)), orderBy: 'modifiedTime desc',
      })
      if (query) params.set('q', `${params.get('q')} and name contains '${query.replace(/'/g, "\\'")}'`)
      const answer = await readJson<{ files?: Array<{ id: string; name: string }> }>(
        await conn.request(`https://www.googleapis.com/drive/v3/files?${params.toString()}`), 'list your spreadsheets',
      )
      return (answer.files ?? []).map<SheetsSpreadsheet>((f) => ({ id: f.id, name: f.name }))
    },

    async listTabs({ connectionId, spreadsheetId }) {
      const conn = await open(ctx, connectionId, [GOOGLE_CAPABILITIES.sheetsRead])
      const answer = await readJson<{ sheets?: Array<{ properties?: { sheetId?: number; title?: string } }> }>(
        await conn.request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`),
        'read that spreadsheet',
      )
      return (answer.sheets ?? [])
        .map<SheetsTab>((s) => ({ id: String(s.properties?.title ?? s.properties?.sheetId ?? ''), title: String(s.properties?.title ?? '') }))
        .filter((t) => t.id !== '')
    },

    async listColumns({ connectionId, spreadsheetId, tab }) {
      const conn = await open(ctx, connectionId, [GOOGLE_CAPABILITIES.sheetsRead])
      // Row 1 of the tab: Sheets has no notion of a header, so the first row
      // is the convention every spreadsheet already uses.
      const range = tab ? `${tab}!1:1` : '1:1'
      const answer = await readJson<{ values?: string[][] }>(
        await conn.request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`),
        'read that tab\'s first row',
      )
      return (answer.values?.[0] ?? []).map((h) => String(h ?? '').trim())
    },

    async appendRecords(input: AppendRecordsInput): Promise<AppendRowsResult> {
      if (!Array.isArray(input.records) || input.records.length === 0) throw new Error('appendRecords needs at least one record')
      const columns = await this.listColumns({ connectionId: input.connectionId, spreadsheetId: input.spreadsheetId, ...(input.tab ? { tab: input.tab } : {}) })
      const named = columns.filter((c) => c !== '')
      if (named.length === 0) {
        throw new Error("That tab has no header row, so a row cannot be matched by column name. Put the column names in row 1, or give the row as a JSON array of cell values.")
      }
      // Case and spacing are how a person types a header, not how they mean
      // it, so the match forgives both. Anything else is named, with the
      // headers the tab actually has - guessing a column is how a spreadsheet
      // quietly fills with data in the wrong place.
      const index = new Map(named.map((c, i) => [c.toLowerCase(), i] as const))
      const rows = input.records.map((record) => {
        const row: Array<string | number | boolean | null> = Array(named.length).fill('')
        for (const [key, value] of Object.entries(record)) {
          const at = index.get(key.trim().toLowerCase())
          if (at === undefined) {
            throw new Error(`That tab has no column '${key}'. Its columns are ${named.map((c) => `'${c}'`).join(', ')}.`)
          }
          row[at] = value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : JSON.stringify(value)
        }
        return row
      })
      return this.appendRows({
        connectionId: input.connectionId, spreadsheetId: input.spreadsheetId,
        ...(input.tab ? { tab: input.tab } : {}), rows,
        ...(input.parseInput ? { parseInput: true } : {}),
      })
    },

    async appendRows(input: AppendRowsInput): Promise<AppendRowsResult> {
      if (!Array.isArray(input.rows) || input.rows.length === 0) throw new Error('appendRows needs at least one row')
      // Appending needs the append capability, which is a wider Google scope
      // than reading - so a connection consented read-only is refused here by
      // name, before Google is asked (A3).
      const conn = await open(ctx, input.connectionId, [GOOGLE_CAPABILITIES.sheetsAppend])
      // A1 in the tab's own name is Sheets' way of saying "the used range of
      // that tab"; Google finds the first empty row itself.
      const range = input.tab ? `${input.tab}!A1` : 'A1'
      const params = new URLSearchParams({
        valueInputOption: input.parseInput ? 'USER_ENTERED' : 'RAW',
        insertDataOption: 'INSERT_ROWS',
        fields: 'updates(updatedRange,updatedRows)',
      })
      const answer = await readJson<{ updates?: { updatedRange?: string; updatedRows?: number } }>(
        await conn.request(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(range)}:append?${params.toString()}`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values: input.rows }) },
        ),
        'add rows to that spreadsheet',
      )
      return { range: String(answer.updates?.updatedRange ?? range), rows: Number(answer.updates?.updatedRows ?? input.rows.length) }
    },
  }
}
