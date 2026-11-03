/**
 * File Name: playground.ts
 * Purpose: Pure helpers for the API Playground execute route — the SSRF
 *          path allow-list (same-host /api/v1 only), the request-header
 *          allow-list (no auth/cookies/hop-by-hop cross the boundary),
 *          and the endpoint catalog the builder's picker renders from.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { SchemaDefinition, GlobalDefinition } from '@tangen/types'

/**
 * Only same-host Tangen API paths may be dispatched. Must be an absolute
 * path (starts with a single '/'), under /api/v1/, with no traversal and
 * no protocol/host smuggling.
 */
export function isAllowedPlaygroundPath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) return false
  if (!path.startsWith('/')) return false          // no absolute URLs
  if (path.startsWith('//')) return false          // no protocol-relative host
  if (path.includes('..')) return false            // no traversal
  const pathname = path.split('?')[0]
  return pathname === '/api/v1' || pathname.startsWith('/api/v1/')
}

const ALLOWED_HEADER_EXACT = new Set(['content-type', 'accept', 'accept-language'])

/** Keeps content-type/accept/x-* only; strips auth, cookies, host, hop-by-hop. */
export function filterRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers ?? {})) {
    const lower = k.toLowerCase()
    if (ALLOWED_HEADER_EXACT.has(lower) || lower.startsWith('x-')) {
      if (lower === 'x-tangen-playground') continue   // never let a caller inject the impersonation header
      out[lower] = v
    }
  }
  return out
}

export interface CatalogEndpoint {
  label: string
  /** PUT included: the admin's Method type and the execute route's allowlist
   *  both carry it, and a global is replaced with one. */
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** Path template ('/api/v1/…') — pre-filled into the request builder. */
  path: string
  description?: string
  sampleBody?: Record<string, unknown>
  /** Example query params — pre-filled into the Params rows. */
  sampleParams?: Record<string, string>
}

// ── Schema-driven examples ────────────────────────────────────────────────────
// The catalog KNOWS the fields, so examples use real names and type-correct
// sample values instead of a generic empty object.

type FieldLike = { name: string; fieldType?: string; required?: boolean; config?: Record<string, unknown> }

/** A plausible example value for a field, or undefined when none makes sense. */
export function sampleValueFor(f: FieldLike): unknown {
  const cfg = (f.config ?? {}) as Record<string, any>
  switch (f.fieldType) {
    case 'text': return 'Sample text'
    case 'textarea': return 'A longer sample paragraph.'
    case 'slug': return 'sample-slug'
    case 'email': return 'hello@example.com'
    case 'url': return 'https://example.com'
    case 'phone': return '+14155552671'
    case 'number': case 'currency': case 'rating': return 42
    case 'boolean': return true
    case 'date': return new Date().toISOString()
    case 'time': return '09:30'
    case 'color': return '#4f46e5'
    case 'select': return cfg.options?.[0]?.value ?? 'option'
    case 'multiselect': return cfg.options?.length ? [cfg.options[0].value] : ['a', 'b']
    case 'tags': return ['sample']
    case 'range': return { min: 1, max: 10 }
    case 'geopoint': return { lat: 12.97, lng: 77.59 }
    case 'json': return { any: 'json' }
    case 'relation': return cfg.many === true ? ['{{relatedId}}'] : '{{relatedId}}'
    case 'media': return '{{assetId}}'
    case 'component': {
      // The resolved component defs sit in config.components, so a block
      // sample is available - and blocks are the LAST thing to leave out of a
      // sample, being the part of the API whose shape nobody guesses. A
      // sample without `_type` teaches a model that does not exist.
      const defs = (cfg.components ?? []) as Array<{ name?: string; fields?: FieldLike[] }>
      const blocks = defs
        .filter((d) => typeof d?.name === 'string')
        .slice(0, 2)
        .map((d) => ({ _type: d.name as string, ...buildSampleValues(d.fields ?? []) }))
      return blocks.length ? blocks : undefined
    }
    case 'repeater': {
      const sub = (cfg.fields ?? []) as FieldLike[]
      const row = buildSampleValues(sub)
      return Object.keys(row).length ? [row] : undefined
    }
    default: return undefined   // richtext/object - too structural to fake usefully
  }
}

/** Example `values` for a create: required fields first, capped at 6. */
export function buildSampleValues(fields: FieldLike[]): Record<string, unknown> {
  const ordered = [...fields].sort((a, b) => Number(!!b.required) - Number(!!a.required))
  const out: Record<string, unknown> = {}
  for (const f of ordered) {
    if (Object.keys(out).length >= 6) break
    if ((f.config as any)?.admin?.hidden) continue
    const v = sampleValueFor(f)
    if (v !== undefined) out[f.name] = v
  }
  return out
}

