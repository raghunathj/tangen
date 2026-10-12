/**
 * File Name: extension-dependencies.ts
 * Purpose: The extension dependency model (closure plan Phase 4, Unit 4):
 *          given what is installed and enabled in one workspace x
 *          environment, which manifests are loaded, and which Tangen
 *          capabilities are available in the process, decide for every
 *          extension whether it is ACTIVE there and, when it is not, say
 *          why in words an operator can act on.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure and deterministic. Not a package manager:
 *          nothing is fetched or installed; this is validation over the
 *          extensions already present. A required capability must be
 *          AVAILABLE (not necessarily started: a demand-driven worker that
 *          has nothing to do is still available). A required extension
 *          must be active in the SAME scope, at a version satisfying the
 *          declared range. Cycles and self-dependencies block every
 *          member. Optional extensions never block; the missing ones are
 *          reported so the extension can adapt.
 */
import { parseServiceRef, serviceMajorSatisfies } from './extension-services'
import type { TangenExtensionManifest } from './extension'
import { dependencyId, dependencyRange, satisfiesVersion } from './extension-manifest'

export type ManifestForResolution = Pick<TangenExtensionManifest, 'id' | 'version' | 'requires' | 'optional' | 'deploymentRoles' | 'provides'>

export interface ActivationInput {
  /** Every installation row of the scope (installed state only), by extension id. */
  installed: Record<string, { version: string | null; enabled: boolean }>
  /** The manifests loaded in this process, by extension id. */
  manifests: Record<string, ManifestForResolution>
  /** The deployment role of this process; a manifest's `deploymentRoles` policy is checked against it. */
  role?: 'development' | 'staging' | 'production' | null
  /** A Tangen capability's availability here; null when the process has no such capability. */
  capability: (id: string) => { available: boolean; reason?: string } | null
  /**
   * Why an extension's declared schema is not in place here (migrations
   * pending, failed, or history that no longer matches); null when it is.
   * Default: schema is never a concern.
   */
  schema?: (id: string) => string | null
}

export type ActivationState =
  /** Installed, enabled, every requirement met. */
  | 'active'
  /** No installed row in this scope. */
  | 'not-installed'
  /** Installed here, switched off. */
  | 'disabled'
  /** Installed and enabled, but its code is not loaded in this process. */
  | 'not-registered'
  /** Its manifest's `deploymentRoles` policy excludes this deployment's role. */
  | 'not-permitted'
  /** A required Tangen capability is missing or unavailable. */
  | 'unavailable'
  /** A required extension is not active here, or the dependency graph is broken. */
  | 'blocked'
  /** Its declared migrations are not applied here (or failed, or history disagrees). */
  | 'schema-pending'

export interface ActivationResult {
  active: boolean
  state: ActivationState
  /** Why it is not active; null when active. Safe for an operator: names, never values. */
  reason: string | null
  /** Optional extensions that are not active here. */
  missingOptional: string[]
}

export type ActivationMap = Record<string, ActivationResult>

/**
 * Resolves every extension known in the scope (installed or loaded). The
 * same input always yields the same output; two environments are two calls.
 */
