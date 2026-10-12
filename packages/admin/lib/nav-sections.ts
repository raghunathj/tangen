/**
 * File Name: nav-sections.ts
 * Purpose: Pure rules for what a sidebar section shows, kept out of the
 *          component so they can be stated and tested without a DOM.
 *
 * Author: Raghunath J
 * License: MIT
 */

export type ExtensionsSectionMode = 'items' | 'hidden'

/**
 * Nothing active means no Extensions section, for everyone (the user,
 * 2026-09-08): an empty caption is noise, and the way to install one is
 * documentation, not navigation.
 */
export function extensionsSectionMode(input: { hasExtensions: boolean }): ExtensionsSectionMode {
  return input.hasExtensions ? 'items' : 'hidden'
}

/**
 * Which extensions belong in the Extensions section (plan-connectors E2).
 *
 * A connector pack is not a feature an operator opens; it exists so that a
 * provider can be connected, and everything it offers is already on the
 * Connections page - the providers it owns, the capabilities each one has,
 * and the connections themselves. Listing it here sent an operator looking
 * for Google to a page about an extension (the user, 2026-09-19). Its
 * overview page stays reachable by URL for whoever wants the grant review.
 */
export function extensionsForNav<T extends { kind?: 'extension' | 'connector-pack' }>(apps: readonly T[]): T[] {
  return apps.filter((a) => a.kind !== 'connector-pack')
}
