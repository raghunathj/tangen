/**
 * File Name: client.ts
 * Purpose: Implements createClient — the main entry point for the Tangen JS/TS SDK, wiring together an HTTP client, object query builder, globals accessor, and global search.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends on @tangen/types for query types. Uses globalThis.fetch by default; callers may pass a custom fetch implementation for testing or Edge environments.
 */
import type { ContentName, ContentRow, GlobalName, GlobalData } from '@tangen/types'
import { TangenError } from './errors'
import { ObjectQueryBuilder } from './query-builder'
import {
  notifyObservers, notifyInFlight, parseServerTiming, parseQmId, registerQmDetailFetcher,
  type RequestObserver, type QmRequestDetail,
} from './observe'
import { GlobalsAccessor } from './globals-accessor'
import { readSSEFrames } from './sse'

export { TangenError }
import { resolveApiBase } from './api-base'
import { createMediaAccessor, type MediaAccessor } from './media'

/** Fetch-compatible function signature — pass a custom implementation to stub the network in tests. */
export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/**
 * Configuration for the Tangen SDK client.
 */
export interface ClientConfig {
  /** The site's API origin, e.g. https://cms.example.com - the SDK adds the
   *  API path itself. A base that already ends in /api/v1 works too. */
  apiUrl: string
  apiKey: string
  fetch?: FetchFn
  /** Per-request timeout in milliseconds. Default: 30000. */
  timeoutMs?: number
  /** Extra attempts for transient failures (429/502/503/504/network). Default: 0. */
  retries?: number
  /** Called once per received response with timing info (plus the server's
   *  own db/queue numbers when the API's dev capture is on). Also see the
   *  process-wide observeRequests(). Errors thrown here are swallowed. */
  onResponse?: RequestObserver
  /** Opt this client's key in as the Tangen Toolbar's drill-down fetcher:
   *  clicking a Requests row fetches per-query detail (redacted statement
   *  shapes + timings) via GET /toolbar/qm/:entryId with THIS key. Default
   *  false - the toolbar never uses a key you did not explicitly volunteer.
   *  Requires permissions.toolbar.enabled on the key server-side. */
  toolbarDetail?: boolean
}

/**
 * Per-request options every method accepts. `signal` is a native
 * AbortSignal: aborting it cancels the request AND stops the retry loop, so
 * a cancelled read does not quietly retry three more times (Phase 7, Unit 3).
 */
export interface RequestOptions {
  signal?: AbortSignal
}

/**
 * Internal HTTP client interface used by ObjectQueryBuilder and GlobalsAccessor.
 */
export interface HttpClient {
  get(path: string, opts?: RequestOptions): Promise<any>
  post(path: string, body: unknown, opts?: RequestOptions): Promise<any>
  /** `extra` carries per-request headers, e.g. `If-Match` for a conditional update. */
  patch(path: string, body: unknown, extra?: Record<string, string>, opts?: RequestOptions): Promise<any>
  put(path: string, body: unknown, opts?: RequestOptions): Promise<any>
  delete(path: string, opts?: RequestOptions): Promise<any>
}

/**
 * Optional filters for the global search endpoint.
 */
export interface SearchOptions {
  type?: string
  limit?: number
}

/**
 * Result returned by the global search endpoint.
 */
export interface SearchResult {
  data: Record<string, unknown>[]
  meta: { total: number; query: string }
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])

/** The longest a Retry-After may hold one retry; a server asking for more gets this. */
export const MAX_RETRY_AFTER_MS = 30_000
/** Random spread added to a Retry-After wait, so a fleet told "1" does not return as one. */
const RETRY_JITTER_MS = 250

/**
 * Seconds or an HTTP-date in a Retry-After header, as milliseconds from now.
 * @param header - The raw header value, if any.
 * @param now - The current time, for the date form.
 * @returns Milliseconds to wait, or null when the header is absent or unreadable.
 */
export function parseRetryAfter(header: string | null | undefined, now: number = Date.now()): number | null {
  if (!header) return null
  const value = header.trim()
  if (/^[0-9]+$/.test(value)) return Number(value) * 1000
  const at = Date.parse(value)
  if (Number.isNaN(at)) return null
  return Math.max(0, at - now)
}

/**
 * How long to wait before the next attempt. A 429 (or any retryable
 * answer) that carried Retry-After is honoured - bounded by
 * MAX_RETRY_AFTER_MS and spread by a little jitter - instead of the flat
 * backoff; without the header the backoff grows with the attempt.
 * @param attempt - The attempt about to be made (1 for the first retry).
 * @param retryAfterMs - What the previous response asked for, if anything.
 * @param random - Math.random, replaceable in tests.
 * @returns Milliseconds to wait.
 */
