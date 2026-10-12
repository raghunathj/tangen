/**
 * File Name: knowledge.ts
 * Purpose: POST /api/v1/knowledge/search and /api/v1/knowledge/ask — thin
 *          mounts for the OPTIONAL @tangen/knowledge package. API-key auth
 *          with the `search` grant; 404 while disabled; a vector-space
 *          mismatch (config model ≠ index model) is a 409 telling the
 *          developer to reindex, never a silent bad answer.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Retrieval + prompt assembly live in the package;
 *          generation for /ask reuses the workspace's existing AI provider
 *          settings (Settings → AI).
 */
import { embeddingsSettingsFor } from '../config/service-settings'
import { deploymentFor } from '../config/service-settings'
import { Elysia } from 'elysia'
import { getProvider, availableProviders, streamOrBuffer } from '../services/ai'
import { resolveProviderKey } from '../lib/ai-keys'
import { sseResponse, type SSEStreamEvent } from '../lib/sse'
import { resolveProviderChoice } from './ai/fill'
import { readSettings } from './ai/settings'
import { knowledgeExec, logKnowledgeQuery } from '../services/knowledge-sync'

/** SSE opt-in: `Accept: text/event-stream` or `?stream=1` (default stays JSON). */
export function wantsEventStream(ctx: any): boolean {
  if (String(ctx?.query?.stream ?? '') === '1') return true
  const accept = ctx?.request?.headers?.get?.('accept') ?? ''
  return String(accept).includes('text/event-stream')
}

type KnowledgeModule = typeof import('@tangen/knowledge')
let knowledgeModule: KnowledgeModule | null | undefined

