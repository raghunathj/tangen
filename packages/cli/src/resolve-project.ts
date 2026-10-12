/**
 * File Name: resolve-project.ts
 * Purpose: Locates the tangen.config.ts for the active project using a multi-strategy search
 * (cwd, app/, parent walk; --project resolves app/workspaces/<name>) and derives a
 * best-guess workspaceId from the directory name.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The workspaceId returned here is a best-guess; push/diff/pull each override
 * it with config.workspaceId after loading the actual config. Supports --project flag for monorepos.
 */
import { existsSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'

export interface ResolvedProject {
  /** Display name for the project */
  projectName: string | null
  /** Absolute path to the directory containing tangen.config.ts */
  configCwd: string
  /** WorkspaceId — overridden by config.workspaceId inside push/diff/pull after the config is loaded */
  workspaceId: string
}

/**
 * Resolves which project the CLI should operate on.
 *
 * Config search order (no --project flag):
 *  1. Current directory has tangen.config.ts → use it
 *  2. app/tangen.config.ts exists → use it
 *  3. Walk up parent directories looking for tangen.config.ts (stops at filesystem root or when
 *     a node_modules/ sibling is found, to avoid escaping the project boundary)
 *
 * With --project <name>:
 *  Looks for <name>/tangen.config.ts or app/workspaces/<name>/workspace.config.ts from cwd.
 *
 * WorkspaceId shown here is a best-guess from the directory name.
 * push/diff/pull each call deriveWorkspaceId(config, ...) which checks config.workspaceId first,
 * so the config always wins.
 */
export function resolveProject(cwd: string, projectName?: string): ResolvedProject {
  if (projectName) {
    return resolveNamed(cwd, projectName)
  }
  return resolveAuto(cwd)
}

function resolveNamed(cwd: string, name: string): ResolvedProject {
  // Each candidate is [dir, configFilename] — workspace dirs use workspace.config.ts
  const candidatesAt = (dir: string): Array<[string, string]> => [
    [join(dir, name), 'tangen.config.ts'],
    [join(dir, 'app', 'workspaces', name), 'workspace.config.ts'],
  ]

  // Try cwd first, then walk up parents (so --project resolves sibling
  // projects when run from inside another workspace). Bounded like
  // resolveAuto: stop at the filesystem root or a foreign package boundary.
  const tried: string[] = []
  let dir = cwd
  while (true) {
    for (const [candidate, configFile] of candidatesAt(dir)) {
      tried.push(join(candidate, configFile))
      if (hasConfig(candidate, configFile)) {
        const workspaceId = process.env.TANGEN_WORKSPACE_ID
          ?? `wsp_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
        return { projectName: name, configCwd: candidate, workspaceId }
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    if (dir !== cwd && existsSync(join(dir, 'node_modules'))) break
    dir = parent
  }

  throw new Error(
    `Project "${name}" not found. Looked in:\n${tried.map(c => `  ${c}`).join('\n')}`,
  )
}

/**
 * A config file is a file WITH content. A zero-byte tangen.config.ts (a
 * `touch`, an interrupted write) shadowed the real one in app/ and every
 * command then guessed the workspace id from the folder name; it is skipped
 * here, and the identity notice says why when nothing else is found.
 */
function hasConfig(dir: string, file = 'tangen.config.ts'): boolean {
  const p = join(dir, file)
  try { return existsSync(p) && statSync(p).size > 0 } catch { return false }
}

function resolveAuto(cwd: string): ResolvedProject {
  // 1. Current directory
  if (hasConfig(cwd)) {
    return makeResult(cwd)
  }

  // 2. app/ subdirectory (single-app layout)
  const appDir = join(cwd, 'app')
  if (hasConfig(appDir)) {
    return makeResult(appDir)
  }

  // 3. Walk up parent directories (bounded — stops at filesystem root or package boundary)
  let dir = dirname(cwd)
  while (dir !== dirname(dir)) {
    if (hasConfig(dir)) return makeResult(dir)
    // Stop walking if we hit a directory containing node_modules but no tangen.config.ts
    // (likely a different project root)
    if (existsSync(join(dir, 'node_modules'))) break
    dir = dirname(dir)
  }

  // Nothing found — don't fabricate a project identity from the directory
  // name; report null so callers can distinguish "unresolved" from "resolved".
  // The concrete error surfaces at config import time in push/diff/pull.
  return {
    projectName: null,
    configCwd: cwd,
    workspaceId: process.env.TANGEN_WORKSPACE_ID ?? 'wsp_local_dev',
  }
}

function makeResult(configCwd: string): ResolvedProject {
  const dirName = basename(configCwd)
  const workspaceId = process.env.TANGEN_WORKSPACE_ID
    ?? `wsp_${dirName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
  return { projectName: dirName === '.' ? null : dirName, configCwd, workspaceId }
}
