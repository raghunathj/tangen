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
  for (const g of globals) assertSafeName(g.name)
  mkdirSync(appGlobalsDir, { recursive: true })
  writeFileSync(join(appGlobalsDir, 'index.ts'), generateGlobalsFileContent(globals))
  return { written: ['globals/index.ts'] }
}
