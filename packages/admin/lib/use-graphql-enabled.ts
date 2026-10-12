/**
 * File Name: use-graphql-enabled.ts
 * Purpose: Whether the GraphQL API answers for this workspace x environment,
 *          so the Devspace nav and page can gate on it without probing
 *          POST /api/v1/graphql (which 404s, and logs, on every project that
 *          never enabled it).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Reads the ONE Admin bootstrap store (closure plan
 *          Phase 8A, Unit 10). This used to fetch `/admin/ui-config` itself,
 *          into a cache keyed by environment alone - so two workspaces
 *          sharing an env slug shared the answer. GraphQL is a per-scope
 *          configuration flag rather than a runtime capability: it has no
 *          registry entry, so it stays a flag on the same response.
 */
import { useParams } from 'react-router-dom'
import { useCapabilities } from './use-capabilities'

/**
 * True once the bootstrap says GraphQL answers here; false until then.
 * `active` is kept for callers that skip the question entirely (a non-admin
 * who cannot see Devspace); the read is shared either way.
 */
export function useGraphqlEnabled(active = true): boolean {
  const params = useParams<{ workspaceId: string }>()
  const { flags } = useCapabilities(active ? params.workspaceId : undefined)
  return flags.graphqlEnabled
}
