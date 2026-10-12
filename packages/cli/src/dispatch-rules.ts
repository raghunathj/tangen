/**
 * File Name: dispatch-rules.ts
 * Purpose: The decisions the CLI dispatcher (index.ts) makes before any
 *          command runs, as pure functions so they are testable: when the
 *          `◆ tangen` header is printed. A `--json` run prints no
 *          header, so stdout is the JSON document and nothing else - an agent
 *          parses it from the first byte.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure. `mcp` never gets a header (the stdio transport
 *          carries only protocol messages); `push` prints its own styled one.
 */


/** True when the dispatcher prints the compact `◆ tangen` header before the command. */
export function dispatcherPrintsHeader(args: string[]): boolean {
  const command = args[0]
  if (command === 'push' || command === 'mcp') return false
  if (args.includes('--json')) return false
  return true
}

/** The `--layout` flag of `tangen pull`: the v2 app layout unless `--layout v1` is given. */
export function pullLayout(args: string[]): 'v1' | 'v2' {
  const idx = args.indexOf('--layout')
  return idx !== -1 && args[idx + 1] === 'v1' ? 'v1' : 'v2'
}
