/**
 * File Name: schema-writable.ts
 * Purpose: SB-1 — decides whether the admin Content Object / Globals Builder may
 *   WRITE schema files. It may only do so on a dev runtime (not production) with
 *   a present, writable app source dir (`app/content-objects`). On a build/prod
 *   runtime, or when the source isn't there, the builder is read-only. This is a
 *   hard server-side gate — the write API (SB-2) checks it too, not just the UI.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { accessSync, constants } from 'node:fs'
import { deploymentRole, deploymentPolicy, type DeploymentRole } from './deployment-role'
import { join } from 'node:path'

export interface SchemaWritableInput {
  /** The deployment role of this process: only a development deployment writes schema files. */
  role: DeploymentRole
  /** Resolved absolute path to the app content-objects dir, or null if none found. */
  appContentDir: string | null
  /** Whether that dir exists and is writable. */
  canWrite: (dir: string) => boolean
}

/** Pure decision: dev (not production) AND a writable app-content dir. */
export function resolveSchemaWritable(input: SchemaWritableInput): boolean {
  if (!deploymentPolicy(input.role).schemaWritable) return false
  if (!input.appContentDir) return false
  return input.canWrite(input.appContentDir)
}

/** True if the directory exists and the process can write to it. */
export function dirIsWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Locate the `app/content-objects` dir across the layouts the API can run in:
 * a deployed site (cwd = site root) or the monorepo dev server (cwd =
 * packages/api). Returns the first candidate that is writable, else null.
 */
export function findAppContentDir(cwd: string = process.cwd()): string | null {
  const candidates = [
    join(cwd, 'app', 'content-objects'),          // site / npm layout
    join(cwd, '..', '..', 'app', 'content-objects'), // monorepo: packages/api → repo root
  ]
  for (const dir of candidates) {
    if (dirIsWritable(dir)) return dir
  }
  return null
}

/** The live capability: is the schema builder allowed to write in this runtime? */
export function getSchemaWritable(): boolean {
  return resolveSchemaWritable({
    role: deploymentRole(),
    appContentDir: findAppContentDir(),
    canWrite: dirIsWritable,
  })
}

/**
 * The `app/components` dir (sibling of `app/content-objects`). May not exist yet
 * — the first reusable component creates it — so this returns the intended path
 * whenever the app root is resolvable, not only when the dir already exists.
 */
export function findAppComponentsDir(cwd: string = process.cwd()): string | null {
  const content = findAppContentDir(cwd)
  if (!content) return null
  return join(content, '..', 'components') // <app>/content-objects → <app>/components
}

/**
 * The `app/globals` dir (sibling of `app/content-objects`) — holds the single
 * `index.ts` defineGlobals array. Returns the intended path when the app root is
 * resolvable (the dir may need creating on first write).
 */
export function findAppGlobalsDir(cwd: string = process.cwd()): string | null {
  const content = findAppContentDir(cwd)
  if (!content) return null
  return join(content, '..', 'globals') // <app>/content-objects → <app>/globals
}
