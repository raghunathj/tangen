/**
 * File Name: capability-descriptor.ts
 * Purpose: One server-owned answer to "what can this workspace and
 *          environment do" (closure plan Phase 8A, Units 2-7). Admin used to
 *          assemble that from four endpoints and three client caches; this
 *          reads the Phase 3 runtime registry and the Phase 4 extension
 *          state and rediscovers nothing.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure over its inputs - the registry snapshot and the
 *          extension state views are passed in, so the mapping is testable
 *          without a server. The three states are kept apart on purpose:
 *          `off` is a choice an operator can reverse, `unavailable` is a
 *          condition they cannot. An extension enabled in the database whose
 *          code this process has not loaded is `unavailable`, never `on` -
 *          the honest reading of the cross-process residual Phase 4 left.
 */
import type { CapabilityState, CapabilityKind } from '../runtime/registry'
import type { ExtensionStateView } from '../runtime/extensions'

export type CapabilityStateName = 'on' | 'off' | 'unavailable'

export type CapabilityReasonCode =
  | 'NOT_COMPOSED'
  | 'DEPENDENCY_MISSING'
  | 'NOT_REQUIRED'
  | 'NOT_INSTALLED'
  | 'DISABLED'
  | 'DEPENDENCY_UNSATISFIED'
  | 'NOT_LOADED_IN_PROCESS'
  | 'FAILED'

export interface CapabilityReason {
  code: CapabilityReasonCode
  /** One sentence for an operator. Never a stack, a path, a driver message or a secret. */
  message: string
}

export interface CapabilityDescriptor {
  /** Stable machine id. Extensions use `ext:<id>`; nothing uses a display label. */
  id: string
  label: string
  kind: CapabilityKind
  state: CapabilityStateName
  reason?: CapabilityReason
  /** Extensions: the version of the code this process loaded. Absent otherwise. */
  version?: string
  /** Data-only navigation metadata. Never a component. */
  nav?: { section?: string; order?: number }
  /** Where this capability is managed, and whether that page is usable now. */
  settings?: { href: string; usable: boolean }
}

/** `ext:<id>` - the Phase 4 scheme, kept. */
export const EXTENSION_CAPABILITY_PREFIX = 'ext:'
export const extensionCapabilityId = (id: string): string => `${EXTENSION_CAPABILITY_PREFIX}${id}`

/**
 * Where a capability is managed in Admin. Management pages stay reachable
 * when a capability is off or unavailable - hiding them would hide the way
 * back - so this maps id to page rather than to feature.
 */
const SETTINGS_HREF: Record<string, string> = {
  media: 'settings/media',
  search: 'settings/search',
  mail: 'settings/mail',
  knowledge: 'ai/knowledge',
  ai: 'settings/ai',
  mcp: 'ai/agents',
  realtime: 'settings/realtime',
  graphql: 'devspace/playground',
}

/** The sidebar section a capability contributes to, when it contributes at all. */
const NAV_SECTION: Record<string, string> = {
  knowledge: 'AI',
  ai: 'AI',
  mcp: 'AI',
  search: 'Content',
  media: 'Content',
  realtime: 'Workspace',
  graphql: 'Devspace',
}

function coreState(s: CapabilityState): { state: CapabilityStateName; reason?: CapabilityReason } {
  // A composition that never included it is not something Admin can switch on.
  if (!s.enabled) {
    return { state: 'unavailable', reason: { code: 'NOT_COMPOSED', message: `${s.label} is not part of this server build.` } }
  }
  if (s.error) {
    return { state: 'unavailable', reason: { code: 'FAILED', message: s.error } }
  }
  // The registry evaluates availability at START; before that it is null,
  // which means "nothing has said it cannot run".
  if (s.availability && s.availability.available === false) {
    return { state: 'unavailable', reason: { code: 'DEPENDENCY_MISSING', message: s.availability.reason } }
  }
  if (s.required === false) {
    return { state: 'off', reason: { code: 'NOT_REQUIRED', message: `${s.label} is switched off for this environment.` } }
  }
  return { state: 'on' }
}

