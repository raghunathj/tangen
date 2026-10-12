/**
 * File Name: contributions.ts
 * Purpose: The contribution registry (Extension Kernel K2.1,
 *          tasks/plan-extension-kernel.md): the one substrate under Flow
 *          nodes, MCP tools, search / Porter providers, webhook triggers and
 *          site identity - the formalisation of the "well-known key +
 *          registry()" idiom. A point is declared once (`<id>@<major>`,
 *          multiplicity, required grant); an extension contributes from its
 *          server entry (`contributions: { 'flow.actions@1': [...] }`, or the
 *          legacy key the point desugars, e.g. `flowActions`) or at runtime
 *          (`contribute`, withdrawn on stop); `contributions(point)` is the
 *          ONE reader: active contributors only, registration order, the
 *          contributor's own ctx lent alongside each item, a grants-declaring
 *          contributor without the point's grant skipped and warned, an
 *          unknown point refused rather than answered with an empty list.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Reads the extension registry; never imported by it
 *          (reset reaches here through `onExtensionRegistryReset`). Warnings
 *          are collected, deduplicated and readable (`contributionWarnings`)
 *          so a host can surface them; they are logged once each.
 */
import { compileGrants, grantNames } from '@tangen/types'
import { getLogger } from '@tangen/logging'
import { listExtensionServerIds, getExtensionServer, getExtensionManifest, onExtensionRegistryReset } from '../hooks/app-hooks-registry'

const log = () => getLogger(['tangen', 'api', 'contributions'])

export interface ContributionPointDef {
  /** `flow.actions`, `mcp.tools`, `acme.widgets` - namespaced by the owner. */
  id: string
  /** The point's major; a contribution targets exactly one. */
  version: number
  /** `multi`: an ordered list; `single`: one answers (the first active). */
  multiplicity: 'multi' | 'single'
  /** The facility grant a grants-declaring contributor must hold (`flow:contribute-nodes`). */
  grant?: string
  /** The well-known server-entry key this point desugars (`flowActions`); read as a contribution. */
  legacyKey?: string
  description?: string
}

export interface ContributionPoint extends ContributionPointDef {
  /** Who declared it: `tangen` for the built-ins, else the extension id. */
  owner: string
}

export interface Contribution<T = unknown> {
  extensionId: string
  item: T
  /** The contributor's OWN ctx for the scope, when the reader lends one - a host runs the item with it, never with its own. */
  ctx?: () => unknown | Promise<unknown>
}

export interface ContributionsOptions {
  /** The ids active in the scope; when given, only these contribute. */
  activeIds?: ReadonlySet<string>
  /** Synchronous activity check, when a set is not at hand. */
  isActive?: (extensionId: string) => boolean
  /** Lends a contributor its own ctx. */
  ctxFor?: (extensionId: string) => unknown | Promise<unknown>
  /** A contributor to leave out (a host reading everyone but itself). */
  except?: string
  /** The scope being read: runtime contributions made for this workspace join the unscoped ones; without it only unscoped items answer. */
  workspaceId?: string
}

