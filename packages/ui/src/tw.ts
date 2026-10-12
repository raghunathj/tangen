/**
 * File Name: tw.ts
 * Purpose: The one tailwind-merge configuration of the design system. The
 *          UI V2 type scale adds `text-ui-*`, `text-title*` and
 *          `text-display` utilities; tailwind-merge cannot tell a custom
 *          font-size from a colour by its name, so without this it treated
 *          `text-ui-sm` as a colour and DROPPED `text-accent-contrast` from
 *          every primary button (caught by the axe lane: black on indigo).
 *          `cx` and every `tv()` in @tangen/ui and the Admin go through here.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tailwind-merge, tailwind-variants (createTV).
 */
import clsx, { type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'
import { createTV } from 'tailwind-variants'

/** The font-size steps `globals.css` declares under `--text-*`. */
export const TEXT_SCALE = ['ui-2xs', 'ui-xs', 'ui-sm', 'ui', 'ui-lg', 'title-sm', 'title', 'title-lg', 'display'] as const

/** Shadow and radius names `globals.css` maps from the tokens. */
export const SHADOW_SCALE = ['raised', 'popover', 'dialog'] as const
export const RADIUS_SCALE = ['control'] as const

export const twMergeConfig = {
  classGroups: {
    'font-size': [{ text: [...TEXT_SCALE] }],
    shadow: [{ shadow: [...SHADOW_SCALE] }],
    rounded: [{ rounded: [...RADIUS_SCALE] }],
  },
}

const merge = extendTailwindMerge({ extend: twMergeConfig })

/** Merges Tailwind class strings, resolving conflicts with the V2 scale known. */
export function cx(...args: ClassValue[]) {
  return merge(clsx(...args))
}

/** `tv` with the same merge configuration, so a size variant never deletes a colour. */
export const tv = createTV({ twMergeConfig })
