/**
 * File Name: object-lifecycle.ts
 * Purpose: TL-6 — `tangen object disable|enable|delete <name>`: thin CLI sugar over
 *   the code edits a developer would make by hand. disable/enable toggle the type's
 *   `disabled: true` flag in schema.ts (soft delete — content APIs 404, data stays);
 *   delete removes the type folder + barrel entry (PERMANENT — the confirmed push
 *   drops the table). All file edits are conservative: when a hand-authored file
 *   can't be edited safely, we bail with instructions instead of corrupting it.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'

/**
 * Toggle `disabled: true` in a defineObjectType source. Returns the new source
 * (identical string when already in the desired state) or null when the file's
 * shape can't be edited safely (no defineObjectType / no label line to anchor on).
 */
export function setDisabledInSource(src: string, disabled: boolean): string | null {
  if (!src.includes('defineObjectType(') && !src.includes('defineComponent(')) return null
  const has = /\n\s*disabled:\s*true,?\s*(?=\n)/.test(src)

  if (disabled) {
    if (has) return src
    // Anchor on the label line — every authored type has one.
    const m = src.match(/\n(\s*)label:\s*[^\n]*\n/)
    if (!m || m.index === undefined) return null
    const insertAt = m.index + m[0].length
    return src.slice(0, insertAt) + `${m[1]}disabled: true,\n` + src.slice(insertAt)
  }

  if (!has) return src
  return src.replace(/\n\s*disabled:\s*true,?(?=\n)/, '')
}

/** Inverse of add-object's barrel update: drop the import + the types[] entry. */
export function removeFromSchemaBarrel(content: string, typeName: string): string {
  let out = content.replace(new RegExp(`^import ${typeName} from '\\./${typeName}/schema'\\n`, 'm'), '')
  out = out.replace(/(\btypes:\s*\[)([^\]]*)(\])/, (_, open, items: string, close) => {
    const names = items.split(',').map((s) => s.trim()).filter(Boolean).filter((n) => n !== typeName)
    return `${open}${names.join(', ')}${close}`
  })
  return out
}

export interface ObjectLifecycleIO {
  log?: (msg: string) => void
  error?: (msg: string) => void
  /** Receives `<type>.<field>` for every relation field detachReferencesInDir removed. */
  detached?: string[]
}

/** `tangen object disable|enable <name>` — flips the flag in schema.ts. */
export function runObjectToggleCommand(
  typeName: string,
  disabled: boolean,
  configCwd: string,
  io: ObjectLifecycleIO = {},
): boolean {
  const log = io.log ?? console.log
  const error = io.error ?? console.error
  const schemaPath = join(configCwd, 'content-objects', typeName, 'schema.ts')
  if (!existsSync(schemaPath)) {
    error(`tangen: no such type - ${schemaPath} not found`)
    return false
  }
  const src = readFileSync(schemaPath, 'utf8')
  const next = setDisabledInSource(src, disabled)
  if (next === null) {
    error(`tangen: could not edit ${schemaPath} safely - add ${disabled ? '' : 'or remove '}\`disabled: true\` on the defineObjectType(...) call manually`)
    return false
  }
  if (next === src) {
    log(`  already ${disabled ? 'disabled' : 'enabled'} - nothing to do`)
    return true
  }
  writeFileSync(schemaPath, next)
  log(`  ✓ ${typeName} ${disabled ? 'disabled (content APIs will answer 404; data untouched)' : 're-enabled'}`)
  return true
}

/**
 * `tangen object delete <name>` file-side: removes the type folder + barrel entry.
 * PERMANENT once pushed with the type's approval (the caller runs the push). The push itself
 * still refuses while relation fields elsewhere target this type.
 */
export function runObjectDeleteFiles(
  typeName: string,
  configCwd: string,
  io: ObjectLifecycleIO = {},
): boolean {
  const log = io.log ?? console.log
  const error = io.error ?? console.error
  const contentDir = join(configCwd, 'content-objects')
  const typeDir = join(contentDir, typeName)
  if (!existsSync(join(typeDir, 'schema.ts'))) {
    error(`tangen: no such type - ${typeDir}/schema.ts not found`)
    return false
  }
  rmSync(typeDir, { recursive: true, force: true })
  const barrelPath = join(contentDir, 'index.ts')
  if (existsSync(barrelPath)) {
    writeFileSync(barrelPath, removeFromSchemaBarrel(readFileSync(barrelPath, 'utf8'), typeName))
  }
  log(`  ✓ removed ${typeDir} and its barrel entry`)
  return true
}

/**
 * Remove every relation field targeting `targetName` from a schema source (the
 * detach half of `tangen object delete`'s cascade). Handles the two canonical
 * shapes — builder-written single-line entries and hand-authored
 * `key: field.relation({...})` blocks — plus editorView stage lists. Returns the
 * source unchanged when nothing references the target, and null when a reference
 * exists but can't be removed safely (caller aborts with instructions).
 */
