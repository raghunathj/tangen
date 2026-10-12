/**
 * File Name: services.ts
 * Purpose: Typed services between extensions (Extension Kernel K3.1,
 *          tasks/plan-extension-kernel.md). A provider offers
 *          `<its id>.<name>@<major>` from its running scope (usually from
 *          `onStart`, so the implementation closes over the provider's own
 *          ctx and therefore runs under the provider's authority); a consumer
 *          asks for `<ns>.<name>@<range>` and gets the implementation with
 *          its provenance, resolved by the semver engine extension
 *          dependencies use, among the ACTIVE providers of the scope. Rides
 *          on the contribution registry (point `services@1`): scope,
 *          withdrawal on stop, activity and reset come from there.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A provider may only fill its own namespace (`tangen.*`
 *          is the platform's), so two extensions can never offer the same
 *          id; the same extension offering one ref twice in a scope answers
 *          the first and warns. When the manifest declares `provides.services`,
 *          a runtime provide outside that list is refused: the declaration is
 *          what the activation resolver unblocks consumers on.
 */
import { parseServiceRef, isProvidedServiceRef, isRequiredServiceRef, serviceMajorSatisfies } from '@tangen/types'
import { contributions, contribute, noteContributionWarning, type ContributionsOptions } from './contributions'
import { getExtensionManifest, listExtensionServerIds } from '../hooks/app-hooks-registry'
import type { ActorIdentity, ExecutionContext } from '@tangen/types'

export { parseServiceRef } from '@tangen/types'

export const SERVICES_POINT = 'services@1'

/** One provided service, as contributed. */
export interface ProvidedService<T = unknown> {
  ref: string
  impl: T
}

/** A resolved service: the implementation and who provides it. */
export interface ResolvedService<T = unknown> {
  extensionId: string
  /** The provider's ref, `seo.service@1`. */
  ref: string
  impl: T
}

export type ServiceScope = Pick<ContributionsOptions, 'workspaceId' | 'activeIds' | 'isActive'>

/**
 * Offer a service from a running scope. The handle withdraws; the host
 * withdraws the scope's services when it stops.
 */
export function provideService<T>(extensionId: string, ref: string, impl: T, opts: { workspaceId?: string } = {}): () => void {
  const parsed = parseServiceRef(ref)
  if (!parsed || !isProvidedServiceRef(ref)) throw new Error(`A provided service is <your id>.<name>@<major>, e.g. ${extensionId}.service@1; got '${ref}'`)
  if (parsed.namespace !== extensionId) throw new Error(`Extension '${extensionId}' may only provide services in its own namespace: '${ref}' belongs to '${parsed.namespace}'`)
  const declared = getExtensionManifest(extensionId)?.provides?.services
  if (Array.isArray(declared) && !declared.includes(ref)) {
    throw new Error(`Extension '${extensionId}' provides '${ref}' but its manifest provides.services does not declare it (declared: ${declared.join(', ') || 'none'})`)
  }
  return contribute(extensionId, SERVICES_POINT, [{ ref, impl } satisfies ProvidedService<T>], opts)
}

function offered(scope: ServiceScope): ResolvedService[] {
  const out: ResolvedService[] = []
  const seen = new Set<string>()
  for (const c of contributions<ProvidedService>(SERVICES_POINT, scope)) {
    const item = c.item
    if (!item || typeof item !== 'object' || typeof item.ref !== 'string') {
      noteContributionWarning(`extension '${c.extensionId}' contributed a service without a ref to ${SERVICES_POINT}; dropped`)
      continue
    }
    const parsed = parseServiceRef(item.ref)
    if (!parsed || parsed.namespace !== c.extensionId) {
      noteContributionWarning(`extension '${c.extensionId}' offers '${item.ref}', which is not in its namespace; dropped`)
      continue
    }
    const key = `${c.extensionId}:${item.ref}`
    if (seen.has(key)) noteContributionWarning(`extension '${c.extensionId}' offers ${item.ref} twice in this scope; the first answers`)
    seen.add(key)
    out.push({ extensionId: c.extensionId, ref: item.ref, impl: item.impl })
  }
  return out
}

