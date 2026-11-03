/**
 * File Name: use-capabilities.ts
 * Purpose: The admin UI's ONE source of capability truth (closure plan Phase
 *          8A, Units 9 and 10). Admin used to assemble this from four
 *          endpoints and three module-level caches keyed by environment
 *          alone, which meant two workspaces sharing an env slug shared the
 *          answer. The server now sends it; this reads it, once per
 *          workspace x environment.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: zustand, the same store shape use-can.ts uses - no new
 *          state library. Capability state is NOT a permission: a surface
 *          needs `capabilityAllows AND permissionAllows`, and the two are
 *          asked separately on purpose.
 */
import { create } from 'zustand'
import { useEffect } from 'react'
import { adminFetch } from './api'
import { validateRichtextNodes, type ExtensionRichtextNode } from '@tangen/types'

export type CapabilityState = 'on' | 'off' | 'unavailable'

export interface CapabilityReason {
  code: string
  message: string
}

export interface CapabilityDescriptor {
  id: string
  label: string
  kind: 'core' | 'optional' | 'demand' | 'extension'
  state: CapabilityState
  reason?: CapabilityReason
  version?: string
  nav?: { section?: string; order?: number }
  settings?: { href: string; usable: boolean }
}

/** What a caller learns about one capability, loading and failure included. */
export type CapabilityStatus = CapabilityState | 'loading' | 'unknown'

interface Scope { workspaceId: string }
const keyOf = (s: Scope) => s.workspaceId

/**
 * The non-capability flags the same bootstrap response carries: a
 * presentation preference, an environment-role rule, and two per-scope
 * configuration switches. They are NOT capabilities - they have no registry
 * entry and no on/off/unavailable semantics - but they arrive on the same
 * read, so they are stored with it rather than fetched three more times.
 */
export interface BootstrapFlags {
  recents: boolean
  /** admin.nav.content: the generic Content nav section. Default ON. */
  content: boolean
  schemaWritable: boolean
  queryMonitorEnabled: boolean
  graphqlEnabled: boolean
  /** The role of the deployment this Admin talks to; shown, never chosen. */
  deploymentRole: 'development' | 'staging' | 'production' | null
  /** admin.nav.links: what the Settings tree shows under "Other". */
  links: NavLinks
  /**
   * The richtext nodes this workspace's active, granted extensions declare,
   * highest priority first. Only the CONTRIBUTIONS: the built-in vocabulary is
   * bundled, so an empty list is the ordinary case and costs nothing.
   */
  richtextNodes: RichtextContribution[]
}

/** One contributed node, exactly as its extension declared it. */
export type RichtextContribution = ExtensionRichtextNode & { name: string }

/** `<extensionId>.<name>`, which is what the server namespaces a node to. */
const NAMESPACED = /^[a-zA-Z][a-zA-Z0-9-]*\.[a-zA-Z][a-zA-Z0-9]*$/

/**
 * A declaration list is only usable if it is WHOLE. `validateRichtextNodes` is
 * the same check the server ran before sending it, so a response that fails it
 * means something is wrong with the response, and a half-trusted list would
 * compile into a schema that throws and blank the editor for every field.
 *
 * The names are checked twice and deliberately. On the wire a name is
 * `acme.callout`, which the shared validator REFUSES - it validates a
 * declaration as an extension author wrote it, where the name is camelCase and
 * the namespace has not been applied yet. So the namespace is checked here and
 * stripped before the shared rules run, rather than loosening a rule that the
 * extension review depends on. Getting this wrong dropped every contribution
 * silently, and the browser lane is what caught it.
 */
export function richtextNodesOf(raw: unknown): RichtextContribution[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const list = raw as RichtextContribution[]
  if (!list.every((n) => typeof n?.name === 'string' && NAMESPACED.test(n.name))) return []
  const asDeclared = list.map((n) => ({ ...n, name: n.name.slice(n.name.indexOf('.') + 1) }))
  return validateRichtextNodes(asDeclared).length === 0 ? list : []
}

export interface NavLinks { support?: string; docs?: string }

function linksOf(raw: unknown): NavLinks {
  if (!raw || typeof raw !== 'object') return {}
  const out: NavLinks = {}
  for (const key of ['support', 'docs'] as const) {
    const v = (raw as Record<string, unknown>)[key]
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) out[key] = v
  }
  return out
}

// `content` defaults true here too: a failed or not-yet-loaded bootstrap
// read must not hide a core nav section - unlike `recents` (opt-in, safe
// off), losing the read should never look like "every type was hidden".
const NO_FLAGS: BootstrapFlags = { recents: false, content: true, schemaWritable: false, queryMonitorEnabled: false, graphqlEnabled: false, deploymentRole: null, links: {}, richtextNodes: [] }

