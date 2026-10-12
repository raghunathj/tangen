/**
 * File Name: search-hooks.ts
 * Purpose: How a NON-request content mutation reaches search.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Routes get their search seam as a per-request decoration
 *   (`ctx.searchEngineRef`), which works because a route always has a request.
 *   The local client does not: of its ten construction sites, three are an
 *   extension context, a job context and the form worker, none of which has a
 *   ctx to decorate. Threading one through would have meant inventing a fake
 *   request for background work.
 *
 *   So the same object the decoration carries is also published here, once, by
 *   the search capability when it registers. Callers ask for it and get either
 *   the sync or null.
 *
 *   Null IS the gate. A deployment without the search capability registers
 *   nothing, every caller sees null and does nothing - no dynamic import, no
 *   engine, no wasted resolution. And because this module names no search
 *   module, importing it from core keeps the search tree off the lean entry
 *   point's static graph, which the capability-isolation test enforces.
 *
 *   This is deliberately NOT a second search subsystem. It holds one reference
 *   and hands it back; every projection decision still belongs to the writer
 *   the routes already use.
 */

/**
 * The shape a content mutation needs. Structural on purpose: naming the type
 * from the search tree, even as a type-only import, is a dependency this module
 * does not need to take.
 */
export interface ContentSearchSync {
  onWrite(
    ctx: { schema?: { types?: Array<{ name: string; fields?: unknown[] }> } },
    tx: unknown,
    args: { workspaceId: string; typeName: string; objectId: string; row: Record<string, unknown> },
  ): Promise<boolean>
  onDelete(
    ctx: { schema?: { types?: Array<{ name: string; fields?: unknown[] }> } },
    tx: unknown,
    args: { workspaceId: string; typeName: string; objectId: string },
  ): Promise<boolean>
}

let current: ContentSearchSync | null = null

/** Publish the seam. Called once by the search capability's `register`. */
export function setContentSearchSync(sync: ContentSearchSync | null): void {
  current = sync
}

/** The seam, or null when search is not enabled in this deployment. */
export function getContentSearchSync(): ContentSearchSync | null {
  return current
}

/** Tests compose servers repeatedly; this keeps one from leaking into the next. */
export function resetContentSearchSync(): void {
  current = null
}
