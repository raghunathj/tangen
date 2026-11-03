/**
 * File Name: numeric-input.tsx
 * Purpose: A number field that never shows a value it is not storing.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `<input type="number">` reports an EMPTY value for any
 *          text it cannot parse, while leaving the characters the person typed
 *          on screen. Every number field in the editor read that value
 *          directly, so typing `100+` into one left the box reading `100+`,
 *          stored `null`, and came back blank on reload with "is required"
 *          blocking the publish. The field looked filled and was not, and
 *          nothing said so until a different screen.
 *
 *          A text input with `inputMode="decimal"` is the fix, because it
 *          makes the invariant unconditional: what is on screen is what the
 *          draft holds. The native spinners go, which is a small loss next to
 *          a field that silently discards input; the numeric keypad on a phone
 *          comes from `inputMode`, and `min`/`max`/`step` were always enforced
 *          server-side by field-validator rather than by the widget.
 *
 *          What it CANNOT do is keep `100+` for you: a number column holds no
 *          such thing. So the honest ceiling is to say so immediately, on the
 *          field, rather than at publish time on another screen.
 *
 *          It carries a kit-lint budget of 2 rather than using the kit's
 *          `Input`, and that is debt, not a design. The kit's Input wraps its
 *          control in a div and styles the inner element itself, while all
 *          three call sites pass their own `subInput`/`fieldInput` classes
 *          straight to the input; routing those through the kit changes how
 *          every number field in the product looks, which is a visual change
 *          and does not belong inside a bug fix. The migration is worth doing
 *          on its own, with someone looking at the result.
 */
import { useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { clsx } from 'clsx'

/**
 * Everything an `<input>` takes, minus the four this component owns.
 *
 * `value` and `onChange` are re-typed because the point of the component is
 * that it hands back a NUMBER or null rather than the browser's string, and
 * `type` is owned because the whole fix is that it is never `number`.
 * `min`/`max` stay numbers and are NOT forwarded: on a text input the native
 * attributes do nothing, so they inform the hint below and the server-side
 * field-validator remains the enforcement, as it always was.
 *
 * Widened from a fixed four props when the raw `<input type="number">` call
 * sites were swept: a filter needs `placeholder`, `autoFocus` and `onKeyDown`
 * for its Enter-to-apply, and the bulk editor needs `disabled`. Listing them
 * one at a time would have meant editing this interface for each new caller.
 */
export interface NumericInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'> {
  value: unknown
  onChange: (value: number | null) => void
  min?: number
  max?: number
  /** Whole numbers only; rejects a typed decimal point rather than rounding it. */
  integer?: boolean
}

/** What the box should read for a stored value. */
function displayOf(value: unknown): string {
  return value == null || value === '' ? '' : String(value)
}

/**
 * Why this text is not a number, or null when it is one (or is empty, which
 * is not an error: a field mid-edit must not shout, and `required` is the rule
 * that decides whether empty is allowed).
 */
export function numericIssue(raw: string, integer?: boolean): string | null {
  const t = raw.trim()
  if (t === '') return null
  if (!/^-?\d*\.?\d+$/.test(t)) return 'Digits only. Put any sign or unit in a text field.'
  if (integer && t.includes('.')) return 'A whole number.'
  return null
}

export function NumericInput({ value, onChange, min, max, integer, className, ...rest }: NumericInputProps) {
  // The typed text, kept locally so it stays on screen. `key` on the stored
  // value resyncs it when the value changes from outside (a reload, an undo,
  // a version restore) without fighting the person while they type.
  const [draft, setDraft] = useState(() => displayOf(value))
  const [seen, setSeen] = useState(() => displayOf(value))
  if (displayOf(value) !== seen && displayOf(value) !== draft) {
    setSeen(displayOf(value))
    setDraft(displayOf(value))
  }

  const issue = numericIssue(draft, integer)

  return (
    <>
      <input
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        value={draft}
        onChange={(e) => {
          const raw = e.currentTarget.value
          setDraft(raw)
          const t = raw.trim()
          // A number only when it IS one. Anything else stores nothing, and
          // the message below says why rather than leaving it to a publish.
          onChange(t !== '' && numericIssue(t, integer) === null ? Number(t) : null)
        }}
        aria-invalid={issue ? true : undefined}
        className={clsx(className, issue && 'border-danger')}
        {...rest}
      />
      {issue && <p className="mt-1 text-ui-xs text-danger-fg">{issue}</p>}
      {!issue && min != null && max != null && <span className="sr-only">{`Between ${min} and ${max}`}</span>}
    </>
  )
}
