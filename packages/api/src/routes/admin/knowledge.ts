/**
 * File Name: knowledge.ts
 * Purpose: Admin knowledge operations — test a semantic search as an admin
 *          (no API key needed) and trigger a full reindex through the
 *          durable queue (progress lands in Settings → Jobs & Cron → Runs).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Member-auth routes; reindex needs manage:settings.
 *          Lazily imports @tangen/knowledge like every knowledge mount.
 */
import { embeddingsSettingsFor } from '../../config/service-settings'
import { deploymentFor } from '../../config/service-settings'
import { Elysia } from 'elysia'
import { RequestError } from '../../lib/errors'
import { requireCapability, hasCapability } from '../../lib/member-access'
import { resolveProviderKey } from '../../lib/ai-keys'
import { sseResponse, type SSEStreamEvent } from '../../lib/sse'
import { getProvider, availableProviders, streamOrBuffer } from '../../services/ai'
import { knowledgeExec, KNOWLEDGE_REINDEX_TASK, KNOWLEDGE_EMBED_TASK } from '../../services/knowledge-sync'
import { enqueueTask } from '../../services/task-queue'
import { resolveProviderChoice } from '../ai/fill'
import { readSettings } from '../ai/settings'
import { wantsEventStream } from '../knowledge'

/** Lazy knowledge import + qa store bound to this request's db. */
async function qaStoreFor(ctx: any) {
  let knowledge: typeof import('@tangen/knowledge')
  try {
    knowledge = await import('@tangen/knowledge')
  } catch {
    throw new RequestError('KNOWLEDGE_PACKAGE_MISSING', 'Install @tangen/knowledge to use knowledge features', 500)
  }
  return knowledge.createQaStore(knowledgeExec(ctx.db))
}

/** Q&A embedding rides the durable queue (same task as content changes). */
function enqueueQaEmbed(ctx: any, op: 'qa' | 'remove-qa', qaId: string): void {
  void enqueueTask({
    taskId: KNOWLEDGE_EMBED_TASK,
    workspaceId: ctx.workspaceId,
    payload: { op, qaId },
  }).catch(() => { /* best effort - reindex repairs */ })
}

/**
 * Shared admin retrieval for the playground testers (search + ask): member
 * session, enabled config, adapter, and a vector search over the requested
 * audiences ('all' shows both tiers - admins test any audience).
 */
async function adminRetrieve(ctx: any, opts: { k: number; maxK: number }) {
  const { db, workspaceId, workspaceProjects, body, memberId } = ctx
  if (!memberId) throw new RequestError('FORBIDDEN', 'Admin session required', 403)

  let knowledge: typeof import('@tangen/knowledge')
  try {
    knowledge = await import('@tangen/knowledge')
  } catch {
    throw new RequestError('KNOWLEDGE_PACKAGE_MISSING', 'Install @tangen/knowledge to use knowledge features', 500)
  }
  const project = (workspaceProjects as any[])?.find((p) => p.workspaceId === workspaceId)
  const config = knowledge.resolveKnowledgeConfig(project)
  if (!config.enabled) throw new RequestError('KNOWLEDGE_DISABLED', 'Knowledge is not enabled for this environment (app/config/knowledge.ts)', 409)

  const query = String(body?.query ?? '').trim()
  if (!query) throw new RequestError('VALIDATION_ERROR', 'query is required', 422)

  const embeddings = knowledge.requireEmbeddingsConfig(config)
  const adapter = knowledge.getEmbeddingAdapter(embeddingsSettingsFor(project, embeddings))
  const store = knowledge.createKnowledgeStore(knowledgeExec(db))
  const meta = await store.getMeta(workspaceId).catch(() => undefined)
  if (!meta) throw new RequestError('KNOWLEDGE_NOT_INDEXED', 'No index yet - run a reindex or tangen knowledge index', 409)

  const [vector] = await adapter.embed([query])
  const audienceSel = String(body?.audience ?? 'all')
  const hits = await store.search(workspaceId, vector, {
    k: Math.min(Number(body?.limit) || opts.k, opts.maxK),
    locale: body?.locale ? String(body.locale) : undefined,
    audiences: audienceSel === 'all' ? ['public', 'internal'] : [audienceSel],
    qaBoost: config.qaBoost,
  })
  return { knowledge, project, config, query, hits }
}

