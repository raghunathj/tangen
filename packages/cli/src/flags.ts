/**
 * File Name: flags.ts
 * Purpose: Reading a flag's value once, deterministically (closure plan
 *          Phase 6C, Unit 5, finding 6C-3). `--type` was read as the next
 *          argv element with no check, so `tangen push --type` fell back to a
 *          default and `tangen push --type --json` took `--json` as the
 *          environment name. In a CI script either one is a silent write to
 *          the wrong target.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure. `flagValue` returns the value, `undefined` when
 *          the flag is absent, or a MissingFlagValue when the flag is there
 *          with nothing usable after it - callers turn that into an exit,
 *          never into a guess.
 */

/** A flag was passed with no value, or with another flag where its value should be. */
export class MissingFlagValue extends Error {
  constructor(public readonly flag: string, public readonly found?: string) {
    super(found
      ? `${flag} needs a value, but the next argument is "${found}"`
      : `${flag} needs a value`)
    this.name = 'MissingFlagValue'
  }
}

/** True when a token is another flag rather than a value. A bare `-` is a value. */
export function looksLikeFlag(token: string): boolean {
  return token.length > 1 && token.startsWith('-')
}

/**
 * The value of `--name value` or `--name=value`. `undefined` when the flag is
 * not there at all; throws MissingFlagValue when it is there without one.
 */
export function flagValue(args: string[], flag: string): string | undefined {
  const inline = args.find((a) => a.startsWith(`${flag}=`))
  if (inline !== undefined) {
    const value = inline.slice(flag.length + 1)
    if (value === '') throw new MissingFlagValue(flag)
    return value
  }
  const i = args.indexOf(flag)
  if (i === -1) return undefined
  const next = args[i + 1]
  if (next === undefined) throw new MissingFlagValue(flag)
  if (looksLikeFlag(next)) throw new MissingFlagValue(flag, next)
  return next
}

/**
 * `flagValue`, but a missing value is reported and the process exits 1 rather
 * than throwing - the shape the dispatcher wants at every call site.
 */
export function flagValueOrExit(args: string[], flag: string, usage?: string): string | undefined {
  try {
    return flagValue(args, flag)
  } catch (err) {
    if (!(err instanceof MissingFlagValue)) throw err
    console.error(`tangen: ${err.message}${usage ? `\n  Usage: ${usage}` : ''}`)
    process.exit(1)
  }
}