/** The built-in points, each desugaring the well-known key extensions declare today. */
export const CORE_CONTRIBUTION_POINTS: readonly ContributionPointDef[] = [
  { id: 'flow.triggers', version: 1, multiplicity: 'multi', legacyKey: 'flowTriggers', grant: 'flow:contribute-nodes', description: 'Flow triggers a host (Flows) offers' },
  { id: 'flow.actions', version: 1, multiplicity: 'multi', legacyKey: 'flowActions', grant: 'flow:contribute-nodes', description: 'Flow actions, run with the contributor\'s ctx' },
  { id: 'flow.presets', version: 1, multiplicity: 'multi', legacyKey: 'flowPresets', grant: 'flow:contribute-nodes', description: 'Flow presets (plan-connectors D1): one-click integrations a host renders; Flows builds and owns the flow' },
  { id: 'mcp.tools', version: 1, multiplicity: 'multi', legacyKey: 'mcpTools', grant: 'mcp:contribute-tools', description: 'MCP tools, namespaced ext_<id>_<name>' },
  { id: 'search.providers', version: 1, multiplicity: 'multi', legacyKey: 'searchProviders', description: 'Search providers, run with the contributor\'s ctx' },
  { id: 'porter.providers', version: 1, multiplicity: 'multi', legacyKey: 'porterProviders', description: 'Porter providers' },
  { id: 'webhook.triggers', version: 1, multiplicity: 'multi', legacyKey: 'webhookTriggers', description: 'Outbound webhook trigger definitions' },
  { id: 'site.identity', version: 1, multiplicity: 'single', legacyKey: 'siteIdentity', description: 'The site identity provider (exactly one per workspace)' },
  { id: 'services', version: 1, multiplicity: 'multi', description: 'Typed services (K3): { ref: "<id>.<name>@<major>", impl }, resolved by kernel/services.ts' },
  { id: 'filters', version: 1, multiplicity: 'multi', legacyKey: 'filters', description: 'Filter registrations (K4): { point: "<id>@<range>", priority?, when?, transform }, run by kernel/filters.ts' },
  { id: 'connectors', version: 1, multiplicity: 'multi', grant: 'connections:contribute', description: 'Connector definitions (K6): how an outside service authenticates, which hosts it reaches, how a request is made; core owns the credentials' },
  { id: 'storage.provider', version: 1, multiplicity: 'multi', grant: 'storage:provide', description: 'Storage providers (K8.2): id, label, create(config) → StorageAdapter; core local and s3 are listed in the same shape' },
  { id: 'graphql.types', version: 1, multiplicity: 'multi', grant: 'graphql:contribute', description: 'GraphQL schema extensions (K8.4): { sdl, resolvers } - own types, Query/Mutation fields, computed fields on content types; resolvers run with the extension ctx bound to the caller' },
  { id: 'translation.provider', version: 1, multiplicity: 'multi', grant: 'translation:provide', description: 'Translation engines (K8.3): id, label, languages?, translate(texts, opts); core google and ai are listed in the same shape' },
  { id: 'ai.provider', version: 1, multiplicity: 'multi', grant: 'ai:provide', description: 'AI providers (K8.1): id, label, advertised capabilities (text/json/image/vision/embeddings) and models; core built-ins are listed in the same shape' },
]

const points = new Map<string, ContributionPoint>()
/** extension id -> handle -> { point, items, workspaceId? } */
const runtime = new Map<string, Map<symbol, { point: string; items: unknown[]; workspaceId?: string }>>()
const warnings = new Set<string>()
let ready = false
let generation = 0

/** Bumps on every runtime contribution, withdrawal and reset; compiled chains key on it. */
export function contributionsGeneration(): number { return generation }

/** Nothing runs at import (the lifecycle rule): the built-ins and the reset hook install on first use. */
function ensure(): void {
  if (ready) return
  ready = true
  for (const def of CORE_CONTRIBUTION_POINTS) declareCore(def)
  onExtensionRegistryReset(() => {
    generation++
    runtime.clear()
    warnings.clear()
    // Points an extension declared go with the registry; the built-ins stay.
    for (const [ref, p] of points) if (p.owner !== 'tangen') points.delete(ref)
  })
}

function declareCore(def: ContributionPointDef): void {
  points.set(refOf(def.id, def.version), { ...def, owner: 'tangen' })
}

const refOf = (id: string, version: number) => `${id}@${version}`

function warn(message: string): void {
  if (warnings.has(message)) return
  warnings.add(message)
  log().warn(message)
}

/** Declare a point. Idempotent for the same shape and owner; a different shape or owner under the same ref is refused. */
export function declareContributionPoint(def: ContributionPointDef, owner = 'tangen'): ContributionPoint {
  ensure()
  const ref = refOf(def.id, def.version)
  const existing = points.get(ref)
  const next: ContributionPoint = { ...def, owner }
  if (existing) {
    const same = existing.owner === owner && existing.multiplicity === def.multiplicity && existing.grant === def.grant && existing.legacyKey === def.legacyKey
    if (!same) throw new Error(`Contribution point ${ref} is already declared by '${existing.owner}' with a different shape`)
    return existing
  }
  points.set(ref, next)
  return next
}

/** Resolve `<id>@<major>`; undefined when not declared. */
export function contributionPoint(ref: string): ContributionPoint | undefined {
  ensure()
  return points.get(ref)
}

export function listContributionPoints(): ContributionPoint[] {
  ensure()
  return [...points.values()]
}

function resolve(ref: string): ContributionPoint {
  ensure()
  if (!/@\d+$/.test(ref)) throw new Error(`A contribution point is addressed with its major: '${ref}' → '${ref}@1'`)
  const point = points.get(ref)
  if (!point) throw new Error(`Unknown contribution point '${ref}'`)
  return point
}

/**
 * Contribute at runtime (from onStart); the handle withdraws. A contribution
 * made for a workspace (`ctx.contribute` passes the scope it starts in) is
 * seen by readers of that scope only, and the host withdraws it when the
 * scope stops; an unscoped one is seen everywhere. Everything is withdrawn
 * on registry reset.
 */
