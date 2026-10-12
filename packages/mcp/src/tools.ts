/**
 * File Name: tools.ts
 * Purpose: The built-in MCP tool set. Every tool double-gates: the API key's
 *          grants (permissions.ts) AND the schema's mcp exposure flags
 *          (exposure.ts). Reads default to published content.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure dependency injection — the host (Tangen API or
 *          the stdio CLI) provides the data client and media search; this
 *          package never imports host internals, which is what keeps it an
 *          independently installable unit.
 */
import type { ApiKeyPermissions, ObjectTypeDefinition, CustomTableDefinition } from '@tangen/types'
import { exposedTypes, exposedFields, stripHiddenFields, exposedTables, stripTableColumns } from './exposure'
import { keyCanObjects, keyCanMedia, keyCanTable } from './permissions'
import type { McpToolDef, McpResourceDef } from './protocol'

/** Fluent query builder subset the host client must provide (LocalClient satisfies it). */
export interface McpQueryBuilder {
  where(filters: Record<string, unknown>): McpQueryBuilder
  sort(field: string, direction: 'asc' | 'desc'): McpQueryBuilder
  limit(n: number): McpQueryBuilder
  status?(s: string): McpQueryBuilder
  locale?(l: string): McpQueryBuilder
  get(): Promise<{ data: Record<string, unknown>[]; meta?: { total?: number } }>
}

export interface McpMediaHit {
  id: string
  filename: string
  alt?: string | null
  mimeType?: string | null
  size?: number | null
}

export interface McpToolContext {
  /** Data client bound to the key's workspace/env (the API passes LocalClient). */
  client: {
    objects: (typeName: string) => McpQueryBuilder
    table: (tableName: string) => McpQueryBuilder
  }
  permissions: ApiKeyPermissions | undefined
  /** Full schema types — exposure filtering happens here. */
  types: ObjectTypeDefinition[]
  /**
   * Custom table definitions declared by the workspace config. Table-level
   * MCP exposure (`mcp: false` / `{ hiddenColumns }`) is resolved here via
   * exposure.ts; the key's `tables:read` grant gates on top.
   */
  customTables: CustomTableDefinition[]
  /**
   * The lifecycle action policy for one object, for THIS key (K2): which
   * actions exist, which are available now, and why not. The publish tools
   * consult it before running; get_object_actions hands it to the agent so
   * it can plan instead of trying. Absent when the host does not provide it.
   */
  actions?: (typeName: string, id: string) => Promise<import('@tangen/types').LifecycleActions>
  /** Host-provided media search; omit to disable the search_media tool. */
  searchMedia?: (args: { query?: string; category?: string; limit: number }) => Promise<McpMediaHit[]>
  /**
   * Host-provided grounded doc/content Q&A (RAG). Wired only when the workspace
   * has Knowledge enabled; when omitted, the `ask_docs` tool stays present but
   * returns an llms.txt fallback so an agent still knows where to read.
   */
  askDocs?: (args: { query: string; limit: number }) => Promise<{ passages: { source: string; content: string; score?: number }[] }>
}

const LIMIT_MAX = 50

function typeOrThrow(ctx: McpToolContext, name: unknown): ObjectTypeDefinition {
  const t = exposedTypes(ctx.types).find((x) => x.name === name)
  if (!t) throw new Error(`Unknown or unexposed type: ${String(name)}. Use list_types to see what is available.`)
  return t
}

function clampLimit(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), LIMIT_MAX) : 10
}

