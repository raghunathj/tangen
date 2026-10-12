/**
 * File Name: connector.ts
 * Purpose: The Google connector (plan-connectors C2): ONE provider, one auth
 *          model, and the capabilities a connection to it may be authorized
 *          for. Declarative metadata plus narrow provider operations - a
 *          `request` that authenticates, a `health` that asks the cheapest
 *          question Google answers, and one `search` per resource an operator
 *          picks from. Core owns the credentials, the OAuth flow, the refresh,
 *          the sealing, the health sweep and the revocation.
 *
 *          Capabilities are provider-scoped, so `sheets.append` means the same
 *          thing whichever auth model an operator used, and they map to
 *          Google's scopes HERE so no consumer ever types one.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/cms for types only. No Admin, no React.
 */
import type { ConnectorContext, ConnectorDefinition, ResourcePage, ResourceRequest } from '@tangen/cms'
import { GOOGLE_OAUTH_CONNECTOR, GOOGLE_PROVIDER } from './contract'

/** Google's own hosts, and the only ones a connection of this connector reaches. */
export const GOOGLE_HOSTS = [
  'accounts.google.com',
  'oauth2.googleapis.com',
  'sheets.googleapis.com',
  'www.googleapis.com',
  'searchconsole.googleapis.com',
] as const

const SCOPE = {
  sheetsReadonly: 'https://www.googleapis.com/auth/spreadsheets.readonly',
  sheets: 'https://www.googleapis.com/auth/spreadsheets',
  driveMetadata: 'https://www.googleapis.com/auth/drive.metadata.readonly',
  searchConsoleReadonly: 'https://www.googleapis.com/auth/webmasters.readonly',
} as const

/** A provider answer, or a refusal an operator can read. */
async function readJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // Google puts a sentence in `error.message`; anything else is truncated
    // rather than pasted, and a token never appears in either.
    let detail = body.slice(0, 200)
    try { detail = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? detail } catch { /* not JSON */ }
    throw new Error(`Google refused to ${what} (${res.status}): ${detail}`)
  }
  return (await res.json()) as T
}

/**
 * Spreadsheets come from Drive, which is the only place Google will list them:
 * the Sheets API reads one spreadsheet at a time. Drive's metadata scope rides
 * with `sheets.read` for that reason.
 */
async function searchSpreadsheets(input: ResourceRequest, conn: ConnectorContext): Promise<ResourcePage> {
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: 'nextPageToken,files(id,name,modifiedTime)',
    pageSize: String(input.limit),
    orderBy: 'modifiedTime desc',
  })
  if (input.query) params.set('q', `${params.get('q')} and name contains '${input.query.replace(/'/g, "\\'")}'`)
  if (input.cursor) params.set('pageToken', input.cursor)
  const answer = await readJson<{ files?: Array<{ id: string; name: string; modifiedTime?: string }>; nextPageToken?: string }>(
    await conn.request!(`https://www.googleapis.com/drive/v3/files?${params.toString()}`), 'list your spreadsheets',
  )
  return {
    options: (answer.files ?? []).map((f) => ({
      id: f.id, label: f.name,
      ...(f.modifiedTime ? { hint: `changed ${f.modifiedTime.slice(0, 10)}` } : {}),
    })),
    ...(answer.nextPageToken ? { nextCursor: answer.nextPageToken } : {}),
  }
}

