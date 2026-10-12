/**
 * File Name: interaction-css.ts
 * Purpose: Tier 1 Interactions - compiled to CSS, costing the visitor no
 *          JavaScript.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Most real motion on a real page is an entrance, a hover
 *          or a focus ring, and CSS does all three. Shipping a JavaScript
 *          animation runtime for them would tax every site that animates
 *          anything, so the common cases compile to keyframes and
 *          pseudo-classes here. Only scroll-triggered motion may cost a
 *          script, and only on pages that use it.
 *
 *          The scroll case is still emitted as CSS, paused. The runtime's
 *          whole job is then to flip one attribute when the element comes
 *          into view - so the script never has to know what the animation is,
 *          which keeps it tiny and keeps the motion inspectable in the
 *          stylesheet.
 *
 *          Reduced motion is honoured by the emitter rather than left to the
 *          page author. Vestibular disorders make large movement genuinely
 *          painful, and the reduced branch restores the END state rather than
 *          only cancelling the animation - suppressing an entrance without
 *          restoring it leaves the element invisible forever, which is the
 *          worst possible answer to asking for less motion.
 */
import type { Interaction, InteractionAction } from '@tangen/studio-schema'

/** A class name safe to drop into a selector. */
const SAFE_CLASS = /^[A-Za-z_][A-Za-z0-9_-]*$/

/** The attribute the runtime sets when a scroll-triggered element appears. */
export const IN_VIEW_ATTR = 'data-tg-inview'

/**
 * The shared keyframes, emitted once for the whole stylesheet.
 *
 * Per-class copies would multiply six identical definitions across every
 * styled class for no benefit.
 */
export const KEYFRAMES_CSS = [
  '@keyframes tg-fade-in{from{opacity:0}to{opacity:1}}',
  '@keyframes tg-slide-up{from{opacity:0;transform:translateY(1rem)}to{opacity:1;transform:none}}',
  '@keyframes tg-slide-down{from{opacity:0;transform:translateY(-1rem)}to{opacity:1;transform:none}}',
  '@keyframes tg-slide-left{from{opacity:0;transform:translateX(1rem)}to{opacity:1;transform:none}}',
  '@keyframes tg-slide-right{from{opacity:0;transform:translateX(-1rem)}to{opacity:1;transform:none}}',
  '@keyframes tg-scale-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}',
].join('\n')

/** What a hover or focus should settle on, as a declaration list. */
const HOVER_STATE: Record<InteractionAction, string> = {
  'fade-in': 'opacity:1',
  'slide-up': 'transform:translateY(-.25rem)',
  'slide-down': 'transform:translateY(.25rem)',
  'slide-left': 'transform:translateX(-.25rem)',
  'slide-right': 'transform:translateX(.25rem)',
  'scale-in': 'transform:scale(1.03)',
}

/** The CSS for one interaction on one class, or '' when it cannot be emitted. */
export function interactionCss(className: string, interaction: Interaction): string {
  if (!SAFE_CLASS.test(className)) return ''

  const { event, action, duration, delay, easing } = interaction
  const sel = `.${className}`
  const timing = `${duration}ms ${easing}${delay ? ` ${delay}ms` : ''}`

  if (event === 'hover' || event === 'focus') {
    // A transition rather than a keyframe: the element has a resting state to
    // return to, which an animation would fight.
    return [
      `${sel}{transition:opacity ${timing},transform ${timing}}`,
      `${sel}:${event}{${HOVER_STATE[action]}}`,
      `@media (prefers-reduced-motion:reduce){${sel}{transition:none}}`,
    ].join('\n')
  }

  // `forwards` holds the final state, without which the element flicks back
  // to its starting opacity and reads as a bug rather than an animation.
  const animation = `animation:tg-${action} ${timing} both forwards`

  if (event === 'enter-view') {
    return [
      `${sel}{${animation};animation-play-state:paused}`,
      `${sel}[${IN_VIEW_ATTR}]{animation-play-state:running}`,
      // The reduced branch must leave the element VISIBLE, not merely
      // unanimated - it starts at opacity 0.
      `@media (prefers-reduced-motion:reduce){${sel}{animation:none;opacity:1;transform:none}}`,
    ].join('\n')
  }

  return [
    `${sel}{${animation}}`,
    `@media (prefers-reduced-motion:reduce){${sel}{animation:none;opacity:1;transform:none}}`,
  ].join('\n')
}
