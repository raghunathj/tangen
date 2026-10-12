/**
 * File Name: graphql.ts
 * Purpose: The thin GraphQL mount — POST /api/v1/graphql. All the weight
 *          (schema generation from the content model, resolvers) lives in
 *          the OPTIONAL @tangen/graphql package, lazy-imported only when a
 *          workspace enables GraphQL. Disabled ⇒ 404 (route indistinguishable
 *          from absent); enabled-but-not-installed ⇒ a bun-add error.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Runs through the same auth middleware as every admin
 *          route — API keys and member sessions both reach it, and the
 *          package enforces per-type read grants in its resolvers (G2).
 *          For G0 the mount serves a minimal { ping } schema so the wiring
 *          is provable before generation lands. Realtime R5: the memoized
 *          schema gains a Subscription type while a realtime hub runs in
 *          the process, and `realtimeGraphqlSource` hands the same schema
 *          to the graphql-ws adapter on the realtime route, so a
 *          subscription over the socket and a query over POST see one
 *          schema.
 */
import { Elysia } from 'elysia'
import { deploymentRole } from '../lib/deployment-role'
import type { WorkspaceProject } from '@tangen/types'
import { createLocalClient } from '../services/local-client'
import { getSchema } from '../services/schema-cache'
import { gatewayContextOf } from '../gateway/request-context'
import { graphqlDepthCeiling, effectiveGraphqlDepth, assertGraphqlDepth } from '../gateway/graphql-depth'
import { getRealtimeHub } from '../realtime/transport'
import type { GraphqlWsSource } from '../realtime/graphql-ws'
import type { RealtimeIdentity } from '../realtime/authorize'
import { contributions, contributionsGeneration, noteContributionWarning } from '../kernel/contributions'
import { extensionWiringDeps, extensionExecution, bindExtensionCtx } from '../services/extension-server'
import { dispatchExecution } from '../kernel/intersect'

type GraphqlModule = typeof import('@tangen/graphql')
let graphqlModule: GraphqlModule | null | undefined

