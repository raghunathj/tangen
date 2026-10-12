/**
 * File Name: protections.ts
 * Purpose: Every Block's protection, collected out of the resolved type
 *          definitions - the map the stylesheet compiler enforces by.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The declaration lives on the component def, because
 *          the def is what a site author writes and what `tangen push`
 *          carries into the environment. That makes the def the ONE source:
 *          the panel reads `protection` off the def it selected, and the
 *          server reads the same defs through `ctx.types()`, so the two
 *          cannot disagree. There is deliberately no kit fallback here - a
 *          site that overrides `kit.buttons` with a def of its own has made
 *          a decision, and the kit's declaration travels with the kit's defs
 *          through `withBuilderKit` like every other key.
 *
 *          Defs live wherever a type puts them - a region, a repeater's
 *          sub-fields, a group, a nested component - and one the collector
 *          missed would be a Block the compiler treats as Open. So it walks
 *          the same containers the schema resolver does.
 *
 *          Reading is loud. A malformed declaration throws with the component
 *          and the key (see protection-declaration.ts); two defs sharing a
 *          name but disagreeing on protection throw too, because the map can
 *          hold one answer and whichever it kept would be wrong for the other.
 */
import { readProtectionDeclaration, type BlockProtection } from '@tangen/studio-schema'
import { classTarget } from '@tangen/studio-compiler'

// The target reader moved beside RuleTarget in the compiler with WF-S10:
// Porter re-checks an incoming `class:` row's target with it, and the
// platform may not import extension code. Re-exported so the class routes
// and the publish path keep their existing import.
export { classTarget }

type AnyRecord = Record<string, unknown>

const isRecord = (v: unknown): v is AnyRecord => !!v && typeof v === 'object' && !Array.isArray(v)

const sameDeclaration = (a: BlockProtection | undefined, b: BlockProtection | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * The protection every component def in these types declares, by name.
 *
 * Takes the RESOLVED types (`ctx.types()`), where registry name refs have
 * already been expanded into defs. A string entry left over is skipped: it
 * is not a def, and it cannot carry a declaration.
 */
export function protectionsFor(
  types: ReadonlyArray<{ fields?: unknown }> | undefined,
): Record<string, BlockProtection> {
  const out: Record<string, BlockProtection> = {}
  const seen = new Map<string, BlockProtection | undefined>()

  const visitDef = (def: AnyRecord) => {
    const name = typeof def.name === 'string' ? def.name : ''
    if (!name) return
    const protection = readProtectionDeclaration(name, def.protection)
    if (seen.has(name) && !sameDeclaration(seen.get(name), protection)) {
      throw new Error(
        `Component "${name}" is declared more than once and the protection declarations differ - one component, one protection`,
      )
    }
    seen.set(name, protection)
    if (protection) out[name] = protection
    visitFields(def.fields)
  }

  const visitFields = (fields: unknown) => {
    if (!Array.isArray(fields)) return
    for (const field of fields) {
      if (!isRecord(field)) continue
      const cfg = isRecord(field.config) ? field.config : {}
      if (field.fieldType === 'component') {
        if (!Array.isArray(cfg.components)) continue
        for (const entry of cfg.components) if (isRecord(entry)) visitDef(entry)
      } else if (field.fieldType === 'repeater') {
        visitFields(cfg.fields)
      } else if (field.fieldType === 'group') {
        visitFields(cfg.groupFields)
      }
    }
  }

  for (const t of types ?? []) visitFields(t?.fields)
  return out
}

