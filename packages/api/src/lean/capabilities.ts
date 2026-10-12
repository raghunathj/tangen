/**
 * File Name: capabilities.ts
 * Purpose: What a Tangen API process can be made of. The capability is the
 *          unit: core is always present, everything else is declared, and a
 *          capability that is off must not be IMPORTED, not merely unmounted.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The architectural invariant, in the user's words
 *          (2026-08-27): "Optional Tangen capabilities may make the product
 *          richer, but they must not make a simple Tangen deployment pay their
 *          startup/runtime cost when they are not enabled."
 *
 *          Measured on 2026-08-27, which is why these boundaries and not
 *          others. A process is ~178 MB RSS, of which ~111 MB is reached
 *          before any optional capability exists: Bun 22, Elysia 41,
 *          drizzle/postgres 20, then the gateway and content routes. Of the
 *          66 MB the API's own 163 modules add, SIX modules are 53 MB of it
 *          and the other 149 come to 5.9 MB together. So the boundaries below
 *          are drawn around the six, and the long tail is deliberately left
 *          alone: splitting it would be motion without payment.
 *
 *          The `measuredMb` numbers were CORRECTED on 2026-08-27 for the two
 *          capabilities that have been separated. The originals came from a
 *          cumulative import benchmark that charged every shared dependency to
 *          whichever module reached it first, which inflated a capability's
 *          apparent cost by everything core would have loaded anyway. What is
 *          recorded now for media and search is the marginal cost measured in
 *          situ: enable the capability, measure, disable it, measure. Expect
 *          the remaining estimates to fall the same way.
 *
 *          `gated` is the honest half. A capability is gated once its
 *          implementation is genuinely behind a dynamic import, and the
 *          isolation test proves it by walking the graph. Adding a capability
 *          here does not make it lean; flipping `gated` after the work does,
 *          and the test refuses the flip until it is true.
 */

/** A unit of the server that can be present or absent. */
export interface Capability {
  id: string
  label: string
  /**
   * Source paths, relative to `packages/api/src`, that implement it. Being
   * reachable from the lean entry when the capability is off is the failure.
   */
  modules: string[]
  /** Measured RSS on 2026-08-27, MB, cumulative-attribution. Advisory only. */
  measuredMb?: number
  /**
   * True once the implementation is behind a dynamic import and the isolation
   * test guards it. False means "declared, not yet lean".
   */
  gated: boolean
}

/**
 * Always present. Not a capability anyone can turn off: a CMS without content
 * routes, permissions or the gateway is not a smaller CMS, it is a broken one.
 */
export const LEAN_ENTRY = 'server-lean.ts'

export const CORE_MODULES = [
  'index.ts',
  'gateway/index.ts',
  'routes/objects/get.ts',
  'routes/auth/login.ts',
  'routes/members/capabilities.ts',
] as const

export const CAPABILITIES: Capability[] = [
  {
    id: 'media',
    label: 'Media library and image handling',
    modules: ['routes/media/upload.ts', 'routes/media/delete.ts', 'routes/media/localize.ts'],
    // Three figures, and only the last one is the answer.
    //   17.9 MB  isolated module graph - misleading, it counts core twice
    //    0.7 MB  an earlier in-situ reading, taken while the AI routes still
    //            dragged `sharp` in by another path, so media looked free
    //   19.1 MB  marginal, in situ, re-measured 2026-08-28 after that leak
    //
    // Only 11 of media's 53 modules are exclusive to it, so the cost was not
    // breadth: `services/image-processor.ts` imported `sharp`, a native
    // module, and that one file was almost all of it.
    //
    // Phase 7 (2026-08-31) made sharp an OPTIONAL dependency loaded on first
    // use. Re-measured over three runs, full boot RSS fell 177 -> 160 MB and
    // the media cell 176 -> 159, so media now costs what its own modules
    // cost. The native module is paid for by the first image processed, not
    // by every boot.
    measuredMb: 1.5,
    gated: true,
  },
  {
    id: 'search',
    label: 'Content search index',
    modules: ['services/postgres-search-engine.ts', 'services/search-engine-registry.ts', 'routes/search/admin.ts'],
    // Re-measured 2026-08-29, marginal and in situ, after Orama was removed:
    // 0.9 MB, not the 4.0 this said before. The index no longer lives in this
    // process at all, so the capability is now its routes, its governor and a
    // SQL builder rather than an in-memory search library. Search is now the
    // CHEAPEST gated capability; media, at 19.1, is the expensive one.
    measuredMb: 0.9,
    gated: true,
  },
  {
    id: 'realtime',
    label: 'Realtime transport and presence',
    modules: ['realtime/transport.ts'],
    measuredMb: 9.6,
    gated: false,
  },
  {
    id: 'redis',
    label: 'Redis client (queue, cache, fan-out)',
    modules: ['plugins/redis.ts'],
    measuredMb: 4.8,
    gated: false,
  },
  {
    id: 'fields',
    label: 'Field option resolution',
    modules: ['routes/fields/options.ts'],
    measuredMb: 3.9,
    gated: false,
  },
  {
    id: 'scheduler',
    label: 'Scheduler and jobs',
    modules: ['workers/scheduler.ts'],
    measuredMb: 0.2,
    gated: false,
  },
  {
    id: 'sync',
    label: 'Sync and Porter',
    modules: ['routes/sync/runs.ts'],
    measuredMb: 1.5,
    gated: false,
  },
  {
    id: 'ai',
    label: 'AI, knowledge and MCP',
    modules: ['routes/ai/chats.ts', 'routes/knowledge.ts', 'routes/mcp.ts'],
    measuredMb: 0.7,
    gated: false,
  },
]

/** The capabilities whose isolation is currently a hard gate. */
export function gatedCapabilities(): Capability[] {
  return CAPABILITIES.filter((c) => c.gated)
}

/** What is declared but not yet lean, newest measurement first. */
export function pendingCapabilities(): Capability[] {
  return CAPABILITIES.filter((c) => !c.gated).sort((a, b) => (b.measuredMb ?? 0) - (a.measuredMb ?? 0))
}

/** The RSS a capability is expected to save once gated, for the advisory report. */
export function pendingSavingMb(): number {
  return Math.round(pendingCapabilities().reduce((sum, c) => sum + (c.measuredMb ?? 0), 0) * 10) / 10
}
