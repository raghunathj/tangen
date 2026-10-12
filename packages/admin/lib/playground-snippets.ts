/**
 * File Name: playground-snippets.ts
 * Purpose: PG-4 — code export for the API Playground: curl, JS fetch, and
 *          @tangen/sdk snippets generated from the current request. SDK
 *          snippets are pattern-mapped (objects query/find/by-slug, globals,
 *          search); anything unmapped falls back to fetch with a note.
 *          {{variables}} are left verbatim — define them where the code runs.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { KVRow } from './playground'
import { rowsToRecord, placeholdersIn } from './playground'

export interface SnippetInput {
  origin: string
  method: string
  path: string
  params: KVRow[]
  headers: KVRow[]
  body: string | null
}

export interface Snippets { curl: string; fetch: string; sdk: string }

function fullUrl(i: SnippetInput): string {
  const qs = new URLSearchParams(rowsToRecord(i.params)).toString()
  return `${i.origin}${i.path}${i.path.includes('?') ? '&' : '?'}${qs}`
}

function varsNote(i: SnippetInput): string {
  const names = new Set<string>()
  for (const s of [i.path, i.body ?? '', ...i.params.map((p) => p.value), ...i.headers.map((h) => h.value)]) {
    for (const n of placeholdersIn(s)) names.add(n)
  }
  return names.size ? `// define: ${[...names].map((n) => `{{${n}}}`).join(', ')}\n` : ''
}

export function curlSnippet(i: SnippetInput): string {
  const parts = [`curl -X ${i.method} '${fullUrl(i)}'`, `  -H 'Authorization: Bearer tgn_…your-key'`]
  for (const [k, v] of Object.entries(rowsToRecord(i.headers))) parts.push(`  -H '${k}: ${v}'`)
  if (i.body != null) {
    parts.push(`  -H 'Content-Type: application/json'`)
    parts.push(`  -d '${i.body.replace(/\n\s*/g, ' ')}'`)
  }
  return varsNote(i).replace(/^\/\//, '#') + parts.join(' \\\n')
}