/** The read tool set (write tools are appended by writes.ts per write mode). */
export function buildReadTools(ctx: McpToolContext): McpToolDef[] {
  const tools: McpToolDef[] = [
    {
      name: 'list_types',
      description: 'List the content types available in this workspace with their fields. Call this first to learn the content model.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({
        types: exposedTypes(ctx.types)
          .filter((t) => keyCanObjects(ctx.permissions, 'read', t.name))
          .map((t) => ({
            name: t.name,
            label: t.label,
            singleton: t.singleton ?? false,
            fields: exposedFields(t).map((f) => ({
              name: f.name, label: f.label, fieldType: f.fieldType, required: f.required,
            })),
          })),
      }),
    },
    {
      name: 'get_schema',
      description:
        'Return the FULL content model for authoring/editing schema code: every readable type with complete field configs (relation targetType, options, validation, AI hints), taxonomy/admin metadata, plus the custom-table names. Use this before writing or changing a schema so edits are grounded in the current model. (`list_types` is the shallow view for content operations.)',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Optional - return just this one type instead of the whole model' },
        },
      },
      handler: async (args) => {
        const readable = exposedTypes(ctx.types).filter((t) => keyCanObjects(ctx.permissions, 'read', t.name))
        const chosen = args.type ? readable.filter((t) => t.name === String(args.type)) : readable
        if (args.type && chosen.length === 0) {
          throw new Error(`Unknown or unexposed type: ${String(args.type)}. Use list_types to see what is available.`)
        }
        return {
          types: chosen.map((t) => ({
            name: t.name,
            label: t.label,
            plural: t.plural,
            singleton: t.singleton ?? false,
            disabled: t.disabled ?? false,
            // taxonomy (parentType/hierarchical), menu, editorView — what the admin nesting reads
            admin: t.admin,
            fields: exposedFields(t).map((f) => ({
              name: f.name,
              label: f.label,
              fieldType: f.fieldType,
              required: f.required,
              // relation.targetType, options, validation, ai.hint — the detail list_types omits
              config: f.config,
              helpText: f.helpText,
            })),
          })),
          customTables: exposedTables(ctx.customTables).map((t) => t.name),
        }
      },
    },
    {
      name: 'ask_docs',
      description:
        'Ask a natural-language question about how to build on THIS Tangen project and get a grounded answer from its indexed docs/content (RAG). If retrieval is not enabled, it points you to load the docs wholesale from /llms.txt instead.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'e.g. "how do I add a webhook trigger?"' },
          limit: { type: 'number', description: `Max passages (≤ ${LIMIT_MAX})` },
        },
      },
      handler: async (args) => {
        const query = String(args.query ?? '').trim()
        if (!query) throw new Error('ask_docs needs a "query".')
        if (!ctx.askDocs) {
          return {
            grounded: false,
            message:
              'Grounded doc search (RAG) is not enabled for this project. Load the docs wholesale from /llms.txt (or /llms-full.txt), or enable it with `tangen knowledge index --docs` (needs @tangen/knowledge + pgvector).',
          }
        }
        const { passages } = await ctx.askDocs({ query, limit: clampLimit(args.limit) })
        return { grounded: true, passages }
      },
    },
    {
      name: 'search_content',
      description: 'Query content objects of a type. Filters use TangenQL operators (eq, contains, gte, …). Returns published content by default.',
      inputSchema: {
        type: 'object',
        required: ['type'],
        properties: {
          type: { type: 'string', description: 'Type name from list_types' },
          where: { type: 'object', description: 'TangenQL filters, e.g. { "title": { "contains": "launch" } }' },
          sort: { type: 'string', description: 'Field to sort by (default created_at)' },
          direction: { type: 'string', enum: ['asc', 'desc'] },
          limit: { type: 'number', description: `Max ${LIMIT_MAX}, default 10` },
          status: { type: 'string', enum: ['published', 'draft', 'any'], description: 'Default published' },
          locale: { type: 'string', description: 'Read localized values (e.g. "ta") - default locale otherwise' },
        },
      },
      handler: async (args) => {
        const type = typeOrThrow(ctx, args.type)
        if (!keyCanObjects(ctx.permissions, 'read', type.name)) {
          throw new Error(`This API key has no read grant for type "${type.name}".`)
        }
        let builder = ctx.client.objects(type.name).limit(clampLimit(args.limit))
        const status = (args.status as string) ?? 'published'
        if (status !== 'any' && builder.status) builder = builder.status(status)
        if (args.locale && builder.locale) builder = builder.locale(String(args.locale))
        if (args.where && typeof args.where === 'object') builder = builder.where(args.where as Record<string, unknown>)
        if (args.sort) builder = builder.sort(String(args.sort), (args.direction as 'asc' | 'desc') ?? 'desc')
        const res = await builder.get()
        return {
          total: res.meta?.total ?? res.data.length,
          items: res.data.map((row) => stripHiddenFields(type, row)),
        }
      },
    },
    {
      name: 'get_object',
      description: 'Fetch a single content object by id.',
      inputSchema: {
        type: 'object',
        required: ['type', 'id'],
        properties: {
          type: { type: 'string' },
          id: { type: 'string' },
          locale: { type: 'string', description: 'Read localized values' },
        },
      },
      handler: async (args) => {
        const type = typeOrThrow(ctx, args.type)
        if (!keyCanObjects(ctx.permissions, 'read', type.name)) {
          throw new Error(`This API key has no read grant for type "${type.name}".`)
        }
        // No status filter — id lookups may hit drafts; archived stays excluded
        let builder = ctx.client.objects(type.name)
          .where({ id: { eq: String(args.id) } })
          .limit(1)
        if (args.locale && builder.locale) builder = builder.locale(String(args.locale))
        const res = await builder.get()
        const row = res.data[0]
        if (!row) throw new Error(`No ${type.name} with id ${String(args.id)}.`)
        return stripHiddenFields(type, row)
      },
    },
  ]

  if (ctx.searchMedia && keyCanMedia(ctx.permissions)) {
    const searchMedia = ctx.searchMedia
    tools.push({
      name: 'search_media',
      description: 'Search media assets by filename/alt text, optionally by category (image, video, audio, document, other).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          category: { type: 'string', enum: ['image', 'video', 'audio', 'document', 'other'] },
          limit: { type: 'number' },
        },
      },
      handler: async (args) => ({
        items: await searchMedia({
          query: args.query ? String(args.query) : undefined,
          category: args.category ? String(args.category) : undefined,
          limit: clampLimit(args.limit),
        }),
      }),
    })
  }

  // Exposed (mcp !== false) AND key-granted; keep the def for column redaction.
  const grantedTables = exposedTables(ctx.customTables).filter((t) => keyCanTable(ctx.permissions, t.name))
  const grantedTableNames = grantedTables.map((t) => t.name)
  if (grantedTables.length > 0) {
    tools.push({
      name: 'query_table',
      description: `Query a custom table. Available tables: ${grantedTableNames.join(', ')}.`,
      inputSchema: {
        type: 'object',
        required: ['table'],
        properties: {
          table: { type: 'string', enum: grantedTableNames },
          where: { type: 'object', description: 'TangenQL-style filters' },
          sort: { type: 'string' },
          direction: { type: 'string', enum: ['asc', 'desc'] },
          limit: { type: 'number' },
        },
      },
      handler: async (args) => {
        const name = String(args.table)
        const def = grantedTables.find((t) => t.name === name)
        if (!def) {
          throw new Error(`This API key has no read grant for table "${name}", or it is not exposed to MCP.`)
        }
        let builder = ctx.client.table(name).limit(clampLimit(args.limit))
        if (args.where && typeof args.where === 'object') builder = builder.where(args.where as Record<string, unknown>)
        if (args.sort) builder = builder.sort(String(args.sort), (args.direction as 'asc' | 'desc') ?? 'desc')
        const res = await builder.get()
        // Redact hidden columns before rows leave the tool
        return { total: res.meta?.total ?? res.data.length, items: res.data.map((r) => stripTableColumns(def, r)) }
      },
    })
  }

  if (ctx.actions) {
    const actions = ctx.actions
    tools.push({
      name: 'get_object_actions',
      description: "Which lifecycle actions (publish, unpublish, schedule, stage, archive, restore, an extension's alternative) exist for an object, which are available to this key now, and every reason one is not. Ask before attempting a transition.",
      inputSchema: {
        type: 'object',
        required: ['type', 'id'],
        properties: { type: { type: 'string' }, id: { type: 'string' } },
      },
      handler: async (args) => {
        const type = typeOrThrow(ctx, args.type)
        if (!keyCanObjects(ctx.permissions, 'read', type.name)) {
          throw new Error(`This API key has no read grant for type "${type.name}".`)
        }
        return await actions(type.name, String(args.id))
      },
    })
  }

  return tools
}

/** Schema resources — one JSON document per exposed, readable type. */
export function buildSchemaResources(ctx: McpToolContext): McpResourceDef[] {
  return exposedTypes(ctx.types)
    .filter((t) => keyCanObjects(ctx.permissions, 'read', t.name))
    .map((t) => ({
      uri: `tangen://schema/${t.name}`,
      name: `${t.label} schema`,
      description: `Field definitions for the "${t.name}" content type`,
      mimeType: 'application/json',
      read: async () => JSON.stringify({
        name: t.name,
        label: t.label,
        singleton: t.singleton ?? false,
        fields: exposedFields(t).map((f) => ({
          name: f.name, label: f.label, fieldType: f.fieldType,
          required: f.required, helpText: f.helpText,
        })),
      }, null, 2),
    }))
}
