/**
 * File Name: installed-field-types.ts
 * Purpose: Shape + search filter for custom field types contributed by installed
 *   extensions (fetched from GET /admin/workspaces/:id/field-types and shown in the
 *   Add Field modal's "From Extensions" group). Dependency-light so it's unit-testable
 *   without pulling in React or the icon set.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** A custom field type contributed by an installed extension or the site. */
export interface InstalledFieldType {
  name: string
  label: string
  description?: string
  icon?: string
  extensionName?: string
  /** Per-field config options this type accepts (drives the config Sheet controls). */
  configSchema?: Record<string, unknown>
  /** false when the type opts out of AI (`ai.enabled: false`) — governs AI generation. */
  aiEnabled?: boolean
  /** Schema-builder control paths/prefixes to hide for this type (general option
   *  suppression), e.g. `['config.ai', 'config.default']`. */
  hiddenControls?: string[]
}

/**
 * True when a schema-builder control (identified by its `path`) should be hidden
 * given a field type's `hiddenControls` list. Matches an exact path OR a
 * `<entry>.` prefix — so `'config.ai'` hides `config.ai.enabled` and
 * `config.ai.hint`, but NOT a hypothetical `config.airline`. Empty/undefined
 * list hides nothing.
 */
export function isControlHidden(path: string, hidden: string[] | undefined): boolean {
  if (!hidden?.length) return false
  return hidden.some((h) => path === h || path.startsWith(h + '.'))
}

/** Search filter for installed custom types — matches name / label / description. */
export function filterInstalledFieldTypes(items: InstalledFieldType[], query: string): InstalledFieldType[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return items
  return items.filter(
    (f) =>
      f.name.toLowerCase().includes(needle) ||
      f.label.toLowerCase().includes(needle) ||
      (f.description ?? '').toLowerCase().includes(needle),
  )
}
