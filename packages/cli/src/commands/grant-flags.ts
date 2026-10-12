/**
 * File Name: grant-flags.ts
 * Purpose: The grant-decision flags of `extension install|upgrade`, parsed
 *          once for both commands. `--approve-optional` and `--approve-grants`
 *          ACCUMULATE: a repeated flag, the `--flag=value` form and a comma
 *          list all add to one set, so `--approve-optional a --approve-optional b`
 *          means both (it used to keep the first and silently deny the
 *          second). `none` and `all` are whole decisions and win over a list.
 *
 * Author: Raghunath J
 * License: MIT
 */

export interface GrantDecisionFlags {
  approveOptional: readonly string[] | 'all' | 'none' | undefined
  approveGrants: readonly string[] | undefined
}

/** Every value given for `--<name>` (repeated, `=`, comma-separated), in order, de-duplicated; null when the flag never appears. */
function valuesOf(args: readonly string[], name: string): string[] | null {
  const flag = `--${name}`
  let seen = false
  const out: string[] = []
  const add = (raw: string | undefined) => {
    for (const v of String(raw ?? '').split(',')) { const g = v.trim(); if (g && !out.includes(g)) out.push(g) }
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === flag) {
      seen = true
      // A bare flag followed by another flag has no value: an empty set, not the next flag's name.
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('--')) { add(next); i++ }
    } else if (a.startsWith(`${flag}=`)) {
      seen = true
      add(a.slice(flag.length + 1))
    }
  }
  return seen ? out : null
}

export function parseGrantDecisionFlags(args: readonly string[]): GrantDecisionFlags {
  const optional = valuesOf(args, 'approve-optional')
  const grants = valuesOf(args, 'approve-grants')
  const approveOptional = optional === null ? undefined
    : optional.includes('none') ? 'none' as const
    : optional.includes('all') ? 'all' as const
    : optional
  return { approveOptional, approveGrants: grants === null ? undefined : grants }
}
