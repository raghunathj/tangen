/**
 * File Name: disable.ts
 * Purpose: Implements the `tangen disable` command, which removes a feature's import and
 *   config key from `tangen.config.ts` and optionally drops its database tables.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends on `enable.ts` for shared import-line helpers; all I/O
 *   (filesystem, SQL, prompts) is injectable via `DisableCommandOptions` for full unit testability.
 */
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { getFeature } from '../features/registry'
import { buildConfigImportLine, buildConfigKeyLine, isFeatureInjected, resolveInjectionTarget } from './enable'
import type { FeatureDefinition } from '../features/types'

// ─── Pure helpers (fully testable without I/O) ────────────────────────────────

/**
 * Removes the feature's import line from `tangen.config.ts` content.
 * No-op (idempotent) if the line is not present.
 */
export function removeFeatureImport(content: string, feature: FeatureDefinition): string {
  // Match the import regardless of quote style or relative prefix
  // (./config/auth in single-file projects, ../../config/auth in workspace configs)
  const importRe = new RegExp(`^import\\s*\\{\\s*${feature.configImportName}\\s*\\}\\s*from\\s*["'][^"']*["'];?\\s*$`)
  return content
    .split('\n')
    .filter((line) => !importRe.test(line))
    .join('\n')
}

/**
 * Removes the feature's config key line from `tangen.config.ts` content.
 * No-op (idempotent) if the line is not present.
 */
export function removeFeatureConfigKey(content: string, feature: FeatureDefinition): string {
  const keyLine = buildConfigKeyLine(feature)
  if (!content.includes(keyLine)) return content
  return content
    .split('\n')
    .filter((line) => line !== keyLine)
    .join('\n')
}

// ─── I/O options (injected for testability) ───────────────────────────────────

export interface DisableCommandOptions {
  log?: (msg: string) => void
  fileExists?: (path: string) => boolean
  readFile?: (path: string) => string
  writeFile?: (path: string, content: string) => void
  /** Called if a file needs deletion — not used for config/auth.ts (we leave it) */
  deleteFile?: (path: string) => void
  /**
   * Interactive prompt shown when `--drop-tables` is not set.
   * Receives the prompt message and returns the user's answer ('yes' | 'no').
   * Inject a mock in tests; production implementation uses readline.
   */
  prompt?: (message: string) => Promise<string>
  /**
   * Executes raw SQL (the feature's `dropSql`) against the database.
   * Injected for tests; production uses the postgres client directly.
   */
  executeSQL?: (sql: string, databaseUrl: string) => Promise<void>
  /** When true, skips the interactive prompt and drops tables immediately (CI/scripting). */
  dropTables?: boolean
}

// ─── Production prompt (readline-based) ──────────────────────────────────────

/**
 * Minimal interactive prompt using Node's readline.
 * Resolves to 'yes' if the user types 'y' or 'yes' (case-insensitive), 'no' otherwise.
 * The default (pressing Enter with no input) is 'no' — keeps data safe.
 */
async function interactivePrompt(message: string): Promise<string> {
  const { createInterface } = await import('readline')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close()
      const normalised = answer.trim().toLowerCase()
      resolve(normalised === 'y' || normalised === 'yes' ? 'yes' : 'no')
    })
  })
}

/**
 * Executes raw SQL against a Postgres database using the `postgres` client.
 * Used to run the feature's `dropSql` when the developer confirms table removal.
 */
async function executeSQLProduction(sql: string, databaseUrl: string): Promise<void> {
  const postgres = (await import('postgres')).default
  const client = postgres(databaseUrl, { max: 1 })
  try {
    await client.unsafe(sql)
  } finally {
    await client.end()
  }
}

// ─── Command ──────────────────────────────────────────────────────────────────

