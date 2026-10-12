/**
 * File Name: ai-nav.ts
 * Purpose: Whether the AI nav section exists, decided from the ONE capability
 *          truth (closure plan Phase 9D, Unit 17). Two hooks used to answer
 *          this - one asking /admin/ai/settings, one asking
 *          /admin/ai/surfaces - and both cached under the environment slug
 *          alone, so two workspaces sharing a slug shared the answer. Both
 *          are gone; this reads the Phase 8A store.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure over a status lookup, so it is testable without a
 *          server or a render. Capability state is not permission: the caller
 *          still asks `hasCapability('manage:aiSettings')` separately.
 */
import type { CapabilityStatus } from './use-capabilities'

/** The capabilities the AI section exists for. Content AI itself is a setting, not a section. */
const AI_SECTION_CAPABILITIES = ['knowledge', 'mcp'] as const

/**
 * Shown when Knowledge or MCP is usable, and ALSO when one of them is
 * unavailable: the page is where the reason lives, and hiding it would hide
 * the only explanation an operator has. Off is a choice someone made, so it
 * hides; loading and unknown hide too, so the section never flashes in.
 */
export function aiSectionVisible(status: (id: string) => CapabilityStatus): boolean {
  return AI_SECTION_CAPABILITIES.some((id) => {
    const s = status(id)
    return s === 'on' || s === 'unavailable'
  })
}
