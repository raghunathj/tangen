/**
 * File Name: form-behavior.ts
 * Purpose: The forms behavior registry — code-side option functions and
 *   lifecycle hooks loaded at API boot from the site's app/forms barrel.
 *   DB rows hold structure; behavior overlays at runtime (same philosophy as
 *   content field behavior). defineFormHooks entries attach hooks to ANY form
 *   by slug — admin-built forms included.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: consumed by the submit routes (hooks + option
 *   resolution) and the form worker (queued hooks).
 */

export type FormOptionsFn = (ctx: {
  tangen: unknown
  env: string
  workspaceId: string
}) => Promise<Array<{ label: string; value: string }>> | Array<{ label: string; value: string }>

export interface FormsBehavior {
  /** Lifecycle hooks keyed by form slug. */
  hooksBySlug: Record<string, Record<string, unknown>>
  /** Option loader functions keyed by form slug → field name. */
  optionsBySlugField: Record<string, Record<string, FormOptionsFn>>
}

/**
 * Builds the behavior registry from an app/forms barrel's default export —
 * defineForm entries contribute option functions (and their own hooks);
 * defineFormHooks entries contribute hooks for any slug.
 */
export function buildFormsBehavior(entries: unknown[]): FormsBehavior {
  const behavior: FormsBehavior = { hooksBySlug: {}, optionsBySlugField: {} }
  for (const e of entries ?? []) {
    if (!e || typeof e !== 'object') continue
    const entry = e as Record<string, any>
    if (typeof entry.slug !== 'string' || !entry.slug) continue

    if (Array.isArray(entry.fields)) {
      for (const f of entry.fields) {
        if (f && typeof f.options === 'function' && typeof f.name === 'string') {
          behavior.optionsBySlugField[entry.slug] ??= {}
          behavior.optionsBySlugField[entry.slug][f.name] = f.options
        }
      }
    }
    if (entry.hooks && typeof entry.hooks === 'object') {
      behavior.hooksBySlug[entry.slug] = { ...behavior.hooksBySlug[entry.slug], ...entry.hooks }
    }
  }
  return behavior
}

/**
 * Imports the app/forms barrel next to a workspace's tangen.config.ts.
 * Missing barrels are fine (feature unused); load errors are logged once.
 */
