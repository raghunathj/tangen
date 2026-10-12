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
import type { SchemaDefinition } from '@tangen/types'

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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
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
    default: return undefined   // richtext/component/repeater/object - too structural to fake usefully
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

/** Example query body: a real-field filter when a text-ish field exists. */
export function buildSampleQuery(fields: FieldLike[]): Record<string, unknown> {
  const textish = fields.find((f) => ['text', 'textarea', 'slug', 'email'].includes(f.fieldType ?? ''))
  return {
    ...(textish ? { where: { [textish.name]: { contains: '' } } } : {}),
    sort: '-created_at',
    limit: 10,
  }
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
          description: 'Filter/sort/paginate. Operators: eq, ne, in, nin, gt, lt, contains, startsWith, empty…',
          sampleBody: buildSampleQuery(fields),
        },
        {
          label: 'List', method: 'GET' as const, path: `/api/v1/objects/${t.name}`,
          description: 'Plain list - depth=1 expands relations, locale=<code> serves translations.',
          sampleParams: { depth: '1' },
        },
        {
          label: 'Get by id', method: 'GET' as const, path: `/api/v1/objects/${t.name}/{{id}}`,
          description: 'Set an {{id}} variable in the Vars tab, or paste an id into the path.',
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
