/**
 * File Name: interaction-defaults.ts
 * Purpose: What the Interaction editor creates when a designer picks a type,
 *          and how each type is named.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Tier 1 (load, enter-view, hover, focus) compiles to
 *          CSS; Tier 2 (scrub, timeline, reverse-on-leave, count-up) is
 *          interpreted by a module the runtime loads only for pages that
 *          declare one. The editor offers both under one "Type" control and
 *          the distinction stays invisible to the designer - the cost is the
 *          runtime's concern, not theirs.
 *
 *          Every default here must pass the schema's normaliser. A default
 *          the schema refuses would be a control that creates something the
 *          server then rejects, which is the fastest way for a panel to lose
 *          trust - so the test suite normalises each one.
 */
import {
  DEFAULT_DURATION_MS, EASINGS, INTERACTION_EVENTS, TIER2_KINDS,
  type Interaction, type InteractionEvent, type Tier2Kind,
} from '@tangen/studio-schema'

/** Everything the Type control offers, Tier 1 first. */
export const INTERACTION_TYPES = [...INTERACTION_EVENTS, ...TIER2_KINDS] as const
export type InteractionType = (typeof INTERACTION_TYPES)[number]

export const INTERACTION_TYPE_LABEL: Record<InteractionType, string> = {
  load: 'On load',
  'enter-view': 'When scrolled into view',
  hover: 'On hover',
  focus: 'On focus',
  scrub: 'Scroll scrub',
  timeline: 'Timeline',
  'reverse-on-leave': 'Reverse on leave',
  'count-up': 'Count up',
}

/** The type of a stored interaction, for the Type control. */
export function interactionType(value: unknown): InteractionType | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { kind?: unknown; event?: unknown }
  if (typeof v.kind === 'string' && (TIER2_KINDS as readonly string[]).includes(v.kind)) return v.kind as Tier2Kind
  if (typeof v.event === 'string' && (INTERACTION_EVENTS as readonly string[]).includes(v.event)) return v.event as InteractionEvent
  return null
}

const fadeUp = [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }]

/**
 * A sensible starting interaction for a type, already valid.
 *
 * `className` is carried on Tier 2 declarations because the interpreter
 * addresses elements by selector; the server re-injects the row's name on
 * every write, so a rename can never leave it stale.
 */
export function defaultInteraction(type: InteractionType, className: string): Record<string, unknown> {
  switch (type) {
    case 'scrub':
      return {
        kind: 'scrub', className, keyframes: fadeUp,
        view: true, axis: 'block', rangeStart: 'entry 0%', rangeEnd: 'entry 100%', easing: EASINGS[0],
      }
    case 'timeline':
      return {
        kind: 'timeline', className,
        steps: [{ className, keyframes: fadeUp, duration: DEFAULT_DURATION_MS, easing: EASINGS[0] }],
      }
    case 'reverse-on-leave':
      return { kind: 'reverse-on-leave', className, keyframes: fadeUp, duration: DEFAULT_DURATION_MS, easing: EASINGS[0], threshold: 0.2 }
    case 'count-up':
      return { kind: 'count-up', className, from: 0, to: 100, duration: 1200 }
    default: {
      const t1: Interaction = { event: type, action: 'fade-in', duration: DEFAULT_DURATION_MS, delay: 0, easing: EASINGS[0] }
      return t1 as unknown as Record<string, unknown>
    }
  }
}