function extensionState(v: ExtensionStateView): { state: CapabilityStateName; reason?: CapabilityReason } {
  if (!v.installed) {
    return { state: 'off', reason: { code: 'NOT_INSTALLED', message: `${v.name} is not installed in this environment.` } }
  }
  if (!v.enabled) {
    return { state: 'off', reason: { code: 'DISABLED', message: `${v.name} is installed here and switched off.` } }
  }
  if (!v.registered) {
    // Enabled in the database, code not loaded in THIS process: the Phase 4
    // cross-process residual, told honestly rather than reported as on.
    return {
      state: 'unavailable',
      reason: { code: 'NOT_LOADED_IN_PROCESS', message: `${v.name} is enabled here, but this server has not loaded its code. Restart the server to pick it up.` },
    }
  }
  if (v.runtime?.availability && v.runtime.availability.available === false) {
    return { state: 'unavailable', reason: { code: 'DEPENDENCY_MISSING', message: v.runtime.availability.reason } }
  }
  if (!v.activation.active) {
    return {
      state: 'unavailable',
      reason: { code: 'DEPENDENCY_UNSATISFIED', message: v.reason ?? `${v.name} cannot run here: something it requires is not active.` },
    }
  }
  if (v.runtime?.error) {
    return { state: 'unavailable', reason: { code: 'FAILED', message: v.runtime.error } }
  }
  return { state: 'on' }
}

/**
 * A capability is no better off than what it depends on. `coreState` answers
 * for one capability in isolation; this walks the declared dependencies so
 * that knowledge with no AI key reads UNAVAILABLE rather than `on`, and says
 * which dependency and why. A dependency this process does not have is
 * ignored - the registry refuses an unknown dependency at START, and a
 * descriptor is not the place to invent a state for one.
 */
function resolveCoreStates(core: CapabilityState[]): Map<string, { state: CapabilityStateName; reason?: CapabilityReason }> {
  const byId = new Map(core.map((s) => [s.id, s]))
  const out = new Map(core.map((s) => [s.id, coreState(s)]))
  const settled = new Set<string>()

  const settle = (id: string, trail: readonly string[]): void => {
    if (settled.has(id) || trail.includes(id)) return
    settled.add(id)
    const s = byId.get(id)
    if (!s) return
    const own = out.get(id)!
    if (own.state !== 'on') return
    for (const depId of s.dependsOn) {
      const dep = byId.get(depId)
      if (!dep) continue
      settle(depId, [...trail, id])
      const depState = out.get(depId)!
      if (depState.state === 'on') continue
      out.set(id, {
        state: depState.state,
        reason: {
          code: 'DEPENDENCY_UNSATISFIED',
          message: `${s.label} needs ${dep.label}, which is ${depState.state}${depState.reason ? `: ${depState.reason.message}` : '.'}`,
        },
      })
      return
    }
  }

  for (const s of core) settle(s.id, [])
  return out
}

export interface DescriptorInput {
  /** The process registry's snapshot. Extension capabilities (`ext:`) are read from `extensions` instead. */
  registry: CapabilityState[]
  /** One workspace x environment's extension state (Phase 4). */
  extensions: ExtensionStateView[]
}

/**
 * The capability descriptors for one workspace and environment, ordered by
 * id so two identical states serialize identically.
 */
export function capabilityDescriptors(input: DescriptorInput): CapabilityDescriptor[] {
  const out: CapabilityDescriptor[] = []

  const core = input.registry.filter((s) => !s.id.startsWith(EXTENSION_CAPABILITY_PREFIX))
  const resolved = resolveCoreStates(core)

  for (const s of core) {
    const { state, reason } = resolved.get(s.id)!
    out.push({
      id: s.id,
      label: s.label,
      kind: s.kind,
      state,
      ...(reason ? { reason } : {}),
      ...(NAV_SECTION[s.id] ? { nav: { section: NAV_SECTION[s.id] } } : {}),
      ...(SETTINGS_HREF[s.id] ? { settings: { href: SETTINGS_HREF[s.id]!, usable: state !== 'unavailable' } } : {}),
    })
  }

  for (const v of input.extensions) {
    const { state, reason } = extensionState(v)
    out.push({
      id: extensionCapabilityId(v.id),
      label: v.name,
      kind: 'extension',
      state,
      ...(reason ? { reason } : {}),
      ...(v.version ? { version: v.version } : {}),
      nav: { section: 'Extensions' },
      // The extensions list is management UI: it stays reachable in every
      // state, because it is where an operator installs or enables one.
      settings: { href: `extensions/${v.id}`, usable: true },
    })
  }

  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Ids declared more than once - the collision the Admin must never have to resolve. */
export function duplicateCapabilityIds(descriptors: CapabilityDescriptor[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const d of descriptors) {
    if (seen.has(d.id)) dupes.add(d.id)
    seen.add(d.id)
  }
  return [...dupes].sort()
}
