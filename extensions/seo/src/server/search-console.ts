/**
 * File Name: search-console.ts
 * Purpose: Search Console for the SEO manager, through the GOOGLE CONNECTOR
 *          PACK (plan-connectors F2).
 *
 *          SEO used to offer its own `google-search-console` connector and
 *          speak the API itself. It no longer does either: the pack owns the
 *          provider, its `google.search-console@1` service owns the API, and
 *          this module only decides WHICH connection to read and says
 *          honestly what is missing when it cannot.
 *
 *          That is the whole point of the connector programme from a
 *          consumer's side - an extension that wants Search Console asks for
 *          a capability and gets a typed service, and knows nothing about
 *          OAuth, scopes, refresh, or Google's URLs.
 *
 *          Nothing is lost by the move. An operator's existing connection is
 *          ADOPTED by the pack (`supersedes`), so the same account, the same
 *          consent and the same id already stored in these settings keep
 *          working.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionServerCtx } from '@tangen/cms'

/**
 * The half of `google.search-console@1` this extension uses, declared HERE.
 *
 * Not imported from the pack, deliberately: SEO must build, install and run in
 * a project that has no Google pack at all, and a package it imported would be
 * a runtime dependency on something optional. A service contract is a shape,
 * and this is the shape SEO asks for - the platform hands over whatever the
 * active provider registered under that ref.
 */
interface SearchConsoleService {
  listSites(input: { connectionId: string }): Promise<SearchConsoleSite[]>
  query(input: {
    connectionId: string
    siteUrl: string
    startDate: string
    endDate: string
    dimensions?: string[]
    rowLimit?: number
  }): Promise<SearchConsoleRow[]>
}

export interface SearchConsoleSite { siteUrl: string; permissionLevel: string }
export interface SearchConsoleRow { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }

/** The pack's service, and the capability a connection needs for it. */
export const SEARCH_CONSOLE_SERVICE = 'google.search-console@^1'
export const SEARCH_CONSOLE_CAPABILITY = 'google.search-console.read'
/** The provider a connection belongs to, for the picker and for resolution. */
export const SEARCH_CONSOLE_PROVIDER = 'google'

/** The row shape the analytics sync stores. Unchanged by the move. */
export interface SearchAnalyticsRow extends SearchConsoleRow {}

export interface SearchAnalyticsQuery {
  siteUrl: string
  startDate: string
  endDate: string
  dimensions: Array<'date' | 'page' | 'query' | 'country' | 'device'>
  rowLimit?: number
}

export type SearchConsoleStatus =
  | { connected: true; connectionId: string; label: string; property: string | null }
  | { connected: false; reason: string }

/** What this module hands back: the status, and - when there is one - a reader. */
export interface SearchConsoleReader {
  listSites(): Promise<SearchConsoleSite[]>
  query(q: SearchAnalyticsQuery): Promise<SearchAnalyticsRow[]>
}

const PACK_MISSING =
  'Search Console needs the Google connector pack: install @tangen/connectors-google and enable it, then connect a Google account under Settings > Connections. Everything else in SEO works without it.'

/**
 * The connection the operator chose (SEO Manager > Settings), else the
 * provider's first usable one - with a reason an operator can act on when
 * there is none.
 *
 * Three quite different absences, told apart rather than merged: the pack is
 * not here, the grant was not approved, or nothing is connected yet.
 */
export async function searchConsoleConnection(
  ctx: ExtensionServerCtx,
): Promise<{ status: SearchConsoleStatus; reader?: SearchConsoleReader }> {
  const service = ctx.services?.get<SearchConsoleService>(SEARCH_CONSOLE_SERVICE)
  if (!service) return { status: { connected: false, reason: PACK_MISSING } }
  if (!ctx.connections) {
    return {
      status: {
        connected: false,
        reason: `Reading Search Console needs the ${SEARCH_CONSOLE_CAPABILITY} grant: approve it with \`tangen extension upgrade seo --approve-optional connections:${SEARCH_CONSOLE_CAPABILITY}\`.`,
      },
    }
  }

  const settings: Record<string, unknown> = (await ctx.settings?.get().catch(() => ({}))) ?? {}
  const chosenId = typeof settings.searchConsole === 'string' && settings.searchConsole ? settings.searchConsole : undefined
  const property = typeof settings.searchConsoleProperty === 'string' && settings.searchConsoleProperty.trim()
    ? settings.searchConsoleProperty.trim()
    : null

  // The platform's own derivation says what the state is and why, in the same
  // words the Connections page and every picker show - so SEO never invents a
  // second explanation for the same situation.
  const available = await ctx.connections.availability?.(SEARCH_CONSOLE_CAPABILITY)
  let conn: Awaited<ReturnType<NonNullable<ExtensionServerCtx['connections']>['get']>>
  try {
    conn = await ctx.connections.get(SEARCH_CONSOLE_PROVIDER, {
      ...(chosenId ? { id: chosenId } : {}),
      capabilities: ['search-console.read'],
    })
  } catch (e) {
    return { status: { connected: false, reason: (e as Error).message } }
  }
  if (!conn) {
    return {
      status: {
        connected: false,
        reason: chosenId
          ? 'The Google connection chosen on the SEO Manager\'s Settings tab no longer exists or is not active.'
          : available?.reason ?? 'No Google connection yet: add one under Settings > Connections.',
      },
    }
  }

  const connectionId = conn.id
  return {
    status: { connected: true, connectionId, label: conn.label, property },
    reader: {
      listSites: () => service.listSites({ connectionId }),
      query: (q) => service.query({
        connectionId,
        siteUrl: q.siteUrl,
        startDate: q.startDate,
        endDate: q.endDate,
        ...(q.dimensions ? { dimensions: q.dimensions as never } : {}),
        ...(q.rowLimit ? { rowLimit: q.rowLimit } : {}),
      }),
    },
  }
}
