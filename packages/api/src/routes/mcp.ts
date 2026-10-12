/**
 * File Name: mcp.ts
 * Purpose: POST /api/v1/mcp — thin mount for the OPTIONAL @tangen/mcp
 *          package (JSON-RPC over HTTP; synchronous request/response, no
 *          SSE stream). The package is imported LAZILY and only when the
 *          workspace/env enables MCP, so hosts
 *          that never enable it load none of its code; if the config
 *          enables MCP but the package is missing, the route says exactly
 *          what to install.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: All MCP logic (protocol, tools, exposure, grants)
 *          lives in @tangen/mcp; this file only wires auth context, the
 *          LocalClient, and the media-search provider into it.
 */
import { embeddingsSettingsFor } from '../config/service-settings'
import { and, eq, like, or, desc } from 'drizzle-orm'
import { observeMcpCall } from './mcp-telemetry'
import { Elysia } from 'elysia'
import { mediaAssets, workspaceActivity } from '@tangen/db'
import { randomUUID } from 'node:crypto'
import { categoryCondition, folderScopeCondition } from './media/list'
import { makePublishHandler, makeUnpublishHandler } from './objects/publish'
import { lifecycleActionsFor } from './objects/resource'
import { contributions as mcpContributions } from '../kernel/contributions'
import { createLocalClient } from '../services/local-client'
import { extensionWiringDeps } from '../services/extension-server'

type McpModule = typeof import('@tangen/mcp')
let mcpModule: McpModule | null | undefined