/** A field worth filtering on: indexed or unique first, then any plain scalar. */
export function filterableField(fields: FieldLike[]): FieldLike | undefined {
  const FILTERABLE = ['text', 'slug', 'email', 'url', 'select', 'number', 'boolean', 'date', 'relation']
  const scored = fields.filter((f) => FILTERABLE.includes(f.fieldType ?? ''))
  const cfg = (f: FieldLike) => (f.config ?? {}) as Record<string, any>
  const indexed = scored.find((f) => (f as { index?: boolean }).index === true || cfg(f).index === true)
  const unique = scored.find((f) => cfg(f).validation?.unique === true || cfg(f).unique === true)
  return indexed ?? unique ?? scored[0]
}

/**
 * Example query body. Any field can be filtered - that is what `where` is for
 * - so the sample picks one worth showing: an INDEXED or unique field before
 * an arbitrary one, with an operator that returns something.
 *
 * It used to emit `{ contains: '' }` on the first text-ish field, which
 * matches every row and reads as a broken example. Worse, it made the picker
 * look as though `Get by id` were the only way to find a record.
 */
export function buildSampleQuery(fields: FieldLike[]): Record<string, unknown> {
  const f = filterableField(fields)
  if (!f) return { sort: '-created_at', limit: 10 }
  const v = sampleValueFor(f)
  const exact = ['select', 'boolean', 'number', 'relation', 'date'].includes(f.fieldType ?? '')
  const clause = exact
    ? { [f.name]: { eq: v ?? null } }
    : { [f.name]: { contains: String(v ?? '').slice(0, 6) } }
  return { where: clause, sort: '-created_at', limit: 10 }
}

export interface CatalogGroup {
  group: string
  endpoints: CatalogEndpoint[]
}

/**
 * Builds the endpoint picker: core REST per content type, custom-table
 * query routes, and every custom-route apiGroup (with its resource
 * label). Paths are templates — the UI fills workspace/env.
 */
