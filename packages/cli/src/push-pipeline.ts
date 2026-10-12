/**
 * File Name: push-pipeline.ts
 * Purpose: The order `tangen push` does its work once the plan is known:
 *          generate (in memory), apply (database), write (files). Everything
 *          push will write is generated BEFORE the database is touched, so a
 *          schema the generator cannot express stops the push while the
 *          database is still exactly as it was. Before this, codegen ran last:
 *          a push could apply its plan, migrate side tables and custom tables,
 *          and then fail to write content-tables.ts - leaving the database one
 *          step ahead of the generated file the API reads.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure orchestration over injected steps, so the ordering
 *          contract is testable without a database. generatePushArtifacts /
 *          writePushArtifacts are the real steps push.ts plugs in.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import type { SchemaDefinition, CustomTableDefinition } from '@tangen/types'
import { generateContentTablesCode, generateCustomTablesCode } from './codegen'
import { generateContentTypesCode, type GlobalForCodegen, type TableForCodegen } from './commands/types'

/** Everything a push writes to disk, generated up front. */
export interface PushArtifacts {
  contentTables: string
  /** Absent on a scoped apply (`--type`), which never gathers custom tables. */
  customTables?: string
  /** The tangen-types.d.ts source (the typed registry), written beside the others after the apply. */
  typesDeclaration?: string
}

/** What the typed registry (tangen-types.d.ts) is generated from, beyond the schema. */
export interface TypesDeclarationInput {
  schema: SchemaDefinition
  globals?: GlobalForCodegen[]
  tables?: TableForCodegen[]
  locales?: string[]
  roles?: string[]
  extensions?: string[]
}

export interface PushPipelineDeps {
  /** In-memory codegen of every file push will write. Throws when the schema cannot be generated. */
  generate: () => PushArtifacts
  /** The database work: the plan, then the post-apply reconciles. Runs only after generate succeeded. */
  apply: () => Promise<void>
  /** Writes the generated files. Runs only after apply resolved. */
  write: (artifacts: PushArtifacts) => void
}

export type PushPipelineResult =
  | { ok: true; artifacts: PushArtifacts }
  | { ok: false; stage: 'generate'; error: Error }

/**
 * generate -> apply -> write, never partial: a generation failure returns
 * before apply (the database untouched); the files land only after apply.
 */
export async function generateApplyWrite(deps: PushPipelineDeps): Promise<PushPipelineResult> {
  let artifacts: PushArtifacts
  try {
    artifacts = deps.generate()
  } catch (e) {
    return { ok: false, stage: 'generate', error: e instanceof Error ? e : new Error(String(e)) }
  }
  await deps.apply()
  deps.write(artifacts)
  return { ok: true, artifacts }
}

/**
 * The generate step push uses: content-tables from the artifact schema (local,
 * or runtime + overlay on a scoped apply) and, when gathered, custom-tables.
 * Throws with the generator's message when a table literal would carry a
 * duplicate column.
 */
export function generatePushArtifacts(
  artifactSchema: SchemaDefinition,
  registry: Array<Record<string, unknown>>,
  customTables: CustomTableDefinition[] | undefined,
  types?: TypesDeclarationInput,
  /** Which workspace and environment this generation belongs to (Phase 6B, Unit 3). */
  where?: { workspaceId: string },
): PushArtifacts {
  return {
    contentTables: generateContentTablesCode(artifactSchema, registry, where),
    ...(customTables !== undefined ? { customTables: generateCustomTablesCode(customTables) } : {}),
    ...(types
      ? { typesDeclaration: generateContentTypesCode(types.schema, types.globals ?? [], types.tables ?? [], types.locales ?? [], types.roles ?? [], types.extensions ?? []) }
      : {}),
  }
}

/**
 * The write step: the generated files into the resolved generated dir, and
 * the types declaration to `typesPath` when both are given. Returns the paths
 * written. The generated content-tables.ts is codegen and type support: the
 * running process builds its table objects from the registry rows of the
 * environments it serves (@tangen/api content-tables-runtime), so which
 * environment pushed last cannot decide what a process reads.
 */
export function writePushArtifacts(artifacts: PushArtifacts, outDir: string, typesPath?: string): string[] {
  mkdirSync(outDir, { recursive: true })
  const written: string[] = []
  const contentPath = resolve(outDir, 'content-tables.ts')
  writeFileSync(contentPath, artifacts.contentTables, 'utf8')
  written.push(contentPath)
  if (artifacts.customTables !== undefined) {
    const customPath = resolve(outDir, 'custom-tables.ts')
    writeFileSync(customPath, artifacts.customTables, 'utf8')
    written.push(customPath)
  }
  if (artifacts.typesDeclaration !== undefined && typesPath) {
    mkdirSync(dirname(typesPath), { recursive: true })
    writeFileSync(typesPath, artifacts.typesDeclaration, 'utf8')
    written.push(typesPath)
  }
  return written
}
