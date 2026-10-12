/**
 * File Name: config-resolved.ts
 * Purpose: GET /api/v1/admin/config/resolved - the deployment as boot
 *          resolved it for this workspace: the role, every key with its
 *          provenance (references, never secret material) and the boot
 *          findings. Owner, or the manage:settings capability.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { Elysia } from 'elysia'
import { resolvedFor, deploymentFindingsFor } from '../../config/state'
import { requireOwnerOrCapability } from '../../lib/member-access'
import { RequestError } from '../../lib/errors'

export const adminConfigResolvedRoute = (app: Elysia) =>
  app.get('/api/v1/admin/config/resolved', (ctx: any) => {
    const { workspaceId, memberId, permissions, memberRole } = ctx
    requireOwnerOrCapability({ permissions, memberId, memberRole }, 'manage:settings')
    const r = resolvedFor(String(workspaceId ?? ''))
    if (!r) throw new RequestError('NOT_FOUND', 'No resolved deployment for this workspace on this server', 404)
    return {
      data: {
        workspaceId,
        role: r.role,
        findings: deploymentFindingsFor(String(workspaceId ?? '')),
        keys: r.diagnostics(),
      },
    }
  })