export function fetchSnippet(i: SnippetInput): string {
  const headers: Record<string, string> = {
    Authorization: 'Bearer tgn_…your-key',
    ...(i.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...rowsToRecord(i.headers),
  }
  const lines = [
    `${varsNote(i)}const res = await fetch('${fullUrl(i)}', {`,
    `  method: '${i.method}',`,
    `  headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ')},`,
    ...(i.body != null ? [`  body: JSON.stringify(${i.body.trim() || '{}'}),`] : []),
    `})`,
    `const json = await res.json()`,
  ]
  return lines.join('\n')
}

const SDK_PRELUDE = `import { createClient } from '@tangen/sdk'
const client = createClient({ apiUrl: '…/api/v1', apiKey: process.env.TANGEN_API_KEY! })
`

/** Pattern-mapped @tangen/sdk snippet; null when no clean mapping exists. */
export function sdkSnippet(i: SnippetInput): string | null {
  const path = i.path.split('?')[0].replace(/\/+$/, '')
  let parsed: Record<string, unknown> | null = null
  if (i.body != null) { try { parsed = JSON.parse(i.body) } catch { parsed = null } }

  // POST /objects/query (legacy, type in body) and /objects/{type}/query
  const perType = path.match(/^\/api\/v1\/objects\/([^/]+)\/query$/)
  const queryType = perType ? perType[1] : (path === '/api/v1/objects/query' && typeof parsed?.type === 'string' ? parsed.type as string : null)
  if (i.method === 'POST' && queryType && parsed) {
    const calls: string[] = [`client.objects('${queryType}')`]
    const where = (parsed.where ?? parsed.query) as Record<string, unknown> | undefined
    if (where && Object.keys(where).length) calls.push(`.where(${JSON.stringify(where)})`)
    if (typeof parsed.locale === 'string') calls.push(`.locale('${parsed.locale}')`)
    if (typeof parsed.sort === 'string') calls.push(`.sort('${parsed.sort}')`)
    if (typeof parsed.limit === 'number') calls.push(`.limit(${parsed.limit})`)
    if (typeof parsed.offset === 'number') calls.push(`.offset(${parsed.offset})`)
    if (Array.isArray(parsed.props)) calls.push(`.props(${JSON.stringify(parsed.props)})`)
    if (typeof parsed.depth === 'number') calls.push(`.depth(${parsed.depth})`)
    calls.push('.get()')
    return `${varsNote(i)}${SDK_PRELUDE}\nconst { data } = await ${calls.join('\n  ')}`
  }

  // GET /objects/:type/by-slug/:slug and /objects/:type/:id
  let m = path.match(/^\/api\/v1\/objects\/([^/]+)\/by-slug\/([^/]+)$/)
  if (i.method === 'GET' && m) {
    return `${varsNote(i)}${SDK_PRELUDE}\nconst { data } = await client.objects('${m[1]}').findBySlug('${decodeURIComponent(m[2])}')`
  }
  m = path.match(/^\/api\/v1\/objects\/([^/]+)\/([^/]+)$/)
  if (i.method === 'GET' && m && m[2] !== 'query') {
    return `${varsNote(i)}${SDK_PRELUDE}\nconst { data } = await client.objects('${m[1]}').find('${decodeURIComponent(m[2])}')`
  }

  // GET /objects/{type} — list (query with no filters)
  m = path.match(/^\/api\/v1\/objects\/([^/]+)$/)
  if (i.method === 'GET' && m && m[1] !== 'query' && m[1] !== 'by-slug') {
    return `${varsNote(i)}${SDK_PRELUDE}\nconst { data } = await client.objects('${m[1]}').get()`
  }
  // POST /objects/{type} — create
  if (i.method === 'POST' && m && parsed && m[1] !== 'query') {
    const title = typeof parsed.title === 'string' ? parsed.title : 'Untitled'
    const values = (parsed.values && typeof parsed.values === 'object') ? JSON.stringify(parsed.values) : '{}'
    return `${varsNote(i)}${SDK_PRELUDE}\nconst { data } = await client.objects('${m[1]}').create({ title: ${JSON.stringify(title)}, values: ${values} })`
  }

  // PATCH/DELETE /objects/{type}/{id} + publish/unpublish
  m = path.match(/^\/api\/v1\/objects\/([^/]+)\/([^/]+)$/)
  if (m && m[2] !== 'query') {
    const id = decodeURIComponent(m[2])
    if (i.method === 'PATCH' && parsed) {
      return `${varsNote(i)}${SDK_PRELUDE}\nconst { data } = await client.objects('${m[1]}').update('${id}', ${JSON.stringify(parsed)})`
    }
    if (i.method === 'DELETE') {
      return `${varsNote(i)}${SDK_PRELUDE}\nawait client.objects('${m[1]}').delete('${id}')`
    }
  }
  m = path.match(/^\/api\/v1\/objects\/([^/]+)\/([^/]+)\/(publish|unpublish)$/)
  if (i.method === 'POST' && m) {
    return `${varsNote(i)}${SDK_PRELUDE}\nconst { data } = await client.objects('${m[1]}').${m[3]}('${decodeURIComponent(m[2])}')`
  }

  // Globals + search
  m = path.match(/^\/api\/v1\/globals\/([^/]+)$/)
  if (i.method === 'GET' && m) {
    return `${varsNote(i)}${SDK_PRELUDE}\nconst data = await client.globals('${m[1]}').get()`
  }
  if (i.method === 'POST' && path === '/api/v1/search' && parsed && typeof parsed.q === 'string') {
    return `${varsNote(i)}${SDK_PRELUDE}\nconst results = await client.search('${parsed.q}')`
  }
  if (i.method === 'GET' && path === '/api/v1/i18n/locales') {
    return `${varsNote(i)}${SDK_PRELUDE}\nconst { data } = await client.locales()`
  }

  return null
}

export function generateSnippets(i: SnippetInput): Snippets {
  const sdk = sdkSnippet(i)
  return {
    curl: curlSnippet(i),
    fetch: fetchSnippet(i),
    sdk: sdk ?? `// No direct @tangen/sdk helper for ${i.method} ${i.path} - use fetch:\n\n${fetchSnippet(i)}`,
  }
}
