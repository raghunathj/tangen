/**
 * File Name: index.ts (shared/fields/credit-card)
 * Purpose: Co-located definition of the `credit_card` custom field type — the
 *   shared pure validator, the admin input, and a ready `fieldTypeUIs` descriptor.
 *   Mirrors the site-level `app/fields/<name>/` convention inside the extension so
 *   a field type is one self-contained folder.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The extension's server entry imports the validator directly
 *   from `./validator` (server-safe); this barrel (which pulls the React input) is
 *   imported only by the browser-safe client entry.
 */
import { CreditCardInput } from './input'
import { validateCreditCard } from './validator'

export { validateCreditCard, luhnValid, cardDigits, formatCardNumber } from './validator'
export { CreditCardInput } from './input'

/** The admin field-type UI descriptor (for the client entry's `fieldTypeUIs`). */
export const creditCardFieldUI = {
  name: 'credit_card',
  Input: CreditCardInput,
  validate: (value: unknown) => validateCreditCard(value),
}
