/**
 * File Name: enable.ts
 * Purpose: Implements the `tangen enable` command, which scaffolds a feature config file,
 *   injects the feature into `tangen.config.ts`, and runs pending DB migrations.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Exports helper functions (`buildConfigImportLine`, `buildConfigKeyLine`,
 *   `isFeatureInjected`) reused by `disable.ts`; all I/O injectable via `EnableCommandOptions`.
 */
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { getFeature } from '../features/registry'
import type { FeatureDefinition } from '../features/types'

// ─── Marker constants ─────────────────────────────────────────────────────────
// These comments in the developer's tangen.config.ts tell the CLI exactly
// where to insert feature imports and config keys. Without them the CLI falls
// back to heuristics, but markers make injection deterministic and re-runs safe.

const IMPORT_MARKER = '// tangen:imports'
const FEATURES_MARKER = '// tangen:features'

/**
 * Resolves which tangen.config.ts `enable`/`disable` should inject into.
 * Since the config consolidation, app/tangen.config.ts is a thin adapter and
 * the injection markers live in the master workspace's config
 * (app/workspaces/<slug>/tangen.config.ts). Scan for the marker-bearing file;
 * single-file projects (markers in the adapter) keep working via the fallback.
 * @returns Absolute target path plus the import prefix from that file to config/.
 */
export function resolveInjectionTarget(
  configCwd: string,
  fileExists: (p: string) => boolean = existsSync,
  readFile: (p: string) => string = (p) => readFileSync(p, 'utf8'),
  listDir: (p: string) => string[] = (p) => readdirSync(p),
): { path: string; importPrefix: string } {
  const workspacesDir = join(configCwd, 'workspaces')
  let markerless: string | null = null
  if (fileExists(workspacesDir)) {
    let slugs: string[] = []
    try { slugs = listDir(workspacesDir) } catch { /* unreadable - fall through */ }
    for (const slug of slugs) {
      const candidate = join(workspacesDir, slug, 'workspace.config.ts')
      if (!fileExists(candidate)) continue
      const content = readFile(candidate)
      if (content.includes(IMPORT_MARKER) && content.includes(FEATURES_MARKER)) {
        return { path: candidate, importPrefix: '../../' }   // deterministic (markers)
      }
      // Remember the first real workspace config as a fallback — older scaffolds
      // (pre-marker `tangen create`) have no markers but the injectors still work.
      if (!markerless && /define(?:Workspace|Config)\s*\(/.test(content)) markerless = candidate
    }
  }
  // Prefer a markerless workspace config over a root tangen.config.ts that
  // `tangen create` projects never had (targeting it wrote enable into the void).
  if (markerless) return { path: markerless, importPrefix: '../../' }
  return { path: join(configCwd, 'tangen.config.ts'), importPrefix: './' }
}

// ─── Pure helpers (fully testable without I/O) ────────────────────────────────

/**
 * Returns the TypeScript import line for a feature's config variable.
 * e.g. `import { authConfig } from './config/auth'`
 * @param importPrefix - Relative prefix from the target config file to the
 *   project's config/ dir: './' for app/tangen.config.ts, '../../' for
 *   app/workspaces/<slug>/tangen.config.ts.
 */
export function buildConfigImportLine(feature: FeatureDefinition, importPrefix = './'): string {
  // Strip the .ts extension so the import path is valid at runtime
  const importPath = `${importPrefix}${feature.configFile.replace(/\.ts$/, '')}`
  return `import { ${feature.configImportName} } from '${importPath}'`
}

/**
 * Returns the key/value line to inject into the defineConfig({}) call.
 * e.g. `  auth: authConfig,`
 */
export function buildConfigKeyLine(feature: FeatureDefinition): string {
  return `  ${feature.configKey}: ${feature.configImportName},`
}

/**
 * Returns true when the feature's config variable is already imported —
 * used to make enable idempotent. Quote-style and path-prefix agnostic so a
 * hand-written `import { authConfig } from "../../config/auth"` counts.
 */
export function isFeatureInjected(content: string, feature: FeatureDefinition): boolean {
  return new RegExp(`import\\s*\\{\\s*${feature.configImportName}\\s*\\}`).test(content)
}

/**
 * Injects the feature import line into the tangen.config.ts content string.
 *
 * Strategy (in priority order):
 *  1. Already present → no-op (idempotent).
 *  2. `// tangen:imports` marker found → insert the line immediately before it.
 *  3. Fallback: insert after the last `import` statement in the file.
 *  4. Last resort: prepend to the file.
 *
 * Returns the updated content string (does not write to disk).
 */
export function injectFeatureImport(content: string, feature: FeatureDefinition, importPrefix = './'): string {
  const importLine = buildConfigImportLine(feature, importPrefix)

  // Already present — nothing to do
  if (isFeatureInjected(content, feature)) return content

  // Marker-based injection (preferred — deterministic)
  if (content.includes(IMPORT_MARKER)) {
    return content.replace(IMPORT_MARKER, `${importLine}\n${IMPORT_MARKER}`)
  }

  // Fallback: insert after the last top-level `import` statement
  const lines = content.split('\n')
  let lastImportIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('import ')) lastImportIdx = i
  }
  if (lastImportIdx >= 0) {
    lines.splice(lastImportIdx + 1, 0, importLine)
    return lines.join('\n')
  }

  // Last resort: prepend
  return `${importLine}\n${content}`
}

/**
 * Injects the feature config key into the tangen.config.ts content string.
 *
 * Strategy (in priority order):
 *  1. Already present → no-op (idempotent).
 *  2. `// tangen:features` marker found → insert the line immediately before it.
 *  3. Fallback: insert on the first line after `defineConfig({`.
 *
 * Returns the updated content string (does not write to disk).
 */
