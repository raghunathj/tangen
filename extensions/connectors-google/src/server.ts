/**
 * File Name: server.ts
 * Purpose: What the pack contributes (plan-connectors C1-C4): the connector,
 *          two typed services, and two Flow actions. Three ways to reach one
 *          Google connection - code through a service, no-code through a flow,
 *          and the raw authenticated client for anything unusual - and all
 *          three go through the same capability check.
 *
 *          The flow actions ask for a connection and a resource with the
 *          platform's own config field kinds, so the builder renders the same
 *          pickers an extension's settings form does and stores ids.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { defineExtensionServer } from '@tangen/cms'
import { GOOGLE_CAPABILITIES, GOOGLE_SEARCH_CONSOLE_SERVICE, GOOGLE_SHEETS_SERVICE, type SheetsRow } from './contract'
import { googleOAuthConnector, GOOGLE_BRAND } from './connector'
import { createSheetsService } from './sheets'
import { createSearchConsoleService } from './search-console'

/** A flow's config value as the builder stores it: an id, or nothing yet. */
const id = (config: Record<string, unknown>, key: string): string => {
  const v = config[key]
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`This step needs '${key}' to be chosen`)
  return v.trim()
}

const cell = (v: unknown) => (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v))

/**
 * What a flow author put in the Row field, which is a json field because that
 * is the only place `{{tokens}}` can be composed. Three shapes are accepted,
 * because all three are things a person reasonably writes:
 *
 *   { "Email": "{{trigger.email}}" }   by column name, matched to the header
 *   ["ada@acme.test", 3]               by position, left to right
 *   [["a"], ["b"]]                     several rows at once
 *
 * The object form is the one worth having: a flow author should not have to
 * count columns, and reordering the columns in Google then moves nothing.
 */
function rowInput(value: unknown): { records: Array<Record<string, unknown>> } | { rows: SheetsRow[] } {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>
    if (Object.keys(record).length === 0) throw new Error("'Row' is empty: give a column and a value, like { \"Email\": \"{{trigger.email}}\" }")
    return { records: [record] }
  }
  if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    return { records: parsed as Array<Record<string, unknown>> }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("'Row' must be a JSON object keyed by column name, like { \"Email\": \"{{trigger.email}}\" }, or an array of cell values, like [\"ada@acme.test\", 3]")
  }
  const rows = Array.isArray(parsed[0]) ? (parsed as unknown[][]) : [parsed as unknown[]]
  return { rows: rows.map((row) => row.map(cell)) }
}

