/**
 * File Name: index.ts
 * Purpose: Tangen icon set - self-contained curated components (generated
 *          snapshots, no runtime remixicon import) so eager bundles carry
 *          only ~46KB of icons instead of the whole 2.3MB pack. The full
 *          pack stays available lazily via '@tangen/icons/all' (raw Ri*
 *          names resolved by the admin's DynamicIcon).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Add icons by editing src/remix-aliases.ts, then run
 *          bun scripts/generate-curated.tsx.
 */
export * from './curated'
export type { IconProps } from './curated'

// Re-export from @tangen/types so both import paths work.
// The canonical definition lives in @tangen/types (no React dependency there).
export type { IconName } from '@tangen/types'
