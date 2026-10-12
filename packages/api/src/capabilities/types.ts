/**
 * File Name: types.ts
 * Purpose: The capability contract. A capability owns its own setup: what it
 *          mounts, where in the chain, and what it registers at process start.
 *          The composer knows none of its internals.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This file must stay free of any capability
 *          implementation import, including type-only ones. A `import type
 *          { PostgresSearchEngine } from '../services/postgres-search-engine'` here would be
 *          erased at runtime but is still a static edge in the source graph,
 *          and the reachability gate would rightly call it a leak: the whole
 *          reason a barrel or a shared types file is dangerous is that it
 *          looks harmless.
 *
 *          Two phases, because the chain has two halves. `mountPublic` runs in
 *          front of the auth middleware, `mountAuthenticated` behind it. Media
 *          needs both (serving an asset is public, uploading is not) and a
 *          single insertion point would have put one of them on the wrong side
 *          of authentication.
 *
 *          `register` is for the process-wide setup a capability owns:
 *          subscribers, background tasks, seeding. It used to live at module
 *          scope in index.ts, which meant importing the server registered the
 *          search indexer whether or not search was wanted. A capability that
 *          registers itself as a side effect of being imported is not
 *          optional, however carefully its routes are gated.
 */

/** Loosely typed: the chain erases its accumulated Elysia types after ~100 `.use()` calls. */
export type App = any

/** What a capability is handed. Deliberately small. */
export interface CapabilityContext {
  db: unknown
  redis: unknown
  eventBus: unknown
  /** Live view of the composed projects, never a captured snapshot. */
  projects: () => unknown[]
}

/**
 * One optional part of the server. Every member is optional: a capability that
 * only adds public routes implements only `mountPublic`.
 */
export interface ServerCapability {
  /** Mounted in front of the auth middleware. */
  mountPublic?(app: App): App
  /** Mounted behind the auth middleware. */
  mountAuthenticated?(app: App): App
  /**
   * Mounted in the admin block. Separate from `mountAuthenticated` because the
   * chain has a distinct admin section and search has routes in both: the
   * query surface sits with content, the analytics and synonyms surface with
   * the rest of the admin.
   */
  mountAdmin?(app: App): App
  /** Decorations the capability's own routes need on every request context. */
  decorate?(app: App): App
  /** Can it run in this process? Recorded in the runtime registry; default available. Reasons are operator-safe. */
  availability?(): { available: true } | { available: false; reason: string } | Promise<{ available: true } | { available: false; reason: string }>
  /** Process-wide setup: subscribers, tasks, seeding. Called once per process. */
  register?(ctx: CapabilityContext): void | Promise<void>
  /** Work that needs a listening server, called after startup. */
  start?(ctx: CapabilityContext): void | Promise<void>
}

/** The capabilities a composed server was given, by id. Absent means off. */
export interface ServerCapabilities {
  media?: ServerCapability
  search?: ServerCapability
}

/** The ids this phase knows how to switch. Grows as L1 continues. */
export type CapabilityId = keyof ServerCapabilities

/** Which capabilities to enable. Absent means enabled, matching the full server. */
export type CapabilitySelection = Partial<Record<CapabilityId, boolean>>

export function isEnabled(selection: CapabilitySelection | undefined, id: CapabilityId): boolean {
  return selection?.[id] !== false
}
