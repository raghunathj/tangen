/**
 * File Name: effective-policy.ts
 * Purpose: The resolved Gateway policy for one workspace and environment,
 *          memoized per project object.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The scopes, outermost first (plan 22.3): the operator's
 *          deployment map (`deploymentEnvironments[env].gateway`) is the
 *          ceiling, the workspace's `gateway` narrows it, the environment's
 *          `gateway` narrows it again. Memoized the way resolveStorage is,
 *          because it runs on every limited request, and keyed on the project
 *          OBJECT so a refreshed project list starts clean by construction.
 *          CORS composes origins from more sources than the gateway key and
 *          keeps its own resolver (cors.ts); everything else reads this.
 */
import type { WorkspaceProject, GatewayConfig } from '@tangen/types'
import { resolveGatewayPolicy, GATEWAY_DEFAULTS, type ResolvedGatewayPolicy } from './resolve-config'

let memo = new WeakMap<WorkspaceProject, ResolvedGatewayPolicy>()
let deploymentMemo = new WeakMap<WorkspaceProject, ResolvedGatewayPolicy>()

export function resetEffectivePolicyCache(): void { memo = new WeakMap(); deploymentMemo = new WeakMap() }

/** The policy in force for a workspace: the operator's deployment ceiling narrowed by the workspace's own `gateway`. */
export function effectiveGatewayPolicy(project: WorkspaceProject | undefined): ResolvedGatewayPolicy {
  if (!project) return GATEWAY_DEFAULTS
  const hit = memo.get(project)
  if (hit) return hit
  const value = resolveGatewayPolicy({
    global: project.deploymentGateway as GatewayConfig | undefined,
    workspace: (project.config as { gateway?: GatewayConfig } | undefined)?.gateway,
  }, { source: 'runtime' })
  memo.set(project, value)
  return value
}

/** The operator's deployment ceiling alone (what a workspace may only narrow). */
export function deploymentGatewayPolicy(carrier: WorkspaceProject | undefined): ResolvedGatewayPolicy {
  if (!carrier) return GATEWAY_DEFAULTS
  const hit = deploymentMemo.get(carrier)
  if (hit) return hit
  const value = resolveGatewayPolicy({ global: carrier.deploymentGateway as GatewayConfig | undefined }, { source: 'runtime' })
  deploymentMemo.set(carrier, value)
  return value
}
