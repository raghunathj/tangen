/**
 * File Name: permissions.ts
 * Purpose: The object-access gate, re-exported for GraphQL's consumers.
 *
 *          The rule itself moved to `@tangen/types`, because it never was
 *          GraphQL's: this file's own comment used to say it "mirrors the
 *          object-read logic REST/MCP use", and a rule three surfaces must
 *          agree on belongs to none of them. It stayed here long enough for
 *          `realtime/authorize.ts` to import it, which resolved this whole
 *          package at boot in every process and quietly undid the lazy
 *          import `routes/graphql.ts` arranges on purpose.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ApiKeyPermissions } from '@tangen/types'
import { canWriteTypeObjects } from '@tangen/types'

export { canReadType, canReadDraftsType, canPublishTypeObjects } from '@tangen/types'

/** Can this caller WRITE the given content type? (objects:write) */
export function canWriteType(
  permissions: ApiKeyPermissions | { admin: true } | undefined,
  typeName: string,
): boolean {
  return canWriteTypeObjects(permissions, typeName)
}