export function retryDelayMs(attempt: number, retryAfterMs: number | null, random: () => number = Math.random): number {
  if (retryAfterMs === null) return 100 * attempt
  return Math.min(retryAfterMs, MAX_RETRY_AFTER_MS) + Math.floor(random() * RETRY_JITTER_MS)
}

function createHttpClient(
  baseUrl: string,
  apiKey: string,
  fetchFn: FetchFn,
  timeoutMs: number,
  retries: number,
  onResponse?: RequestObserver,
): HttpClient {
  const base = resolveApiBase(baseUrl)
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  async function attemptOnce(method: string, path: string, body?: unknown, extra?: Record<string, string>, signal?: AbortSignal): Promise<Response> {
    // The client's own timeout, plus the caller's signal when there is one:
    // whichever fires first aborts the attempt.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onCallerAbort = () => controller.abort()
    signal?.addEventListener('abort', onCallerAbort, { once: true })
    if (signal?.aborted) controller.abort()
    try {
      return await fetchFn(`${base}${path}`, {
        method,
        headers: extra ? { ...headers, ...extra } : headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onCallerAbort)
    }
  }

  async function request(method: string, path: string, body?: unknown, extra?: Record<string, string>, opts?: RequestOptions): Promise<any> {
    notifyInFlight(1)
    try {
      return await requestInner(method, path, body, extra, opts?.signal)
    } finally {
      notifyInFlight(-1)
    }
  }

  async function requestInner(method: string, path: string, body?: unknown, extra?: Record<string, string>, signal?: AbortSignal): Promise<any> {
    let lastError: unknown
    let retryAfterMs: number | null = null
    if (signal?.aborted) throw new TangenError('Request cancelled', 0, 'REQUEST_CANCELLED')
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs(attempt, retryAfterMs)))
      // A cancelled request stops retrying: the caller has already left.
      if (signal?.aborted) throw new TangenError('Request cancelled', 0, 'REQUEST_CANCELLED')
      retryAfterMs = null

      let res: Response
      const t0 = Date.now()
      try {
        res = await attemptOnce(method, path, body, extra, signal)
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          if (signal?.aborted) throw new TangenError('Request cancelled', 0, 'REQUEST_CANCELLED')
          throw new TangenError(`Request timed out after ${timeoutMs}ms`, 0)
        }
        // Network error — retryable
        lastError = err
        continue
      }

      notifyObservers({
        path, method, status: res.status,
        wallMs: Date.now() - t0,
        ...(() => { const st = parseServerTiming(res.headers); return st ? { serverTiming: st } : {} })(),
        ...(() => { const id = parseQmId(res.headers); return id ? { qmId: id } : {} })(),
      }, onResponse)

      // Parse defensively: error pages from proxies/load balancers are often
      // HTML or empty — never let a JSON parse failure mask the real status.
      const json = await res.json().catch(() => null)

      if (!res.ok) {
        if (RETRYABLE_STATUSES.has(res.status) && attempt < retries) {
          // The Gateway says when the window resets (plan-gateway section
          // 15); retrying sooner only spends another request on a 429.
          retryAfterMs = parseRetryAfter(res.headers.get('retry-after'))
          continue
        }
        const err = (json as any)?.error ?? {}
        throw new TangenError(
          err.message ?? `Request failed: ${res.status} ${res.statusText}`.trim(),
          res.status,
          err.code,
          err.fieldErrors,
        )
      }

      if (json === null) {
        throw new TangenError('Invalid JSON in API response', res.status)
      }
      return json
    }
    throw new TangenError(
      `Request failed after ${retries + 1} attempts: ${(lastError as Error)?.message ?? 'network error'}`,
      0,
    )
  }

  return {
    get: (path, opts) => request('GET', path, undefined, undefined, opts),
    post: (path, body, opts) => request('POST', path, body, undefined, opts),
    patch: (path, body, extra, opts) => request('PATCH', path, body, extra, opts),
    put: (path, body, opts) => request('PUT', path, body, undefined, opts),
    delete: (path, opts) => request('DELETE', path, undefined, undefined, opts),
  }
}

/**
 * The public Tangen SDK client interface — entry point for querying content objects, globals, and global search.
 */
export interface KnowledgeSearchHit {
  sourceKind: 'object' | 'table' | 'asset' | 'file'
  sourceId: string
  sourceGroup: string
  field: string
  content: string
  title: string | null
  score: number
}

export interface KnowledgeAskResult {
  answer: string | null
  citations: Array<{ ref: number; sourceKind: string; sourceId: string; sourceGroup: string; title: string | null; snippet: string; score: number }>
  provider?: string
  model?: string
  note?: string
}