async function loadMcp(): Promise<McpModule | null> {
  if (mcpModule !== undefined) return mcpModule
  try {
    mcpModule = await import('@tangen/mcp')
  } catch {
    mcpModule = null
  }
  return mcpModule
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export const mcpRoute = (app: Elysia) =>
  app.post('/api/v1/mcp', async (ctx: any) => {
    const { db, redis, workspaceId, permissions, apiKeyId, schema, workspaceProjects, body } = ctx

    // API-key sessions only — member JWTs are for the admin UI
    if (!apiKeyId) {
      return json(403, { error: { code: 'FORBIDDEN', message: 'MCP requires an API key', status: 403 } })
    }

    const mcp = await loadMcp()
    const project = (workspaceProjects as any[])?.find((p) => p.workspaceId === workspaceId)

    // Config resolution needs the package too — a missing package with MCP
    // configured should say so, not 404
    if (!mcp) {
      const configured = Boolean((project as any)?.mcp?.enabled)
      return configured
        ? json(500, { error: { code: 'MCP_PACKAGE_MISSING', message: 'MCP is enabled in config but @tangen/mcp is not installed - run: bun add @tangen/mcp', status: 500 } })
        : json(404, { error: { code: 'NOT_FOUND', message: 'Route not found', status: 404 } })
    }

    const config = mcp.resolveMcpConfig(project)
    if (!config.enabled) {
      return json(404, { error: { code: 'NOT_FOUND', message: 'Route not found', status: 404 } })
    }

    const customTableDefs = project?.config?.customTables ?? []
    // K3: the client acts as this request's key, so create/update through it are the canonical operations under the key's grants.
    const client = createLocalClient({ db, redis, schema, workspaceId, customTables: customTableDefs, projects: workspaceProjects as never, exec: ctx.exec })

    // Publish/unpublish reuse the REAL route handlers via a synthetic ctx so
    // grants, validation, field hooks, and content hooks all fire (full mode).
    const statusCtx = (typeName: string, id: string) => ({
      ...ctx,
      params: { id },
      query: { type: typeName },
    })
    const writeOps = {
      // Audit: every MCP write lands in workspace_activity (actor = the key)
      audit: (event: { action: string; typeName: string; objectId: string; title?: string }) => {
        void db.insert(workspaceActivity).values({
          id: `act_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          workspaceId, category: 'content',
          action: event.action,
          actorId: apiKeyId,
          actorName: ctx.identity?.name ?? 'MCP agent',
          actorType: ctx.exec?.actor.identity.kind ?? 'api_key',
          source: 'sdk',
          typeName: event.typeName,
          objectId: event.objectId,
          objectTitle: event.title ?? null,
        }).catch(() => { /* audit is best-effort */ })
      },
      create: async (typeName: string, title: string, values: Record<string, unknown>) =>
        (await (client.objects(typeName) as any).create({ title, values })).data,
      update: async (typeName: string, id: string, updates: Record<string, unknown>) =>
        (await (client.objects(typeName) as any).update(id, updates)).data,
      publish: async (typeName: string, id: string) => {
        const res = await makePublishHandler(workspaceProjects ?? [])(statusCtx(typeName, id))
        return (res as any)?.data ?? { id }
      },
      unpublish: async (typeName: string, id: string) => {
        const res = await makeUnpublishHandler(workspaceProjects ?? [])(statusCtx(typeName, id))
        return (res as any)?.data ?? { id }
      },
    }

    // Extension-contributed tools — namespaced ext_<id>_<name>, offered only
    // for extensions ACTIVE in this workspace x environment (Phase 4).
    const activeExtensions = new Set(await (extensionWiringDeps()?.activeIds?.(workspaceId) ?? Promise.resolve([] as string[])))
    // K0: an extension tool is offered only to a key holding the tool's
    // declared objects grant (default: read), and its handler receives the
    // calling key - before this every tool of every active extension ran for
    // any key with `{ workspaceId }` alone.
    const keyHoldsObjects = (action: 'read' | 'write' | 'publish') =>
      Boolean((permissions as { objects?: { actions?: string[] } } | undefined)?.objects?.actions?.includes(action))
    // K2.1: `mcp.tools@1` through the contribution registry (the legacy `mcpTools` key reads the same way).
    const extensionTools = (project?.extensions ?? []).filter((ext: { id: string }) => activeExtensions.has(ext.id)).flatMap((ext: { id: string }) =>
      mcpContributions('mcp.tools@1', { activeIds: new Set([ext.id]) }).map((c) => c.item as never)
        .filter((tool: any) => keyHoldsObjects(tool.access?.objects ?? 'read'))
        .map((tool: any) => ({
          name: 'ext_' + ext.id.replace(/[^a-zA-Z0-9]/g, '_') + '_' + tool.name,
          description: '[' + ext.id + '] ' + tool.description,
          inputSchema: tool.inputSchema,
          // K7: the tool runs as the caller - its execution and a client bound to it.
          handler: (args: Record<string, unknown>) =>
            Promise.resolve(tool.handler(args, { workspaceId, apiKeyId, permissions, exec: ctx.exec, tangen: client })),
        })),
    )

    // generate_schema - the headless half of the AI schema builder (finding #7:
    // "agents build schemas" was admin-UI only). Offered ONLY when the runtime
    // can write schema files (dev mode) AND the key carries a schema grant.
    // It returns DRAFTS and never writes: the agent reviews, writes the file
    // into app/content-objects/ (or app/components/), and runs `tangen push` -
    // the same gated path a human takes.
    {
      const { getSchemaWritable } = await import('../lib/schema-writable')
      const schemaGrant = ((permissions as any)?.schema?.actions ?? []) as string[]
      if (getSchemaWritable() && schemaGrant.length > 0) {
        const { generateSchemaDraft, generateSchemaSet, realGeneration } = await import('./ai/schema-generate')
        const genCtx = { db, workspaceId, workspaceProjects, schema, body: {} }
        extensionTools.push({
          name: 'generate_schema',
          description:
            'Generate a DRAFT Tangen schema from a natural-language brief - one content type, '
            + 'component, or global (kind), or a whole related set (set: true). Returns definitions '
            + 'only; nothing is written. Apply by writing the definition into app/content-objects/ '
            + 'or app/components/ and running `tangen push`.',
          inputSchema: {
            type: 'object', required: ['brief'],
            properties: {
              brief: { type: 'string', description: 'What to model, in plain language' },
              kind: { type: 'string', enum: ['type', 'component', 'global'], description: 'Default: type' },
              set: { type: 'boolean', description: 'Generate a whole related data model instead of one item' },
              current: { type: 'object', description: 'An existing draft to refine' },
            },
          },
          handler: async (args: Record<string, unknown>) => {
            const brief = String(args.brief ?? '').trim()
            if (!brief) throw new Error('brief is required')
            if (args.set === true) {
              const res = await generateSchemaSet(genCtx, { prompt: brief }, realGeneration)
              return {
                drafts: res.drafts, provider: res.provider, model: res.model,
                next: 'Review each draft, write it into app/content-objects/<name>/schema.ts (components into app/components/), then run: tangen push',
              }
            }
            const kind = (['type', 'component', 'global'].includes(String(args.kind)) ? String(args.kind) : 'type') as 'type' | 'component' | 'global'
            const res = await generateSchemaDraft(genCtx, { kind, prompt: brief, current: args.current }, realGeneration)
            return {
              draft: res.draft, kind, provider: res.provider, model: res.model,
              next: 'Review the draft, write it into ' + (kind === 'component' ? 'app/components/<name>/schema.ts' : 'app/content-objects/<name>/schema.ts') + ', then run: tangen push',
            }
          },
        })
      }
    }

    // ask_docs delegates here when Knowledge is on; stays a fallback otherwise.
    let askDocs: undefined | ((a: { query: string; limit: number }) => Promise<{ passages: { source: string; content: string; score?: number }[] }>)

    // knowledge_search lights up when BOTH surfaces are enabled
    try {
      const knowledge = await import('@tangen/knowledge')
      const kconfig = knowledge.resolveKnowledgeConfig(project)
      if (kconfig.enabled) {
        const { knowledgeExec } = await import('../services/knowledge-sync')
        // Grounded doc Q&A for the dev loop — same index, filtered to file/doc sources.
        askDocs = async ({ query, limit }) => {
          const embeddings = knowledge.requireEmbeddingsConfig(kconfig)
          const adapter = knowledge.getEmbeddingAdapter(embeddingsSettingsFor(project, embeddings))
          const store = knowledge.createKnowledgeStore(knowledgeExec(db))
          const meta = await store.getMeta(workspaceId).catch(() => undefined)
          if (!meta) throw new Error('No knowledge index yet - run: tangen knowledge index --docs')
          const [vector] = await adapter.embed([query])
          const hits = await store.search(workspaceId, vector, {
            k: Math.min(limit, 25), audiences: mcp.keySearchAudiences(permissions), qaBoost: kconfig.qaBoost,
          })
          return {
            // Docs AND content, but per-type/table read grants still apply
            // (files/assets/qa are audience-gated by the search SQL) so ask_docs
            // can never surface content the key isn't allowed to read.
            passages: hits
              .filter((h) => {
                if (h.sourceKind === 'object') return mcp.keyCanObjects(permissions, 'read', h.sourceGroup)
                if (h.sourceKind === 'table') return mcp.keyCanTable(permissions, h.sourceGroup)
                return true
              })
              .map((h) => ({ source: `${h.sourceKind}:${h.sourceGroup}/${h.sourceId}`, content: h.content, score: h.score })),
          }
        }
        extensionTools.push({
          name: 'knowledge_search',
          description: 'Semantic search over the workspace knowledge index (published content, tables, documents). Returns passages with sources.',
          inputSchema: {
            type: 'object', required: ['query'],
            properties: { query: { type: 'string' }, limit: { type: 'number' }, locale: { type: 'string', description: 'Retrieve in this locale (default-locale fallback included)' } },
          },
          handler: async (args: Record<string, unknown>) => {
            const embeddings = knowledge.requireEmbeddingsConfig(kconfig)
            const adapter = knowledge.getEmbeddingAdapter(embeddingsSettingsFor(project, embeddings))
            const store = knowledge.createKnowledgeStore(knowledgeExec(db))
            const meta = await store.getMeta(workspaceId).catch(() => undefined)
            if (!meta) throw new Error('No knowledge index yet - run: tangen knowledge index')
            const [vector] = await adapter.embed([String(args.query ?? '')])
            const hits = await store.search(workspaceId, vector, { k: Math.min(Number(args.limit) || 8, 25), locale: args.locale ? String(args.locale) : undefined, audiences: mcp.keySearchAudiences(permissions), qaBoost: kconfig.qaBoost })
            const allowed = hits.filter((h) => {
              if (h.sourceKind === 'object') return mcp.keyCanObjects(permissions, 'read', h.sourceGroup)
              if (h.sourceKind === 'table') return mcp.keyCanTable(permissions, h.sourceGroup)
              return true
            })
            const { logKnowledgeQuery } = await import('../services/knowledge-sync')
            logKnowledgeQuery(db, kconfig, {
              workspaceId, query: String(args.query ?? ''), source: 'mcp',
              audience: mcp.keySearchAudiences(permissions).join(','), locale: args.locale ? String(args.locale) : '',
              topScore: allowed[0]?.score ?? null, hitCount: allowed.length, answered: allowed.length > 0,
            })
            return { passages: allowed.map((h) => ({ source: `${h.sourceKind}:${h.sourceGroup}/${h.sourceId}`, content: h.content, score: h.score })) }
          },
        })
      }
    } catch { /* @tangen/knowledge not installed - tool simply absent */ }

    const server = mcp.createMcpServer({
      client: client as never,
      permissions,
      types: schema?.types ?? [],
      customTables: customTableDefs,
      // K2: the lifecycle action policy for THIS key - the publish tools ask
      // it first, and get_object_actions hands it to the agent.
      actions: (typeName: string, id: string) => lifecycleActionsFor(ctx, typeName, id),
      askDocs,
      searchMedia: async ({ query, category, limit }) => {
        const conditions = [eq(mediaAssets.workspaceId, workspaceId)]
        // The tool's EXPOSURE is gated on media:read (keyCanMedia in
        // packages/mcp), but its query ignored allowedFolders, so a key scoped
        // to one folder could search every folder through MCP - filenames, alt
        // text and ids - while the REST library refused it. ONE condition
        // shared with media/list, so the two surfaces cannot drift apart.
        const folderScope = folderScopeCondition(permissions)
        if (folderScope) conditions.push(folderScope)
        if (query) {
          const q = `%${query}%`
          conditions.push(or(like(mediaAssets.filename, q), like(mediaAssets.altText, q))!)
        }
        if (category) conditions.push(categoryCondition(category)!)
        return db
          .select({
            id: mediaAssets.id, filename: mediaAssets.filename, alt: mediaAssets.altText,
            mimeType: mediaAssets.mimeType, size: mediaAssets.sizeBytes,
          })
          .from(mediaAssets)
          .where(and(...conditions))
          .orderBy(desc(mediaAssets.createdAt))
          .limit(limit)
      },
    }, config, writeOps, extensionTools)

    // Streamable HTTP: single message or batch in the POST body
    if (Array.isArray(body)) {
      const responses = (await Promise.all(body.map((m) => observeMcpCall(m, () => server.handle(m))))).filter(Boolean)
      return responses
    }
    const response = await observeMcpCall(body ?? {}, () => server.handle(body ?? {}))
    // Notifications get 202 + empty body per the transport spec
    return response ?? new Response(null, { status: 202 })
  })
