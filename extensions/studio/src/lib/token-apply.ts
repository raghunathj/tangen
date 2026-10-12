/**
 * File Name: token-apply.ts
 * Purpose: Applying a design token from the Variables panel - which prop on
 *          the selected block receives it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The same shape as media-drop.ts on purpose: the panel
 *          offers something, the SCHEMA decides where it lands, and a case
 *          nothing can hold returns a reason rather than doing nothing.
 *
 *          Token family is recognised the way it always is - by the field's
 *          options matching a family's slot list (tokenFamilyForField) - so
 *          a developer's own component with a palette-typed prop is just as
 *          valid a target as a kit block.
 */
import type { ComponentDef, SubField } from '@tangen/types'
import { tokenFamilyForField } from './style-panel'
import type { TokenFamily } from '../tokens'

export type TokenTarget =
  /** `wrapper` props are written through `_studio`, not onto the block. */
  | { action: 'set'; prop: string; source: 'field' | 'wrapper' }
  | { action: 'none'; reason: string }

/** Plain-English names for the families, for messages a marketer reads. */
const FAMILY_LABEL: Record<string, string> = {
  palette: 'colour',
  space: 'spacing',
  type: 'text size',
  radius: 'corner rounding',
  width: 'width',
}

function firstOfFamily(fields: SubField[] | undefined, family: TokenFamily): SubField | null {
  for (const f of fields ?? []) {
    if (tokenFamilyForField(f) === family) return f
  }
  return null
}

/**
 * Where a token should land. The block's OWN prop wins - kit.section declares
 * `background`, and that is what "make this section brand-coloured" means -
 * falling back to Studio's wrapper chrome, which every block carries.
 */
export function tokenTarget(
  family: TokenFamily,
  selected: ComponentDef | null,
  wrapperFields: SubField[],
): TokenTarget {
  if (!selected) {
    return { action: 'none', reason: 'Select a block first, then choose a variable to apply to it.' }
  }

  const own = firstOfFamily(selected.fields as SubField[] | undefined, family)
  if (own) return { action: 'set', prop: own.name, source: 'field' }

  const wrapped = firstOfFamily(wrapperFields, family)
  if (wrapped) return { action: 'set', prop: wrapped.name, source: 'wrapper' }

  const label = FAMILY_LABEL[family] ?? family
  return {
    action: 'none',
    reason: `"${selected.label || selected.name}" has nothing that takes a ${label}.`,
  }
}
