/**
 * File Name: credit-card-input.tsx
 * Purpose: The admin input for the `credit_card` custom field type. Renders a
 *   grouped, masked number field and shows the shared validator's message inline
 *   for instant feedback. The value stored is the raw digits; the server
 *   re-validates authoritatively on save.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Props are the platform's FieldTypeInputProps contract
 *   (value / onChange / field / error / readOnly) — duck-typed by the
 *   field-type-ui plugin, so no cross-package import is required.
 */
import { cardDigits, formatCardNumber, validateCreditCard } from './validator'

interface CreditCardInputProps {
  value: unknown
  onChange: (value: unknown) => void
  error?: string | null
  readOnly?: boolean
}

export function CreditCardInput({ value, onChange, error, readOnly }: CreditCardInputProps) {
  // Prefer the platform-computed error; otherwise validate locally.
  const shown = error ?? validateCreditCard(value)
  const dirty = cardDigits(value).length > 0

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 focus-within:border-accent">
        <span aria-hidden className="text-fg-subtle">💳</span>
        <input
          inputMode="numeric"
          autoComplete="off"
          readOnly={readOnly}
          value={formatCardNumber(value)}
          placeholder="4242 4242 4242 4242"
          onChange={(e) => onChange(cardDigits((e.target as HTMLInputElement).value))}
          className="flex-1 bg-transparent text-sm tabular-nums tracking-wide outline-none placeholder:text-fg-subtle"
        />
      </div>
      {dirty && shown && <p className="text-xs text-danger-fg">{shown}</p>}
    </div>
  )
}
