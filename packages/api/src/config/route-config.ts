/**
 * File Name: route-config.ts
 * Purpose: The `config` and `secrets` a site's route or job context carries
 *          (tasks/plan-config-resolver.md, section 9), built over the
 *          resolved deployment of the request's workspace × environment.
 *          Before boot resolved anything (unit tests mounting one route),
 *          the config answers nothing and the secrets answer nothing.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { RouteConfig, SecretAccessorLike } from '@tangen/types'
import { NO_LOG } from '@tangen/types'
import { resolvedFor } from './state'

const NONE: SecretAccessorLike = Object.freeze(Object.defineProperty({ get: () => undefined, has: () => false, provider: 'none' }, NO_LOG, { value: true, enumerable: false })) as SecretAccessorLike

export function routeConfigFor(workspaceId: string | undefined): { config: RouteConfig; secrets: SecretAccessorLike; integration: (name: string) => import('@tangen/types').ResolvedIntegration | undefined } {
  const r = resolvedFor(workspaceId)
  if (!r) {
    return { config: { get: () => undefined, explain: () => undefined, site: {} as RouteConfig['site'] }, secrets: NONE, integration: () => undefined }
  }
  return {
    config: {
      get: <T,>(key: string) => (r.registry.get(key)?.secret ? undefined : (r.values[key] as T | undefined)),
      explain: (key) => r.explain(key),
      site: r.siteValues() as RouteConfig['site'],
    },
    secrets: r.scopedSecrets(['site']),
    integration: (name) => r.integration(name),
  }
}
