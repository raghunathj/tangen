/**
 * File Name: governance.ts
 * Purpose: Style governance - which style mode a workspace runs in, and
 *          whether the Creative (freeform) controls may be shown to the
 *          member in front of us.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure module - no platform imports, safe in config,
 *          server, and admin bundles alike (same shape as tokens.ts).
 *          Studio's held line is design tokens, never raw CSS, so GOVERNED
 *          is the default and every unrecognised input resolves to it:
 *          opening a workspace up takes a deliberate config change AND a
 *          capability grant, and neither alone is enough.
 */

/** The documented style modes. */
export const STYLE_MODES = ['governed', 'creative', 'both'] as const

export type StyleMode = (typeof STYLE_MODES)[number]

/** The `studio.styleMode` slice of a workspace config. */
export interface StudioGovernanceConfigLike {
  studio?: { styleMode?: unknown } | null
}

/**
 * The workspace's effective style mode. Anything unrecognised - missing,
 * misspelled, wrong type - resolves to 'governed'. A typo must never be the
 * thing that opens raw styling up.
 */
export function resolveStyleMode(
  config?: StudioGovernanceConfigLike | Record<string, unknown> | null,
): StyleMode {
  const raw = (config as StudioGovernanceConfigLike | undefined)?.studio?.styleMode
  return typeof raw === 'string' && (STYLE_MODES as readonly string[]).includes(raw)
    ? (raw as StyleMode)
    : 'governed'
}

/**
 * Whether the Advanced (Creative) style controls may be offered. Requires
 * BOTH: the workspace opted in, and this member holds `studio:creative`.
 * Fails closed on anything unexpected.
 */
export function canUseCreativeStyles(mode: StyleMode, hasCapability: boolean): boolean {
  if (hasCapability !== true) return false
  return mode === 'creative' || mode === 'both'
}
