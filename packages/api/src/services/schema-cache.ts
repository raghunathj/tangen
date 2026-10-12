/**
 * File Name: schema-cache.ts
 * Purpose: The schema loader every caller imports. Process cache, then Redis
 *          when configured, then PostgreSQL; a push in another process empties
 *          the cache through NOTIFY.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A façade over `schema-process-cache.ts`, which holds the
 *   mechanism and its rationale. Kept as the import path for two reasons: every
 *   existing caller and several test mocks name this module, and a test of the
 *   real mechanism needs a module those mocks never replace.
 */
import * as impl from './schema-process-cache'

// Plain copies, not `export { } from` re-exports. A re-export is a live binding
// into the implementation module, and a `mock.module` on this façade writes
// through it - replacing getSchema inside the real module for every later
// test in the run. Owning the bindings here keeps a mock where it was aimed.
export const getSchema = impl.getSchema
export const buildSchemaDefinition = impl.buildSchemaDefinition
export const SCHEMA_CACHE_KEY = impl.SCHEMA_CACHE_KEY
export const SCHEMA_HIT_KEY = impl.SCHEMA_HIT_KEY
export const SCHEMA_MISS_KEY = impl.SCHEMA_MISS_KEY
export const PROCESS_CACHE_TTL_MS = impl.PROCESS_CACHE_TTL_MS
export const schemaProcessCacheStats = impl.schemaProcessCacheStats
export const invalidateSchema = impl.invalidateSchema
export const invalidateAllSchema = impl.invalidateAllSchema
export const startSchemaInvalidationListener = impl.startSchemaInvalidationListener
export const stopSchemaInvalidationListener = impl.stopSchemaInvalidationListener
export const __resetSchemaCacheForTests = impl.__resetSchemaCacheForTests