export const knowledgeAdminRoutes = (app: Elysia) =>
  app
    .get('/api/v1/admin/knowledge/status', async (ctx: any) => {
      const { db, workspaceId, workspaceProjects, memberId } = ctx
      if (!memberId) throw new RequestError('FORBIDDEN', 'Admin session required', 403)
      let knowledge: typeof import('@tangen/knowledge') | null = null
      try { knowledge = await import('@tangen/knowledge') } catch { /* optional */ }
      if (!knowledge) return { data: { enabled: false, provider: null, model: null, indexed: false, counts: {} } }
      const project = (workspaceProjects as any[])?.find((p) => p.workspaceId === workspaceId)
      const config = knowledge.resolveKnowledgeConfig(project)
      if (!config.enabled) return { data: { enabled: false, provider: null, model: null, indexed: false, counts: {} } }
      const store = knowledge.createKnowledgeStore(knowledgeExec(db))
      const meta = await store.getMeta(workspaceId).catch(() => undefined)
      const counts = meta ? await store.counts(workspaceId).catch(() => ({})) : {}
      const audiences = meta ? await store.audienceCounts(workspaceId).catch(() => ({})) : {}
      return {
        data: {
          enabled: true,
          provider: meta?.provider ?? config.embeddings?.provider ?? null,
          model: meta?.model ?? config.embeddings?.model ?? null,
          indexed: Boolean(meta),
          counts,
          audiences,
        },
      }
    })
    .post('/api/v1/admin/knowledge/search', async (ctx: any) => {
      const { hits } = await adminRetrieve(ctx, { k: 5, maxK: 10 })
      return {
        data: hits.map((h) => ({
          sourceKind: h.sourceKind, sourceGroup: h.sourceGroup, sourceId: h.sourceId,
          title: (h.metadata?.title as string | undefined) ?? (h.metadata?.path as string | undefined) ?? null,
          snippet: h.content.length > 200 ? `${h.content.slice(0, 200)}…` : h.content,
          audience: h.audience,
          score: Math.round(h.score * 1000) / 1000,
        })),
      }
    })

    // ── Ask tester (AI → Knowledge) — the retrieval playground's grounded
    //    answer, streamed as meta → delta* → done when SSE is requested.
    .post('/api/v1/admin/knowledge/ask', async (ctx: any) => {
      const { db, workspaceId } = ctx
      {
        // Generation spends provider tokens - same gate as the AI panel routes
        const p = ctx.permissions as { admin?: boolean; capabilities?: string[] } | undefined
        if (ctx.memberId && !hasCapability(ctx, 'use:ai')) {
          throw new RequestError('FORBIDDEN', 'Your role cannot use AI features', 403)
        }
      }
      const r = await adminRetrieve(ctx, { k: 8, maxK: 25 })
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
        throw new RequestError('AI_NOT_CONFIGURED', 'No AI provider available for Ask - configure one in Settings → AI (search works without it)', 409)
      }
      const provider = getProvider(choice.name as never, resolveProviderKey(choice.name as never, envVars)!)

      if (streaming) {
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

    // ── Query insights (AI → Insights) — the curation backlog ─────────────────
    .get('/api/v1/admin/knowledge/insights', async (ctx: any) => {
      if (!ctx.memberId) throw new RequestError('FORBIDDEN', 'Admin session required', 403)
      let knowledge: typeof import('@tangen/knowledge')
      try {
        knowledge = await import('@tangen/knowledge')
      } catch {
        throw new RequestError('KNOWLEDGE_PACKAGE_MISSING', 'Install @tangen/knowledge to use knowledge features', 500)
      }
      const store = knowledge.createInsightsStore(knowledgeExec(ctx.db))
      await store.prune(90).catch(() => {})   // retention rides the read path too
      const mode = ['unanswered', 'low', 'top'].includes(String(ctx.query?.mode)) ? ctx.query.mode : 'unanswered'
      const rows = await store.overview(ctx.workspaceId, {
        mode,
        threshold: ctx.query?.threshold ? Number(ctx.query.threshold) : undefined,
        limit: Math.min(Number(ctx.query?.limit) || 50, 200),
      })
      return { data: rows, meta: { total: rows.length } }
    })

    // ── Curated Q&A (AI → Q&A) — reads for any member, writes manage:settings ──
    .get('/api/v1/admin/knowledge/qa', async (ctx: any) => {
      if (!ctx.memberId) throw new RequestError('FORBIDDEN', 'Admin session required', 403)
      const store = await qaStoreFor(ctx)
      const limit = Math.min(Number(ctx.query?.limit) || 50, 200)
      const offset = Math.max(Number(ctx.query?.offset) || 0, 0)
      const { rows, total } = await store.list(ctx.workspaceId, {
        q: ctx.query?.q ? String(ctx.query.q) : undefined, limit, offset,
      })
      return { data: rows, meta: { total } }
    })
    .post('/api/v1/admin/knowledge/qa', async (ctx: any) => {
      requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:settings')
      const b = ctx.body ?? {}
      const question = String(b.question ?? '').trim()
      const answer = String(b.answer ?? '').trim()
      if (!question || !answer) throw new RequestError('VALIDATION_ERROR', 'question and answer are required', 422)
      const store = await qaStoreFor(ctx)
      const saved = await store.upsert({
        workspaceId: ctx.workspaceId, question, answer,
        audience: b.audience === 'internal' ? 'internal' : 'public',
        enabled: b.enabled !== false,
        updatedBy: ctx.memberId,
      })
      enqueueQaEmbed(ctx, 'qa', saved.id)
      return { data: saved }
    })
    .patch('/api/v1/admin/knowledge/qa/:id', async (ctx: any) => {
      requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:settings')
      const store = await qaStoreFor(ctx)
      const existing = await store.get(ctx.workspaceId, ctx.params.id)
      if (!existing) throw new RequestError('NOT_FOUND', 'Q&A pair not found', 404)
      const b = ctx.body ?? {}
      const saved = await store.upsert({
        ...existing,
        question: b.question != null ? String(b.question).trim() : existing.question,
        answer: b.answer != null ? String(b.answer).trim() : existing.answer,
        audience: b.audience != null ? (b.audience === 'internal' ? 'internal' : 'public') : existing.audience,
        enabled: b.enabled != null ? Boolean(b.enabled) : existing.enabled,
        updatedBy: ctx.memberId,
      })
      enqueueQaEmbed(ctx, 'qa', saved.id)   // task removes chunks when disabled
      return { data: saved }
    })
    .delete('/api/v1/admin/knowledge/qa/:id', async (ctx: any) => {
      requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:settings')
      const store = await qaStoreFor(ctx)
      await store.remove(ctx.workspaceId, ctx.params.id)
      enqueueQaEmbed(ctx, 'remove-qa', ctx.params.id)
      return { data: { deleted: true } }
    })

    .post('/api/v1/admin/knowledge/reindex', async (ctx: any) => {
      requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:settings')
      await enqueueTask({
        taskId: KNOWLEDGE_REINDEX_TASK,
        workspaceId: ctx.workspaceId,
      })
      return { data: { queued: true, task: KNOWLEDGE_REINDEX_TASK } }
    })