interface CapabilityStoreState {
  /** Descriptors by workspace. */
  byScope: Record<string, CapabilityDescriptor[]>
  /** The same response's flags, by the same key. */
  flagsByScope: Record<string, BootstrapFlags>
  loading: Record<string, boolean>
  /** True when the bootstrap read failed for that scope - distinct from "everything is off". */
  failed: Record<string, boolean>
  load: (scope: Scope) => Promise<void>
  /** Forget a scope (or everything) after a lifecycle change. */
  invalidate: (scope?: Scope) => void
}

export const useCapabilityStore = create<CapabilityStoreState>((set, get) => ({
  byScope: {},
  flagsByScope: {},
  loading: {},
  failed: {},
  async load(scope) {
    const key = keyOf(scope)
    if (get().byScope[key] !== undefined || get().loading[key]) return
    set((s) => ({ loading: { ...s.loading, [key]: true } }))
    try {
      const res = await adminFetch<{ data: Partial<BootstrapFlags> & { capabilities?: CapabilityDescriptor[] } }>('/admin/ui-config')
      const d = res?.data ?? {}
      set((s) => ({
        byScope: { ...s.byScope, [key]: d.capabilities ?? [] },
        flagsByScope: {
          ...s.flagsByScope,
          [key]: {
            recents: d.recents === true,
            content: d.content !== false,
            schemaWritable: d.schemaWritable === true,
            queryMonitorEnabled: d.queryMonitorEnabled === true,
            graphqlEnabled: d.graphqlEnabled === true,
            deploymentRole: d.deploymentRole === 'development' || d.deploymentRole === 'staging' || d.deploymentRole === 'production' ? d.deploymentRole : null,
            links: linksOf((d as { links?: unknown }).links),
            richtextNodes: richtextNodesOf((d as { richtextNodes?: unknown }).richtextNodes),
          },
        },
        loading: { ...s.loading, [key]: false },
        failed: { ...s.failed, [key]: false },
      }))
    } catch {
      // A failed read is a FAILED read - not "every capability is off". The
      // guard shows an error state; it does not hide half the application.
      set((s) => ({
        byScope: { ...s.byScope, [key]: [] },
        flagsByScope: { ...s.flagsByScope, [key]: NO_FLAGS },
        loading: { ...s.loading, [key]: false },
        failed: { ...s.failed, [key]: true },
      }))
    }
  },
  invalidate(scope) {
    if (!scope) { set({ byScope: {}, flagsByScope: {}, loading: {}, failed: {} }); return }
    const key = keyOf(scope)
    set((s) => {
      const { [key]: _a, ...byScope } = s.byScope
      const { [key]: _b, ...loading } = s.loading
      const { [key]: _c, ...failed } = s.failed
      const { [key]: _d, ...flagsByScope } = s.flagsByScope
      return { byScope, flagsByScope, loading, failed }
    })
  },
}))

export interface Capabilities {
  /** Every descriptor for this scope, ordered by id. Empty while loading. */
  all: CapabilityDescriptor[]
  loading: boolean
  /** The bootstrap read failed: show an error, never an empty application. */
  failed: boolean
  /** One capability, or undefined when this server does not know the id. */
  get: (id: string) => CapabilityDescriptor | undefined
  /** `on` / `off` / `unavailable`, plus `loading` and `unknown`, never collapsed. */
  status: (id: string) => CapabilityStatus
  /** True only when the capability is usable right now. */
  isOn: (id: string) => boolean
  /** The bootstrap's non-capability flags. Defaults are the safe ones until it loads. */
  flags: BootstrapFlags
}

/** The capabilities of one workspace on this deployment. */
export function useCapabilities(workspaceId: string | undefined): Capabilities {
  const store = useCapabilityStore()
  const scope = workspaceId ? { workspaceId } : null
  const key = scope ? keyOf(scope) : ''

  useEffect(() => {
    if (scope) void store.load(scope)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const all = store.byScope[key] ?? []
  const loading = !scope || store.loading[key] === true || store.byScope[key] === undefined
  const failed = store.failed[key] === true

  const get = (id: string) => all.find((c) => c.id === id)
  const status = (id: string): CapabilityStatus => {
    if (loading) return 'loading'
    const found = get(id)
    return found ? found.state : 'unknown'
  }
  return { all, loading, failed, get, status, isOn: (id) => status(id) === 'on', flags: store.flagsByScope[key] ?? NO_FLAGS }
}

/** `ext:<id>` - the same id the server uses. Admin invents no second naming. */
export const extensionCapabilityId = (extensionId: string): string => `ext:${extensionId}`
