/**
 * File Name: ref-integrity.ts (forms)
 * Purpose: A content write may not leave a `form` field pointing at a form
 *   that does not exist. The field type itself cannot check this - a field
 *   type's validator is `(value) => string | null`, with no workspace, no
 *   database and no schema - so `validateFormRef` only ever checked the shape
 *   of a slug. A page could therefore publish a form section referencing a
 *   renamed or deleted form, and the only sign was an empty section on the
 *   live site.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure except for the lookup it is handed, so the walk is
 *   testable without a database. The walk is the reason this is not three
 *   lines: a `form` field is rarely top-level. It sits inside a component
 *   block, which sits in a repeater, which may sit in another block - so the
 *   type's own definition has to be walked with the values alongside it.
 */

/** A field definition, as `ctx.types()` resolves one (components expanded). */
interface FieldLike {
  name: string
  fieldType: string
  config?: {
    fields?: FieldLike[]
    groupFields?: FieldLike[]
    components?: Array<{ name?: string; fields?: FieldLike[] }>
    [k: string]: unknown
  }
}

/** One reference found in a write, with the path an editor can act on. */
export interface FormRef {
  /** Dotted path to the field, with row indexes: `blocks[2].form`. */
  path: string
  /** The referenced slug, trimmed. */
  slug: string
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Every `form` reference in `values`, found by walking `fields` alongside them.
 *
 * Containers are walked by what they ARE rather than by guessing from the
 * value: a component block names its own type in `_type` (or `_component`,
 * the second spelling the platform accepts), so the right field list is
 * chosen rather than every block's lists tried at once. An unknown block type
 * is skipped: it cannot be validated against a definition nobody has.
 */
export function collectFormRefs(fields: readonly FieldLike[], values: Record<string, unknown>, base = ''): FormRef[] {
  const out: FormRef[] = []
  for (const f of fields) {
    const value = values[f.name]
    const path = base ? `${base}.${f.name}` : f.name
    if (value === undefined || value === null) continue

    if (f.fieldType === 'form') {
      const slug = String(value).trim()
      if (slug !== '') out.push({ path, slug })
      continue
    }
    if (f.fieldType === 'group' && isObj(value)) {
      out.push(...collectFormRefs(f.config?.groupFields ?? [], value, path))
      continue
    }
    if (f.fieldType === 'repeater' && Array.isArray(value)) {
      const sub = f.config?.fields ?? []
      value.forEach((row, i) => { if (isObj(row)) out.push(...collectFormRefs(sub, row, `${path}[${i}]`)) })
      continue
    }
    if (f.fieldType === 'component' && Array.isArray(value)) {
      const defs = f.config?.components ?? []
      value.forEach((block, i) => {
        if (!isObj(block)) return
        // `_type` first: that is what the admin's block editor writes.
        // `_component` is accepted as the second spelling, the same pair the
        // core validator reads.
        const type = (block._type ?? block._component) as string | undefined
        const def = type ? defs.find((d) => d?.name === type) : undefined
        if (!def?.fields) return
        out.push(...collectFormRefs(def.fields, block, `${path}[${i}]`))
      })
      continue
    }
  }
  return out
}

/**
 * The refs that point at nothing, in the order they were found.
 *
 * `exists` is handed in so the walk stays pure and one query answers every
 * reference at once rather than one query per field.
 */
export function danglingRefs(refs: readonly FormRef[], existing: ReadonlySet<string>): FormRef[] {
  return refs.filter((r) => !existing.has(r.slug))
}

/** What an editor is told, naming every bad reference rather than the first. */
export function danglingMessage(bad: readonly FormRef[]): string {
  const one = bad.length === 1
  const list = bad.map((r) => `"${r.slug}" (${r.path})`).join(', ')
  return one
    ? `This references a form that does not exist: ${list}. Pick a form that is still there, or clear the field.`
    : `This references ${bad.length} forms that do not exist: ${list}. Pick forms that are still there, or clear those fields.`
}