/**
 * `tangen disable <featureKey>`
 *
 * Reverses `tangen enable` in two steps:
 *  1. Remove the feature import and config key from `tangen.config.ts`.
 *     The feature's config file (e.g. app/config/auth.ts) is intentionally
 *     NOT deleted — the developer may have customized it.
 *  2. Optionally drop the feature's DB tables after an interactive confirmation
 *     (default: keep data). Skipped entirely if `options.dropTables` is true
 *     (the `--drop-tables` CLI flag), which is useful for CI/scripting.
 *
 * All I/O is injectable via `options` for full unit-testability.
 */
export async function runDisableCommand(
  featureKey: string,
  configCwd: string,
  databaseUrl: string,
  options: DisableCommandOptions = {},
): Promise<void> {
  const {
    log = console.log,
    fileExists = existsSync,
    readFile = (p) => readFileSync(p, 'utf8'),
    writeFile = (p, c) => writeFileSync(p, c, 'utf8'),
    deleteFile: _deleteFile,              // reserved for future use, not used here
    prompt = interactivePrompt,
    executeSQL = executeSQLProduction,
    dropTables = false,
  } = options

  // ── 1. Resolve feature ────────────────────────────────────────────────────
  if (featureKey === 'forms') {
    throw new Error("Forms is an extension now: run `tangen extension uninstall forms`.")
  }
  if (featureKey === 'auth') {
    throw new Error("Site users is an extension now: run `tangen extension uninstall auth`.")
  }
  const feature = getFeature(featureKey)
  if (!feature) {
    throw new Error(
      `Unknown feature '${featureKey}'. Available features: ${Object.keys(await import('../features/registry').then((m) => m.FEATURE_REGISTRY)).join(', ')}`,
    )
  }

  log(`\n  Disabling ${feature.label}...\n`)

  // ── 2. Remove from tangen.config.ts ──────────────────────────────────────
  const { path: tangenConfigPath } = resolveInjectionTarget(configCwd, fileExists, readFile)
  const originalContent = fileExists(tangenConfigPath) ? readFile(tangenConfigPath) : ''

  if (!isFeatureInjected(originalContent, feature)) {
    // Already removed — nothing to undo in the config file
    log(`  ${feature.configKey} is not present in tangen.config.ts - Nothing to remove.`)
  } else {
    let updated = removeFeatureImport(originalContent, feature)
    updated = removeFeatureConfigKey(updated, feature)
    writeFile(tangenConfigPath, updated)
    log(`  Updated tangen.config.ts                            ✓`)
    log(`    - ${buildConfigImportLine(feature)}`)
    log(`    - ${buildConfigKeyLine(feature)}`)
  }

  // Note: the feature config file (e.g. app/config/auth.ts) is intentionally
  // preserved — the developer may have added customisations (hooks, profile fields,
  // provider credentials) and we never want to silently destroy that work.
  log(`\n  Note: ${feature.configFile} was not deleted - remove it manually if it is no longer needed.`)

  // ── 3. Optionally drop tables ─────────────────────────────────────────────
  if (feature.tables.length === 0) {
    log(`\n  No data tables to drop for ${feature.label}.`)
    log(`\n  ${feature.label} disabled.\n`)
    return
  }

  let shouldDrop = dropTables

  if (!shouldDrop) {
    // Interactive confirmation — default is always "keep data" (safe)
    log(`\n  Remove ${feature.label} data tables?`)
    log(`  This will permanently delete all data in:`)
    for (const table of feature.tables) {
      log(`    - ${table}`)
    }
    log('')

    const answer = await prompt(
      `  Drop tables? [y/N] (default: N - keep data): `,
    )
    shouldDrop = answer === 'yes'
  }

  if (shouldDrop) {
    log(`\n  Dropping tables...`)
    await executeSQL(feature.dropSql, databaseUrl)
    for (const table of feature.tables) {
      log(`    ✓ Dropped ${table}`)
    }
    log(`\n  All ${feature.label} data removed.`)
  } else {
    log(`\n  Tables kept. Data is safe.`)
  }

  log(`\n  ${feature.label} disabled.\n`)
}
