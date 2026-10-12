/**
 * File Name: tag-defaults.ts
 * Purpose: The element types Studio offers a site-wide default for, as the
 *          extension imports them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The list moved to
 *          `packages/studio-schema/src/tag-defaults.ts` when WF-S10 landed -
 *          Porter validates an incoming `tag:` row against the same list and
 *          may not import extension code. Re-exported here so the routes and
 *          the panel keep their existing import.
 */
export { TAG_PREFIX, STUDIO_TAGS, tagByName } from '@tangen/studio-schema'
export type { StudioTag } from '@tangen/studio-schema'