/** Tabs are properties of one spreadsheet, so this type is listed within it. */
async function searchTabs(input: ResourceRequest, conn: ConnectorContext): Promise<ResourcePage> {
  const answer = await readJson<{ sheets?: Array<{ properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number } } }> }>(
    await conn.request!(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(String(input.parent))}?fields=sheets.properties`),
    'read that spreadsheet',
  )
  const all = (answer.sheets ?? []).map((s) => ({
    id: String(s.properties?.title ?? s.properties?.sheetId ?? ''),
    label: String(s.properties?.title ?? s.properties?.sheetId ?? ''),
    ...(s.properties?.gridProperties?.rowCount ? { hint: `${s.properties.gridProperties.rowCount} rows` } : {}),
    parent: String(input.parent),
  })).filter((o) => o.id !== '')
  const matched = input.query ? all.filter((o) => o.label.toLowerCase().includes(input.query!.toLowerCase())) : all
  return { options: matched.slice(0, input.limit), ...(matched.length > input.limit ? { truncated: true } : {}) }
}

/** Search Console properties: what the connected account may read. */
async function searchProperties(input: ResourceRequest, conn: ConnectorContext): Promise<ResourcePage> {
  const answer = await readJson<{ siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }> }>(
    await conn.request!('https://searchconsole.googleapis.com/webmasters/v3/sites'), 'list your Search Console properties',
  )
  const all = (answer.siteEntry ?? []).map((s) => ({
    id: String(s.siteUrl ?? ''),
    label: String(s.siteUrl ?? ''),
    ...(s.permissionLevel ? { hint: s.permissionLevel.replace(/^site/, '').toLowerCase() } : {}),
    // Google lists properties an account can see but not read data for.
    ...(s.permissionLevel === 'siteUnverifiedUser' ? { disabled: { reason: 'This account is not verified for that property' } } : {}),
  })).filter((o) => o.id !== '')
  const matched = input.query ? all.filter((o) => o.label.toLowerCase().includes(input.query!.toLowerCase())) : all
  return { options: matched.slice(0, input.limit), ...(matched.length > input.limit ? { truncated: true } : {}) }
}

/**
 * Google's own mark, inline as a data URI (plan-connectors E2): a pack ships
 * the asset an operator recognises, rather than the Admin fetching a logo from
 * a host nobody declared. Rendered in an `<img>`, where a browser runs no
 * script whatever a pack puts here.
 */
export const GOOGLE_BRAND = {
  icon: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Cpath fill='%23FFC107' d='M43.6 20.1H24v7.8h11.3C33.7 32.7 29.3 36 24 36a12 12 0 1 1 0-24c3.1 0 5.8 1.2 7.9 3.1l5.5-5.5A19.9 19.9 0 0 0 24 4a20 20 0 1 0 0 40c11 0 20-8.9 20-20 0-1.3-.1-2.6-.4-3.9z'/%3E%3Cpath fill='%23FF3D00' d='M6.3 14.7l6.4 4.7C14.5 15.1 18.9 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.5-5.5A19.9 19.9 0 0 0 24 4 20 20 0 0 0 6.3 14.7z'/%3E%3Cpath fill='%234CAF50' d='M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5A20 20 0 0 0 24 44z'/%3E%3Cpath fill='%231976D2' d='M43.6 20.1H24v7.8h11.3a12 12 0 0 1-4.1 5.7l6.2 5.2C41 36.2 44 30.6 44 24c0-1.3-.1-2.6-.4-3.9z'/%3E%3C/svg%3E`,
  color: '#4285F4',
} as const

