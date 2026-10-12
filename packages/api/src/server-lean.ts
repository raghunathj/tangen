/**
 * File Name: server-lean.ts
 * Purpose: The capability-aware entry point, and the one a lean production
 *          deployment should use. Resolves ONLY the capabilities it enables,
 *          then hands them to the same composer the full server uses.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This file is the entry the isolation gate walks from,
 *          so what it imports statically IS the lean boot graph. It may
 *          import `./compose` (core) and the capability descriptions, and it
 *          must never import an implementation: every capability tree is
 *          reached through its `load*()` resolver, inside the branch that
 *          enables it.
 *
 *          `createServer` in index.ts remains the compatibility path and stays
 *          synchronous by resolving everything statically. The two entries
 *          share `composeServer` and differ in module resolution alone: there
 *          is one chain, not two server implementations.
 */
import type { WorkspaceProject } from '@tangen/types'
import { composeServer } from './compose'
import { isEnabled, type CapabilitySelection, type ServerCapabilities } from './capabilities/types'

/**
 * A server with only the capabilities asked for.
 *
 * Async because resolving a capability is an `await import()`, which is the
 * whole point: a capability that is off is never resolved, so a lean process
 * never pays for its module graph.
 */
export async function createServerLean(
  projects: WorkspaceProject[] = [],
  selection: CapabilitySelection = {},
) {
  const caps: ServerCapabilities = {}
  if (isEnabled(selection, 'media')) {
    const mod = await import('./capabilities/media')
    caps.media = mod.mediaCapability(await mod.loadMedia())
  }
  if (isEnabled(selection, 'search')) {
    const mod = await import('./capabilities/search')
    caps.search = mod.searchCapability(await mod.loadSearch())
  }
  return composeServer(projects, caps)
}
