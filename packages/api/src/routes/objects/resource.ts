/**
 * File Name: resource.ts
 * Purpose: Resource-style object routes — /api/v1/objects/{type}[/...] — that
 *          delegate to the legacy handlers after injecting the content type
 *          from the path parameter. Also owns the single-segment dispatcher
 *          that distinguishes GET /objects/{type} (list) from the legacy
 *          GET /objects/{id}?type= lookup.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Since Phase 6A these are the ONLY object routes: the
 *          legacy RPC forms (type in the body or in ?type=) are gone, and
 *          `/objects/{type}/...` is the whole content contract. The first path
 *          position is still bound as ":id" (Elysia requires one shared param
 *          name per position, and the Admin-internal versions/schedule routes
 *          own it) and read as the type; ":objectId" is the second segment.
 *          Content type names that match reserved literals (query, by-slug,
 *          slug-check, bulk-update, export, preflight, migrate) cannot be
 *          addressed via resource paths.
 */
import { Elysia, t } from 'elysia'
import type { QueryObject, SchemaDefinition } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { handleQuery, assertKnownQueryKeys } from './query'
import { handleGetById } from './get'
import { handleGetBySlug } from './by-slug'
import { makeCreateHandler } from './create'
import { makeUpdateHandler } from './update'
import { extensionWiringDeps, resolvePublishPolicies } from '../../services/extension-server'
import { dryRunContentPublish } from '../../services/content-filters'
import { lifecycleActions, publishPolicyOf } from '../../kernel/lifecycle-actions'
import { actorFromContext } from '../../kernel/actor'
import { makeDbRowLoader } from '../../services/publish-cascade'
import { projectLocalization } from '../../services/i18n'
import { listRegisteredExtensionIds, getExtensionServer } from '../../hooks/app-hooks-registry'
import { makeDeleteHandler } from './delete'
import { makePublishHandler, makeUnpublishHandler, makeStageHandler, makePreflightHandler } from './publish'

/**
 * TypeBox schema for POST /objects/:type/query — the full query body without
 * `type` (it comes from the path). Mirrors queryBodySchema in query.ts.
 */
export const resourceQueryBodySchema = t.Object({
  status: t.Optional(t.String()),
  query: t.Optional(t.Record(t.String(), t.Any())),
  cacheStrategy: t.Optional(t.Object({ ttl: t.Number(), swr: t.Optional(t.Number()) })),
  sort: t.Optional(t.Object({
    field: t.String(),
    direction: t.Union([t.Literal('asc'), t.Literal('desc')]),
  })),
  limit: t.Optional(t.Number()),
  offset: t.Optional(t.Number()),
  after: t.Optional(t.String()),
  depth: t.Optional(t.Number()),
  props: t.Optional(t.Array(t.String())),
  populate: t.Optional(t.Record(t.String(), t.Array(t.String()))),
  serialize: t.Optional(t.Record(t.String(), t.Any())),
  locale: t.Optional(t.String()),
  includeLabels: t.Optional(t.Boolean()),
  total: t.Optional(t.Boolean()),
})

/** The keys this route accepts, derived from its own schema. `type` comes from the path. */
export const RESOURCE_QUERY_BODY_KEYS = new Set(
  Object.keys((resourceQueryBodySchema as unknown as { properties: Record<string, unknown> }).properties),
)

/**
 * Returns true when the path segment names a content type in the schema —
 * the dispatch decision between list (resource style) and get-by-id (legacy).
 */
export function isTypeSegment(segment: string, schema: SchemaDefinition): boolean {
  return schema.types.some((t) => t.name === segment)
}

/**
 * Throws TYPE_NOT_FOUND when the path's type segment is not in the schema.
 */
export function assertTypeExists(typeName: string, schema: SchemaDefinition): void {
  if (!schema.types.some((t) => t.name === typeName)) {
    throw new RequestError('TYPE_NOT_FOUND', `Type "${typeName}" not found in schema`, 404)
  }
}

/** Query params the GET-list route actually consumes. */
const LIST_PARAMS = new Set(['status', 'limit', 'offset', 'depth', 'locale', 'sort', 'props', 'total'])

/** Params consumed by infrastructure before the handler (auth, env routing). */
const INFRA_PARAMS = new Set(['env', 'key', 'type'])

/**
 * Frequent wrong guesses, each redirected to the thing that works. `slug` is
 * the documented case: it used to be silently ignored, so a "find by slug"
 * returned the whole collection and callers wrote against row one.
 */
