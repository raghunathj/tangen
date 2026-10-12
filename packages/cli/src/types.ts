/**
 * File Name: types.ts
 * Purpose: Defines the runtime schema types and the ChangeOperation discriminated union
 *          used by the CLI to compute and apply schema migrations against a live database.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Imports ObjectTypeDefinition, FieldDefinition, and AdminConfig
 *                     from @tangen/types.
 */
import type { ObjectTypeDefinition, FieldDefinition, AdminConfig } from '@tangen/types'

/** A single field as it exists in the live database, used for diffing against the code schema. */
export interface RuntimeField {
  id: string
  name: string
  label: string
  fieldType: string
  config: Record<string, unknown>
  previousNames: string[]
  required: boolean
  disabled?: boolean
}

/** An object type as it exists in the live database, including its current field list. */
export interface RuntimeObjectType {
  id: string
  name: string
  label: string
  plural?: string | null
  singleton: boolean
  disabled?: boolean
  localized?: boolean
  previousNames: string[]
  adminConfig: Record<string, unknown>
  /** The extension that provides this type, or null when the site's own code declares it. */
  providedBy?: string | null
  fields: RuntimeField[]
}

/** The complete schema as read from the live database, used as the baseline for migration diffing. */
export interface RuntimeSchema {
  types: RuntimeObjectType[]
}

/**
 * Discriminated union of all schema change operations produced by the diff algorithm.
 * Each variant carries the minimum data needed to apply (or explain) that specific change.
 */
export type ChangeOperation =
  | { op: 'CREATE_TYPE'; type: ObjectTypeDefinition }
  | { op: 'CREATE_SINGLETON_OBJECT'; typeName: string }
  | { op: 'RENAME_TYPE'; typeId: string; from: string; to: string }
  | { op: 'UPDATE_TYPE_SINGLETON'; typeId: string; typeName: string; singleton: boolean }
  | { op: 'UPDATE_TYPE_DISABLED'; typeId: string; typeName: string; disabled: boolean }
  | { op: 'UPDATE_TYPE_LOCALIZED'; typeId: string; typeName: string; localized: boolean }
  | { op: 'UPDATE_TYPE_PLURAL'; typeId: string; typeName: string; plural: string | null }
  | { op: 'UPDATE_TYPE_LABEL'; typeId: string; typeName: string; label: string }
  | { op: 'UPDATE_TYPE_ADMIN_CONFIG'; typeId: string; typeName: string; admin: AdminConfig | undefined }
  /** Ownership moved: an extension now provides this type, or the site took it over (`null`). Registry-only. */
  | { op: 'UPDATE_TYPE_PROVIDED_BY'; typeId: string; typeName: string; providedBy: string | null }
  | { op: 'ADD_FIELD'; typeId: string; typeName: string; field: FieldDefinition }
  | { op: 'RENAME_FIELD'; typeId: string; typeName: string; fieldId: string; from: string; to: string }
  | { op: 'UPDATE_FIELD_CONFIG'; typeId: string; typeName: string; fieldId: string; field: FieldDefinition }
  | { op: 'UPDATE_FIELD_REQUIRED'; typeId: string; typeName: string; fieldId: string; fieldName?: string; required: boolean }
  | { op: 'UPDATE_FIELD_DISABLED'; typeId: string; typeName: string; fieldId: string; fieldName?: string; disabled: boolean }
  | { op: 'DROP_FIELD'; typeId: string; typeName: string; fieldId: string; name: string; fieldType: string; warned: true }
  | { op: 'DROP_TYPE'; typeId: string; name: string; warned: true }
  | { op: 'CREATE_INDEX'; typeId: string; typeName: string; field: FieldDefinition }
  | { op: 'DROP_INDEX'; typeId: string; typeName: string; fieldName: string }
  /**
   * tier 1 - same column kind (text to email, rating to number): registry-only, auto-applied.
   * tier 2 - a kind Postgres converts in place (number to text, tags to text): DDL with USING; classified per cast.
   * tier 3 - no automatic conversion (media to relation): always blocked; rename the field instead.
   * `fromSql` / `toSql` are the column kinds the tier was decided from (column-types.ts);
   * the planner falls back to the mapping by type name when a caller omits them.
   */
  | { op: 'CHANGE_FIELD_TYPE'; typeId: string; typeName: string; fieldId: string; fieldName: string; from: string; to: string; tier: 1 | 2 | 3; fromSql?: string | null; toSql?: string | null }
  /**
   * A component sub-field's stored JSONB key moves from `from` to `to`, in every
   * block of `_type` = `component`, at any depth, in every column that can hold
   * one. Declared by `previousName` in the component definition, never inferred:
   * there is no components table, so nothing else remembers that two keys are
   * the same field.
   *
   * `conflict` is a FACT established by the read-only probe, not a verdict: at
   * least one stored block holds both keys, so there are two values and no
   * defined winner. `classifyOperation` reads it and decides; nothing else may.
   * `impact` is advisory enrichment for the preview and never changes risk.
   */
  | {
      op: 'COMPONENT_FIELD_RENAME'; component: string
      /** Every name the value may still be stored under: `previousName` is a trail. */
      sources: string[]
      to: string
      conflict: boolean
      impact?: { baseSource: number; baseConflict: number; baseMigrated: number; localeSource: Record<string, number>; localeConflict: number }
      sites?: Array<{ typeName: string; column: string; sideTable?: boolean }>
    }
  /**
   * Permanently delete a historical component sub-field value from stored JSONB
   * and from the locale overlays that belong to the same blocks.
   *
   * Never produced by a schema diff. Removing a field from a component
   * definition hides it; this is the separate, imperative action that destroys
   * it, and it exists only because someone typed its name.
   */
  /** Physical deletion of a guarded (renamed-aside) column or table - `tangen purge guarded`, never a push artefact. */
  | { op: 'PURGE_GUARDED'; kind: 'column' | 'table'; table: string; name: string; original: string }
  /** Deletion of an uninstalled extension's retained data in ONE workspace x environment - `tangen purge extension`, never a push artefact. */
  | { op: 'PURGE_EXTENSION'; extensionId: string; workspaceId: string; tables: string[] }
  | {
      op: 'COMPONENT_FIELD_PURGE'; component: string; key: string
      impact?: { baseRows: number; localeEntries: Record<string, number>; localeOrphans: number }
      sites?: Array<{ typeName: string; column: string; sideTable?: boolean }>
    }

/** The result of diffing the code schema against the runtime schema, ready for user review and application. */
export interface ChangePlan {
  operations: ChangeOperation[]
  /** At least one op drops data (a column or a table). A group drop has no column, so it is not one. */
  hasDestructive: boolean
  /** At least one op changes the physical schema (DDL), as opposed to registry-only metadata. */
  hasMigrations: boolean
  /**
   * Types the registry still carries that NOBODY declares any more, because
   * the extension that provided them stopped. Not operations: the whole point
   * is that nothing happens to them. The table, its rows and its registry row
   * stay; push reports them, doctor reports them, and a site that really wants
   * one gone declares the type in its own schema (taking ownership) and then
   * drops it the ordinary way, with its approval.
   *
   * Optional because absent means none: a plan assembled by hand (a test, a
   * caller narrowing another plan) is not obliged to carry an empty array.
   */
  orphans?: Array<{ type: string; providedBy: string }>
}
