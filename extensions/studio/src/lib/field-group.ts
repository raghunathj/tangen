/**
 * File Name: field-group.ts
 * Purpose: Which inspector tab a prop belongs in.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Most props classify THEMSELVES: a select whose options
 *          are exactly a token slot list is that family's prop, which is the
 *          same rule the style panel already uses - so kit.spacer's `size`
 *          is space while kit.heading's `size` is type, with no per-widget
 *          knowledge anywhere.
 *
 *          The exceptions are closed enums that are visual but NOT token-
 *          bound (`layout`, `align`, `columns`, `aspect`, `stackOn`,
 *          `pagination`). Nothing in their schema says they are visual, so
 *          they need an explicit `group` on the field - about five across
 *          the whole kit. That hint is the only thing this arc adds to the
 *          contract, and it was worth naming rather than discovering.
 */
import type { SubField } from '@tangen/types'
import { tokenFamilyForField } from './style-panel'

/** The inspector's tabs. */
export type FieldGroup = 'content' | 'style' | 'advanced'

const GROUPS: FieldGroup[] = ['content', 'style', 'advanced']

/**
 * Where a prop goes. An explicit `group` wins - the author knows better than
 * the rule - then the token-family test, then content, because a prop nobody
 * has classified is far more likely to be something the page SAYS than
 * something it looks like.
 */
export function fieldGroup(field: Pick<SubField, 'fieldType' | 'config'> & { group?: unknown }): FieldGroup {
  if (!field) return 'content'
  const declared = field.group
  if (typeof declared === 'string' && (GROUPS as string[]).includes(declared)) {
    return declared as FieldGroup
  }
  return tokenFamilyForField(field) ? 'style' : 'content'
}
