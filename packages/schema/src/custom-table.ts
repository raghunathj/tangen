/**
 * File Name: custom-table.ts
 * Purpose: Fluent builder API for defining custom database table schemas. Use
 * defineTable() and the column helpers in tangen.config.ts to declare custom
 * tables that are created or migrated by `tangen push`.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types (CustomColumnKind, ColumnDefinition, CustomTableDefinition)
 */
import type { CustomColumnKind, ColumnDefinition, CustomTableDefinition } from '@tangen/types'

/**
 * Internal fluent builder for a single custom-table column.
 * Chain modifier methods, then call .build() to produce a ColumnDefinition.
 */
class ColumnBuilder {
  readonly kind: CustomColumnKind
  _nullable = true
  _defaultValue?: unknown
  _defaultNow = false

  constructor(kind: CustomColumnKind) {
    this.kind = kind
  }

  /** Mark this column as NOT NULL — rejects null inserts at the database level. */
  notNull(): this { this._nullable = false; return this }
  /** Mark this column as nullable (the default). */
  nullable(): this { this._nullable = true; return this }
  /** Set a literal default value for this column. */
  default(value: unknown): this { this._defaultValue = value; return this }
  /** Set the column default to the current timestamp (only valid for timestamp columns). */
  defaultNow(): this { this._defaultNow = true; return this }

  /**
   * Compile this builder's configuration into a plain ColumnDefinition object.
   * @returns A ColumnDefinition ready for use in a CustomTableDefinition.
   */
  build(): ColumnDefinition {
    const def: ColumnDefinition = { kind: this.kind, nullable: this._nullable }
    if (this._defaultValue !== undefined) def.defaultValue = this._defaultValue
    if (this._defaultNow) def.defaultNow = true
    return def
  }
}

/** Create a text column builder. */
export function text()      { return new ColumnBuilder('text') }
/** Create a numeric (float) column builder. */
export function number()    { return new ColumnBuilder('number') }
/** Create a boolean column builder. */
export function boolean()   { return new ColumnBuilder('boolean') }
/** Create a JSONB column builder. */
export function json()      { return new ColumnBuilder('json') }
/** Create a timestamp column builder. */
export function timestamp() { return new ColumnBuilder('timestamp') }

/**
 * Define a custom table for this workspace.
 * @param name - Table name used as the database table identifier.
 * @param columns - Column definitions keyed by column name, built with the column helpers.
 * @returns A CustomTableDefinition ready to pass to TangenConfig.customTables.
 */
export function defineTable(
  name: string,
  columns: Record<string, ColumnBuilder>,
  options: Omit<CustomTableDefinition, 'name' | 'columns'> = {},
): CustomTableDefinition {
  const built: Record<string, ColumnDefinition> = {}
  for (const [key, builder] of Object.entries(columns)) {
    built[key] = builder.build()
  }
  return { name, columns: built, ...options }
}