export function injectFeatureConfigKey(content: string, feature: FeatureDefinition): string {
  const keyLine = buildConfigKeyLine(feature)

  // Already present — nothing to do
  if (content.includes(keyLine)) return content

  // Marker-based injection (preferred)
  if (content.includes(FEATURES_MARKER)) {
    return content.replace(FEATURES_MARKER, `${keyLine}\n  ${FEATURES_MARKER}`)
  }

  // Fallback: insert after the opening brace of defineConfig({…}) OR
  // defineWorkspace({…}) — the latter is what `tangen create` scaffolds.
  const match = content.match(/define(?:Config|Workspace)\s*\(\s*\{/)
  if (match?.index !== undefined) {
    const insertAt = match.index + match[0].length
    return content.slice(0, insertAt) + '\n' + keyLine + content.slice(insertAt)
  }

  return content
}

// ─── I/O options (injected for testability) ───────────────────────────────────

export interface EnableCommandOptions {
  log?: (msg: string) => void
  fileExists?: (path: string) => boolean
  readFile?: (path: string) => string
  writeFile?: (path: string, content: string) => void
  /** Runs Drizzle migrations against the target DB. Injected so tests can mock it. */
  runMigrations?: (databaseUrl: string) => Promise<void>
}

// ─── Command ──────────────────────────────────────────────────────────────────

/**
 * `tangen enable <featureKey>`
 *
 * Enables a Tangen feature in three steps:
 *  1. Scaffold `app/config/{feature}.ts` (skipped if it already exists).
 *  2. Inject the feature import + config key into `tangen.config.ts`.
 *  3. Run pending DB migrations for this feature.
 *
 * All I/O is injectable via `options` so the command is fully unit-testable
 * without touching the filesystem or a real database.
 */
export async function runEnableCommand(
  featureKey: string,
  configCwd: string,
  databaseUrl: string,
  options: EnableCommandOptions = {},
): Promise<void> {
  const {
    log = console.log,
    fileExists = existsSync,
    readFile = (p) => readFileSync(p, 'utf8'),
    writeFile = (p, c) => {
      mkdirSync(join(p, '..'), { recursive: true })
      writeFileSync(p, c, 'utf8')
    },
    runMigrations: migrate = async (url) => {
      const { runMigrations } = await import('@tangen/db/migrate')
      await runMigrations(url)
    },
  } = options

  // ── 1. Resolve feature ────────────────────────────────────────────────────
  if (featureKey === 'forms') {
    throw new Error("Forms is an extension now: run `tangen extension install forms` (it arrives with @tangen/cms).")
  }
  if (featureKey === 'auth') {
    throw new Error("Site users is an extension now: run `tangen extension install auth` (it arrives with @tangen/cms).")
  }
  const feature = getFeature(featureKey)
  if (!feature) {
    throw new Error(
      `Unknown feature '${featureKey}'. Available features: ${Object.keys(await import('../features/registry').then((m) => m.FEATURE_REGISTRY)).join(', ')}`,
    )
  }

  // ── 2. Early exit when already fully enabled ─────────────────────────────
  const configFilePath = join(configCwd, feature.configFile)
  const { path: tangenConfigPath, importPrefix } = resolveInjectionTarget(configCwd, fileExists, readFile)
  const originalContent = fileExists(tangenConfigPath) ? readFile(tangenConfigPath) : ''

  if (fileExists(configFilePath) && isFeatureInjected(originalContent, feature)) {
    log(`\n  ${feature.label} is already enabled - nothing to do.`)
    log(`  Customize at ${feature.configFile}\n`)
    return
  }

  log(`\n  Enabling ${feature.label}...\n`)

  // ── 3. Scaffold config file ───────────────────────────────────────────────
  if (fileExists(configFilePath)) {
    log(`  ${feature.configFile} already exists - skipping config scaffold.`)
    log(`  (Your customizations are preserved.)\n`)
  } else {
    writeFile(configFilePath, feature.configTemplate)
    log(`  Created ${feature.configFile}                      ✓`)
  }

  // ── 4. Inject into tangen.config.ts ──────────────────────────────────────
  if (isFeatureInjected(originalContent, feature)) {
    log(`  tangen.config.ts already references ${feature.configKey} - skipping injection.`)
  } else {
    let updated = injectFeatureImport(originalContent, feature, importPrefix)
    updated = injectFeatureConfigKey(updated, feature)
    writeFile(tangenConfigPath, updated)
    log(`  Updated ${tangenConfigPath}                            ✓`)
    log(`    + ${buildConfigImportLine(feature, importPrefix)}`)
    log(`    + ${buildConfigKeyLine(feature)}`)
  }

  // ── 5. Run migrations ─────────────────────────────────────────────────────
  // A database provisioned by an old drizzle-kit push (before the bootstrap
  // used the migrator) has every system table but no migration journal;
  // replaying migrations there collides with existing relations. That is
  // fine: the tables exist. New databases always come from the migrator.
  if (feature.migrations.length > 0) {
    log(`\n  Running migrations...`)
    try {
      await migrate(databaseUrl)
      for (const tag of feature.migrations) {
        log(`    ✓ ${tag}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/already exists/i.test(msg)) {
        log(`    ✓ tables already present (a database provisioned without the migration journal) - skipping migrations`)
      } else {
        throw err
      }
    }
  } else {
    log(`\n  No dedicated migrations for ${feature.label}.`)
  }

  log(`\n  ${feature.label} enabled. Customize at ${feature.configFile}`)
  if (feature.postEnableHint) log(`  ${feature.postEnableHint}`)
  log('')
}
