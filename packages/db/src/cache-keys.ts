/**
 * File Name: cache-keys.ts
 * Purpose: The ONE place the Redis key namespace is defined. Cache keys (schema,
 *   features, stats) are env-id scoped and env ids are global slugs (env_development),
 *   so two different projects sharing one Redis would collide. Every key is namespaced
 *   by a fingerprint of the project's database URL. Both the API (which writes/reads the
 *   cache) and the CLI (which invalidates it on push) MUST derive the prefix identically —
 *   if they drift, push's invalidation silently misses and the API serves a stale schema
 *   until the TTL expires.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Uses Bun.hash — both the API and the CLI run under Bun.
 */

/**
 * The Redis key prefix for a project, derived from its database URL. Applied by the
 * API's ioredis client as `keyPrefix`, and prepended by the CLI when it invalidates.
 */
export function projectRedisPrefix(dbUrl: string | undefined | null): string {
  const fingerprint = Bun.hash(dbUrl || 'local').toString(36).slice(0, 10)
  return `tgn:${fingerprint}:`
}

/** The (un-prefixed) schema cache key for an env — the prefix is applied separately. */
export function schemaCacheKey(): string {
  return 'tangen:schema'
}

/** The fully-qualified schema cache key (prefix + key) — used where the client has no keyPrefix. */
export function fullSchemaCacheKey(dbUrl: string | undefined | null): string {
  return projectRedisPrefix(dbUrl) + schemaCacheKey()
}

/**
 * The NOTIFY channel a schema push announces itself on, after its transaction
 * has committed. The payload is the environment id whose schema changed - the
 * one dimension the schema query is keyed by - so a listening API drops
 * exactly that entry. Shared here because the CLI sends and the API listens,
 * and neither may import the other.
 */
export const SCHEMA_CHANNEL = 'tangen_schema'
