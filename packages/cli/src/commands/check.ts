/**
 * File Name: check.ts
 * Purpose: Implements the `tangen check` command, which locates and runs the TypeScript
 *   compiler against schema files to catch type errors before a push.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires Bun runtime for `Bun.spawn`; uses `tsc` via
 *   `tsconfig.schema.json` found by walking up the directory tree.
 */
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { log } from '../ui'

/** A single tsc diagnostic in machine-readable form (for `--json`). */
export interface CheckDiagnostic {
  file: string
  line?: number
  column?: number
  code: string
  message: string
}

/** The `tangen check --json` result an agent parses to decide its next step. */
export interface CheckResult {
  ok: boolean
  /** True when no tsconfig.schema.json was found (nothing to check). */
  skipped?: boolean
  diagnostics: CheckDiagnostic[]
}

/**
 * Parse `tsc` stdout/stderr into structured diagnostics. Matches the standard
 * `path(line,col): error TSxxxx: message` shape and ignores summary/blank lines.
 */
export function parseTscDiagnostics(output: string): CheckDiagnostic[] {
  const re = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/
  const out: CheckDiagnostic[] = []
  for (const raw of output.split('\n')) {
    const m = re.exec(raw.trim())
    if (m) out.push({ file: m[1], line: Number(m[2]), column: Number(m[3]), code: m[4], message: m[5] })
  }
  return out
}

/** Assemble the `--json` result from tsc's exit code + output. */
export function buildCheckResult(exitCode: number, output: string, skipped = false): CheckResult {
  if (skipped) return { ok: true, skipped: true, diagnostics: [] }
  const diagnostics = parseTscDiagnostics(output)
  return { ok: exitCode === 0 && diagnostics.length === 0, diagnostics }
}

/**
 * Walks up from `startDir` looking for a `tsconfig.schema.json` file.
 * @param startDir - Directory to begin the search from
 * @returns Absolute path to the found config file, or `null` if none exists
 */
function findTsConfigSchema(startDir: string): string | null {
  let dir = startDir
  while (true) {
    const candidate = join(dir, 'tsconfig.schema.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * True when every diagnostic in a tsc output names a file under `generated/`
 * - the content-tables file push itself writes. Such errors mean the file on
 * disk was produced by an older codegen (or edited); the push that follows
 * rewrites it, so they must not block that push. Any diagnostic elsewhere,
 * or an output with no file-bearing diagnostics at all, is a real failure.
 */
export function onlyGeneratedDiagnostics(output: string): boolean {
  const located = output.split('\n').map((l) => /^(.+?)\(\d+,\d+\): error TS/.exec(l.trim())).filter((m): m is RegExpExecArray => !!m)
  if (located.length === 0) return false
  return located.every((m) => /(^|[\\/])generated[\\/]/.test(m[1]))
}

/** The outcome of one schema type-check, for callers that decide what to do with it. */
export interface SchemaCheckOutcome extends CheckResult {
  /** tsc's combined stdout + stderr (empty when skipped or clean). */
  output: string
}

/**
 * Runs `tsc --noEmit` against the project's `tsconfig.schema.json` and RETURNS
 * the outcome - the preflight runs this and reports; it never exits.
 * @param configCwd - Working directory used to locate `tsconfig.schema.json`
 */
export async function runSchemaCheck(configCwd: string): Promise<SchemaCheckOutcome> {
  const tsConfigPath = findTsConfigSchema(configCwd)
  if (!tsConfigPath) return { ...buildCheckResult(0, '', true), output: '' }

  const proc = Bun.spawn(['tsc', '--noEmit', '-p', tsConfigPath], {
    cwd: dirname(tsConfigPath),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await proc.exited
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  const output = out + err
  return { ...buildCheckResult(proc.exitCode ?? 0, output), output }
}

/**
 * Runs `tsc --noEmit` against the project's `tsconfig.schema.json` to type-check
 * schema files; exits with code 1 and prints diagnostics on failure.
 * @param configCwd - Working directory used to locate `tsconfig.schema.json`
 */
export async function runCheckCommand(
  configCwd: string,
  opts: { json?: boolean } = {},
): Promise<void> {
  if (!opts.json) {
    const tsConfigPath = findTsConfigSchema(configCwd)
    if (!tsConfigPath) {
      log.warn('tsconfig.schema.json not found - skipping type-check')
      return
    }
    log.step('Type-checking schema files...')
  }

  const result = await runSchemaCheck(configCwd)

  // Machine-readable path - emit one JSON object and exit non-zero on failure.
  if (opts.json) {
    const { output: _output, ...json } = result
    console.log(JSON.stringify(json))
    if (!json.ok) process.exit(1)
    return
  }

  if (!result.ok) {
    log.stepFail('Schema type errors found')
    console.error()
    result.output.trim().split('\n').forEach(l => console.error(`    ${l}`))
    console.error()
    process.exit(1)
  }

  log.stepOk('Schema types OK')
}
