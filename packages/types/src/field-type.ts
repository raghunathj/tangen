/**
 * File Name: field-type.ts
 * Purpose: Site-level custom field types. A site developer defines a new field
 *   type in `app/fields/<name>/index.ts` with `defineFieldType(...)` — the
 *   declaration + an authoritative validator — and an optional sibling
 *   `input.tsx` for the admin editor input. Auto-discovered by the API (server)
 *   and the admin build; no extension required.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Browser-safe. `index.ts` must NOT import its React input —
 *   the API imports it on the server. The input lives in the sibling `input.tsx`.
 */
import type { FieldType, IconRef } from './object-types'

/**
 * A custom field type's shared validator — runs authoritatively on the server
 * (every save/publish) AND, when an input reuses it, for instant client feedback.
 * Return an error message, or null/undefined when valid. Treat empty as valid
 * (presence is enforced by `required` + the inherited primitive).
 */
export type SiteFieldValidate = (value: unknown) => string | null | undefined

/** A site-defined custom field type (the default export of app/fields/<name>/index.ts). */
export interface SiteFieldTypeDef {
  /** Machine name, referenced as a field's `fieldType` (e.g. 'credit_card'). */
  name: string
  /** Human-readable label shown in the field-type picker. */
  label: string
  /**
   * The built-in primitive this type inherits — storage shape, baseline
   * validation, filters, AI value-shape. Defaults to `'text'`.
   */
  inherits?: FieldType
  /** Icon for the picker — an @tangen/icons name or `{ src }` image. */
  icon?: IconRef
  /** Short description shown under the label in the picker. */
  description?: string
  /**
   * Per-field config options this type accepts — a flat map of key → { type,
   * label, description, default, options }. The schema builder generates config
   * controls from this (each writes to the field's `config.<key>`).
   */
  configSchema?: Record<string, unknown>
  /** Authoritative validator (see {@link SiteFieldValidate}). */
  validate?: SiteFieldValidate
  /**
   * Content AI participation for fields of this type (mirrors the extension
   * `CustomFieldTypeDef.ai`). `enabled: false` opts the type out of AI entirely —
   * no AI-hint control in the schema builder and no AI generation for its values
   * (e.g. a `form` reference: a picked id, nothing to write). `valueShape` tells
   * the AI coercion layer what the field stores; `hint` documents what to write.
   */
  ai?: { enabled?: boolean; hint?: string; valueShape?: 'string' | 'string[]' | 'json' }
  /**
   * Schema-builder controls to hide for fields of this type — the general
   * option-suppression mechanism. Each entry is a control PATH (or path prefix):
   * it hides the control whose path equals it, or starts with `<entry>.`. So
   * `'config.ai'` hides the whole AI section, `'config.localized'` the Localized
   * toggle, `'config.validation.unique'` just the Unique rule, `'config.default'`
   * the default-value input. (`ai.enabled: false` is sugar for `'config.ai'`.)
   * Use it when a control makes no sense for the type — e.g. a `form` reference
   * has no meaningful default value.
   */
  hideControls?: string[]
}

/**
 * Declare a site-level custom field type. Identity helper (like `defineObjectType`)
 * — returns the definition for the API + admin build to discover.
 */
export function defineFieldType(def: SiteFieldTypeDef): SiteFieldTypeDef {
  return def
}
