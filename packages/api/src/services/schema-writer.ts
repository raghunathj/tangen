/**
 * File Name: schema-writer.ts
 * Purpose: SB-2 — write content-type schema files from the admin Content Object
 *   Builder's model. Writes `<appContentDir>/<name>/schema.ts` (via the shared
 *   @tangen/schema codegen) and keeps `<appContentDir>/index.ts` (the barrel) in
 *   sync with whatever type dirs exist. Type names are validated to prevent
 *   writing outside the content-objects dir.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: fs + @tangen/schema codegen only (no DB) — the write is
 *   local; `tangen push` (DDL) is triggered separately by the route. Only
 *   `schema.ts` is (re)written — hand-authored co-files (hooks.ts, access.ts) are
 *   never touched.
 */
import { readdirSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { generateObjectTypeSource, generateSchemaBarrel, generateComponentSource, generateComponentsBarrel, generateGlobalsFileContent, type CodegenObjectType, type CodegenComponent, type CodegenGlobal } from '@tangen/schema'
import { isSafeIdent } from '@tangen/types'
import { RequestError } from '../lib/errors'

/** A valid content-type name: lowercase, starts with a letter, [a-z0-9_]. */
const NAME_RE = /^[a-z][a-z0-9_]*$/

/**
 * A valid content-type FOLDER name — same as a type name but also allows hyphens,
 * so a `post_category` type may live in a `post-category/` folder. The barrel
 * generator derives a valid JS identifier from it (see `schemaDirIdentifier`);
 * without this, hyphenated folders were silently dropped from the barrel.
 */
const DIR_NAME_RE = /^[a-z][a-z0-9_-]*$/

export function assertSafeName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new RequestError('VALIDATION_ERROR', `Invalid content type name "${name}" - use lowercase letters, digits, and underscores`, 422)
  }
}

/**
 * A valid field TYPE as written to disk: the built-ins and an
 * extension-contributed custom name alike are lowercase identifier shapes.
 * It is deliberately not a closed list - a custom field type is a real thing
 * and the writer is not the registry - but it IS a shape, which is what the
 * generated source needs.
 */
const FIELD_TYPE_RE = /^[a-z][a-z0-9_]*$/

/**
 * Every field name and field type of a schema about to be written, validated.
 *
 * Security finding 19: nothing validated a field name anywhere on this path.
 * The builder's own name went through `assertSafeName`; the FIELDS did not, and
 * a field name was emitted as a bare object key in the generated `schema.ts`
 * while its `fieldType` was emitted inside a single-quoted literal. The dev
 * server imports that file on the next watch cycle, so the text ran. The
 * generated-source sinks are safe on their own now (`@tangen/schema`
 * `emitKey`), and this is the refusal that goes with them: a name Tangen
 * cannot use is named back to the caller, never quietly rewritten.
 *
 * A field name becomes a database column, so the rule is the identifier
 * contract every SQL path already uses.
 */
export function assertSafeFields(
  fields: ReadonlyArray<{ name?: unknown; fieldType?: unknown }> | undefined,
  where: string,
): void {
  for (const f of fields ?? []) {
    if (!isSafeIdent(f?.name)) {
      throw new RequestError('VALIDATION_ERROR', `Invalid field name "${String(f?.name)}" on ${where} - use letters, digits and underscores, not starting with a digit`, 422)
    }
    if (typeof f?.fieldType !== 'string' || !FIELD_TYPE_RE.test(f.fieldType)) {
      throw new RequestError('VALIDATION_ERROR', `Invalid field type "${String(f?.fieldType)}" on ${where}.${String(f?.name)} - use lowercase letters, digits and underscores`, 422)
    }
    // A component field's refs become IMPORT SPECIFIERS in the generated file:
    // a folder name and a local identifier. The codegen quotes the path and
    // reduces the identifier to word characters, so a hostile ref cannot be
    // code - but it can name a folder that is not there, and a generated
    // import of a module that does not exist is a schema nobody can push.
    const refs = (f as { config?: { components?: unknown } }).config?.components
    if (Array.isArray(refs)) {
      for (const ref of refs) {
        if (typeof ref === 'string' && !DIR_NAME_RE.test(ref)) {
          throw new RequestError('VALIDATION_ERROR', `Invalid component reference "${ref}" on ${where}.${String(f.name)} - use lowercase letters, digits, underscores and hyphens`, 422)
        }
      }
    }
  }
}