/** The service a consumer asked for (`seo.service@^1`), from the active providers of the scope; undefined when none satisfies. */
export function getService<T = unknown>(ref: string, scope: ServiceScope = {}): ResolvedService<T> | undefined {
  const want = parseServiceRef(ref)
  if (!want || !isRequiredServiceRef(ref)) throw new Error(`A required service is <namespace>.<name>@<range>, e.g. seo.service@^1; got '${ref}'`)
  for (const s of offered(scope)) {
    const p = parseServiceRef(s.ref)!
    if (p.id === want.id && serviceMajorSatisfies(p.version, want.version)) return s as ResolvedService<T>
  }
  return undefined
}

/** What a factory service receives per dispatch (K3.2): the execution to run in, a client bound to it when the host has one, and who asked. */
export interface ServiceDispatch {
  exec: ExecutionContext
  tangen?: unknown
  caller?: ActorIdentity | null
}

/**
 * The implementation to hand a consumer: a factory service is instantiated
 * for THIS dispatch (under provider ∩ caller when a caller is given, under
 * the provider's own execution otherwise); a plain object is the provider's
 * singleton and runs with whatever it closed over - the provider's ctx.
 */
export function instantiateService<T = unknown>(resolved: ResolvedService, dispatch: ServiceDispatch): T {
  const impl = resolved.impl
  return (typeof impl === 'function' ? (impl as (d: ServiceDispatch) => T)(dispatch) : impl) as T
}

/**
 * What `ctx.services.get(ref)` answers. A provider may offer its service as an
 * OBJECT or as a FACTORY, and both are idiomatic: a factory built from the
 * provider's own ctx (`() => createSheetsService(ctx)`) is how every pack
 * offers one, because that is what keeps the provider's authority the
 * provider's.
 *
 * `get` used to hand back the raw implementation, so a factory arrived at the
 * consumer as a FUNCTION and failed deep inside it - "service.query is not a
 * function", from SEO, four modules away from the cause (2026-09-20). A
 * zero-argument factory is therefore called here: the value a consumer asked
 * for is the value it gets.
 *
 * A factory that DECLARES a dispatch parameter needs the caller's execution,
 * which only `dispatch(ref, { as })` can supply, so asking for it through
 * `get` is refused by name rather than answered with something unusable.
 */
export function serviceValue<T = unknown>(resolved: ResolvedService): T {
  const impl = resolved.impl
  if (typeof impl !== 'function') return impl as T
  if ((impl as (...a: unknown[]) => unknown).length > 0) {
    throw new Error(
      `Service '${resolved.ref}' from '${resolved.extensionId}' is dispatch-scoped: its factory takes the caller's execution, `
      + `so read it with ctx.services.dispatch('${resolved.ref}', { as }) rather than ctx.services.get().`,
    )
  }
  return (impl as () => T)()
}

/** Required services of the active consumers that no active provider fulfils right now - for Doctor and the Admin. */
export function unfulfilledServices(scope: ServiceScope = {}): Array<{ extensionId: string; ref: string; reason: string }> {
  const out: Array<{ extensionId: string; ref: string; reason: string }> = []
  for (const extensionId of listExtensionServerIds()) {
    if (scope.activeIds && !scope.activeIds.has(extensionId)) continue
    if (scope.isActive && !scope.isActive(extensionId)) continue
    for (const ref of getExtensionManifest(extensionId)?.requires?.services ?? []) {
      const want = parseServiceRef(ref)
      if (!want) { out.push({ extensionId, ref, reason: 'not a valid service ref' }); continue }
      if (!isRequiredServiceRef(ref) || getService(ref, scope)) continue
      out.push({ extensionId, ref, reason: `no active provider offers ${want.id} in range ${want.version}` })
    }
  }
  return out
}

/** Every service offered in the scope (a diagnostic; duplicates included, as offered). */
export function listServices(scope: ServiceScope = {}): ResolvedService[] {
  return offered(scope)
}