export default defineExtensionServer({
  contributions: {
    'connectors@1': [googleOAuthConnector],

    // C4: the no-code path. The pickers come from the platform, so the builder
    // asks "which Google connection" and "which spreadsheet" with real lists.
    'flow.actions@1': [
      {
        name: 'google_sheets_append_row',
        label: 'Append row to Google Sheet',
        description: 'Adds a row to the bottom of a tab. It never edits or deletes what is already there.',
        configFields: [
          { key: 'connection', label: 'Google account', kind: 'connection', connector: 'google', capabilities: [GOOGLE_CAPABILITIES.sheetsAppend] },
          { key: 'spreadsheet', label: 'Spreadsheet', kind: 'resource', connector: 'google', resource: 'spreadsheet', dependsOn: 'connection' },
          { key: 'tab', label: 'Tab', kind: 'resource', connector: 'google', resource: 'tab', dependsOn: 'connection', parent: 'spreadsheet' },
          { key: 'row', label: 'Row: { "Column name": "value" } or ["value", "value"], {{tokens}} allowed', kind: 'json' },
        ],
        output: [
          { key: 'range', label: 'Range written', type: 'string' },
          { key: 'rows', label: 'Rows added', type: 'number' },
        ],
        handler: async (config, ctx) => {
          const sheets = createSheetsService(ctx)
          const where = {
            connectionId: id(config, 'connection'),
            spreadsheetId: id(config, 'spreadsheet'),
            ...(typeof config.tab === 'string' && config.tab ? { tab: config.tab } : {}),
            ...(config.parseInput === true ? { parseInput: true } : {}),
          }
          const input = rowInput(config.row)
          // By column name when that is what the author wrote, by position
          // when it is not. Same append either way.
          return 'records' in input
            ? sheets.appendRecords({ ...where, records: input.records })
            : sheets.appendRows({ ...where, rows: input.rows })
        },
      },
      {
        name: 'google_search_console_query',
        label: 'Query Search Console',
        description: 'Reads clicks, impressions and positions for a property over a window.',
        configFields: [
          { key: 'connection', label: 'Google account', kind: 'connection', connector: 'google', capabilities: [GOOGLE_CAPABILITIES.searchConsoleRead] },
          { key: 'property', label: 'Property', kind: 'resource', connector: 'google', resource: 'property', dependsOn: 'connection' },
          { key: 'startDate', label: 'From', kind: 'date' },
          { key: 'endDate', label: 'To', kind: 'date' },
          { key: 'rowLimit', label: 'Rows', kind: 'number' },
        ],
        output: [{ key: 'rows', label: 'Rows', type: 'array' }],
        handler: async (config, ctx) => ({
          rows: await createSearchConsoleService(ctx).query({
            connectionId: id(config, 'connection'),
            siteUrl: id(config, 'property'),
            startDate: String(config.startDate ?? ''),
            endDate: String(config.endDate ?? ''),
            ...(Number(config.rowLimit) > 0 ? { rowLimit: Number(config.rowLimit) } : {}),
          }),
        }),
      },
    ],

    /**
     * D1: the same append, offered where the work starts. A host (Forms)
     * renders this on a form; Flows builds the graph and owns everything
     * afterwards - the run history, the retries, the logs - so there is no
     * second executor and nothing for this pack to keep.
     *
     * The graph is deliberately plain: the form's own submissions, then one
     * append. An operator can open it in the builder and change anything,
     * because it is an ordinary flow from the moment it is created.
     */
    'flow.presets@1': [
      {
        id: 'google.sheets.form-submissions',
        label: 'Send submissions to a Google Sheet',
        description: 'Appends a row for every submission of this form. Choose the account, the spreadsheet and the tab; the columns are matched by name.',
        icon: 'IconTable',
        // The provider's own mark, so a form's destination list shows Google
        // and Slack rather than two grey glyphs.
        brand: { ...GOOGLE_BRAND },
        appliesTo: { trigger: 'form.submitted', scope: 'form' },
        configFields: [
          { key: 'connection', label: 'Google account', kind: 'connection', connector: 'google', capabilities: [GOOGLE_CAPABILITIES.sheetsAppend] },
          { key: 'spreadsheet', label: 'Spreadsheet', kind: 'resource', connector: 'google', resource: 'spreadsheet', dependsOn: 'connection' },
          { key: 'tab', label: 'Tab', kind: 'resource', connector: 'google', resource: 'tab', dependsOn: 'connection', parent: 'spreadsheet' },
          { key: 'row', label: 'Row: { "Column name": "{{trigger.submission.values.field}}" }', kind: 'json' },
        ],
        build: ({ config, scope }) => ({
          name: 'Form submissions to Google Sheets',
          nodes: [
            { id: 'trigger_1', kind: 'trigger', position: { x: 0, y: 0 }, data: { type: 'form.submitted' } },
            // One form, not every form: a destination added to THIS form must
            // never quietly collect another form's submissions.
            { id: 'this_form', kind: 'condition', position: { x: 0, y: 140 }, data: { conditions: [{ path: 'trigger.payload.formId', op: 'eq', value: scope.id }] } },
            { id: 'append_1', kind: 'action', position: { x: 0, y: 280 }, data: { action: 'google_sheets_append_row', config } },
          ],
          edges: [
            { id: 'edge_1', from: 'trigger_1', to: 'this_form' },
            { id: 'edge_2', from: 'this_form', to: 'append_1', outlet: 'yes' },
          ],
        }),
      },
    ],
  },

  /**
   * C3: the services are provided as FACTORIES, so each is built with the
   * calling extension's execution and this pack's own ctx - the caller never
   * borrows the pack's authority, and the pack never borrows the caller's.
   */
  onStart: async (ctx) => {
    ctx.services?.provide(GOOGLE_SHEETS_SERVICE, () => createSheetsService(ctx))
    ctx.services?.provide(GOOGLE_SEARCH_CONSOLE_SERVICE, () => createSearchConsoleService(ctx))
  },
})
