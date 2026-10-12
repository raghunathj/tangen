/**
 * File Name: search-console.ts
 * Purpose: `google.search-console@1` (plan-connectors C3): the read-only half
 *          the SEO manager needs - which properties the account may read, and
 *          one query over a window. Read-only on purpose: nothing here can
 *          submit, verify or change a property.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionServerCtx } from '@tangen/cms'
import { GOOGLE_CAPABILITIES, GOOGLE_PROVIDER, type GoogleSearchConsoleService, type SearchConsoleQueryInput, type SearchConsoleRow, type SearchConsoleSite } from './contract'
import { GoogleConnectionMissing } from './sheets'

const DATE = /^\d{4}-\d{2}-\d{2}$/
/** Search Console's own ceiling for one request. */
const MAX_ROWS = 25_000

async function readJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let detail = body.slice(0, 200)
    try { detail = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? detail } catch { /* not JSON */ }
    throw new Error(`Google refused to ${what} (${res.status}): ${detail}`)
  }
  return (await res.json()) as T
}

export function createSearchConsoleService(ctx: ExtensionServerCtx): GoogleSearchConsoleService {
  const open = async (connectionId: string) => {
    const conn = await ctx.connections?.get(GOOGLE_PROVIDER, { id: connectionId, capabilities: [GOOGLE_CAPABILITIES.searchConsoleRead] })
    if (!conn) throw new GoogleConnectionMissing(connectionId)
    return conn
  }
  return {
    async listSites({ connectionId }) {
      const conn = await open(connectionId)
      const answer = await readJson<{ siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }> }>(
        await conn.request('https://searchconsole.googleapis.com/webmasters/v3/sites'), 'list your Search Console properties',
      )
      return (answer.siteEntry ?? [])
        .map<SearchConsoleSite>((s) => ({ siteUrl: String(s.siteUrl ?? ''), permissionLevel: String(s.permissionLevel ?? '') }))
        .filter((s) => s.siteUrl !== '')
    },

    async query(input: SearchConsoleQueryInput): Promise<SearchConsoleRow[]> {
      for (const [key, value] of [['startDate', input.startDate], ['endDate', input.endDate]] as const) {
        if (!DATE.test(String(value))) throw new Error(`${key} must be a date as YYYY-MM-DD`)
      }
      if (!input.siteUrl) throw new Error('siteUrl must be the property exactly as Search Console spells it')
      const conn = await open(input.connectionId)
      const answer = await readJson<{ rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }> }>(
        await conn.request(
          `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(input.siteUrl)}/searchAnalytics/query`,
          {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              startDate: input.startDate, endDate: input.endDate,
              dimensions: input.dimensions ?? ['query'],
              rowLimit: Math.min(Math.max(input.rowLimit ?? 100, 1), MAX_ROWS),
            }),
          },
        ),
        'read that property',
      )
      return (answer.rows ?? []).map<SearchConsoleRow>((r) => ({
        keys: r.keys ?? [],
        clicks: Number(r.clicks ?? 0), impressions: Number(r.impressions ?? 0),
        ctr: Number(r.ctr ?? 0), position: Number(r.position ?? 0),
      }))
    },
  }
}
