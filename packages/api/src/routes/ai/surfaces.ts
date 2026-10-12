/**
 * File Name: surfaces.ts
 * Purpose: GET /api/v1/admin/ai/surfaces — read-only status of the AI
 *          surfaces (MCP now; Knowledge/RAG when Arc B lands) resolved per
 *          environment, so the admin can SHOW what is enabled without ever
 *          owning the toggle (config files are the source of truth).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Lazily imports @tangen/mcp for config resolution —
 *          the package stays optional; absent package reads as disabled
 *          with an installed:false marker.
 */
import { and, eq, desc, count, inArray } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { workspaceActivity } from '@tangen/db'

export const aiSurfacesRoute = (app: Elysia) =>
  app.get('/api/v1/admin/ai/surfaces', async (ctx: any) => {
    const { workspaceId, workspaceProjects } = ctx
    const project = (workspaceProjects as any[])?.find((p) => p.workspaceId === workspaceId)

    let mcpInstalled = true
    let resolveMcpConfig: ((p: unknown) => { enabled: boolean; write: unknown; tools?: string[] }) | null = null
    try {
      const mod = await import('@tangen/mcp')
      resolveMcpConfig = mod.resolveMcpConfig as never
    } catch {
      mcpInstalled = false
    }

    const mcp = {
      installed: mcpInstalled,
      configured: Boolean((project as any)?.mcp?.enabled),
      ...(() => { const resolved = resolveMcpConfig?.(project) ?? { enabled: false, write: false }; return { enabled: resolved.enabled, write: resolved.write, tools: resolved.tools ?? null } })(),
    }

    let knowledgeInstalled = true
    let resolveKnowledgeConfig: ((p: unknown) => { enabled: boolean; embeddings?: { provider?: string; model?: string } }) | null = null
    try {
      const mod = await import('@tangen/knowledge')
      resolveKnowledgeConfig = mod.resolveKnowledgeConfig as never
    } catch {
      knowledgeInstalled = false
    }

    const knowledge = {
      installed: knowledgeInstalled,
      configured: Boolean((project as any)?.knowledge?.enabled),
      ...(() => { const resolved = resolveKnowledgeConfig?.(project) ?? { enabled: false }; return { enabled: resolved.enabled, provider: resolved.embeddings?.provider ?? null, model: resolved.embeddings?.model ?? null } })(),
    }

    return { data: { mcp, knowledge } }
  })

  /** Paged feed of agent (api_key) writes for the AI → Agents page. */
  .get('/api/v1/admin/ai/agent-activity', async (ctx: any) => {
    const limit = Math.min(Number(ctx.query.limit) || 15, 100)
    const offset = Number(ctx.query.offset) || 0
    const conditions = [
      eq(workspaceActivity.workspaceId, ctx.workspaceId),
      inArray(workspaceActivity.actorType, ['api_key', 'agent', 'service']),
    ]
    const rows = await ctx.db.select().from(workspaceActivity)
      .where(and(...conditions))
      .orderBy(desc(workspaceActivity.createdAt))
      .limit(limit).offset(offset)
    const [{ n: total }] = await ctx.db.select({ n: count() }).from(workspaceActivity).where(and(...conditions))
    return { data: rows, meta: { total: Number(total), limit, offset } }
  })
