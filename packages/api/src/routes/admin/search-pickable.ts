/**
 * File Name: search-pickable.ts
 * Purpose: GET /api/v1/admin/search/pickable-sources?audience= — the sources a
 *          recommendation rule can pin/hide (content types + opted-in custom
 *          tables) for an audience. manage:settings.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { Elysia } from 'elysia'
import { requireCapability } from '../../lib/member-access'
import { resolvePickableSources } from '../../services/search-pickable'

export const searchPickableRoute = (app: Elysia) =>
  app.get('/api/v1/admin/search/pickable-sources', async (ctx: any) => {
    const { schema, workspaceId, permissions, workspaceProjects, query } = ctx
    requireCapability({ permissions, memberId: ctx.memberId }, 'manage:settings')
    const audience = query.audience === 'public' ? 'public' : 'internal'
    const project = (workspaceProjects as any[])?.find((p) => p.workspaceId === workspaceId)
    const customTables = project?.config?.customTables ?? project?.customTables ?? []
    const types = ((schema?.types ?? []) as any[]).map((t) => ({ name: t.name, label: t.label }))
    return { data: resolvePickableSources(types, customTables, audience) }
  })
