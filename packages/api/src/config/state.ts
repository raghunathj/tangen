/**
 * File Name: state.ts
 * Purpose: The resolved deployments of this process, by workspace and
 *          environment, set once at boot and read by every context builder
 *          and service that needs its slice. Nothing resolves at request
 *          time.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { DeploymentFinding } from '@tangen/types'
import type { ResolvedDeployment } from './deployment'

const byScope = new Map<string, ResolvedDeployment>()

const keyOf = (workspaceId: string) => workspaceId

let bootFindings: DeploymentFinding[] = []

/** The findings boot validated with (the same list Doctor prints). */
export function deploymentFindingsFor(workspaceId: string | undefined): DeploymentFinding[] {
  return bootFindings.filter((f) => !f.workspace || !workspaceId || f.workspace === workspaceId)
}

export function setDeploymentFindings(list: DeploymentFinding[]): void {
  bootFindings = list
}

export function setResolvedDeployments(list: ResolvedDeployment[]): void {
  byScope.clear()
  for (const r of list) byScope.set(keyOf(r.workspaceId), r)
}

/** The resolved deployment for a workspace, or undefined before boot resolved it. */
export function resolvedFor(workspaceId: string | undefined): ResolvedDeployment | undefined {
  if (!workspaceId) return undefined
  return byScope.get(keyOf(workspaceId))
}

export function resolvedDeployments(): ResolvedDeployment[] {
  return [...byScope.values()]
}

/** Test seam: forget everything. */
export function resetResolvedDeployments(): void {
  bootFindings = []
  byScope.clear()
}
