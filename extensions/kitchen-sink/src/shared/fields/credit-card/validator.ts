/**
 * File Name: credit-card.ts
 * Purpose: The ONE shared, pure, browser-safe validator for the `credit_card`
 *   custom field type. Imported by BOTH the server entry (authoritative, gates
 *   the save) and the admin input (instant feedback) so the two can never drift.
 *   No imports — safe on either runtime.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** Strips spaces/dashes and returns just the digits. */
export function cardDigits(input: unknown): string {
  return String(input ?? '').replace(/\D/g, '')
}

/** Luhn checksum — the industry check every card number must satisfy. */
export function luhnValid(input: unknown): boolean {
  const digits = cardDigits(input)
  if (digits.length < 12 || digits.length > 19) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i])
    if (double) { n *= 2; if (n > 9) n -= 9 }
    sum += n
    double = !double
  }
  return sum % 10 === 0
}

/**
 * The shared validation rule. Returns an error message or null. Empty is treated
 * as valid here — presence is the platform's job (required + the inherited `text`
 * primitive), so this validator only judges the format of a non-empty value.
 */
export function validateCreditCard(value: unknown): string | null {
  const digits = cardDigits(value)
  if (digits.length === 0) return null
  return luhnValid(digits) ? null : 'Enter a valid card number'
}

/** Formats digits into groups of four for display (e.g. 4242 4242 4242 4242). */
export function formatCardNumber(input: unknown): string {
  return cardDigits(input).replace(/(.{4})/g, '$1 ').trim()
}
