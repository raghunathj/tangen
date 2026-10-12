/**
 * File Name: interactions.ts
 * Purpose: Interaction definitions - what a designer can make a Block do.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Called Interactions throughout - not Experiences, not
 *          Animation. The word is settled in studio-decisions.md.
 *
 *          These are DECLARATIONS, not code. An interaction must survive into
 *          a framework-neutral published artifact, be readable by a runtime
 *          that never saw the authoring session, and be expressible as plain
 *          CSS wherever possible. So this file is data and validation; the
 *          compiler emits, and nothing here does.
 *
 *          Everything is clamped and allow-listed on the way IN, because
 *          these values reach a stylesheet. A duration a designer types
 *          freely can be `999s`; an easing is a place a function call could
 *          hide. Validating at the door beats escaping at the emitter,
 *          because the emitter is not the only thing that will ever read
 *          these.
 */

/** What starts an interaction. */
export const INTERACTION_EVENTS = ['load', 'enter-view', 'hover', 'focus'] as const
export type InteractionEvent = (typeof INTERACTION_EVENTS)[number]

/** What it does. Entrance movements a designer recognises by name. */
export const INTERACTION_ACTIONS = [
  'fade-in', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'scale-in',
] as const
export type InteractionAction = (typeof INTERACTION_ACTIONS)[number]

/**
 * Allowed easings. A closed list rather than free text: an easing string is
 * emitted into CSS, and `cubic-bezier` is one keystroke away from somewhere a
 * `url()` could hide.
 */
export const EASINGS = ['ease-out', 'ease-in', 'ease-in-out', 'linear'] as const
export type Easing = (typeof EASINGS)[number]

/** Long enough for a deliberate reveal, short of a page that looks stuck. */
export const MAX_DURATION_MS = 3000
export const DEFAULT_DURATION_MS = 400

export interface Interaction {
  event: InteractionEvent
  action: InteractionAction
  /** Milliseconds. */
  duration: number
  delay: number
  easing: Easing
}

/** Clamps to a whole, non-negative number of milliseconds. */
function ms(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(MAX_DURATION_MS, Math.max(0, Math.round(value)))
}

/**
 * A usable interaction, or null when the input cannot be made into one.
 *
 * Null rather than a repaired guess: an unrecognised event or action would
 * compile into a rule that silently does nothing, which is worse for the
 * designer than the interaction visibly not being there.
 */
export function normalizeInteraction(raw: unknown): Interaction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>

  const event = INTERACTION_EVENTS.find((e) => e === input.event)
  const action = INTERACTION_ACTIONS.find((a) => a === input.action)
  if (!event || !action) return null

  const duration = ms(input.duration, DEFAULT_DURATION_MS)
  return {
    event,
    action,
    // A zero-length animation is the same as none at all, so a designer who
    // typed 0 or a negative gets the default rather than nothing happening.
    duration: duration === 0 ? DEFAULT_DURATION_MS : duration,
    delay: ms(input.delay, 0),
    easing: EASINGS.find((e) => e === input.easing) ?? EASINGS[0],
  }
}

/**
 * Whether this interaction costs the visitor any JavaScript.
 *
 * Only `enter-view` does. Hover and focus are CSS pseudo-classes and a load
 * animation is a keyframe that runs on its own, so the common cases ship
 * nothing - and the one case that needs a script only loads it on pages that
 * actually use it.
 */
export function needsRuntime(interaction: Pick<Interaction, 'event'>): boolean {
  return interaction.event === 'enter-view'
}
