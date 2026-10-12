/**
 * File Name: component-rename.ts
 * Purpose: Explicit rename intent for component sub-fields, and the guard that
 *   keeps it from ever being applied to data it does not describe.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure. A component sub-field is a key inside JSONB, not a
 *   column, so `previousName` here is not an ALTER instruction: it is the only
 *   record anywhere that two keys are the same field. There is no components
 *   table, so the database holds no previous definition to diff against, and
 *   the declaration in code is the whole source of truth.
 *
 *   The migration that consumes it retires itself by COUNTING occurrences of
 *   the old key rather than by writing to a ledger, which is what lets a
 *   revision restore or a Porter import heal on the next push. The cost of that
 *   choice is this file: a declaration stays live indefinitely, so a NEW field
 *   that reuses a still-active source name would be read as un-migrated history
 *   and moved. `componentRenameConflicts` refuses that reuse, which is what
 *   keeps self-healing from eating live data.
 */

/** The shape this module needs from a component definition. */
export interface RenameableComponent {
  name: string
  fields?: Array<{ name: string; previousName?: string[] }>
}

/**
 * Every name that still stands for stored data in this component, mapped to the
 * field that now owns it. A chain protects EVERY name in it, not just the
 * first: rows written before either rename may hold either key.
 */
export function activeRenameSources(component: RenameableComponent): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of component.fields ?? []) {
    for (const prev of f.previousName ?? []) out.set(prev, f.name)
  }
  return out
}

/**
 * Reasons this component's rename intent cannot be trusted. Empty means it can.
 *
 * The messages are the ones a developer reads, so they name both fields and say
 * what to do; there is no rename-history retirement command yet, and an
 * explicit purge of the old values is the honest way out.
 */
export function componentRenameConflicts(component: RenameableComponent): string[] {
  const problems: string[] = []
  const fields = component.fields ?? []
  const current = new Set(fields.map((f) => f.name))
  const claimed = new Map<string, string>()

  for (const f of fields) {
    for (const prev of f.previousName ?? []) {
      if (prev === f.name) {
        problems.push(`component "${component.name}": field "${f.name}" lists itself in previousName - a field was not renamed from itself`)
        continue
      }
      const already = claimed.get(prev)
      if (already) {
        problems.push(`component "${component.name}": "${already}" and "${f.name}" both claim to have been renamed from "${prev}" - one historical value cannot become two fields`)
        continue
      }
      claimed.set(prev, f.name)
    }
  }

  for (const [prev, owner] of claimed) {
    if (!current.has(prev)) continue
    problems.push(
      `component "${component.name}": "${prev}" is still the rename source of "${owner}", so it cannot also be a field. ` +
      `Stored blocks holding "${prev}" are treated as history waiting to move, and a new field of that name would be moved with them. ` +
      `Pick another name, or purge the historical "${prev}" values first and drop the previousName.`,
    )
  }
  return problems
}
