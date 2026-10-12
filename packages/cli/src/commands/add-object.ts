/**
 * File Name: add-object.ts
 * Purpose: Implements the `tangen add-object` command, which scaffolds a new content-type
 *   directory with a schema file and registers it in the content barrel index.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Uses Node `fs` for file I/O; all functions are pure or accept
 *   injectable I/O for testability.
 */
import { join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { schemaDirIdentifier } from '@tangen/schema'

/**
 * Generates the boilerplate content for a new object-type schema file.
 * @param name - The machine-readable type name (e.g. `blogPost`)
 * @param label - The human-readable label shown in the admin UI
 * @returns The full TypeScript source string for the new schema file
 */
export function scaffoldTypeFile(name: string, label: string): string {
  // @tangen/cms is the single facade a site installs (re-exports @tangen/schema).
  // The examples, `tangen create` templates, and the hooks scaffold all use it —
  // scaffolding @tangen/schema here imported a transitive dep the site never
  // declared (fragile under strict resolution) and read inconsistently.
  return `import { defineObjectType, field } from '@tangen/cms'

export default defineObjectType({
  name: '${name}',
  label: '${label}',
  fields: {
    // \`title\`, \`slug\`, \`status\` and the timestamps are built in - every type has
    // them, and declaring one is refused. Add your own fields here, for example:
    // summary: field.textarea({ label: 'Summary', localized: true }),
    // body: field.richtext({ label: 'Body' }),
  },
})
`
}

/**
 * Inserts a new type import and appends the type name to the `types` array in
 * the content barrel (`content/index.ts`), preserving existing entries.
 * @param content - Current string content of the barrel file
 * @param typeName - The type name to add (e.g. `blogPost`)
 * @returns The updated barrel content string
 */
export function updateSchemaBarrel(content: string, typeName: string): string {
  // Derive a valid JS identifier (kebab folders → camelCase) while the import
  // path keeps the raw folder name — mirrors generateSchemaBarrel.
  const ident = schemaDirIdentifier(typeName)
  const newImportLine = `import ${ident} from './${typeName}/schema'\n`

  // Insert after the last relative import (content type imports like `import X from './X/schema'`)
  const relativeImports = [...content.matchAll(/^import \w+ from '\.\/[^']+'\n/gm)]
  if (relativeImports.length > 0) {
    const last = relativeImports[relativeImports.length - 1]
    const insertPos = last.index! + last[0].length
    content = content.slice(0, insertPos) + newImportLine + content.slice(insertPos)
  } else {
    // No content imports yet — insert after the last package import
    const pkgImports = [...content.matchAll(/^import .+ from '[^.][^']*'\n/gm)]
    if (pkgImports.length > 0) {
      const last = pkgImports[pkgImports.length - 1]
      const insertPos = last.index! + last[0].length
      content = content.slice(0, insertPos) + newImportLine + content.slice(insertPos)
    } else {
      content = newImportLine + content
    }
  }

  // Append the type name into the types array - the REAL one. The barrel
  // `tangen create` scaffolds carries a commented example that also contains
  // `types: [`, and registering into that is a silent no-op: the CLI reports
  // success, the schema file exists, and the next push finds nothing.
  const lines = content.split('\n')
  let inBlockComment = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()
    const wasInBlock = inBlockComment
    if (inBlockComment && trimmed.includes('*/')) inBlockComment = false
    else if (!inBlockComment && trimmed.includes('/*') && !trimmed.includes('*/')) inBlockComment = true
    if (wasInBlock || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    if (!/\btypes:\s*\[/.test(line)) continue
    lines[i] = line.replace(/(\btypes:\s*\[)([^\]]*)(\])/, (_, open, items, close) => {
      const t = String(items).trim()
      return `${open}${t ? `${t}, ${ident}` : ident}${close}`
    })
    return lines.join('\n')
  }

  return content
}

/**
 * Orchestrates the `tangen add-object` command: creates the type directory,
 * writes the schema file, and updates the content barrel if it exists.
 * @param typeName - Machine-readable name for the new object type
 * @param label - Human-readable label for the new object type
 * @param configCwd - Root directory that contains the `content/` folder
 * @param log - Optional logger; defaults to `console.log`
 */
/**
 * Generates an optional co-located hooks file for a new type and the line
 * that registers it in the app/hooks barrel.
 */
export function scaffoldHooksFile(typeName: string): string {
  return `import { forType } from '@tangen/cms'

export default forType('${typeName}', {
  // beforeChange(ctx) { … return { fieldName: value } to mutate before write },
  // afterChange(ctx) { … sync external systems },
})
`
}

/** Adds a per-type hooks import + compose entry to app/hooks/index.ts. */
export function updateHooksBarrel(content: string, typeName: string): string {
  const importLine = `import ${typeName}Hooks from '../content-objects/${typeName}/hooks'\n`
  if (content.includes(importLine.trim())) return content

  const imports = [...content.matchAll(/^import .+\n/gm)]
  if (imports.length > 0) {
    const last = imports[imports.length - 1]
    const pos = last.index! + last[0].length
    content = content.slice(0, pos) + importLine + content.slice(pos)
  } else {
    content = importLine + content
  }
  // Register inside composeContentHooks(...)
  return content.replace(
    /composeContentHooks\(/,
    `composeContentHooks(\n  ${typeName}Hooks,`,
  )
}

export async function runAddObjectCommand(
  typeName: string,
  label: string,
  configCwd: string,
  opts: { withHooks?: boolean } = {},
  log: (msg: string) => void = console.log,
): Promise<void> {
  const contentDir = join(configCwd, 'content-objects')
  const typeDir = join(contentDir, typeName)
  const schemaPath = join(typeDir, 'schema.ts')
  const barrelPath = join(contentDir, 'index.ts')

  if (existsSync(schemaPath)) {
    throw new Error(`Object type "${typeName}" already exists at ${schemaPath}`)
  }

  mkdirSync(typeDir, { recursive: true })
  writeFileSync(schemaPath, scaffoldTypeFile(typeName, label))

  if (existsSync(barrelPath)) {
    const current = readFileSync(barrelPath, 'utf8')
    writeFileSync(barrelPath, updateSchemaBarrel(current, typeName))
  }

  log(`Created content-objects/${typeName}/schema.ts`)
  log(`Updated content-objects/index.ts - added "${typeName}"`)

  if (opts.withHooks) {
    const hooksPath = join(typeDir, 'hooks.ts')
    writeFileSync(hooksPath, scaffoldHooksFile(typeName))
    log(`Created content-objects/${typeName}/hooks.ts`)

    const hooksBarrel = join(configCwd, 'hooks', 'index.ts')
    if (existsSync(hooksBarrel)) {
      const current = readFileSync(hooksBarrel, 'utf8')
      const next = updateHooksBarrel(current, typeName)
      if (next !== current) {
        writeFileSync(hooksBarrel, next)
        log(`Updated hooks/index.ts - composed "${typeName}" hooks`)
      } else {
        log(`hooks/index.ts - could not auto-register (compose call not found); add ${typeName}Hooks manually`)
      }
    }
  }
}
