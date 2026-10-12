/**
 * File Name: extension-review.ts
 * Purpose: The grant review engine (Extension Kernel K5.1,
 *          tasks/plan-extension-kernel.md; proposal F.1-F.3). One pure
 *          function turns a manifest's grants into the review every surface
 *          renders identically - the CLI at install, `inspect`, the Admin's
 *          Extensions → Permissions, a marketplace listing, an upgrade
 *          re-review: each grant with its sensitivity tier, the publisher's
 *          reason and the platform's own explanation; an explicit "cannot"
 *          list built from what is absent; the privileged tier blocked for a
 *          marketplace install; what an upgrade adds and removes against the
 *          previous approval. `decideGrants` then records what is granted
 *          and what is denied. No single risk score: warnings attach to grants.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { compileGrants, isPrivilegedGrant } from './extension-grants'
import type { TangenExtensionManifest, ExtensionGrantItem } from './extension'

export type GrantTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'PRIVILEGED'

export interface ReviewedGrant {
  grant: string
  tier: GrantTier
  /** The publisher's reason, from the manifest. */
  reason?: string
  /** The platform's own words for what the grant allows. */
  explanation: string
  optional: boolean
  /** An optional grant's feature, from the manifest (`enables`). */
  enables?: string
  /** Held under the previous approval (an upgrade re-review). */
  previouslyGranted: boolean
  blocked: boolean
}

export interface GrantReview {
  extensionId: string
  version: string
  required: ReviewedGrant[]
  optional: ReviewedGrant[]
  /** What the extension cannot do with these grants. */
  cannot: string[]
  /** Privileged grants a marketplace install can never approve; a required one refuses the install. */
  blocked: string[]
  /** Grants the kernel does not know. */
  unknown: string[]
  /** Publisher-facing: MEDIUM and HIGH grants without a reason. */
  warnings: string[]
  /** Against `previouslyGranted`: new grants this version asks for, and grants it no longer asks for (auto-revoked). */
  added: string[]
  removed: string[]
  /** Whether an operator has anything new to decide (a new grant, required or optional). */
  needsReview: boolean
  /** Whether activation must wait: a new REQUIRED grant nobody approved yet (F.3). New optional grants never block. */
  blocksActivation: boolean
}

export interface ReviewOptions {
  /** `marketplace`: the privileged tier is blocked; `trusted`: first-party or self-hosted, everything may be approved. */
  trust: 'marketplace' | 'trusted'
  /** The grants recorded at the previous install or upgrade. */
  previouslyGranted?: readonly string[]
}

/** The names of a grants list, whatever the items' shape. */
export function grantNames(items: ReadonlyArray<ExtensionGrantItem> | undefined | null): string[] {
  if (!Array.isArray(items)) return []
  return items.map((i) => (typeof i === 'string' ? i : i?.grant)).filter((g): g is string => typeof g === 'string' && g.length > 0)
}

/** The reasons (and features) the publisher attached, by grant. */
export function grantReasons(items: ReadonlyArray<ExtensionGrantItem> | undefined | null): Record<string, { reason?: string; enables?: string }> {
  const out: Record<string, { reason?: string; enables?: string }> = {}
  for (const i of items ?? []) {
    if (typeof i === 'string' || !i?.grant) continue
    if (i.reason || i.enables) out[i.grant] = { ...(i.reason ? { reason: i.reason } : {}), ...(i.enables ? { enables: i.enables } : {}) }
  }
  return out
}

const parts = (grant: string) => {
  const [family, ...rest] = grant.split(':')
  return { family: family ?? '', verb: rest.join(':') }
}

/** Sensitivity: own scope LOW, reads and AI MEDIUM, writes, network and connections HIGH, the trusted-only tier PRIVILEGED. */
export function tierOf(grant: string): GrantTier {
  if (isPrivilegedGrant(grant)) return 'PRIVILEGED'
  const { family, verb } = parts(grant)
  const head = verb.split(':')[0] ?? ''
  switch (family) {
    case 'content': return head === 'read' ? 'MEDIUM' : 'HIGH'
    case 'media': case 'globals': case 'webhooks': return head === 'read' ? 'MEDIUM' : 'HIGH'
    case 'search': case 'tables': case 'schema': return 'MEDIUM'
    case 'network': case 'connections': case 'delegation': case 'events': case 'hooks': return 'HIGH'
    case 'secrets': return verb === 'own' ? 'LOW' : 'HIGH'
    case 'ai': case 'capability': case 'filters': case 'flow': case 'mcp': case 'interceptors': return 'MEDIUM'
    case 'db': case 'jobs': case 'admin': case 'store': case 'realtime': case 'telemetry': case 'locales': case 'mail': case 'routes': return 'LOW'
    default: return 'MEDIUM'
  }
}

