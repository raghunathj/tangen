/**
 * File Name: field-type-ui.ts
 * Purpose: Browser-safe authoring surface for a custom field type's admin UI — the
 *   React input it renders in the object editor plus an optional client-side
 *   validator (instant feedback only; the server re-validates authoritatively).
 *   An extension's admin entry default-exports `defineFieldTypeUI(...)` descriptors;
 *   the field-type-ui vite plugin (CF-3) collects them into a registry that
 *   field-control consults for custom types.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ComponentType } from 'react'
import type { FieldDefinition } from '@tangen/types'

/** Props every custom field-type input receives from the object editor. */
export interface FieldTypeInputProps {
  value: unknown
  onChange: (value: unknown) => void
  field: FieldDefinition
  /** Current validation error for this field (server or client), if any. */
  error?: string | null
  readOnly?: boolean
}

/** The admin-side definition of a custom field type. */
export interface FieldTypeUIDef {
  /** The React input rendered in the editor for fields of this type. */
  Input: ComponentType<FieldTypeInputProps>
  /**
   * Optional client-side validator for instant editor feedback. Return an error
   * message or null/undefined when valid. MUST mirror the server validator — share
   * one pure function between both so they can't drift. Never the source of truth.
   */
  validate?: (value: unknown, field: FieldDefinition) => string | null | undefined
}

/** A registered custom field-type UI descriptor. */
export interface FieldTypeUIDescriptor extends FieldTypeUIDef {
  /** The custom type name — must match the manifest `fieldTypes[].name`. */
  name: string
}

/**
 * Declare a custom field type's admin UI. Identity helper (like `defineExtension`)
 * — returns the descriptor for the field-type-ui plugin to collect.
 */
export function defineFieldTypeUI(name: string, def: FieldTypeUIDef): FieldTypeUIDescriptor {
  return { name, ...def }
}
