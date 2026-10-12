/**
 * File Name: contract.ts
 * Purpose: What a CONSUMER imports (plan-connectors C3). A site or another
 *          extension reaching Google through this pack types itself against
 *          these interfaces and the capability names, and never against the
 *          pack's server module: the provider's protocol is the pack's
 *          business, and a consumer's business is the operation and the
 *          capability it needs.
 *
 *          Nothing here imports the Admin, React or the pack's server, so a
 *          site project can import it and still typecheck.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** The provider id: what a grant and a connection picker name. */
export const GOOGLE_PROVIDER = 'google'

/** The connector: provider plus auth model, the normalized grammar. */
export const GOOGLE_OAUTH_CONNECTOR = 'google.oauth'

/**
 * The capabilities this pack declares, provider-relative. A consumer declares
 * the qualified form as a grant (`connections:google.sheets.append`) and
 * passes the bare form to `ctx.connections.get(...)`.
 */
export const GOOGLE_CAPABILITIES = {
  /** Read a spreadsheet you already have the id of: its tabs and its cells. */
  sheetsRead: 'sheets.read',
  /**
   * LIST and search the spreadsheets in the account. Separate from
   * `sheetsRead` because Google separates them: the Sheets API cannot
   * enumerate spreadsheets and Drive can, and real Google lets a person
   * approve one without the other (found in the 2026-09-19 acceptance run).
   */
  sheetsBrowse: 'sheets.browse',
  sheetsAppend: 'sheets.append',
  searchConsoleRead: 'search-console.read',
} as const

/** The typed services this pack provides. */
export const GOOGLE_SHEETS_SERVICE = 'google.sheets@1'
export const GOOGLE_SEARCH_CONSOLE_SERVICE = 'google.search-console@1'

export interface SheetsSpreadsheet { id: string; name: string }
export interface SheetsTab { id: string; title: string }

/** One append: the values of one row, left to right, as the sheet stores them. */
export type SheetsRow = Array<string | number | boolean | null>

export interface AppendRowsInput {
  /** The connection an operator chose (a connection id, never a label). */
  connectionId: string
  spreadsheetId: string
  /** The tab's title. Omit for the first tab. */
  tab?: string
  rows: SheetsRow[]
  /** Treat the values as typed by a person (formulas, dates) rather than as raw text. */
  parseInput?: boolean
}

/**
 * Append a row by COLUMN NAME rather than by position. The tab's first row is
 * read and each key placed under its matching header, so a flow author writes
 * `{ "Email": "{{trigger.email}}" }` and never has to count columns - and
 * reordering the columns in Google does not silently move the data.
 */
export interface AppendRecordsInput {
  connectionId: string
  spreadsheetId: string
  /** The tab's title. Omit for the first tab. */
  tab?: string
  records: Array<Record<string, unknown>>
  parseInput?: boolean
}

export interface AppendRowsResult {
  /** The range the provider says it wrote, e.g. `Sheet1!A4:C4`. */
  range: string
  rows: number
}

/** `google.sheets@1`: what another extension calls, with no Google knowledge. */
export interface GoogleSheetsService {
  listSpreadsheets(input: { connectionId: string; query?: string; limit?: number }): Promise<SheetsSpreadsheet[]>
  listTabs(input: { connectionId: string; spreadsheetId: string }): Promise<SheetsTab[]>
  /** The tab's header row, left to right, as the sheet spells it. */
  listColumns(input: { connectionId: string; spreadsheetId: string; tab?: string }): Promise<string[]>
  appendRows(input: AppendRowsInput): Promise<AppendRowsResult>
  /** By column name: needs the tab to have a header row. */
  appendRecords(input: AppendRecordsInput): Promise<AppendRowsResult>
}

export interface SearchConsoleSite { siteUrl: string; permissionLevel: string }

export interface SearchConsoleQueryInput {
  connectionId: string
  /** The property, exactly as Search Console spells it (`sc-domain:acme.com`). */
  siteUrl: string
  startDate: string
  endDate: string
  dimensions?: Array<'query' | 'page' | 'country' | 'device' | 'date'>
  rowLimit?: number
}

export interface SearchConsoleRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/** `google.search-console@1`: read-only, the half the SEO manager needs. */
export interface GoogleSearchConsoleService {
  listSites(input: { connectionId: string }): Promise<SearchConsoleSite[]>
  query(input: SearchConsoleQueryInput): Promise<SearchConsoleRow[]>
}
