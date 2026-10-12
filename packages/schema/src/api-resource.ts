/**
 * File Name: api-resource.ts
 * Purpose: defineApiResource() — declares a key-gated API resource from site
 *          or extension code. Registered via TangenConfig.apiResources, the
 *          resource appears in the admin API manager automatically (like
 *          Forms does) and custom routes reference it with the apiGroup
 *          string shorthand.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: validation-only helper — the runtime surfacing lives
 *          in the API's route-resources endpoint; enforcement in the custom
 *          router + api-key-auth helpers.
 */
import type { ApiResourceDefinition } from '@tangen/types'

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i

/**
 * Validates and returns an API resource definition.
 *
 * ```ts
 * export const pincodeResource = defineApiResource({
 *   id: 'pincode',
 *   label: 'Pin Code Delivery API',
 *   actions: ['Search'],
 *   items: async ({ db }) => [...],   // optional — enables per-item scoping
 * })
 * ```
 */
export function defineApiResource(def: ApiResourceDefinition): ApiResourceDefinition {
  if (!def.id || !ID_PATTERN.test(def.id)) {
    throw new Error(`defineApiResource: id must be a slug-safe string (got "${def.id}")`)
  }
  if (!def.label || !def.label.trim()) {
    throw new Error(`defineApiResource("${def.id}"): label is required`)
  }
  if (!Array.isArray(def.actions) || def.actions.length === 0) {
    throw new Error(`defineApiResource("${def.id}"): at least one action is required`)
  }
  const dupes = def.actions.filter((a, i) => def.actions.indexOf(a) !== i)
  if (dupes.length > 0) {
    throw new Error(`defineApiResource("${def.id}"): duplicate actions: ${dupes.join(', ')}`)
  }
  if (def.items !== undefined && typeof def.items !== 'function') {
    throw new Error(`defineApiResource("${def.id}"): items must be a function`)
  }
  return def
}
