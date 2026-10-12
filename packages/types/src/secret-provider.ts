/**
 * File Name: secret-provider.ts
 * Purpose: The privileged boundary for secret material
 *          (tasks/plan-config-resolver.md, section 8). A SecretProvider
 *          answers a REFERENCE (a variable name) with material; the env
 *          provider is the ONE place in the platform that reads a secret
 *          variable. The SecretAccessor a server runtime receives is keyed
 *          by registry key, never by raw variable name, and is a closure
 *          nothing can serialize.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Timing (amendment H): references and their
 *          provenance are fixed at deployment resolution; MATERIAL is read
 *          from the current deployment's provider when asked. For the env
 *          provider that is static for the process; a managed provider may
 *          change the material behind the same reference, and no consumer
 *          contract prevents it. Material never inherits across
 *          deployments because there is only ever the current provider.
 */

export interface SecretProvider {
  readonly kind: string
  has(ref: string): boolean
  read(ref: string): string | undefined
}

/** Self-hosted: the process environment. Blank counts as unset. */
export function envSecretProvider(env: Record<string, string | undefined> = process.env): SecretProvider {
  return {
    kind: 'env',
    has: (ref) => Boolean(env[ref]?.trim()),
    read: (ref) => env[ref]?.trim() || undefined,
  }
}

/** By registry key. `get` answers only for a key the registry declared secret. */
export interface SecretAccessor {
  get(key: string): string | undefined
  has(key: string): boolean
  /** The provider kind that answers, for diagnostics. Never the value. */
  readonly provider: string
}

/** Marks the objects that carry a SecretAccessor or resolved configuration, so a logger can refuse them by type. */
export const NO_LOG = Symbol.for('tangen.no-log')

/**
 * Builds the accessor over the references resolution produced. The map is
 * captured by closure; the returned object exposes no enumerable state,
 * serializes to nothing and is refused by the platform logger.
 */
export function createSecretAccessor(refs: ReadonlyMap<string, string>, provider: SecretProvider): SecretAccessor {
  const accessor = {
    get: (key: string) => { const ref = refs.get(key); return ref ? provider.read(ref) : undefined },
    has: (key: string) => { const ref = refs.get(key); return ref ? provider.has(ref) : false },
    provider: provider.kind,
    toJSON: () => undefined,
  }
  Object.defineProperty(accessor, NO_LOG, { value: true, enumerable: false })
  return accessor
}
