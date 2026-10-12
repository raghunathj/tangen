/**
 * File Name: extension-entry.ts
 * Purpose: One rule for turning a manifest entry (`server`, `migrations`,
 *          `contentTypes`) into the specifier the CLI imports.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: An extension resolved from a PATH carries `__dir` and the
 *          entry is joined onto it. One resolved from a PACKAGE carries
 *          `__pkg`, and the entry is a subpath of that package: its
 *          conventional export first, then the declared path.
 *
 *          Before Stage G9 the migration sites required `__dir`, so a
 *          registry-installed extension's declared migrations were skipped in
 *          silence and its tables never appeared (G7-3).
 *
 *          The contract is deliberately ONE declaration: the manifest names the
 *          path and `files` ships it. A package is NOT asked to also add an
 *          `exports` entry per manifest key - that duplication is what made the
 *          missing `./tangen.extension` export so hard to diagnose. So the
 *          declared path is resolved relative to the package's own location,
 *          exactly as `__dir` is for a path-resolved extension, with the
 *          conventional export tried first for packages that do declare one.
 */
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

export interface EntryOwner {
  /** Set when the extension was resolved from a path inside the project. */
  __dir?: string
  /** Set when it was resolved from a bare package specifier. */
  __pkg?: string
  /**
   * Where that package physically sits, as resolved FROM THE PROJECT. The CLI
   * may be installed somewhere the package is not visible from (the release
   * dry run installs it beside the site, not inside it), so the project's
   * own resolution is remembered at load time and reused for every entry.
   */
  __root?: string
  id?: string
}

/**
 * Resolves `<pkg>/tangen.extension` the way the project itself would: from
 * `from` (the directory holding the project's config), not from the CLI's own
 * location. Returns the absolute file path; throws when the package is not a
 * dependency visible from there.
 */
export function resolveManifestFile(pkg: string, from: string): string {
  const specifier = `${pkg}/tangen.extension`
  if (typeof Bun !== 'undefined' && typeof Bun.resolveSync === 'function') {
    return Bun.resolveSync(specifier, from)
  }
  return fileURLToPath(import.meta.resolve(specifier))
}

export function manifestEntrySpecifiers(
  owner: EntryOwner,
  declared: string | undefined,
  kind: 'server' | 'migrations' | 'contentTypes' | 'push',
): string[] {
  if (!declared) return []
  if (owner.__dir) return [join(owner.__dir, declared)]
  const pkg = owner.__pkg ?? owner.id
  if (!pkg) return []
  const subpath = declared.replace(/^\.\//, '')
  const out = [`${pkg}/${kind}`]
  if (subpath) out.push(`${pkg}/${subpath}`)
  return out
}

/**
 * Where the package physically sits, found through the one subpath every
 * extension package must export anyway. Returns null when it cannot be
 * located, so the caller falls back to specifier-based attempts.
 */
function packageDir(pkg: string): string | null {
  try {
    return dirname(fileURLToPath(import.meta.resolve(`${pkg}/tangen.extension`)))
  } catch { return null }
}

/** Imports the first specifier that resolves; throws the last error otherwise. */
export async function importManifestEntry(
  owner: EntryOwner,
  declared: string | undefined,
  kind: 'server' | 'migrations' | 'contentTypes' | 'push',
): Promise<any | null> {
  const specifiers = [...manifestEntrySpecifiers(owner, declared, kind)]
  if (specifiers.length === 0) return null
  // Last resort, and the one that makes a single manifest declaration enough:
  // the declared path relative to where the package actually is.
  if (!owner.__dir && declared) {
    const dir = owner.__root ?? packageDir(owner.__pkg ?? owner.id ?? '')
    if (dir) specifiers.push(join(dir, declared))
  }
  let last: unknown
  for (const spec of specifiers) {
    try { return await import(spec) } catch (e) { last = e }
  }
  throw last instanceof Error ? last : new Error(`cannot resolve ${specifiers.join(' or ')}`)
}
