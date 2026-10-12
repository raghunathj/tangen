/**
 * File Name: providers.ts
 * Purpose: GET /api/v1/admin/ai/providers — tells the admin panel which LLM
 *          providers are enabled by the site developer AND have a resolvable
 *          API key, plus their selectable models. Never exposes key material.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Admin-panel only (member JWT required). Modeled on
 *          routes/fields/options.ts.
 */
import { Elysia } from 'elysia'
import { RequestError } from '../../lib/errors'
import { listAiProviders } from '../../services/ai/registry'
import { extensionWiringDeps } from '../../services/extension-server'
import { deploymentFor } from '../../config/service-settings'

/**
 * Registers the AI provider-availability endpoint. Mounted after authMiddleware.
 */
export const aiProvidersRoute = (app: Elysia) =>
  app.get('/api/v1/admin/ai/providers', async (ctx: any) => {
    const { workspaceId, memberId, workspaceProjects } = ctx

    if (!memberId) {
      throw new RequestError('FORBIDDEN', 'AI provider info is admin-panel only', 403)
    }

    const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
    const aiConfig = project?.ai ?? project?.config?.ai
    // K8.1: the built-ins and the providers active extensions contribute, with what each advertises.
    const deps = extensionWiringDeps()
    const activeIds = new Set(deps?.activeIds ? await deps.activeIds(workspaceId).catch(() => [] as string[]) : [])
    const providers = listAiProviders({ workspaceId, activeIds, config: aiConfig, secrets: deploymentFor(project)?.secrets })
      .map((p) => ({ name: p.id, label: p.label, available: p.available, models: p.models, imageModels: p.imageModels ?? [], capabilities: p.capabilities, source: p.source }))

    return {
      data: {
        enabled: providers.some(p => p.available),
        providers,
      },
    }
  })