export const googleOAuthConnector: ConnectorDefinition = {
  id: GOOGLE_OAUTH_CONNECTOR,
  provider: GOOGLE_PROVIDER,
  label: 'Google',
  brand: { ...GOOGLE_BRAND },
  description: 'One Google account, used by every Google capability an operator consents to.',
  auth: {
    kind: 'oauth2',
    // offline + consent so Google issues the refresh token core refreshes with.
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&prompt=consent',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    pkce: true,
  },
  hosts: [...GOOGLE_HOSTS],
  /**
   * F2: the SEO extension used to offer its own Search Console connector. Now
   * that this pack owns Google, an operator's existing connection must keep
   * working - the same account, the same consent, and the same id already
   * stored in SEO's settings - so this connector adopts it.
   *
   * Adoption is a read: the row keeps its own id, and uninstalling this pack
   * leaves exactly what was there before rather than something half-migrated.
   */
  supersedes: ['google-search-console'],
  // One Google scope per capability, deliberately. Real Google asks a person
  // per scope (granular permissions), so a capability that bundled two could
  // be half-approved and then refuse everything - which is exactly what the
  // first acceptance run produced: Drive declined, and reading a spreadsheet
  // you already had the id of stopped working with it.
  capabilities: {
    'sheets.read': {
      label: 'Read a spreadsheet',
      description: 'Read the tabs and cells of a spreadsheet you choose.',
      scopes: [SCOPE.sheetsReadonly],
    },
    'sheets.browse': {
      label: 'Find your spreadsheets',
      description: 'List and search the spreadsheets in the account, so you can pick one.',
      scopes: [SCOPE.driveMetadata],
    },
    'sheets.append': {
      label: 'Add rows to a spreadsheet',
      description: 'Append rows. It never edits or deletes what is already there.',
      scopes: [SCOPE.sheets],
    },
    'search-console.read': {
      label: 'Read Search Console',
      description: 'Read clicks, impressions and positions for a property. Read-only.',
      scopes: [SCOPE.searchConsoleReadonly],
    },
  },
  resources: {
    // Finding a spreadsheet is Drive's job, reading one is Sheets': different
    // capabilities, so an operator who declined Drive can still use a
    // spreadsheet whose id is already stored.
    spreadsheet: { label: 'Spreadsheet', capability: 'sheets.browse', search: searchSpreadsheets },
    tab: { label: 'Tab', parent: 'spreadsheet', capability: 'sheets.read', search: searchTabs },
    property: { label: 'Search Console property', capability: 'search-console.read', search: searchProperties },
  },
  /**
   * One authenticated request. `path` is an absolute Google URL, because this
   * connector spans three APIs; the client core hands back is bound to the
   * declared hosts, so nothing else is reachable through it.
   */
  request: (conn, path, init) => conn.fetch(path, {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      authorization: `Bearer ${String(conn.credentials.accessToken ?? '')}`,
    },
  }),
  /**
   * The cheapest question the consented scopes can answer. `tokeninfo` needs
   * no scope at all, so a connection consented for Search Console only is
   * still checkable.
   */
  /**
   * The cheapest question the CONSENTED scopes can answer, and an honest
   * verdict about what the answer means.
   *
   * `tokeninfo` is Google's debug endpoint: it needs no scope, which is why it
   * was used, but it is not meant for production and it refused a token
   * Google had minted seconds earlier (acme, 2026-09-20). So a real endpoint
   * is preferred wherever a recorded scope allows one - the check then proves
   * the token works for something an operator actually wants - and tokeninfo
   * remains the fallback for a connection consented to nothing else.
   *
   * What the answer means matters as much as the answer: a 5xx, a 429 or a
   * thrown request is the provider failing to ANSWER and says nothing about
   * the credential, so it is reported as transient and the previous verdict
   * stands.
   */
  health: async (conn) => {
    const token = String(conn.credentials.accessToken ?? '')
    if (!token) return { ok: false, message: 'This connection holds no access token - reconnect it' }
    const scopes = typeof conn.meta?.scope === 'string' ? conn.meta.scope : ''
    const probe = scopes.includes(SCOPE.searchConsoleReadonly)
      ? { url: 'https://searchconsole.googleapis.com/webmasters/v3/sites', what: 'list your Search Console properties' }
      : scopes.includes(SCOPE.driveMetadata)
        ? { url: 'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)', what: 'list your files' }
        : { url: `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`, what: 'verify this connection' }

    let res: Response
    try {
      res = await conn.request!(probe.url)
    } catch (e) {
      return { ok: false, transient: true, message: `Google could not be reached: ${(e as Error).message}` }
    }
    if (res.ok) return { ok: true }
    // Google's own words, and what they mean for an operator.
    let detail = ''
    try {
      const body = await res.json() as { error?: string | { message?: string }; error_description?: string }
      detail = typeof body.error === 'string' ? body.error : body.error?.message ?? body.error_description ?? ''
    } catch { /* not JSON */ }
    const transient = res.status === 429 || res.status >= 500
    return {
      ok: false,
      ...(transient ? { transient: true } : {}),
      message: transient
        ? `Google could not answer (${res.status})${detail ? `: ${detail}` : ''}`
        : `Google refused to ${probe.what} (${res.status})${detail ? `: ${detail}` : ''}`,
    }
  },
}
