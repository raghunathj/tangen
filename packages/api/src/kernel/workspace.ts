/**
 * File Name: workspace.ts
 * Purpose: The workspace boundary of one execution (kernel plan §17): a
 *          credential names a workspace, a request may name one, and the
 *          execution gets exactly one. A request that names none gets the
 *          credential's; one that names a different workspace is refused
 *          unless the actor carries the explicit cross-workspace flag
 *          (superadmin), in which case the execution runs THERE.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Before K1 a superadmin naming another workspace was
 *          only spared the 403 - the request still ran in the JWT's
 *          workspace. The refusal text stays what assertWorkspaceBoundary
 *          answers, so clients see the same 403.
 */
import { assertWorkspaceBoundary } from '../lib/workspace-boundary'

export interface WorkspaceResolution {
  workspaceId: string
  /** True when the superadmin flag carried the execution into a workspace other than the credential's. */
  crossWorkspace: boolean
}

export function resolveExecutionWorkspace(input: {
  credentialWorkspaceId: string
  requestedWorkspaceId: string | null | undefined
  /** The actor's explicit cross-workspace privilege. */
  superadmin: boolean
}): WorkspaceResolution {
  const requested = input.requestedWorkspaceId ?? null
  if (requested === null || requested === input.credentialWorkspaceId) {
    return { workspaceId: input.credentialWorkspaceId, crossWorkspace: false }
  }
  if (input.superadmin) return { workspaceId: requested, crossWorkspace: true }
  assertWorkspaceBoundary(input.credentialWorkspaceId, requested)
  return { workspaceId: input.credentialWorkspaceId, crossWorkspace: false }
}