export function resolveExtensionActivation(input: ActivationInput): ActivationMap {
  const ids = [...new Set([...Object.keys(input.installed), ...Object.keys(input.manifests)])].sort()
  const out: ActivationMap = {}
  const visiting = new Set<string>()

  const installedVersion = (id: string): string | null =>
    input.installed[id]?.version ?? input.manifests[id]?.version ?? null

  /** Installed + enabled extensions whose manifest declares the service id, with the major each offers. */
  const providersOf = (serviceId: string): Array<{ providerId: string; major: string }> => {
    const out: Array<{ providerId: string; major: string }> = []
    for (const [providerId, m] of Object.entries(input.manifests)) {
      const row = input.installed[providerId]
      if (!row?.enabled) continue
      for (const declared of m.provides?.services ?? []) {
        const p = parseServiceRef(declared)
        if (p && p.id === serviceId) out.push({ providerId, major: p.version })
      }
    }
    return out
  }

  const resolve = (id: string, trail: string[]): ActivationResult => {
    if (out[id]) return out[id]
    const row = input.installed[id]
    const manifest = input.manifests[id]
    const done = (state: ActivationState, reason: string | null, missingOptional: string[] = []): ActivationResult => {
      const r = { active: state === 'active', state, reason, missingOptional }
      out[id] = r
      return r
    }
    if (!row) return done('not-installed', 'not installed here')
    if (!row.enabled) return done('disabled', 'disabled here')
    if (!manifest) return done('not-registered', 'installed here, but its code is not loaded in this process')

    // The manifest's deployment-role policy: a developer tool is never active in production.
    if (manifest.deploymentRoles && input.role && !manifest.deploymentRoles.includes(input.role)) {
      return done('not-permitted', `its manifest allows ${manifest.deploymentRoles.join(', ')} deployments only; this is a ${input.role} deployment`)
    }

    // Required capabilities: available, not started.
    for (const cap of manifest.requires?.capabilities ?? []) {
      const a = input.capability(cap)
      if (!a) return done('unavailable', `requires capability '${cap}', which is not part of this server`)
      if (!a.available) return done('unavailable', `requires capability '${cap}', which is unavailable${a.reason ? `: ${a.reason}` : ''}`)
    }

    // Declared schema in place: an extension never runs against tables it expects and does not have.
    const schema = input.schema?.(id) ?? null
    if (schema) return done('schema-pending', schema)

    // Required extensions: active in the same scope, at a satisfying version.
    if (visiting.has(id)) {
      const cycle = [...trail.slice(trail.indexOf(id)), id].join(' -> ')
      return done('blocked', `dependency cycle: ${cycle}`)
    }
    visiting.add(id)
    try {
      for (const dep of manifest.requires?.extensions ?? []) {
        const depId = dependencyId(dep)
        if (depId === id) return done('blocked', 'depends on itself')
        const depRow = input.installed[depId]
        if (!depRow) return done('blocked', `requires '${depId}', which is not installed here`)
        if (!depRow.enabled) return done('blocked', `requires '${depId}', which is disabled here`)
        const range = dependencyRange(dep)
        const v = installedVersion(depId)
        if (range && (!v || !satisfiesVersion(v, range))) {
          return done('blocked', `requires '${depId}' ${range}, but ${v ? `${v} is installed` : 'its version is unknown'} here`)
        }
        const depResult = resolve(depId, [...trail, id])
        if (!depResult.active) {
          const why = depResult.state === 'blocked' && depResult.reason?.startsWith('dependency cycle') ? depResult.reason : `'${depId}' is not active here: ${depResult.reason}`
          return done('blocked', depResult.reason?.startsWith('dependency cycle') ? why : `requires ${why}`)
        }
      }
      // Required typed services (K3): an ACTIVE provider whose declared major satisfies the range.
      for (const ref of manifest.requires?.services ?? []) {
        const want = parseServiceRef(ref)
        if (!want) return done('blocked', `requires service '${ref}', which is not a valid service ref`)
        const offers = providersOf(want.id).filter((o) => o.providerId !== id)
        if (offers.length === 0) return done('blocked', `requires service '${ref}', which no active extension provides here`)
        const inRange = offers.filter((o) => serviceMajorSatisfies(o.major, want.version))
        if (inRange.length === 0) {
          const o = offers[0]!
          return done('blocked', `requires service '${ref}', but the provider here ('${o.providerId}') offers ${want.id}@${o.major}`)
        }
        const live = inRange.find((o) => resolve(o.providerId, [...trail, id]).active)
        if (!live) {
          const o = inRange[0]!
          const why = resolve(o.providerId, [...trail, id]).reason
          return done('blocked', `requires service '${ref}', whose provider '${o.providerId}' is not active here: ${why}`)
        }
      }
    } finally {
      visiting.delete(id)
    }

    const missingOptional: string[] = []
    for (const ref of manifest.optional?.services ?? []) {
      const want = parseServiceRef(ref)
      const live = want && providersOf(want.id).filter((o) => o.providerId !== id && serviceMajorSatisfies(o.major, want.version)).some((o) => resolve(o.providerId, [...trail, id]).active)
      if (!live) missingOptional.push(`service:${ref}`)
    }
    for (const dep of manifest.optional?.extensions ?? []) {
      const depId = dependencyId(dep)
      if (depId === id) continue
      const range = dependencyRange(dep)
      const v = installedVersion(depId)
      const present = input.installed[depId]?.enabled && input.manifests[depId] && (!range || (v !== null && satisfiesVersion(v, range)))
      if (!present) { missingOptional.push(depId); continue }
      const depResult = resolve(depId, [...trail, id])
      if (!depResult.active) missingOptional.push(depId)
    }
    return done('active', null, missingOptional)
  }

  for (const id of ids) resolve(id, [])
  return out
}

/**
 * The extensions active in a scope that REQUIRE `id` (directly). An
 * uninstall or disable of `id` is refused while any exists: the operator
 * disables or uninstalls the dependants first, so nothing is left blocked
 * by surprise.
 */
export function activeDependantsOf(id: string, manifests: Record<string, ManifestForResolution>, activation: ActivationMap): string[] {
  return Object.keys(manifests)
    .filter((other) => other !== id && activation[other]?.active && (manifests[other]!.requires?.extensions ?? []).some((d) => dependencyId(d) === id))
    .sort()
}

/**
 * The order in which active extensions should start: a dependency before
 * its dependants, alphabetical otherwise. Stop and dispose run it reversed.
 */
export function extensionStartOrder(manifests: Record<string, ManifestForResolution>, ids: string[]): string[] {
  const wanted = new Set(ids)
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (id: string, trail: string[]) => {
    if (seen.has(id) || !wanted.has(id)) return
    if (trail.includes(id)) return   // a cycle is already reported by the resolver; do not loop here
    for (const dep of manifests[id]?.requires?.extensions ?? []) visit(dependencyId(dep), [...trail, id])
    for (const dep of manifests[id]?.optional?.extensions ?? []) visit(dependencyId(dep), [...trail, id])
    seen.add(id)
    out.push(id)
  }
  for (const id of [...ids].sort()) visit(id, [])
  return out
}