const list = (items: string[]) => items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

function scopes(verb: string): { head: string; types?: string[]; fields?: string[]; names?: string[] } {
  const segs = verb.split(':')
  const out: { head: string; types?: string[]; fields?: string[]; names?: string[] } = { head: segs[0] ?? '' }
  for (const s of segs.slice(1)) {
    const m = /^([a-z]+)\((.*)\)$/.exec(s)
    if (!m) { if (s === 'draft') out.head = 'read:draft'; continue }
    const args = m[2]!.split(',').map((x) => x.trim()).filter(Boolean)
    if (m[1] === 'types') out.types = args
    else if (m[1] === 'fields') out.fields = args
    else out.names = args
  }
  return out
}

/** The platform's own words for a grant. Unknown grants come back as they are. */
export function explainGrant(grant: string): string {
  const { family, verb } = parts(grant)
  const s = scopes(verb)
  const what = (base: string) => `${base}${s.types ? ` ${list(s.types)} content` : ' content'}${s.fields ? `, fields ${list(s.fields)} only` : ''}`
  switch (family) {
    case 'content':
      if (s.head === 'read') return s.types ? `Read published ${list(s.types)} content` : 'Read published content'
      if (s.head === 'read:draft') return s.types ? `Read draft ${list(s.types)} content` : 'Read draft content'
      if (s.head === 'create') return what('Create')
      if (s.head === 'update') return what('Update')
      if (s.head === 'publish') return what('Publish')
      if (s.head === 'delete') return what('Delete')
      return grant
    case 'media': return s.head === 'read' ? 'Read media' : s.head === 'write' ? 'Upload and change media' : s.head === 'delete' ? 'Delete media' : grant
    case 'globals': return s.head === 'read' ? `Read ${s.names ? `the ${list(s.names)} global${s.names.length > 1 ? 's' : ''}` : 'globals'}` : s.head === 'write' ? `Change ${s.names ? `the ${list(s.names)} global${s.names.length > 1 ? 's' : ''}` : 'globals'}` : grant
    case 'search': return 'Search content'
    case 'webhooks': return s.head === 'read' ? 'Read webhooks' : s.head === 'write' ? 'Create and change webhooks' : 'Delete webhooks'
    case 'tables': return 'Read custom tables'
    case 'schema': return s.head === 'push' ? 'Change your content schema' : 'Read your content schema'
    case 'locales': return verb === 'all' ? 'Write every locale' : `Write the ${list(verb.split(',').map((x) => x.trim()))} locale${verb.includes(',') ? 's' : ''}`
    case 'capability': return `Hold the ${verb} capability`
    case 'db': return verb === 'own' ? 'Use its own database tables' : verb === 'platform' ? "Use the platform's database directly" : grant
    case 'network':
      if (verb === 'any') return 'Reach any host over HTTP'
      if (verb === 'private') return 'Reach private and internal addresses over HTTP'
      if (verb.startsWith('*.')) return `Reach every subdomain of ${verb.slice(2)} over HTTP`
      return `Reach ${verb} over HTTP`
    case 'secrets': return verb === 'own' ? 'Read its own secrets' : verb === 'any' ? 'Read every platform secret' : `Read the platform secret ${verb}`
    case 'connections': return `Use the ${verb} connection`
    case 'ai': return verb === 'generate' ? 'Generate text with your AI provider' : verb === '*' || verb === 'any' ? 'Use your AI provider' : `Use your AI provider (${verb})`
    case 'jobs': return 'Queue background jobs'
    case 'events': return 'Emit events'
    case 'admin': return 'Adds pages, panels or widgets to the Admin'
    case 'filters': return verb === '*' ? 'Transform any filter point' : `Transform ${verb} filter points`
    case 'flow': return 'Contribute Flow triggers and actions'
    case 'mcp': return 'Contribute MCP tools'
    case 'delegation': return 'Act as another recorded user, key or identity'
    case 'interceptors': return verb === 'platform' ? "Intercept the platform's own requests" : 'Intercept its own requests'
    case 'store': return 'Use its own key-value storage'
    case 'realtime': return 'Publish realtime events'
    case 'telemetry': return 'Read telemetry'
    case 'mail': return 'Send mail'
    case 'routes': return 'Serve its own routes'
    default: return grant
  }
}