export interface KnowledgeQueryOptions {
  limit?: number
  types?: string[]
  tables?: string[]
  sources?: Array<'object' | 'table' | 'asset' | 'file'>
  /** Locale-accurate retrieval (default-locale fallback included). */
  locale?: string
}

/**
 * One event of a streamed /knowledge/ask answer:
 * meta arrives first (citations are known before generation), then 0..n text
 * deltas, then done with token usage. Server-side failures mid-stream raise a
 * TangenError from the iterator instead of yielding a half answer.
 */
export type KnowledgeAskStreamEvent =
  | { type: 'meta'; provider: string | null; model: string | null; citations: KnowledgeAskResult['citations']; note?: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number } }

/** The workspace's language configuration, default locale first. */
export interface LocalesInfo {
  enabled: boolean
  defaultLocale: string
  locales: Array<{ code: string; label: string }>
}

// ── Client plugins ───────────────────────────────────────────────────────────

/**
 * What a client plugin is handed to build its API. `http` is the same low-level
 * transport the built-in accessors use (auth, retries, timing all applied), so
 * a plugin never re-implements request handling. This is the ONE seam an
 * EXTENSION's own client SDK mounts through - core carries no per-extension code.
 */
export interface PluginContext {
  http: HttpClient
  /** The resolved API base (…/api/v1), for a plugin that must build absolute URLs. */
  apiUrl: string
}

/**
 * An extension's client SDK, mounted on the client under `name`
 * (`client.<name>.…`). Build one with `defineClientPlugin` and pass it to
 * `createClient({ plugins: [...] })`.
 */
export interface TangenClientPlugin<Name extends string = string, Api = unknown> {
  readonly name: Name
  setup(ctx: PluginContext): Api
}

/** Define a client plugin with its namespace and API inferred for the caller. */
export function defineClientPlugin<Name extends string, Api>(
  name: Name,
  setup: (ctx: PluginContext) => Api,
): TangenClientPlugin<Name, Api> {
  return { name, setup }
}

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never

/** Merge a plugins tuple into `{ [name]: Api }` so `client.<name>` is typed. */
export type PluginApis<P extends readonly TangenClientPlugin[]> = UnionToIntersection<
  { [K in keyof P]: P[K] extends TangenClientPlugin<infer N, infer A> ? { readonly [X in N]: A } : never }[number]
>

/** Namespaces a plugin may not claim - the built-in client surface. */
const RESERVED_PLUGIN_NAMES = new Set(['objects', 'globals', 'media', 'locales', 'extensionSettings', 'qmDetail', 'search', 'knowledge'])

export interface TangenClient {
  /**
   * Query a content type. When `tangen types` has been run the name is a
   * literal union (typos are compile errors) and the row is fully typed;
   * otherwise it degrades to `string` + a loose record.
   */
  objects<K extends ContentName>(type: K): ObjectQueryBuilder<ContentRow<K>>
  globals<K extends GlobalName>(name: K): GlobalsAccessor<GlobalData<K>>
  /** The media library: list, read, and build public asset URLs. Read-only by design. */
  media: MediaAccessor
  /** Which languages the workspace serves (default first) — `{ enabled: false }` when localization is off. */
  locales(): Promise<{ data: LocalesInfo }>
  /** An extension's settings marked `public` in its manifest (E.18): what a website may read, never a secret. */
  extensionSettings(extensionId: string): Promise<{ data: Record<string, unknown> }>
  /**
   * Performance drill-down for a request THIS key made: per-query timings
   * with redacted statement shapes (never raw SQL). The entry id comes from
   * the X-Tangen-Qm response header (ObservedRequest.qmId). Requires the
   * key's toolbar permission; 404 when the entry is unknown, evicted, made
   * by another caller, or capture is off.
   */
  qmDetail(entryId: string): Promise<{ data: QmRequestDetail }>
  search(query: string, options?: SearchOptions): Promise<SearchResult>
  /** Semantic (RAG) surface — requires knowledge enabled server-side. */
  knowledge: {
    search(query: string, options?: KnowledgeQueryOptions): Promise<{ data: KnowledgeSearchHit[] }>
    ask(query: string, options?: KnowledgeQueryOptions): Promise<{ data: KnowledgeAskResult }>
    /**
     * Streaming twin of ask(): async-iterates meta → delta* → done over the
     * server's SSE. Pass `signal` to cancel mid-answer (stops the upstream
     * generation too). Iterate with `for await`.
     */
    askStream(
      query: string,
      options?: KnowledgeQueryOptions & { signal?: AbortSignal },
    ): AsyncGenerator<KnowledgeAskStreamEvent, void, unknown>
  }
}