/** List type names in the content-objects dir (dirs containing a schema.ts). */
export function listContentTypeNames(appContentDir: string): string[] {
  if (!existsSync(appContentDir)) return []
  return readdirSync(appContentDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(appContentDir, e.name, 'schema.ts')))
    .map((e) => e.name)
    .filter((n) => DIR_NAME_RE.test(n))
}

/** Rewrite the barrel (`index.ts`) to import every current type dir, sorted. */
function writeBarrel(appContentDir: string): void {
  const names = listContentTypeNames(appContentDir).sort()
  writeFileSync(join(appContentDir, 'index.ts'), generateSchemaBarrel(names))
}

export interface WriteResult { written: string[] }

/**
 * Create or update a content type: (re)write `<name>/schema.ts` and refresh the
 * barrel. Only schema.ts is written — co-files are left untouched.
 */
export function writeContentType(appContentDir: string, type: CodegenObjectType): WriteResult {
  assertSafeName(type.name)
  assertSafeFields(type.fields as never, type.name)
  const dir = join(appContentDir, type.name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'schema.ts'), generateObjectTypeSource(type))
  writeBarrel(appContentDir)
  return { written: [`${type.name}/schema.ts`, 'index.ts'] }
}

export interface DeleteResult { removed: string }

/** Delete a content type dir and refresh the barrel. */
export function deleteContentType(appContentDir: string, name: string): DeleteResult {
  assertSafeName(name)
  const dir = join(appContentDir, name)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  writeBarrel(appContentDir)
  return { removed: name }
}

// ─── Reusable components (app/components) ─────────────────────────────────────

/** List reusable-component names in the components dir (dirs with a schema.ts). */
export function listComponentNames(appComponentsDir: string): string[] {
  if (!existsSync(appComponentsDir)) return []
  return readdirSync(appComponentsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(appComponentsDir, e.name, 'schema.ts')))
    .map((e) => e.name)
    .filter((n) => DIR_NAME_RE.test(n))
}

/** Rewrite the components registry barrel to a plain array of every component. */
function writeComponentsBarrel(appComponentsDir: string): void {
  const names = listComponentNames(appComponentsDir).sort()
  writeFileSync(join(appComponentsDir, 'index.ts'), generateComponentsBarrel(names))
}

/** Create or update a reusable component: write `<name>/schema.ts` + refresh the registry. */
export function writeComponent(appComponentsDir: string, comp: CodegenComponent): WriteResult {
  assertSafeName(comp.name)
  assertSafeFields(comp.fields as never, comp.name)
  mkdirSync(join(appComponentsDir, comp.name), { recursive: true })
  writeFileSync(join(appComponentsDir, comp.name, 'schema.ts'), generateComponentSource(comp))
  writeComponentsBarrel(appComponentsDir)
  return { written: [`${comp.name}/schema.ts`, 'index.ts'] }
}

/** Delete a reusable component dir and refresh the registry. */
export function deleteComponent(appComponentsDir: string, name: string): DeleteResult {
  assertSafeName(name)
  const dir = join(appComponentsDir, name)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  writeComponentsBarrel(appComponentsDir)
  return { removed: name }
}

// ── Globals (single app/globals/index.ts array) ───────────────────────────────

/** Pure: insert or replace a global by name, preserving order. */
export function upsertGlobal(globals: CodegenGlobal[], next: CodegenGlobal): CodegenGlobal[] {
  const i = globals.findIndex((g) => g.name === next.name)
  if (i === -1) return [...globals, next]
  return globals.map((g, j) => (j === i ? next : g))
}

/** Pure: remove a global by name. */
export function removeGlobal(globals: CodegenGlobal[], name: string): CodegenGlobal[] {
  return globals.filter((g) => g.name !== name)
}

/** Writes the whole app/globals/index.ts from the full globals array. */
export function writeGlobals(appGlobalsDir: string, globals: CodegenGlobal[]): WriteResult {
  for (const g of globals) { assertSafeName(g.name); assertSafeFields(g.fields as never, g.name) }
  mkdirSync(appGlobalsDir, { recursive: true })
  writeFileSync(join(appGlobalsDir, 'index.ts'), generateGlobalsFileContent(globals))
  return { written: ['globals/index.ts'] }
}