export function contribute(extensionId: string, ref: string, items: readonly unknown[], opts: { workspaceId?: string } = {}): () => void {
  resolve(ref)
  const handle = Symbol(ref)
  const mine = runtime.get(extensionId) ?? new Map()
  runtime.set(extensionId, mine)
  mine.set(handle, { point: ref, items: [...items], ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}) })
  generation++
  return () => { mine.delete(handle); generation++ }
}

/** Withdraw an extension's runtime contributions: one scope's, or all of them. */
export function withdrawContributions(extensionId: string, workspaceId?: string): void {
  ensure()
  generation++
  if (!workspaceId) { runtime.delete(extensionId); return }
  const mine = runtime.get(extensionId)
  if (!mine) return
  for (const [handle, entry] of mine) if (entry.workspaceId === workspaceId) mine.delete(handle)
}

/** Whether a contributor may fill a point: only with the point's grant declared (E.14: an undeclared extension holds nothing). */
function holdsGrant(extensionId: string, point: ContributionPoint): boolean {
  if (!point.grant) return true
  const required = getExtensionManifest(extensionId)?.grants?.required
  if (!Array.isArray(required)) return false
  const facilities = compileGrants(grantNames(required)).facilities
  const family = point.grant.split(':')[0]
  return facilities.has(point.grant) || facilities.has(`${family}:*`) || facilities.has(`${family}:any`)
}

function itemsOf(extensionId: string, point: ContributionPoint, ref: string, workspaceId?: string): unknown[] {
  const server = getExtensionServer(extensionId) as (Record<string, unknown> & { contributions?: Record<string, unknown> }) | undefined
  const out: unknown[] = []
  const push = (source: unknown) => {
    if (source === undefined || source === null) return
    const list = Array.isArray(source) ? source : [source]
    for (const item of list) {
      // An object, or a factory (site identity is `provider | (ctx) => provider`).
      if (item && (typeof item === 'object' || typeof item === 'function')) out.push(item)
      else warn(`extension '${extensionId}' contributed a non-object item to ${ref}; dropped`)
    }
  }
  if (point.legacyKey && server) push(server[point.legacyKey])
  if (server?.contributions && typeof server.contributions === 'object') push(server.contributions[ref])
  for (const entry of runtime.get(extensionId)?.values() ?? []) {
    if (entry.point !== ref) continue
    if (entry.workspaceId && entry.workspaceId !== workspaceId) continue
    push(entry.items)
  }
  return out
}

/** The one reader. Active contributors in registration order, each item with its contributor and (when lent) its ctx. */
export function contributions<T = unknown>(ref: string, opts: ContributionsOptions = {}): Contribution<T>[] {
  const point = resolve(ref)
  const out: Contribution<T>[] = []
  for (const extensionId of listExtensionServerIds()) {
    if (opts.except && extensionId === opts.except) continue
    if (opts.activeIds && !opts.activeIds.has(extensionId)) continue
    if (opts.isActive && !opts.isActive(extensionId)) continue
    const items = itemsOf(extensionId, point, ref, opts.workspaceId)
    if (items.length === 0) continue
    if (!holdsGrant(extensionId, point)) {
      warn(`extension '${extensionId}' contributes to ${ref} without the ${point.grant} grant; its contributions are ignored`)
      continue
    }
    const ctx = opts.ctxFor ? () => opts.ctxFor!(extensionId) : undefined
    for (const item of items) out.push({ extensionId, item: item as T, ...(ctx ? { ctx } : {}) })
  }
  if (point.multiplicity === 'single' && out.length > 1) {
    warn(`contribution point ${ref} is single but ${out.map((c) => `'${c.extensionId}'`).join(', ')} all offer one; '${out[0]!.extensionId}' answers`)
  }
  return out
}

/** A `single` point's answer: the first active contribution, or undefined. */
export function contributionOf<T = unknown>(ref: string, opts: ContributionsOptions = {}): Contribution<T> | undefined {
  const point = resolve(ref)
  if (point.multiplicity !== 'single') return undefined
  return contributions<T>(ref, opts)[0]
}

/** Raise a warning through the registry's channel (deduplicated, logged once); for the modules built on the registry. */
export function noteContributionWarning(message: string): void {
  ensure()
  warn(message)
}

/** Every warning raised so far (deduplicated), for a host or Doctor to surface. */
export function contributionWarnings(): string[] {
  ensure()
  return [...warnings]
}