async function loadKnowledge(): Promise<KnowledgeModule | null> {
  if (knowledgeModule !== undefined) return knowledgeModule
  try {
    knowledgeModule = await import('@tangen/knowledge')
  } catch {
    knowledgeModule = null
  }
  return knowledgeModule
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

interface SearchBody {
  query?: string
  limit?: number
  types?: string[]
  tables?: string[]
  sources?: Array<'object' | 'table' | 'asset' | 'file'>
  /** Locale-accurate retrieval — requested locale + default fallback. */
  locale?: string
  /** Narrow within the key's granted audiences (never widens). */
  audience?: 'public' | 'internal'
}

async function retrieve(ctx: any, source: 'search' | 'ask') {
  const { db, workspaceId, permissions, apiKeyId, workspaceProjects, body } = ctx

  if (!apiKeyId) return { error: json(403, { error: { code: 'FORBIDDEN', message: 'Knowledge endpoints require an API key', status: 403 } }) }
  if (!permissions?.search?.actions?.includes('read')) {
    return { error: json(403, { error: { code: 'FORBIDDEN', message: "This API key has no 'search' read grant", status: 403 } }) }
  }

  const knowledge = await loadKnowledge()
  const project = (workspaceProjects as any[])?.find((p) => p.workspaceId === workspaceId)

  if (!knowledge) {
    const configured = Boolean((project as any)?.knowledge?.enabled)
    return {
      error: configured
        ? json(500, { error: { code: 'KNOWLEDGE_PACKAGE_MISSING', message: 'Knowledge is enabled in config but @tangen/knowledge is not installed - run: bun add @tangen/knowledge', status: 500 } })
        : json(404, { error: { code: 'NOT_FOUND', message: 'Route not found', status: 404 } }),
    }
  }

  const config = knowledge.resolveKnowledgeConfig(project)
  if (!config.enabled) {
    return { error: json(404, { error: { code: 'NOT_FOUND', message: 'Route not found', status: 404 } }) }
  }

  const b = (body ?? {}) as SearchBody
  const query = String(b.query ?? '').trim()
  if (!query) return { error: json(422, { error: { code: 'VALIDATION_ERROR', message: 'query is required', status: 422 } }) }

  const embeddings = knowledge.requireEmbeddingsConfig(config)
  const adapter = knowledge.getEmbeddingAdapter(embeddingsSettingsFor(project, embeddings))
  const store = knowledge.createKnowledgeStore(knowledgeExec(db))

  // Vector-space pin: the query model must match the index model
  const meta = await store.getMeta(workspaceId).catch(() => undefined)
  if (!meta) {
    return { error: json(409, { error: { code: 'KNOWLEDGE_NOT_INDEXED', message: 'No index yet - run: tangen knowledge index', status: 409 } }) }
  }
  const indexedBy = knowledge.vectorSpaceName(meta)
  if (meta.dimensions !== adapter.dimensions || indexedBy !== adapter.name) {
    // Dimensions named too: a pin that trips on dimensions alone otherwise
    // reads "built with g12-local but config says g12-local", which says
    // nothing about what actually differs.
    return { error: json(409, { error: { code: 'KNOWLEDGE_MODEL_MISMATCH', message: `Index was built with ${indexedBy} (${meta.dimensions} dims) but config says ${adapter.name} (${adapter.dimensions} dims) - run: tangen knowledge index --rebuild`, status: 409 } }) }
  }

  // Audience: the key's grant is the ceiling (fail-closed public); a body
  // audience may only NARROW within it
  const { keySearchAudiences } = await import('@tangen/mcp').catch(() => ({ keySearchAudiences: () => ['public'] }) as never)
  const granted: string[] = keySearchAudiences(permissions)
  if (b.audience && !granted.includes(b.audience)) {
    return { error: json(403, { error: { code: 'FORBIDDEN', message: `This API key has no '${b.audience}' audience grant`, status: 403 } }) }
  }
  const audiences = b.audience ? [b.audience] : granted

  const [vector] = await adapter.embed([query])
  const sourceGroups = [...(b.types ?? []), ...(b.tables ?? [])]
  const hits = await store.search(workspaceId, vector, {
    k: Math.min(Number(b.limit) || 8, 25),
    sourceKinds: b.sources,
    sourceGroups: sourceGroups.length ? sourceGroups : undefined,
    locale: b.locale ? String(b.locale) : undefined,
    audiences,
    qaBoost: config.qaBoost,
  })

  // Key grants filter what comes back: objects per type, tables per table
  const { keyCanObjects, keyCanTable } = await import('@tangen/mcp').catch(() => ({
    keyCanObjects: () => true, keyCanTable: () => true,
  }) as never)
  const allowed = hits.filter((h) => {
    if (h.sourceKind === 'object') return keyCanObjects(permissions, 'read', h.sourceGroup)
    if (h.sourceKind === 'table') return keyCanTable(permissions, h.sourceGroup)
    return true   // repo files / knowledge-base assets are workspace knowledge
  })

  // Insights: record what was asked and how well the index answered
  logKnowledgeQuery(db, config, {
    workspaceId, query, source,
    audience: audiences.join(','), locale: b.locale ? String(b.locale) : '',
    topScore: allowed[0]?.score ?? null, hitCount: allowed.length, answered: allowed.length > 0,
  })

  return { knowledge, config, project, hits: allowed, query }
}

export const knowledgeRoutes = (app: Elysia) =>
  app
    .post('/api/v1/knowledge/search', async (ctx: any) => {
      const r = await retrieve(ctx, 'search')
      if ('error' in r) return r.error
      return {
        data: r.hits.map((h) => ({
          sourceKind: h.sourceKind,
          sourceId: h.sourceId,
          sourceGroup: h.sourceGroup,
          field: h.field,
          content: h.content,
          title: (h.metadata?.title as string | undefined) ?? (h.metadata?.path as string | undefined) ?? null,
          score: h.score,
        })),
      }
    })
    .post('/api/v1/knowledge/ask', async (ctx: any) => {
      const r = await retrieve(ctx, 'ask')
      if ('error' in r) return r.error
      const { db, workspaceId } = ctx
      const streaming = wantsEventStream(ctx)
      if (r.hits.length === 0) {
        if (streaming) {
          return sseResponse((async function* (): AsyncGenerator<SSEStreamEvent> {
            yield { event: 'meta', data: { provider: null, model: null, citations: [], note: 'No relevant content found.' } }
            yield { event: 'done', data: { usage: { inputTokens: 0, outputTokens: 0 } } }
          })())
        }
        return { data: { answer: null, citations: [], note: 'No relevant content found.' } }
      }

      const { buildAskPrompt, buildCitations } = r.knowledge
      const { system, prompt } = buildAskPrompt(r.query, r.hits, r.config.askInstructions)

      const settings = await readSettings(db, workspaceId)
      const envVars = deploymentFor(r.project)?.secrets
      const providers = availableProviders(r.project?.ai ?? r.project?.config?.ai, envVars)
      let choice: { name: string; model: string }
      try {
        choice = resolveProviderChoice(settings, providers, {})
      } catch {
        // Pre-stream failures stay plain JSON errors - the stream only starts
        // once generation can actually begin.
        return json(409, { error: { code: 'AI_NOT_CONFIGURED', message: 'No AI provider available for /ask - configure one in Settings → AI (search works without it)', status: 409 } })
      }
      const provider = getProvider(choice.name as never, resolveProviderKey(choice.name as never, envVars)!)

      if (streaming) {
        // meta first (citations are known pre-generation), then deltas, then
        // done with usage. Mid-stream provider failures become a terminal
        // `error` event via sseResponse; client disconnects abort upstream.
        const citations = buildCitations(r.hits)
        const signal = ctx.request?.signal as AbortSignal | undefined
        return sseResponse((async function* (): AsyncGenerator<SSEStreamEvent> {
          yield { event: 'meta', data: { provider: choice.name, model: choice.model, citations } }
          for await (const ev of streamOrBuffer(provider, { system, prompt, model: choice.model } as never, { signal })) {
            if (ev.type === 'delta') yield { event: 'delta', data: { text: ev.text } }
            else yield { event: 'done', data: { usage: ev.usage } }
          }
        })())
      }

      const result = await provider.generateText({ system, prompt, model: choice.model } as never)

      return {
        data: {
          answer: (result as { text?: string }).text ?? result,
          citations: buildCitations(r.hits),
          provider: choice.name,
          model: choice.model,
        },
      }
    })