/** The optional package, loaded once; null when it is not installed. */
export async function loadGraphql(): Promise<GraphqlModule | null> {
  if (graphqlModule !== undefined) return graphqlModule
  try {
    graphqlModule = await import('@tangen/graphql')
  } catch {
    graphqlModule = null
  }
  return graphqlModule
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// The generated GraphQLSchema is expensive to build, so it is memoized per
// env and rebuilt only when the content schema fingerprint changes (i.e.
// after `tangen push`). One process-wide cache for the one schema of this database.
const _schemaCache = new Map<string, { fingerprint: string; schema: unknown }>()

function schemaFingerprint(schema: any, extra: unknown = null): string {
  return JSON.stringify([(schema?.types ?? []).map((t: any) => [
    t.name, t.disabled === true, (t.fields ?? []).map((f: any) => [f.name, f.fieldType, f.disabled === true, f.config?.targetType, f.config?.many]),
  ]), extra])
}

/**
 * The memoized generated schema for one environment. The Subscription type
 * (Realtime R5) is generated only while a realtime hub runs in this process,
 * and that flag is part of the fingerprint, so introspection never
 * advertises subscriptions a deployment cannot serve. Shared by the POST
 * mount, the SDL route and the graphql-ws adapter, so the three can never
 * drift.
 */
/** A `graphql.types@1` item as the route folds it in (Extension Kernel K8.4). */
export interface GraphqlExtensionItem { extensionId: string; sdl: string; resolvers?: Record<string, Record<string, (...args: never[]) => unknown>> }

/** What the ACTIVE extensions contribute to the schema, each with its extension id; an item without SDL is dropped with a warning. */
export function graphqlContributionsFor(workspaceId: string, activeIds: ReadonlySet<string>): GraphqlExtensionItem[] {
  const out: GraphqlExtensionItem[] = []
  for (const c of contributions<{ sdl?: unknown; resolvers?: unknown }>('graphql.types@1', { activeIds, workspaceId })) {
    if (!c.item || typeof c.item.sdl !== 'string' || !c.item.sdl.trim()) { noteContributionWarning(`graphql.types@1 from extension "${c.extensionId}" dropped: sdl must be a non-empty string`); continue }
    out.push({ extensionId: c.extensionId, sdl: c.item.sdl, resolvers: (c.item.resolvers ?? undefined) as GraphqlExtensionItem['resolvers'] })
  }
  return out
}

/** The active set for a workspace, from the boot wiring; empty when nothing is wired (tests, a lean process). */
async function activeExtensionsFor(workspaceId: string): Promise<Set<string>> {
  const deps = extensionWiringDeps()
  if (!deps?.activeIds) return new Set()
  return new Set(await deps.activeIds(workspaceId).catch(() => [] as string[]))
}

export function graphqlSchemaFor(gql: GraphqlModule, input: { schema: unknown; project: any; mutations: boolean; extensions?: GraphqlExtensionItem[] }): unknown {
  const { schema, project } = input
  const subscriptions = getRealtimeHub() !== null
  const extensions = input.extensions ?? []
  const fingerprint = schemaFingerprint(schema, {
    t: (project?.config?.customTables ?? []).map((x: any) => x.name),
    g: Object.keys(project?.config?.globals ?? {}),
    m: input.mutations,
    s: subscriptions,
    // K8.4: the contributions, and the registry generation so a runtime `contribute` rebuilds too.
    x: extensions.map((e) => [e.extensionId, e.sdl]),
    gen: contributionsGeneration(),
  })
  const cacheKey = String(project?.workspaceId ?? '*')
  const cached = _schemaCache.get(cacheKey)
  if (cached?.fingerprint === fingerprint) return cached.schema
  const customTables = (project?.config?.customTables ?? []) as Array<{ name: string; columns: Record<string, { type: string }> }>
  const globalNames = Object.keys((project?.config?.globals ?? {}) as Record<string, unknown>)
  const built = gql.buildContentSchema((schema ?? { types: [] }) as never, {
    resolvers: gql.createResolvers() as never,
    customTables: customTables.map((t) => ({ name: t.name, columns: t.columns })),
    globalNames,
    mutations: input.mutations,
    componentRegistry: (project?.components ?? []) as never,
    subscriptions,
  })
  // K8.4: what the active extensions add - types, Query/Mutation fields, computed fields; a failing contribution is dropped with a warning.
  const withExtensions = extensions.length
    ? gql.applyGraphqlContributions(built as never, extensions as never, { warn: noteContributionWarning })
    : built
  _schemaCache.set(cacheKey, { fingerprint, schema: withExtensions })
  return withExtensions
}

/**
 * Realtime R5: what the graphql-ws adapter needs for a connection - the
 * env's generated schema and a context whose `canRead` is the identity's,
 * the way the POST mount builds one for a request. Null where GraphQL is not
 * enabled for the identity's environment (the socket is refused 404, as the
 * POST is). Subscriptions read no content, so the context carries no client:
 * the page refetches through a query.
 */
export function realtimeGraphqlSource(deps: { db: unknown; redis: unknown; projects: () => WorkspaceProject[] }): GraphqlWsSource {
  const noClient = { objects: () => { throw new Error('GraphQL subscriptions carry no content: query the object through POST /api/v1/graphql') } }
  return async (identity: RealtimeIdentity) => {
    const gql = await loadGraphql()
    if (!gql) return null
    const project = deps.projects().find((p) => p.workspaceId === identity.workspaceId)
        const config = gql.resolveGraphqlConfig(project as never, deploymentRole() === 'development')
    if (!config.enabled) return null
    const schema = await getSchema(deps.db as never, deps.redis as never)
    const built = graphqlSchemaFor(gql, { schema, project, mutations: config.mutations, extensions: graphqlContributionsFor(identity.workspaceId, await activeExtensionsFor(identity.workspaceId)) })
    return {
      gql,
      schema: built as never,
      context: (realtime) => gql.createRequestContext({
        client: noClient,
        canRead: (type) => gql.canReadType(identity.permissions, type),
        canReadDrafts: (type) => gql.canReadDraftsType(identity.permissions, type),
        realtime,
      }),
    }
  }
}


/**
 * Whether POST /api/v1/graphql would answer for this environment: the
 * optional package is installed AND the workspace enables GraphQL for the
 * env. The admin reads this from /admin/ui-config instead of probing the
 * route with a POST that 404s (and logs a console error) on every project
 * that never turned GraphQL on.
 */
export async function graphqlEnabledFor(project: unknown): Promise<boolean> {
  const gql = await loadGraphql()
  if (!gql) return false
  try { return Boolean(gql.resolveGraphqlConfig(project as never, deploymentRole() === 'development').enabled) } catch { return false }
}

async function handle(ctx: any): Promise<Response> {
  const { db, redis, workspaceId, schema, workspaceProjects, body } = ctx
  const project = (workspaceProjects as any[])?.find((p) => p.workspaceId === workspaceId)

  const gql = await loadGraphql()
  if (!gql) {
    // Configured but the package is missing ⇒ say so; otherwise 404
    const configured = Boolean((project as any)?.graphql?.enabled)
    return configured
      ? json(500, { error: { code: 'GRAPHQL_PACKAGE_MISSING', message: 'GraphQL is enabled in config but @tangen/graphql is not installed - run: bun add @tangen/graphql', status: 500 } })
      : json(404, { error: { code: 'NOT_FOUND', message: 'Route not found', status: 404 } })
  }

  const config = gql.resolveGraphqlConfig(project as never, deploymentRole() === 'development')
  if (!config.enabled) {
    return json(404, { error: { code: 'NOT_FOUND', message: 'Route not found', status: 404 } })
  }

  const query = String(body?.query ?? '')
  if (!query.trim()) {
    return json(400, { error: { code: 'VALIDATION_ERROR', message: 'A GraphQL query is required', status: 400 } })
  }

  // M6: the Gateway's ceiling, measured on the document alone and refused
  // BEFORE the schema is built or consulted. A query that does not parse
  // measures null and is left to the normal syntax error below.
  const ceiling = graphqlDepthCeiling(project)
  const measured = gql.measureQueryDepth(query)
  if (measured !== null) assertGraphqlDepth(gatewayContextOf(ctx), measured, ceiling)

  // Build (or reuse) the generated schema for this env. The fingerprint
  // changes when the content schema does (tangen push), triggering a rebuild.
  const gqlSchema = graphqlSchemaFor(gql, { schema, project, mutations: config.mutations, extensions: graphqlContributionsFor(workspaceId, await activeExtensionsFor(workspaceId)) })

  const client = createLocalClient({
    db, redis, schema, workspaceId, customTables: project?.config?.customTables ?? [],
    // C1: GraphQL mutations run content hooks like the REST routes do
    projects: workspaceProjects as never,
    // K3: the writes run as this request's key, through the canonical operations
    exec: ctx.exec,
  })
  const permissions = ctx.permissions
  const contextValue = gql.createRequestContext({
    client,
    canRead: (type: string) => gql.canReadType(permissions, type),
    canWrite: config.mutations ? (type: string) => gql.canWriteType(permissions, type) : undefined,
    canPublish: config.mutations ? (type: string) => gql.canPublishTypeObjects(permissions, type) : undefined,
    canReadDrafts: (type: string) => gql.canReadDraftsType(permissions, type),
  })
  // K8.4: a contributed resolver runs with its extension's ctx bound to THIS caller - the caller's
  // permissions ∩ the extension's grants - and only while the extension is active here.
  ;(contextValue as unknown as Record<string, unknown>).extensionCtx = async (extensionId: string) => {
    const deps = extensionWiringDeps()
    if (!deps || !(await deps.isActive(extensionId, workspaceId))) return null
    const own = extensionExecution(extensionId, workspaceId)
    return bindExtensionCtx(await deps.buildCtx(extensionId, workspaceId), ctx.exec ? dispatchExecution(own, ctx.exec) : own)
  }

  const result = await gql.executeGraphql({
    schema: gqlSchema as never,
    source: query,
    variableValues: body?.variables ?? null,
    operationName: body?.operationName ?? null,
    contextValue,
    introspection: config.introspection,
    // CF-2: the resolved setting finally reaches a validation rule. Without
    // this the key existed, defaulted to 12, and enforced nothing. M6: it
    // may tighten the Gateway's ceiling and never loosen it.
    maxDepth: effectiveGraphqlDepth(config.maxDepth, ceiling),
  })
  return json(200, result)
}

/**
 * GET serves the GraphiQL explorer (dev convenience) when enabled — but it
 * is NOT authenticated (no member session on a browser GET), so it only
 * renders the shell; the actual queries it POSTs carry the browser's admin
 * session cookies/headers. Disabled or graphiql:false ⇒ 404.
 */
async function handleGet(ctx: any): Promise<Response> {
  // Auth-exempt (see auth middleware) — no session context here. Serve the
  // shell whenever the package is present; the POST it makes is authenticated
  // and 404s when GraphQL is disabled for the resolved env.
  const gql = await loadGraphql()
  if (!gql) return json(404, { error: { code: 'NOT_FOUND', message: 'Route not found', status: 404 } })
  const url = new URL(ctx.request.url)
  const env = url.searchParams.get('env') ?? 'development'
  return new Response(gql.graphiqlHTML(`/api/v1/graphql`), {
    status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/**
 * PG-5 — the generated schema's SDL for the admin GraphQL workbench. Admin
 * gated and INDEPENDENT of the public introspection setting: autocomplete and
 * the docs explorer must work even where introspection is off. Reads the same
 * memoized schema the endpoint executes against, so it can never drift.
 */
async function handleSdl(ctx: any): Promise<Response> {
  const { workspaceId, schema, workspaceProjects, memberId } = ctx
  const role = String(ctx.memberRole ?? '')
  if (!memberId || (role !== 'owner' && role !== 'admin' && role !== 'superadmin')) {
    return json(403, { error: { code: 'FORBIDDEN', message: 'The GraphQL workbench is available to owners and admins only', status: 403 } })
  }
  const gql = await loadGraphql()
  if (!gql) return json(404, { error: { code: 'NOT_FOUND', message: '@tangen/graphql is not installed', status: 404 } })
  const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
  const config = gql.resolveGraphqlConfig(project as never, deploymentRole() === 'development')
  if (!config.enabled) {
    return json(404, { error: { code: 'NOT_FOUND', message: 'GraphQL is not enabled for this deployment', status: 404 } })
  }
  const gqlSchema = graphqlSchemaFor(gql, { schema, project, mutations: config.mutations, extensions: graphqlContributionsFor(workspaceId, await activeExtensionsFor(workspaceId)) })
  return json(200, { data: { sdl: gql.printSchemaSDL(gqlSchema as never), mutations: config.mutations } })
}

export const graphqlRoute = (app: Elysia) =>
  app
    .post('/api/v1/graphql', (ctx: any) => handle(ctx))
    .get('/api/v1/graphql', (ctx: any) => handleGet(ctx))
    .get('/api/v1/admin/graphql/sdl', (ctx: any) => handleSdl(ctx))