/**
 * Creates a Tangen SDK client configured with the given API URL and key.
 * @param config - Client configuration including apiUrl, apiKey, optional custom
 *   fetch, and optional extension client `plugins` (each mounts under its name).
 * @returns A TangenClient instance, extended with each plugin's API.
 */
export function createClient<const P extends readonly TangenClientPlugin[] = []>(
  config: ClientConfig & { plugins?: P },
): TangenClient & PluginApis<P> {
  const fetchFn = config.fetch ?? globalThis.fetch
  const http = createHttpClient(
    config.apiUrl,
    config.apiKey,
    fetchFn,
    config.timeoutMs ?? 30_000,
    config.retries ?? 0,
    config.onResponse,
  )
  const client: TangenClient = {
    // Runtime is name-based; the generic surface is on the interface above.
    objects: ((typeName: string) => new ObjectQueryBuilder(http, typeName)) as TangenClient['objects'],
    globals: ((name: string) => new GlobalsAccessor(http, name)) as TangenClient['globals'],
    media: createMediaAccessor(http, resolveApiBase(config.apiUrl)),
    locales: () => http.get('/i18n/locales'),
    extensionSettings: (extensionId: string) => http.get(`/ext/${encodeURIComponent(extensionId)}/settings`),
    qmDetail: (entryId: string) => http.get(`/toolbar/qm/${encodeURIComponent(entryId)}`),
    search: (query: string, options?: SearchOptions) =>
      http.post('/search', { q: query, ...options }),
    knowledge: {
      search: (query: string, options?: KnowledgeQueryOptions) =>
        http.post('/knowledge/search', { query, ...options }),
      ask: (query: string, options?: KnowledgeQueryOptions) =>
        http.post('/knowledge/ask', { query, ...options }),
      askStream: async function* (query, options = {}) {
        // Deliberately not routed through the JSON http client: no whole-request
        // timeout on a long-lived stream, and the body must stay a ReadableStream.
        const { signal, ...opts } = options
        const base = resolveApiBase(config.apiUrl)
        const res = await fetchFn(`${base}/knowledge/ask?stream=1`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
          },
          body: JSON.stringify({ query, ...opts }),
          ...(signal ? { signal } : {}),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => null)
          const err = (json as any)?.error ?? {}
          throw new TangenError(
            err.message ?? `Request failed: ${res.status} ${res.statusText}`.trim(),
            res.status,
            err.code,
          )
        }
        for await (const frame of readSSEFrames(res.body)) {
          let data: any
          try { data = JSON.parse(frame.data) } catch { continue }
          switch (frame.event) {
            case 'meta':
              yield {
                type: 'meta',
                provider: data.provider ?? null,
                model: data.model ?? null,
                citations: data.citations ?? [],
                ...(data.note ? { note: data.note } : {}),
              } as KnowledgeAskStreamEvent
              break
            case 'delta':
              yield { type: 'delta', text: String(data.text ?? '') } as KnowledgeAskStreamEvent
              break
            case 'done':
              yield {
                type: 'done',
                usage: {
                  inputTokens: Number(data.usage?.inputTokens ?? 0),
                  outputTokens: Number(data.usage?.outputTokens ?? 0),
                },
              } as KnowledgeAskStreamEvent
              break
            case 'error':
              throw new TangenError(String(data.message ?? 'stream error'), 502)
          }
        }
      },
    },
  }
  // Explicit opt-in ONLY: volunteer this client's key as the toolbar's
  // drill-down fetcher. 404 (evicted/off/foreign entry) reads as "no detail".
  if (config.toolbarDetail === true) {
    registerQmDetailFetcher(async (entryId: string) => {
      try {
        return (await client.qmDetail(entryId)).data
      } catch (err) {
        if (err instanceof TangenError && err.status === 404) return null
        throw err
      }
    })
  }

  // Mount extension client SDKs. Each plugin's API sits under its name; a
  // plugin may not shadow a built-in accessor, and two plugins may not collide.
  const withPlugins = client as TangenClient & Record<string, unknown>
  for (const plugin of config.plugins ?? []) {
    if (RESERVED_PLUGIN_NAMES.has(plugin.name) || plugin.name in withPlugins) {
      throw new TangenError(`Client plugin name "${plugin.name}" is reserved or already in use`, 0, 'PLUGIN_NAME_CONFLICT')
    }
    withPlugins[plugin.name] = plugin.setup({ http, apiUrl: resolveApiBase(config.apiUrl) })
  }
  return withPlugins as TangenClient & PluginApis<P>
}
