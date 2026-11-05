/**
 * File Name: known-flags.ts
 * Purpose: Which flags each command accepts, and the guard that refuses the
 *          ones it does not. An unrecognised flag used to be IGNORED, so
 *          `tangen push --help` was read as a bare `tangen push` and applied
 *          the schema. A flag the CLI does not know is now an error that
 *          happens BEFORE the command runs, so nothing is written.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure, so the whole table is testable without a project.
 *          The table is the dispatcher's own reading of argv, collected per
 *          branch, plus the flags its helpers read (`grant-flags.ts` takes
 *          --approve-grants/--approve-optional, `commands/ai.ts` takes
 *          --force/--tools), which is why it cannot be derived from the
 *          dispatcher body alone.
 */

/**
 * Flags every command takes, read in the dispatcher's preamble before any
 * branch. `--json` is here because the header suppression reads it for every
 * command, so passing it anywhere is harmless rather than wrong.
 */
export const GLOBAL_FLAGS = ['--project', '--workspace', '--json'] as const

/**
 * Flags that were REMOVED and already refuse with a sentence explaining the
 * model that replaced them. Listed so this guard does not preempt that
 * message with a worse one: `--env` deserves "a deployment has one database",
 * not "unknown flag".
 */
export const RETIRED_FLAGS = ['--env', '--prod'] as const

/** Asking for help, accepted anywhere, on any command. */
export const HELP_FLAGS = ['--help', '-h'] as const

/**
 * Commands whose first argument is a subcommand, so the key is two words.
 * `mcp` is in both shapes - `mcp` serves stdio, `mcp expose` reports - and
 * the longer key is tried first, which resolves it.
 */
const TWO_WORD = new Set([
  'workspace', 'release', 'add', 'object', 'knowledge', 'extension',
  'migrate', 'skills', 'schema', 'connections', 'db', 'mcp',
])

/**
 * Flags per command, beyond the globals. A command absent from this table
 * takes the globals and nothing else, which is deliberate: `tangen check
 * --force` is a typo worth catching, not a flag worth inventing.
 */
export const COMMAND_FLAGS: Readonly<Record<string, readonly string[]>> = {
  'create': ['--name', '--db', '--ai', '--no-ai'],
  'check': [],
  'diff': [],
  'push': ['--approve', '--plan', '--type', '--candidate', '--confirm', '--all-workspaces'],
  'purge': ['--approve', '--plan', '--list'],
  'doctor': ['--deployment'],
  'pull': ['--layout'],
  'types': ['--out'],
  'dev': ['--typecheck', '--skip-db-check'],
  'start': ['--skip-db-check'],
  'build': ['--out'],
  'reconcile': ['--apply'],
  'bootstrap': ['--name', '--with-demo', '--ai', '--no-ai'],
  'reset-password': ['--password'],
  'enable': [],
  'disable': ['--drop-tables'],
  'ai': ['--force', '--tools'],
  'mcp': ['--key', '--url', '--allow-schema'],

  'db reconcile': ['--apply'],
  'schema regenerate': ['--force'],
  'connections rotate-key': [],
  'workspace create': [],
  'workspace remove': [],
  'release list': ['--status'],
  'release status': ['--status'],
  'add object': ['--label', '--with-hooks'],
  'object disable': ['--yes'],
  'object enable': ['--yes'],
  'object delete': ['--yes'],
  'knowledge index': ['--rebuild', '--yes', '--docs'],
  'knowledge status': ['--rebuild', '--yes', '--docs'],
  'mcp expose': [],
  'migrate layout': ['--dry-run'],
  'skills update': [],
  'extension bundle': ['--minify'],
  'extension install': ['--yes', '--approve-optional', '--approve-grants'],
  'extension uninstall': [],
  'extension remove': [],
  'extension list': [],
  'extension inspect': [],
  'extension enable': ['--plan', '--yes', '--approve-optional', '--approve-grants'],
  'extension disable': ['--plan', '--yes', '--approve-optional', '--approve-grants'],
  'extension upgrade': ['--plan', '--yes', '--approve-optional', '--approve-grants'],
  'extension status': ['--plan', '--yes', '--approve-optional', '--approve-grants'],
  'extension create': ['--name', '--description', '--author', '--website'],
}

/**
 * The table key for an argv, or `undefined` when the command is not one we
 * know. Two words first, so `mcp expose` is not read as `mcp`.
 */
export function commandKey(args: readonly string[]): string | undefined {
  const [first, second] = args
  if (!first) return undefined
  if (second && !second.startsWith('-') && TWO_WORD.has(first)) {
    const pair = `${first} ${second}`
    if (pair in COMMAND_FLAGS) return pair
  }
  return first in COMMAND_FLAGS ? first : undefined
}

/** True when any argument asks for help, wherever it sits. */
export function wantsHelp(args: readonly string[]): boolean {
  return args.some((a) => (HELP_FLAGS as readonly string[]).includes(a))
}

/**
 * The flags in `args` that this command does not accept.
 *
 * Only `--long` forms are checked, because that is the whole surface apart
 * from `-h`: a single-dash token is left alone rather than guessed at, and a
 * `--flag=value` form is compared on the name.
 *
 * An UNKNOWN COMMAND yields no unknown flags. The dispatcher already prints
 * usage and exits 1 for that, and reporting its flags as well would bury the
 * one thing that is actually wrong.
 */
export function unknownFlags(args: readonly string[]): string[] {
  const key = commandKey(args)
  if (key === undefined) return []
  const allowed = new Set<string>([
    ...GLOBAL_FLAGS, ...RETIRED_FLAGS, ...HELP_FLAGS, ...COMMAND_FLAGS[key]!,
  ])
  const seen: string[] = []
  for (const raw of args) {
    if (!raw.startsWith('--') || raw === '--') continue
    const name = raw.split('=', 1)[0]!
    if (!allowed.has(name) && !seen.includes(name)) seen.push(name)
  }
  return seen
}
