/**
 * File Name: deployment.ts
 * Purpose: The API's entry to the one deployment composition: resolve a
 *          project's deployment (registry, sources, secrets, the role of
 *          this process) and validate it with the same primitives Doctor
 *          reads. Boot resolves once per workspace; nothing resolves at
 *          request time.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { resolveProjectDeployment, type ResolvedDeployment, type ResolveProjectDeploymentInput, type WorkspaceProject } from '@tangen/types'

export type { ResolvedDeployment, ManifestLike } from '@tangen/types'

export function resolveDeployment(input: Omit<ResolveProjectDeploymentInput, 'project'> & { project: WorkspaceProject }): ResolvedDeployment {
  return resolveProjectDeployment({ ...input, project: input.project as never })
}

// ── Validation: boot and Doctor read the same findings ────────────────────────

export { validateProjectDeployment, deploymentRefusal, logDeploymentFindings, type DeploymentFinding, type ValidateProjectDeploymentInput } from '@tangen/types'