export function detachRelationFieldsFromSource(src: string, targetName: string, onRemoved?: (field: string) => void): string | null {
  const refRe = new RegExp(`targetType['"]?\\s*:\\s*['"]${targetName}['"]`)
  if (!refRe.test(src)) return src
  if (!src.includes('defineObjectType(') && !src.includes('defineComponent(')) return null

  let out = src
  const removedFields: string[] = []

  // The entry's OWN fieldType is the FIRST one on its line — a component field's line
  // nests other fieldTypes inside its JSON, and a greedy scan must never cross into
  // them (that would remove a whole component field for one nested sub-field).
  const ownTypeIsRelation = (line: string) => /fieldType['"]?\s*:\s*['"]([a-z_]+)['"]/.exec(line)?.[1] === 'relation'

  // Pass 1: single-line FIELD entries — key: { ...fieldType: 'relation'...targetType... },
  out = out.replace(
    new RegExp(`^[ \\t]+([a-zA-Z0-9_]+):\\s*\\{[^\\n]*targetType[^\\n]*['"]${targetName}['"][^\\n]*\\},?[ \\t]*\\n`, 'gm'),
    (m, key: string) => {
      if (!ownTypeIsRelation(m)) return m
      removedFields.push(key)
      return ''
    },
  )

  // Pass 1b: SubField ARRAY entries (app/components schema files) —
  //   { name: 'writer', ..., fieldType: 'relation', ..., targetType: '<name>' ... },
  out = out.replace(
    new RegExp(`^[ \\t]+\\{\\s*name:\\s*['"]([a-zA-Z0-9_]+)['"][^\\n]*targetType[^\\n]*['"]${targetName}['"][^\\n]*\\},?[ \\t]*\\n`, 'gm'),
    (m, key: string) => {
      if (!ownTypeIsRelation(m)) return m
      removedFields.push(key)
      return ''
    },
  )

  // Pass 2: multiline blocks —   key: field.relation({ ... }) / key: { ... } spanning lines
  while (refRe.test(out)) {
    const at = out.search(refRe)
    // Walk back to the start of the enclosing field entry line.
    let entryStart = -1
    let key = ''
    let indent = ''
    const lineStarts: number[] = []
    for (let i = out.lastIndexOf('\n', at); i > 0; i = out.lastIndexOf('\n', i - 1)) lineStarts.push(i + 1)
    for (const ls of lineStarts) {
      const line = out.slice(ls, out.indexOf('\n', ls))
      const m = line.match(/^([ \t]+)([a-zA-Z0-9_]+):\s*(field\.[a-zA-Z0-9_]+\(\{|\{)\s*$/)
      if (m) { entryStart = ls; key = m[2]; indent = m[1]; break }
      // A closing line before finding an entry start means the match isn't inside a field block we understand.
      if (/^[ \t]*\},?\s*$/.test(line) && ls < at) continue
    }
    if (entryStart === -1) return null
    // Walk forward balancing braces/parens from the entry line to its end.
    let depth = 0
    let i = entryStart
    let entryEnd = -1
    for (; i < out.length; i++) {
      const ch = out[i]
      if (ch === '{' || ch === '(') depth++
      else if (ch === '}' || ch === ')') {
        depth--
        if (depth === 0) {
          // consume optional ')' for field.x({...}), trailing comma, then the newline
          let j = i + 1
          if (out[j] === ')') j++
          if (out[j] === ',') j++
          while (out[j] === ' ' || out[j] === '\t') j++
          if (out[j] === '\n') j++
          entryEnd = j
          break
        }
      }
    }
    if (entryEnd === -1 || entryEnd <= at) return null
    void indent
    // The found entry must BE a relation field — walking back can land on a structural
    // block (`fields: {`, a component field) that merely CONTAINS the reference. Those
    // can't be line-surgeried safely → bail to manual instructions.
    const segment = out.slice(entryStart, entryEnd)
    const segmentIsRelation = /field\.relation\(/.test(segment)
      || /fieldType['"]?\s*:\s*['"]([a-z_]+)['"]/.exec(segment)?.[1] === 'relation'
    if (!segmentIsRelation) return null
    removedFields.push(key)
    out = out.slice(0, entryStart) + out.slice(entryEnd)
  }

  // editorView stage lists: drop the removed field names.
  for (const key of removedFields) {
    out = out.replace(new RegExp(`"${key}",?`, 'g'), '')
    out = out.replace(new RegExp(`'${key}',?`, 'g'), '')
  }
  // Tidy dangling commas the list edits may leave: ["a",] / [ ,"b"]
  out = out.replace(/,\s*\]/g, ']').replace(/\[\s*,/g, '[')

  if (onRemoved) for (const f of removedFields) onRemoved(f)
  return out
}

/**
 * Detach every reference to `targetName` across the content dir (all schema.ts
 * except the target's own). Returns the edited file list, or null after printing
 * which files need manual edits.
 */
export function detachReferencesInDir(
  contentDir: string,
  targetName: string,
  io: ObjectLifecycleIO = {},
  /** app/components — reusable component schemas are scanned too. */
  componentsDir?: string,
): string[] | null {
  const { readdirSync } = require('node:fs') as typeof import('node:fs')
  const log = io.log ?? console.log
  const error = io.error ?? console.error
  const edited: string[] = []
  const manual: string[] = []
  const scanDir = (base: string, label: string) => {
    if (!existsSync(base)) return
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || (base === contentDir && entry.name === targetName)) continue
      const schemaPath = join(base, entry.name, 'schema.ts')
      if (!existsSync(schemaPath)) continue
      const src = readFileSync(schemaPath, 'utf8')
      const next = detachRelationFieldsFromSource(src, targetName, (f) => io.detached?.push(`${entry.name}.${f}`))
      if (next === null) { manual.push(schemaPath); continue }
      if (next !== src) { writeFileSync(schemaPath, next); edited.push(`${label}${entry.name}/schema.ts`) }
    }
  }
  scanDir(contentDir, '')
  if (componentsDir) scanDir(componentsDir, 'components/')
  if (manual.length > 0) {
    error(`tangen: could not safely detach relation fields in:\n${manual.map((f) => `  - ${f}`).join('\n')}\n  Remove the fields targeting "${targetName}" manually, then re-run.`)
    return null
  }
  for (const f of edited) log(`  ✓ detached relation field(s) in ${f}`)
  return edited
}
