/**
 * File Name: ui.ts
 * Purpose: Provides ANSI color helpers, CLI symbols, and structured log functions used across
 * all tangen CLI commands for consistent terminal output.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Color output is automatically disabled when stdout is not a TTY or NO_COLOR
 * is set. All helpers are exported as named constants (c, sym, log).
 */
// ANSI color helpers — respects NO_COLOR and non-TTY environments
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR

const ansi = (code: string) => (s: string) => COLOR ? `\x1b[${code}m${s}\x1b[0m` : s

export const c = {
  bold:    ansi('1'),
  dim:     ansi('2'),
  green:   ansi('32'),
  red:     ansi('31'),
  yellow:  ansi('33'),
  cyan:    ansi('36'),
  blue:    ansi('34'),
  gray:    ansi('90'),
  magenta: ansi('35'),
}

// ── Symbols ───────────────────────────────────────────────────────────────────

export const sym = {
  tick:    c.green('✓'),
  cross:   c.red('✗'),
  warn:    c.yellow('⚠'),
  add:     c.green('+'),
  remove:  c.red('−'),
  change:  c.yellow('~'),
  arrow:   c.dim('→'),
  bullet:  c.dim('·'),
  dash:    c.dim('-'),
}

// ── Structured log helpers ────────────────────────────────────────────────────

export const log = {
  /** Blank line */
  gap: () => console.log(),

  /** Header printed at the start of every push */
  header(workspaceId: string, role: string) {
    console.log()
    console.log(
      `  ${c.bold(c.cyan('◆'))} ${c.bold('tangen')}  ` +
      `${c.dim('workspace:')} ${c.cyan(workspaceId)}  ` +
      `${c.dim('role:')} ${c.green(role)}`,
    )
    console.log()
  },

  ok: (msg: string) => console.log(`  ${sym.tick}  ${msg}`),
  info: (msg: string) => console.log(`  ${sym.bullet}  ${c.dim(msg)}`),
  warn: (msg: string) => console.warn(`  ${sym.warn}  ${c.yellow(msg)}`),
  error: (msg: string) => console.error(`  ${sym.cross}  ${c.red(msg)}`),

  /** Inline spinner-style step (writes without newline, caller resolves) */
  step(msg: string) { process.stdout.write(`  ${c.dim('○')}  ${c.dim(msg)}`) },
  stepOk(msg: string)   { process.stdout.write(`\r  ${sym.tick}  ${msg}                    \n`) },
  stepFail(msg: string) { process.stdout.write(`\r  ${sym.cross}  ${c.red(msg)}\n`) },

  noChanges() {
    console.log(`  ${sym.dash}  ${c.dim('No schema changes')}`)
    console.log()
  },

  success(role: string) {
    console.log()
    console.log(`  ${sym.tick}  ${c.bold(`Schema applied (${role} deployment)`)}`)
    console.log()
  },
}