export function buildPlaygroundCatalog(input: {
  schema: SchemaDefinition | { types?: Array<{ name: string; label?: string }> } | null
  apiGroups: Array<{ id: string; label?: string; actions?: string[] }>
  customTables: string[]
  /** The ACTIVE extensions' key routes: what a site reads with a workspace key. */
  extensions?: Array<{ id: string; label?: string; routes: Array<{ method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; path: string }> }>
  /** The workspace's global definitions, resolved by globalDefinitionsOf. */
  globals?: GlobalDefinition[] | null
}): CatalogGroup[] {
  const groups: CatalogGroup[] = []
  // PG-2: disabled (soft-deleted) types are invisible everywhere — the catalog too
  const types = ((input.schema?.types ?? []) as Array<{ name: string; label?: string; disabled?: boolean; fields?: FieldLike[] }>)
    .filter((t) => t.disabled !== true)

  // One FOLDER per content type (Postman-style), holding the full method set of
  // the resource routes (/objects/{type}/…) — the shape the SDK speaks.
  // Examples are schema-driven: real field names, type-correct sample values.
  for (const t of types) {
    const fields = t.fields ?? []
    const flatSample = Object.fromEntries(Object.entries(buildSampleValues(fields)).slice(0, 2))
    groups.push({
      group: t.label ?? t.name,
      endpoints: [
        {
          label: 'Query', method: 'POST' as const, path: `/api/v1/objects/${t.name}/query`,
          description: 'Find by ANY field, not just id. Filter/sort/paginate; operators: eq, ne, in, nin, gt, lt, contains, startsWith, empty… Indexed fields are the cheap ones.',
          sampleBody: buildSampleQuery(fields),
        },
        {
          label: 'List', method: 'GET' as const, path: `/api/v1/objects/${t.name}`,
          description: 'Plain list - depth=1 expands relations, locale=<code> serves translations.',
          sampleParams: { depth: '1' },
        },
        {
          label: 'Get by id', method: 'GET' as const, path: `/api/v1/objects/${t.name}/{{id}}`,
          description: 'By id only. To fetch by a slug, a path or any other field, use Query with a `where`.',
          sampleParams: { depth: '1' },
        },
        {
          label: 'Create', method: 'POST' as const, path: `/api/v1/objects/${t.name}`,
          description: 'Creates a draft. values keys are the type’s field names.',
          sampleBody: { title: 'Untitled', values: buildSampleValues(fields) },
        },
        {
          label: 'Update', method: 'PATCH' as const, path: `/api/v1/objects/${t.name}/{{id}}`,
          description: 'Partial update of the draft - send only the fields you change.',
          sampleBody: { title: 'Updated title', ...flatSample },
        },
        {
          label: 'Delete', method: 'DELETE' as const, path: `/api/v1/objects/${t.name}/{{id}}`,
          description: 'Archives the entry (soft delete - status becomes archived).',
        },
        {
          label: 'Publish', method: 'POST' as const, path: `/api/v1/objects/${t.name}/{{id}}/publish`,
          description: 'Publishes the draft. Required-relation drafts block unless ?cascade=true.',
        },
        {
          label: 'Unpublish', method: 'POST' as const, path: `/api/v1/objects/${t.name}/{{id}}/unpublish`,
          description: 'Back to draft - the published snapshot stops being served.',
        },
      ],
    })
  }

  // Globals are singletons declared in code, so they have no list/create/
  // publish cycle - one read and two writes each, plus the definitions list.
  // They were missing from this picker entirely: the catalog knew content
  // types, custom tables, custom routes and extensions, and a workspace's
  // globals were never an input, so four routes the API serves could not be
  // reached from the screen built for reaching routes.
  const globals = (Array.isArray(input.globals) ? input.globals : []).filter((g) => g && typeof g.name === 'string')
  if (globals.length) {
    const endpoints: CatalogEndpoint[] = [{
      label: 'List', method: 'GET' as const, path: '/api/v1/globals',
      description: 'Every global the workspace declares - definitions only, no authored data.',
    }]
    for (const g of globals) {
      const name = g.label ?? g.name
      const fields = (g.fields ?? []) as unknown as FieldLike[]
      const sample = buildSampleValues(fields)
      endpoints.push(
        {
          label: `Get - ${name}`, method: 'GET' as const, path: `/api/v1/globals/${g.name}`,
          // No depth here on purpose: a global has no depth option, so a
          // media or relation field comes back as the bare id.
          description: 'The authored values, at data.values. Media and relations arrive as ids, never expanded.',
        },
        {
          label: `Replace - ${name}`, method: 'PUT' as const, path: `/api/v1/globals/${g.name}`,
          // The body is the values object itself, NOT a `values` wrapper: the
          // route hands it straight to collapseGlobalMedia.
          description: 'Replaces the whole store. The body is the values object itself, not wrapped. Translations go through PATCH.',
          sampleBody: sample,
        },
        {
          label: `Update - ${name}`, method: 'PATCH' as const, path: `/api/v1/globals/${g.name}`,
          description: 'Merges onto what is stored - send only the keys you change. Add ?locale=<code> to write a translation.',
          sampleBody: Object.fromEntries(Object.entries(sample).slice(0, 2)),
        },
      )
    }
    groups.push({ group: 'Globals', endpoints })
  }

  if (input.customTables.length) {
    groups.push({
      group: 'Custom tables',
      endpoints: input.customTables.map((name) => ({
        label: `Query ${name}`, method: 'POST' as const,
        path: `/api/v1/tables/${name}/query`, sampleBody: { limit: 10 },
      })),
    })
  }

  if (input.apiGroups.length) {
    groups.push({
      group: 'Custom routes',
      endpoints: input.apiGroups.flatMap((g) =>
        (g.actions?.length ? g.actions : ['']).map((action) => ({
          label: `${g.label ?? g.id}${action ? ` - ${action}` : ''}`,
          method: 'POST' as const,
          // Seeds the group + action sub-path; the developer edits the rest
          path: `/api/v1/custom/:workspaceId/:env/${g.id}/${action}`.replace(/\/$/, '/'),
          description: `Custom route group '${g.id}'`,
          sampleBody: {},
        })),
      ),
    })
  }

  // An extension's key routes (an SEO resolver, a Forms schema read): what a
  // site reads with a workspace key, so they are testable here like any other
  // endpoint. A ':param' stays in the path for the developer to fill.
  for (const ext of input.extensions ?? []) {
    if (!ext.routes.length) continue
    groups.push({
      group: ext.label ?? ext.id,
      endpoints: ext.routes.map((r) => ({
        label: `${r.method} ${r.path || '/'}`,
        method: r.method,
        path: `/api/v1/ext/${ext.id}${r.path ? `/${r.path}` : ''}`,
        description: `${ext.label ?? ext.id} extension, read with a workspace API key.`,
        ...(r.method === 'GET' ? {} : { sampleBody: {} }),
      })),
    })
  }

  // GraphQL — one endpoint that POSTs a query. Always offered (the endpoint
  // itself 404s if GraphQL is disabled for the env, so this is harmless).
  const firstType = types[0]?.name
  groups.push({
    group: 'GraphQL',
    endpoints: [{
      label: 'GraphQL query',
      method: 'POST',
      path: '/api/v1/graphql',
      description: 'POST a GraphQL query (schema generated from your content model).',
      sampleBody: {
        query: firstType
          ? `{ ${firstType}s(limit: 5) { data { id title } meta { total } } }`
          : '{ __schema { queryType { fields { name } } } }',
      },
    }],
  })

  return groups
}