const PARAM_HINTS: Record<string, (type: string) => string> = {
  slug: (t) => `to fetch one object by slug use GET /api/v1/objects/${t}/by-slug/<slug>`,
  filter: (t) => `to filter a list use POST /api/v1/objects/${t}/query with a TangenQL body`,
  where: (t) => `to filter a list use POST /api/v1/objects/${t}/query with a TangenQL body`,
  query: (t) => `to filter a list use POST /api/v1/objects/${t}/query with a TangenQL body`,
  search: (t) => `to search use POST /api/v1/objects/${t}/query with a TangenQL body`,
}

/**
 * Maps GET-list query-string params onto a QueryObject for the query handler.
 * Supported: status, limit, offset, sort=field[:asc|desc], depth, props (csv).
 *
 * Unknown params are a 400, not a shrug. Tolerating them turned a typo into a
 * silently widened result set that callers then wrote against (finding #1);
 * a filter that does not filter is never what the caller meant.
 */
export function parseListParams(
  typeName: string,
  query: Record<string, string | undefined>,
): QueryObject {
  for (const k of Object.keys(query)) {
    if (LIST_PARAMS.has(k) || INFRA_PARAMS.has(k)) continue
    const hint = PARAM_HINTS[k]?.(typeName)
    throw new RequestError(
      'VALIDATION_ERROR',
      `Unknown query parameter "${k}" on the list route${hint ? ` - ${hint}` : ''}. `
      + `Supported: ${[...LIST_PARAMS].join(', ')}.`,
      400,
    )
  }

  const out: QueryObject = { type: typeName }

  if (query.status) out.status = query.status as QueryObject['status']

  const num = (v: string | undefined): number | undefined => {
    if (v === undefined) return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  const limit = num(query.limit)
  if (limit !== undefined) out.limit = limit
  const offset = num(query.offset)
  if (offset !== undefined) out.offset = offset
  // ?total=false skips the exact count; anything else keeps the default.
  if (query.total === 'false' || query.total === '0') out.total = false
  const depth = num(query.depth)
  if (depth !== undefined) out.depth = depth

  if (query.locale) out.locale = query.locale

  if (query.sort) {
    const [field, direction] = query.sort.split(':')
    out.sort = { field, direction: direction === 'desc' ? 'desc' : 'asc' }
  }

  if (query.props) out.props = query.props.split(',').map((p) => p.trim()).filter(Boolean)

  return out
}

/**
 * Adapts a resource-path ctx (params.id = type, params.objectId = object id)
 * to the legacy handler contract (query.type = type, params.id = object id).
 */
/** The action policy for one request: the caller's actor, the workspace's locale, the installed extensions' policies. */
export async function lifecycleActionsFor(ctx: any, typeName: string, objectId?: string) {
  const project = (ctx.workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === ctx.workspaceId)
  const wiring = extensionWiringDeps()
  const entries = wiring
    ? listRegisteredExtensionIds().map((id) => ({ id, server: (getExtensionServer(id) ?? {}) as Record<string, unknown> }))
    : []
  return lifecycleActions({
    schema: ctx.schema,
    workspaceId: ctx.workspaceId,
    defaultLocale: projectLocalization(project)?.defaultLocale ?? null,
    loadRow: makeDbRowLoader(ctx.db, ctx.workspaceId),
    publishPolicies: (input) => wiring
      ? resolvePublishPolicies({ entries, isActive: wiring.isActive, buildCtx: wiring.buildCtx as never, workspaceId: ctx.workspaceId, ...input })
      : Promise.resolve([]),
    // K4.5: content.publish@1 as a dry run, so the editor shows a filter's veto before the click.
    publishDryRun: (input) => {
      const typeDef = (ctx.schema as { types: Array<{ name: string; fields: Array<{ name: string }> }> }).types.find((t) => t.name === input.typeName)
      return typeDef ? dryRunContentPublish({ workspaceId: ctx.workspaceId, typeName: input.typeName, row: input.row, typeDef }) : Promise.resolve(null)
    },
  }, actorFromContext(ctx), { typeName, objectId })
}

function withResourceParams(handler: (ctx: any) => Promise<unknown>) {
  return (ctx: any) => {
    const typeName = ctx.params.id as string
    assertTypeExists(typeName, ctx.schema)
    ctx.query.type = typeName
    ctx.params.id = ctx.params.objectId
    return handler(ctx)
  }
}

/**
 * Elysia plugin registering the resource-style object routes. Mounted after
 * authMiddleware, replacing the legacy GET /objects/:id registration with the
 * list-vs-id dispatcher.
 * @param projects - Workspace projects passed through to the mutating handlers' hook runners.
 */
export const resourceObjectRoutes = (projects: any[]) => (app: Elysia) => {
  const createHandler = makeCreateHandler(projects)
  const updateHandler = makeUpdateHandler(projects)
  const deleteHandler = makeDeleteHandler(projects)
  const publishHandler = makePublishHandler(projects)
  const unpublishHandler = makeUnpublishHandler(projects)
  const stageHandler = makeStageHandler(projects)
  const preflightHandler = makePreflightHandler()

  return app
    // Dispatcher: /objects/{type} → list; /objects/{id} → legacy by-id lookup.
    // (Both occupy the same single-segment pattern, so one route must decide.)
    // GET /objects/{type} - the list. The segment is a content type: since
    // Phase 6A there is no by-id lookup here, so an unknown segment is an
    // unknown type and says so rather than being read as an object id.
    .get('/api/v1/objects/:id', (ctx: any) => {
      const typeName = ctx.params.id as string
      assertTypeExists(typeName, ctx.schema)
      ctx.body = parseListParams(typeName, ctx.query)
      return handleQuery(ctx)
    })

    // Full query power without type in the body
    .post('/api/v1/objects/:id/query', (ctx: any) => {
      const typeName = ctx.params.id as string
      assertTypeExists(typeName, ctx.schema)
      ctx.body = { ...(ctx.body ?? {}), type: typeName }
      return handleQuery(ctx)
    }, {
      body: resourceQueryBodySchema,
      // The key check runs in `parse`, on the RAW body. Elysia normalises
      // unknown properties away before a handler - and before schema
      // validation - so `additionalProperties: false` never fires and a
      // handler-side check sees a body the unknown key has already left.
      parse: async ({ request }: any) => {
        const raw = await request.json()
        assertKnownQueryKeys(raw, RESOURCE_QUERY_BODY_KEYS)
        return raw
      },
    })

    // Create
    .post('/api/v1/objects/:id', (ctx: any) => {
      const typeName = ctx.params.id as string
      assertTypeExists(typeName, ctx.schema)
      ctx.body = { ...(ctx.body ?? {}), type: typeName }
      return createHandler(ctx)
    })

    // Slug lookup (static segment wins over :objectId below)
    .get('/api/v1/objects/:id/by-slug/:slug', (ctx: any) => {
      const typeName = ctx.params.id as string
      assertTypeExists(typeName, ctx.schema)
      ctx.query.type = typeName
      return handleGetBySlug(ctx)
    })

    /**
     * Is publishing currently unavailable for this type, and why? Advisory:
     * the editor uses it to offer "Save as draft" instead of a Publish button
     * that a content hook would refuse anyway. With no extension declaring a
     * policy - a plain Tangen - this always answers { blocked: false } and
     * nothing on screen changes.
     */
    .get('/api/v1/objects/:id/publish-policy', async (ctx: any) => {
      // K2: a projection of the lifecycle action policy below, kept for two
      // releases. Surfaces should read /actions.
      const typeName = ctx.params.id as string
      assertTypeExists(typeName, ctx.schema)
      const objectId = typeof ctx.query?.objectId === 'string' ? ctx.query.objectId : undefined
      return { data: publishPolicyOf(await lifecycleActionsFor(ctx, typeName, objectId)) }
    })

    /**
     * The lifecycle action policy (kernel plan §6): which actions exist for
     * this type or object, whether each is available to the CALLER now, and
     * every reason it is not - permissions, base-locale rights, the status
     * machine, a validation dry run, the relation cascade, and each
     * installed extension's publish policy with the action it offers in
     * place. The editor, the list, Studio and MCP project this.
     */
    .get('/api/v1/objects/:id/actions', async (ctx: any) => {
      const typeName = ctx.params.id as string
      assertTypeExists(typeName, ctx.schema)
      const objectId = typeof ctx.query?.objectId === 'string' && ctx.query.objectId ? ctx.query.objectId : undefined
      return { data: await lifecycleActionsFor(ctx, typeName, objectId) }
    })
    .get('/api/v1/objects/:id/:objectId/actions', async (ctx: any) => {
      const typeName = ctx.params.id as string
      assertTypeExists(typeName, ctx.schema)
      return { data: await lifecycleActionsFor(ctx, typeName, ctx.params.objectId as string) }
    })

    // Single object CRUD
    .get('/api/v1/objects/:id/:objectId', withResourceParams(handleGetById))
    .patch('/api/v1/objects/:id/:objectId', withResourceParams(updateHandler))
    .delete('/api/v1/objects/:id/:objectId', withResourceParams(deleteHandler))

    // Status transitions
    .post('/api/v1/objects/:id/:objectId/publish/preflight', withResourceParams(preflightHandler))
    .post('/api/v1/objects/:id/:objectId/publish', withResourceParams(publishHandler))
    .post('/api/v1/objects/:id/:objectId/unpublish', withResourceParams(unpublishHandler))
    .post('/api/v1/objects/:id/:objectId/stage', withResourceParams(stageHandler))
}
