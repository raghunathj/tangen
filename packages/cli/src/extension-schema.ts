/**
 * File Name: extension-schema.ts
 * Purpose: An extension declares content types; this is where they join the
 *   site's. `loadExtensionTypes` reads every extension the workspace config
 *   installs and returns what each declares; `mergeDeclaredTypes` decides who
 *   owns a name and stamps provenance on the rest. `tangen push` then runs the
 *   merged schema through the ORDINARY pipeline - preflight, plan, one
 *   transaction, ledger, codegen - so there is exactly one provisioning path
 *   and every safety property of push rounds 0-2 still holds.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The rules, stated once:
 *
 *   - **The site wins a name clash.** It is their database. The plan says
 *     whose definition won rather than picking one quietly.
 *   - **Provenance is stamped, never authored.** `providedBy` on a type comes
 *     from the extension that declared it and from nowhere else; a value found
 *     in a site schema file is discarded, because otherwise a typo would buy a
 *     type immunity from being dropped.
 *   - **Behavior does not survive.** Hooks, validate and dynamicOptions are
 *     stripped exactly as the site's own schema loses them crossing the JSON
 *     subprocess boundary in schema-loader.ts. What is pushed is structure.
 *   - **A broken declaration is fatal.** Provisioning that silently skips is
 *     the worst failure this codebase knows: a wrong guess that succeeds. A
 *     contentTypes module that cannot be imported, or a declaration that is
 *     not a content type, fails the preflight with the extension named.
 *
 *   Losing a type is handled downstream, in diff.ts: a registry row that
 *   carries a `providedBy` is never turned into a DROP_TYPE.
 */
import { join } from 'node:path'
import { importManifestEntry, manifestEntrySpecifiers } from './extension-entry'
import type { CustomTableDefinition } from '@tangen/types'
import type { ObjectTypeDefinition, SchemaDefinition, TangenExtensionManifest } from '@tangen/types'
import { stripFieldBehavior } from './schema-loader'

/** What one extension declares. */
export interface DeclaredExtensionTypes {
  extensionId: string
  types: ObjectTypeDefinition[]
}

/** The site's schema and every extension's, resolved into one schema plus what to say about it. */
export interface MergedSchema {
  /** The schema every later stage reads: the site's types first, then the extensions' in config order. */
  schema: SchemaDefinition
  /** Type name -> the extension that provides it. Empty for a site-owned type. */
  fromExtension: Map<string, string>
  /**
   * An extension declared a type the SITE already owns: the site's definition
   * is the one in `schema`. `siteName` differs from `type` when the match was
   * through the extension type's `previousName` - the site hand-wrote the type
   * under the name the extension would otherwise rename away from.
   */
  overridden: Array<{ type: string; extension: string; siteName?: string }>
  /** Two extensions declared the same name: the first in config order kept it. */
  conflicts: Array<{ type: string; kept: string; dropped: string }>
}

/** A definition with functions and provenance removed - what a push may carry. */
function asStructure(type: ObjectTypeDefinition): ObjectTypeDefinition {
  // JSON round-trip drops functions, which is exactly what the site's schema
  // loses crossing the subprocess boundary; stripFieldBehavior then clears the
  // empty `hooks: {}` husks a round-trip leaves behind.
  const copy = JSON.parse(JSON.stringify(type)) as ObjectTypeDefinition
  delete (copy as { providedBy?: string }).providedBy
  stripFieldBehavior({ types: [copy] })
  return copy
}

function assertIsType(type: unknown, extensionId: string, index: number): asserts type is ObjectTypeDefinition {
  const t = type as { name?: unknown; fields?: unknown } | null
  if (!t || typeof t.name !== 'string' || !t.name || !Array.isArray(t.fields)) {
    throw new Error(
      `contentTypes[${index}] of extension "${extensionId}" is not a content type `
      + '(a name and a fields array are the minimum). Declare it with defineObjectType().',
    )
  }
}

/**
 * Merges the site's schema with what each extension declares, in config order.
 * Pure: neither input is mutated.
 */
export function mergeDeclaredTypes(
  site: SchemaDefinition,
  declared: DeclaredExtensionTypes[],
): MergedSchema {
  const fromExtension = new Map<string, string>()
  const overridden: MergedSchema['overridden'] = []
  const conflicts: MergedSchema['conflicts'] = []

  const siteNames = new Set(site.types.map((t) => t.name))
  const types: ObjectTypeDefinition[] = site.types.map((t) => {
    if ((t as { providedBy?: string }).providedBy === undefined) return t
    const copy = { ...t }
    delete (copy as { providedBy?: string }).providedBy
    return copy
  })

  for (const source of declared) {
    for (let i = 0; i < source.types.length; i++) {
      const raw = source.types[i]
      assertIsType(raw, source.extensionId, i)
      const name = raw.name
      if (siteNames.has(name)) {
        overridden.push({ type: name, extension: source.extensionId })
        continue
      }
      // The site owns the row this type would RENAME. It happens when the site
      // hand-wrote the type before the extension could provision it and the
      // extension has since renamed it: both definitions would then claim the
      // same registry row, and the diff would emit a rename for a type the site
      // still declares. The site keeps its row and its name; the extension's
      // definition is left out, exactly as for a plain name clash.
      const owned = (raw.previousName ?? []).find((p) => siteNames.has(p))
      if (owned) {
        overridden.push({ type: name, extension: source.extensionId, siteName: owned })
        continue
      }
      const kept = fromExtension.get(name)
      if (kept) {
        conflicts.push({ type: name, kept, dropped: source.extensionId })
        continue
      }
      fromExtension.set(name, source.extensionId)
      types.push({ ...asStructure(raw), providedBy: source.extensionId })
    }
  }

  return { schema: { ...site, types }, fromExtension, overridden, conflicts }
}

