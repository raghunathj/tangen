/**
 * File Name: config.ts
 * Purpose: Resolves the GraphQL config for a workspace×env — env override
 *          wins over the workspace config; everything defaults OFF.
 *          GraphiQL/introspection default sensibly by environment.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types only.
 */
import type { GraphqlConfig, WorkspaceProject } from '@tangen/types'

export interface ResolvedGraphqlConfig {
  enabled: boolean
  graphiql: boolean
  introspection: boolean
  maxDepth: number
  mutations: boolean
}

const DISABLED: ResolvedGraphqlConfig = { enabled: false, graphiql: false, introspection: false, maxDepth: 12, mutations: false }

/** project.graphql > disabled. `isDev` (a development deployment) decides the GraphiQL default. */
export function resolveGraphqlConfig(
  project: WorkspaceProject | undefined,
  isDev = false,
): ResolvedGraphqlConfig {
  const config = (project as { graphql?: GraphqlConfig } | undefined)?.graphql
  if (!config?.enabled) return DISABLED
  return {
    enabled: true,
    graphiql: config.graphiql ?? isDev,
    introspection: config.introspection ?? true,
    maxDepth: config.maxDepth ?? 12,
    mutations: config.mutations === true,
  }
}
