/**
 * File Name: token-suggest.ts
 * Purpose: The rules behind typing `{{` in a field that accepts data from a
 *          run (a flow node's config, a form destination's mapping). Copying a
 *          token from a list at the bottom of a panel and pasting it into a
 *          field above was the whole mechanism (the user, 2026-09-19), so an
 *          operator had to know the token grammar to use it at all.
 *
 *          Pure and separate from the control, because the fiddly parts are
 *          caret arithmetic and matching, and those are worth stating as
 *          facts: what is being typed at the caret, what it matches, and what
 *          the text looks like afterwards - including not writing a second
 *          `}}` over the one the editor already has.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** One offer in the list: the token to insert, and how to read it. */
export interface TokenOption {
  /** The full token, braces included: `{{trigger.submission.values.email}}`. */
  token: string
  /** What it is, in the operator's words: `Email`. */
  label: string
  /** Where it comes from: `Trigger`, `Steps`, `Form fields`. */
  group: string
  /** One line more, where the label is not enough. */
  hint?: string
}

/** The partial token under the caret: where it starts, where it ends, and what has been typed. */
export interface ActiveToken {
  /** Index of the opening `{`. */
  start: number
  /** Index just past what will be replaced (the caret, plus a `}}` already there). */
  end: number
  /** What has been typed after `{{`, trimmed: `trigger.sub`. */
  query: string
}

/**
 * What is being typed at the caret, or `null` when nothing is.
 *
 * An opening `{{` counts only while it is still open: a `}}` or a line break
 * between it and the caret closes it, and typing in the middle of a finished
 * token is editing text, not composing a new one.
 */
export function activeToken(text: string, caret: number): ActiveToken | null {
  const before = text.slice(0, caret)
  const open = before.lastIndexOf('{{')
  if (open === -1) return null
  const between = before.slice(open + 2)
  if (between.includes('}}') || between.includes('\n')) return null
  // A token is a path, so anything that cannot appear in one means the operator
  // has moved on to ordinary prose.
  if (/[{}"]/.test(between)) return null
  // Swallow a closing `}}` the editor already put there, so accepting an
  // offer never leaves `{{trigger.x}}}}`.
  const after = text.slice(caret)
  const closing = after.startsWith('}}') ? 2 : 0
  return { start: open, end: caret + closing, query: between.trim() }
}

/** The body of a token, without its braces: `{{trigger.x}}` -> `trigger.x`. */
function body(token: string): string {
  return token.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '')
}

/**
 * The offers for what has been typed, best first.
 *
 * A prefix of the path ranks above a word found in the middle of it, which
 * ranks above a match on the label alone - so typing `trigger` offers the
 * trigger's own fields before a step that happens to mention it.
 */
export function filterTokens(tokens: readonly TokenOption[], query: string, limit = 8): TokenOption[] {
  const q = query.trim().toLowerCase()
  if (q === '') return tokens.slice(0, limit)
  const scored: Array<{ option: TokenOption; rank: number }> = []
  for (const option of tokens) {
    const path = body(option.token).toLowerCase()
    const label = option.label.toLowerCase()
    const rank = path.startsWith(q) ? 0 : path.includes(q) ? 1 : label.includes(q) ? 2 : -1
    if (rank >= 0) scored.push({ option, rank })
  }
  return scored
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.option)
}

/** The text and caret after accepting an offer. */
export function applyToken(text: string, token: string, active: ActiveToken): { text: string; caret: number } {
  const next = `${text.slice(0, active.start)}${token}${text.slice(active.end)}`
  return { text: next, caret: active.start + token.length }
}

/**
 * The text and caret after inserting a token with no partial one being typed -
 * the picker button, which drops it wherever the caret was.
 */
export function insertToken(text: string, caret: number, token: string): { text: string; caret: number } {
  const active = activeToken(text, caret)
  if (active) return applyToken(text, token, active)
  const at = Math.max(0, Math.min(caret, text.length))
  return { text: `${text.slice(0, at)}${token}${text.slice(at)}`, caret: at + token.length }
}

/** The groups in the order they should be shown, each with its own offers. */
export function groupTokens(tokens: readonly TokenOption[]): Array<{ group: string; items: TokenOption[] }> {
  const out: Array<{ group: string; items: TokenOption[] }> = []
  for (const t of tokens) {
    const found = out.find((g) => g.group === t.group)
    if (found) found.items.push(t)
    else out.push({ group: t.group, items: [t] })
  }
  return out
}

/**
 * Tokens for the fields of one form, for a destination added to it
 * (plan-connectors D2). The paths are the ones Forms hydrates onto the trigger,
 * so what the picker offers is what a run actually resolves.
 */
export function formFieldTokens(fields: ReadonlyArray<{ name: string; label?: string }>): TokenOption[] {
  return fields
    .filter((f) => typeof f.name === 'string' && f.name !== '')
    .map((f) => ({
      token: `{{trigger.submission.values.${f.name}}}`,
      label: f.label?.trim() || f.name,
      group: 'Form fields',
      hint: f.label?.trim() ? f.name : undefined,
    }))
}
