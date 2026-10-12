/**
 * File Name: object-types.ts
 * Purpose: Defines the `object_types` table, which stores content-type definitions
 *   (schema blueprints) registered in each environment of a workspace.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm/pg-core; one registry per database: a type name is unique in the deployment.
 */
import { pgTable, text, timestamp, boolean, integer, jsonb, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * Stores the schema definition for a single content type within an environment.
 * Each row describes one content type (e.g. "post", "author") including its field
 * schema version, singleton flag, and admin UI configuration.
 */
export const objectTypes = pgTable('object_types', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  label: text('label').notNull(),
  /** Explicit plural word (nullable — inflection derives one from `name` when absent). */
  plural: text('plural'),
  singleton: boolean('singleton').notNull().default(false),
  disabled: boolean('disabled').notNull().default(false),
  /** Type-level localization opt-in — title (and any localized fields) get a
   *  <type>_i18n side table; drives whether the admin offers translation. */
  localized: boolean('localized').notNull().default(false),
  /** The extension that declares this type, or NULL when the site's own code
   *  does. A row with a value here is never dropped by a push: an extension
   *  that stops declaring it leaves an orphan the tooling reports instead. */
  providedBy: text('provided_by'),
  previousNames: text('previous_names').array().notNull().default(sql`'{}'`),
  adminConfig: jsonb('admin_config').notNull().default(sql`'{}'`),
  schemaVersion: integer('schema_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqEnvName: unique().on(t.name),
}))