/** What the grants do NOT allow - stated from what is absent, so the list is honest for exactly these grants. */
export function cannotList(grants: readonly string[]): string[] {
  const c = compileGrants(grants)
  const actions = new Set<string>([...(c.bundle.objects?.actions ?? []), ...Object.values(c.bundle.objects?.types ?? {}).flat()])
  const fac = c.facilities
  const has = (g: string) => fac.has(g)
  const out: string[] = []
  if (!actions.has('read_draft')) out.push('read draft content')
  if (!actions.has('write')) out.push('create content')
  else if (!c.bundle.objects?.actions?.includes('write')) out.push('create content outside its declared types')
  if (!actions.has('publish')) out.push('publish content')
  if (!actions.has('delete')) out.push('delete content')
  if (!c.bundle.media?.actions.includes('write')) out.push('upload or change media')
  if (!c.bundle.schema?.actions.includes('push')) out.push('change your schema')
  if (!has('db:platform')) out.push("use the platform's database")
  if (!has('network:any')) out.push([...fac].some((g) => g.startsWith('network:')) ? 'reach other hosts' : 'reach any host')
  if (!has('secrets:any')) out.push('read your platform secrets')
  if (!has('delegation:act-as')) out.push('act as another user')
  out.push('run with administrator authority')
  return out
}

/** The review every surface renders. */
export function reviewGrants(manifest: Pick<TangenExtensionManifest, 'id' | 'version' | 'grants'>, opts: ReviewOptions): GrantReview {
  const requiredItems = manifest.grants?.required ?? []
  const optionalItems = manifest.grants?.optional ?? []
  const reasons = { ...grantReasons(requiredItems), ...grantReasons(optionalItems) }
  const previous = new Set(opts.previouslyGranted ?? [])
  const known = (g: string) => compileGrants([g]).unknown.length === 0
  const review = (grant: string, optional: boolean): ReviewedGrant => {
    const tier = tierOf(grant)
    return {
      grant, tier, optional,
      ...(reasons[grant]?.reason ? { reason: reasons[grant]!.reason } : {}),
      ...(reasons[grant]?.enables ? { enables: reasons[grant]!.enables } : {}),
      explanation: explainGrant(grant),
      previouslyGranted: previous.has(grant),
      blocked: opts.trust === 'marketplace' && tier === 'PRIVILEGED',
    }
  }
  const requiredNames = grantNames(requiredItems).filter(known)
  const optionalNames = grantNames(optionalItems).filter(known)
  const unknown = [...grantNames(requiredItems), ...grantNames(optionalItems)].filter((g) => !known(g))
  const required = requiredNames.map((g) => review(g, false))
  const optional = optionalNames.map((g) => review(g, true))
  const all = [...required, ...optional]
  const asked = new Set(all.map((g) => g.grant))
  return {
    extensionId: manifest.id,
    version: manifest.version,
    required, optional,
    cannot: cannotList([...requiredNames, ...optionalNames]),
    blocked: all.filter((g) => g.blocked).map((g) => g.grant),
    unknown,
    warnings: all.filter((g) => (g.tier === 'MEDIUM' || g.tier === 'HIGH') && !g.reason).map((g) => `${g.grant} has no reason`),
    added: opts.previouslyGranted ? all.filter((g) => !previous.has(g.grant)).map((g) => g.grant) : [],
    removed: opts.previouslyGranted ? [...previous].filter((g) => !asked.has(g)) : [],
    needsReview: opts.previouslyGranted ? all.some((g) => !previous.has(g.grant)) : true,
    blocksActivation: opts.previouslyGranted ? required.some((g) => !previous.has(g.grant)) : true,
  }
}

export interface GrantDecision {
  ok: boolean
  granted: string[]
  denied: string[]
  /** Required grants that cannot be approved here; the install is refused when any exists. */
  refused: string[]
}

/**
 * Record a decision: every required grant is granted (a blocked one refuses
 * the install); optional grants follow the operator - `true` all, `false`
 * none, a list, or `'keep'` (what the previous approval granted stays).
 */
export function decideGrants(review: GrantReview, choice: { optional: boolean | readonly string[] | 'keep' }): GrantDecision {
  const refused = review.required.filter((g) => g.blocked).map((g) => g.grant)
  if (refused.length) return { ok: false, granted: [], denied: [], refused }
  const approvedOptional = (g: ReviewedGrant): boolean => {
    if (g.blocked) return false
    if (choice.optional === true) return true
    if (choice.optional === false) return false
    if (choice.optional === 'keep') return g.previouslyGranted
    return choice.optional.includes(g.grant)
  }
  const granted = [...review.required.map((g) => g.grant), ...review.optional.filter(approvedOptional).map((g) => g.grant)]
  const denied = review.optional.filter((g) => !approvedOptional(g)).map((g) => g.grant)
  return { ok: true, granted, denied, refused: [] }
}
