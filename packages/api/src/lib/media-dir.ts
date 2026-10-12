/**
 * File Name: media-dir.ts
 * Purpose: Where media lives on this process's disk: the project default
 *          (public/media under the project root), and the directory one
 *          workspace × environment resolved as `storage.mediaDir` (the
 *          environment file, or the MEDIA_DIR deployment variable).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: MEDIA_DIR is a declared configuration key, so the
 *          resolver is its one reader; this module only knows the process
 *          default. TANGEN_WORKSPACE_DIR (set by `tangen dev`/`start`) is a
 *          process-level signal - the project root - not configuration.
 */
import { resolve } from 'node:path'
import { resolvedFor } from '../config/state'

// The project root. In an npm-consumer install the API lives at
// node_modules/@tangen/api/src/lib, so the "4 levels up" heuristic lands on
// <project>/node_modules - which is EPHEMERAL (npm can wipe it) and is not the
// project's public/ folder. TANGEN_WORKSPACE_DIR (the same signal used to
// locate app/workspaces) is the reliable project root; the 4-up walk is the
// monorepo fallback.
const PROJECT_ROOT = process.env.TANGEN_WORKSPACE_DIR
  ? resolve(process.env.TANGEN_WORKSPACE_DIR)
  : resolve(import.meta.dir, '../../../..')

/** {project-root}/public/media - served statically at GET /media/*; the root when nothing configures one. */
export const DEFAULT_MEDIA_DIR = resolve(PROJECT_ROOT, 'public/media')

/** The media directory of one workspace × environment: its resolved `storage.mediaDir`, else the project default. */
export function mediaDirFor(workspaceId: string | undefined): string {
  const configured = resolvedFor(workspaceId)?.get<string>('storage.mediaDir')
  return configured?.trim() ? resolve(configured) : DEFAULT_MEDIA_DIR
}
