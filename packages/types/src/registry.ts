/**
 * File Name: registry.ts
 * Purpose: The Tangen type registry — a single augmentable interface that
 *          `tangen types` fills via module augmentation (declare module
 *          '@tangen/types'). Every schema-aware API (objects/table/global,
 *          hooks) is generic OVER this registry with a graceful fallback:
 *          a repo that has run `tangen types` gets fully-typed content, while
 *          one that hasn't keeps working loosely. Deliberately plain interface
 *          + shallow conditional lookups (NO deep/recursive inference) so
 *          type-checking stays fast — performance is a first-class constraint.
 *
 * Author: Raghunath J
 * License: MIT
 */

/**
 * Augmented by the generated `tangen-types.d.ts`, e.g.
 * `declare module '@tangen/types' { interface TangenRegistry { content: {…} } }`.
 * Empty by default → all helpers below fall back to their loose forms.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TangenRegistry {}

/** A loose content record when the registry has no `content` block. */
export type LooseRecord = Record<string, unknown>

/**
 * Content type names — a string-literal union when the registry is filled,
 * otherwise `string` (so untyped repos still compile).
 */
export type ContentName =
  TangenRegistry extends { content: infer C } ? Extract<keyof C, string> : string

/**
 * The record type for a content type name — the generated interface when known,
 * otherwise a loose record. A single conditional lookup, not deep inference.
 */
export type ContentRow<K extends string> =
  TangenRegistry extends { content: infer C }
    ? (K extends keyof C ? C[K] : LooseRecord)
    : LooseRecord

/**
 * A row's field/column keys — narrows to the record's keys when typed, and
 * degrades to `string` for a loose record (so untyped builders accept any
 * field name). One `keyof … & string`, not deep inference.
 */
export type FieldKey<T> = keyof T & string

/** System columns accepted by sort/filters in BOTH spellings. */
/**
 * The system fields a query may name, in the PUBLIC spelling first (closure
 * plan Phase 6A, Unit 5: sort by the content model's names). The snake_case
 * storage spellings are the accepted pre-v1 alias and stay in the type so
 * existing code keeps compiling; new code should use the camelCase names.
 */
export type SystemColumnKey =
  | 'id' | 'title' | 'status'
  | 'createdAt' | 'updatedAt' | 'publishedAt' | 'createdBy' | 'updatedBy'
  /** @deprecated storage spellings - accepted, but `createdAt` is the contract */
  | 'created_at' | 'updated_at' | 'published_at' | 'created_by' | 'updated_by'

/** Custom table names — literal union when typed, else `string`. */
export type TableName =
  TangenRegistry extends { tables: infer T } ? Extract<keyof T, string> : string

/** The row shape for a custom table name — the generated record, or loose. */
export type TableRow<K extends string> =
  TangenRegistry extends { tables: infer T }
    ? (K extends keyof T ? T[K] : LooseRecord)
    : LooseRecord

/** Global (Options/Metafield) names — literal union when typed, else `string`. */
export type GlobalName =
  TangenRegistry extends { globals: infer G } ? Extract<keyof G, string> : string

/** The data shape for a global name — the generated record, or loose. */
export type GlobalData<K extends string> =
  TangenRegistry extends { globals: infer G }
    ? (K extends keyof G ? G[K] : LooseRecord)
    : LooseRecord

/** Authorable locale codes — the config's union when typed, else `string`. */
export type LocaleCode =
  TangenRegistry extends { locales: infer L } ? (L & string) : string

/** Role slugs (built-ins + code roles) — the config's union when typed, else `string`. */
export type RoleSlug =
  TangenRegistry extends { roles: infer R } ? (R & string) : string

/**
 * Extension ids (feature-gated built-ins + config `extensions:` entries, ids
 * derived from the resolve path's last segment) — the config's union when
 * typed, else `string`.
 */
export type ExtensionId =
  TangenRegistry extends { extensions: infer E } ? (E & string) : string