/**
 * Two declared types that would claim the SAME registry row: one is named `x`
 * and another carries `previousName: ['x']`. The diff would match both to the
 * one runtime row and emit a rename for a type that is still declared - a plan
 * that reads fine and is nonsense. Refused before the database is opened.
 */
export function findPreviousNameCollisions(schema: SchemaDefinition): string[] {
  const byName = new Map(schema.types.map((t) => [t.name, t]))
  const errors: string[] = []
  for (const t of schema.types) {
    for (const prev of t.previousName ?? []) {
      const owner = byName.get(prev)
      if (!owner || owner === t) continue
      const where = (x: typeof t) => (x.providedBy ? `extension ${x.providedBy}` : 'this site')
      errors.push(
        `"${t.name}" (${where(t)}) carries previousName "${prev}", but "${prev}" is still declared by ${where(owner)}`
        + ` - both would claim the same registry row. Drop the previousName, or rename one of the two.`,
      )
    }
  }
  return errors
}

/** One line about where a type came from, or null when the site simply owns it. */
export function describeProvenance(typeName: string, merged: MergedSchema): string | null {
  const clash = merged.overridden.find((o) => o.type === typeName || o.siteName === typeName)
  if (clash) {
    return clash.siteName
      ? `declared by this site as "${clash.siteName}" AND by extension ${clash.extension} as "${clash.type}" - the site wins`
      : `declared by this site AND by extension ${clash.extension} - the site wins`
  }
  const ext = merged.fromExtension.get(typeName)
  return ext ? `from extension ${ext}` : null
}

// ── Reading the declarations ──────────────────────────────────────────────────

/** A manifest as the CLI's extension resolver returns it (`__dir` for a local path). */
type ResolvedManifest = TangenExtensionManifest & { __dir?: string; __pkg?: string }

/**
 * Imports the `contentTypes` a manifest declares. An inline array is taken as
 * it is; a string is a module path resolved the way `server` is - relative to
 * the extension dir, or as a package subpath for a bare specifier.
 */
export async function readManifestContentTypes(manifest: ResolvedManifest): Promise<ObjectTypeDefinition[]> {
  const declared = manifest.contentTypes
  if (!declared) return []
  if (Array.isArray(declared)) return declared
  if (typeof declared !== 'string') {
    throw new Error(`extension "${manifest.id}": contentTypes must be an array of definitions or a module path`)
  }
  let mod: { default?: unknown } | null
  try {
    mod = await importManifestEntry(manifest, declared, 'contentTypes')
  } catch (e) {
    const tried = manifestEntrySpecifiers(manifest, declared, 'contentTypes').join(' or ')
    throw new Error(
      `extension "${manifest.id}": could not load contentTypes from "${declared}" (${tried})\n`
      + `  ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  const value = (mod.default ?? mod) as unknown
  if (!Array.isArray(value)) {
    throw new Error(`extension "${manifest.id}": "${declared}" must default-export an array of content types`)
  }
  return value as ObjectTypeDefinition[]
}

/**
 * Every content type the extensions installed by this workspace declare, in
 * config order. An extension with no `contentTypes` contributes nothing and is
 * left out entirely, so the common case costs one manifest import.
 */
export async function loadExtensionTypes(
  cwd: string,
  config: { extensions?: Array<{ resolve?: string }>; plugins?: Array<{ resolve?: string }> },
): Promise<DeclaredExtensionTypes[]> {
  const { loadConfigExtensions } = await import('./commands/extension-install')
  const manifests = await loadConfigExtensions(config, cwd)
  const out: DeclaredExtensionTypes[] = []
  for (const manifest of manifests) {
    if (!manifest.contentTypes) continue
    const types = await readManifestContentTypes(manifest as ResolvedManifest)
    if (types.length > 0) out.push({ extensionId: manifest.id, types })
  }
  return out
}


/** A manifest's declared custom tables, with the identity and version they came from. */
export interface DeclaredExtensionTables {
  extensionId: string
  version: string
  tables: CustomTableDefinition[]
}

/**
 * Custom tables declared by the extensions this project ENABLES. Eligibility is
 * the same rule `loadExtensionTypes` already uses: an extension listed in the
 * config's `extensions:` array. A package sitting in node_modules that nobody
 * enabled declares nothing.
 *
 * Reads manifest data only. It does not call `onInstall`, `onUninstall` or any
 * other lifecycle hook - planning inspects a declaration, it does not run an
 * extension. Importing the manifest module does execute that module's top-level
 * code, which is the ordinary npm trust model and not something this changes.
 */
export async function loadExtensionCustomTables(
  cwd: string,
  config: { extensions?: Array<{ resolve?: string }>; plugins?: Array<{ resolve?: string }> },
): Promise<DeclaredExtensionTables[]> {
  const { loadConfigExtensions } = await import('./commands/extension-install')
  const manifests = await loadConfigExtensions(config, cwd)
  const out: DeclaredExtensionTables[] = []
  for (const manifest of manifests) {
    const tables = (manifest as { customTables?: CustomTableDefinition[] }).customTables
    if (!Array.isArray(tables) || tables.length === 0) continue
    out.push({ extensionId: manifest.id, version: String((manifest as { version?: string }).version ?? ''), tables })
  }
  return out
}
