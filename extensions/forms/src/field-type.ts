/**
 * File Name: form-field-type.ts
 * Purpose: The `form` custom field type, contributed by the Forms feature. A
 *   field of this type stores a reference to one of the workspace's forms; the
 *   admin input is a form picker and the frontend renders it via the embed schema
 *   endpoint. Authored with the SAME public `defineFieldType` mechanism a site
 *   developer or extension uses (dogfood) — it just gets registered conditionally
 *   when the workspace has Forms enabled (see S2 gating).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: validate is pure + browser-safe (no ctx) — existence isn't
 *   checked here (the picker only offers real forms); storage inherits the `text`
 *   primitive (the form slug/id). Read-time expansion is a client concern:
 *   fetch /embed/forms/<ref>/schema.
 */
import { defineFieldType } from '@tangen/cms'

/**
 * A valid form reference is a form slug (kebab) or id (`frm_…`). Empty is valid
 * here — presence is `required`'s job, mirroring the `credit_card` validator —
 * so this only judges the shape of a non-empty ref.
 */
export function validateFormRef(value: unknown): string | null {
  const ref = String(value ?? '').trim()
  if (ref === '') return null
  return /^[a-z0-9][a-z0-9_-]*$/i.test(ref) ? null : 'Pick a form from the list'
}

/** The `form` field type — same `defineFieldType` path any site dev/extension uses. */
export const formFieldType = defineFieldType({
  name: 'form',
  label: 'Form',
  inherits: 'text',
  icon: 'IconFileText',
  description: "Reference a form to render - pick one of this workspace's forms.",
  validate: validateFormRef,
  // A form reference is a picked id — there is nothing for AI to write. Opt the
  // type out of AI entirely (hides the AI section, skips AI generation).
  ai: { enabled: false },
  // General option suppression: a picked form reference has no meaningful default
  // value, so hide that control in the schema builder.
  hideControls: ['config.default'],
})
