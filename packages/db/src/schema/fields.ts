/**
 * File Name: fields.ts
 * Purpose: Drizzle schema for the `fields` table, which stores the field-level
 *          schema definitions for each content type (objectType) within an environment.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: References object_types. previousNames tracks rename history
 *                     to support non-destructive field renames in migrations.
 *                     config is a JSON blob whose shape depends on fieldType.
 */
import { pgTable, text, timestamp, boolean, integer, jsonb, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { objectTypes } from './object-types'

/**
 * Defines individual field schemas belonging to a content object type, including
 * field type, display config, ordering, required flag, and rename history.
 */
export const fields = pgTable('fields', {
  id: text('id').primaryKey(),
  typeId: text('type_id').notNull().references(() => objectTypes.id),
  name: text('name').notNull(),
  label: text('label').notNull(),
  fieldType: text('field_type').notNull(),
  config: jsonb('config').notNull().default(sql`'{}'`),
  previousNames: text('previous_names').array().notNull().default(sql`'{}'`),
  position: integer('position').notNull().default(0),
  required: boolean('required').notNull().default(false),
  /** Soft-disable: hidden from every runtime surface; column + data preserved. */
  disabled: boolean('disabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqTypeField: unique().on(t.typeId, t.name),
}))
