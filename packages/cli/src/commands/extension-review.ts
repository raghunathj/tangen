/**
 * File Name: extension-review.ts
 * Purpose: The grant review as the CLI renders and decides it (Extension
 *          Kernel K5.2b, tasks/plan-extension-kernel.md; proposal F.1-F.3).
 *          `renderGrantReview` prints the one review every surface shares -
 *          grouped by tier, each grant with the publisher's reason and the
 *          platform's explanation, optional grants marked with the feature
 *          they enable, the explicit "cannot" list, and on an upgrade what
 *          is new and what is no longer requested. `reviewAndDecide` runs it
 *          for an install or an upgrade: a package from a registry is a
 *          marketplace install (the privileged tier is refused), the
 *          project's own code is trusted; in a terminal it asks, outside one
 *          it needs `--yes`; the decision is what the installation records.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { reviewGrants, decideGrants, grantNames, evaluateGrantPolicy, validateGrantPolicy, type GrantPolicy, type GrantReview, type ReviewedGrant, type TangenExtensionManifest } from '@tangen/types'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface ReviewCliOptions {
  /** Accept the review non-interactively: required grants approved, optional ones per `approveOptional` (all when unset). */
  yes?: boolean
  /** Which optional grants to approve: a list, `'all'`, or `'none'`. Default with `--yes`: all. */
  approveOptional?: readonly string[] | 'all' | 'none'
  /** Whether stdin is a terminal; default `process.stdin.isTTY`. */
  interactive?: boolean
  /** Asks a yes/no question in a terminal; default reads stdin. */
  ask?: (question: string, defaultYes: boolean) => Promise<boolean>
  /** The CI form: the approved set is exactly this list - a required grant outside it refuses, an optional one outside it is denied. Implies non-interactive. */
  approveGrants?: readonly string[]
  /** The project's grant policy (`tangen.policy.ts`); deny wins, an allow list refuses anything outside it. Null = none. */
  policy?: GrantPolicy | null
}

/** `tangen.policy.ts` at the project root: `export default { grants: { allow?, deny? } }`. Null when there is none. */
export async function loadGrantPolicy(projectRoot: string): Promise<GrantPolicy | null> {
  const file = join(projectRoot, 'tangen.policy.ts')
  if (!existsSync(file)) return null
  // Re-read on every call: the module cache would otherwise hand back the first version of an edited policy.
  const mod = await import(`${file}?t=${Date.now()}`)
  const root = (mod.default ?? mod) as { grants?: unknown }
  const grants = root && typeof root === 'object' ? root.grants : undefined
  const problems = validateGrantPolicy(grants)
  if (problems.length) throw new Error(`tangen.policy.ts: grants ${problems.join('; ')}`)
  return grants as GrantPolicy
}

/** A manifest loaded from the project's own code (`__dir`) is trusted; one installed from a registry (`__pkg`) is a marketplace install. */
export function trustOf(manifest: { __dir?: string; __pkg?: string }): 'trusted' | 'marketplace' {
  if (manifest.__dir && !manifest.__pkg) return 'trusted'
  if (manifest.__pkg?.startsWith('@tangen/')) return 'trusted'
  return manifest.__pkg ? 'marketplace' : 'trusted'
}

const TIERS: Array<ReviewedGrant['tier']> = ['LOW', 'MEDIUM', 'HIGH', 'PRIVILEGED']
const MARK: Record<ReviewedGrant['tier'], string> = { LOW: '✓', MEDIUM: '!', HIGH: '!!', PRIVILEGED: '✗' }

/** The review as lines of text; the caller decides where they go. */
export function renderGrantReview(review: GrantReview, opts: {
  publisher?: string
  recorded?: readonly string[] | null
  status?: Record<string, 'granted' | 'denied'>
  /** Connectors C1: what a pack offers, so the hosts are on screen before its code runs. */
  connectors?: ReadonlyArray<{ id: string; provider: string; label?: string; hosts?: readonly string[]; supersedes?: readonly string[] }>
  kind?: 'extension' | 'connector-pack'
} = {}): string[] {
  const lines: string[] = []
  lines.push(`${review.extensionId} ${review.version}${opts.publisher ? `    Package: ${opts.publisher}` : ''}`)
  // C1: a connector pack's whole purpose is reaching outside, so say where to,
  // beside the permissions rather than buried in them. These are not grants:
  // the connector's own client is bound to these hosts and an operator's
  // credentials never leave core, which the `cannot` line below says outright.
  if (opts.connectors?.length) {
    lines.push('')
    lines.push(opts.kind === 'connector-pack' ? 'Connector pack. It offers connections to:' : 'It offers connections to:')
    const byProvider = new Map<string, { hosts: Set<string>; models: string[]; adopts: Set<string> }>()
    for (const c of opts.connectors) {
      const entry = byProvider.get(c.provider) ?? { hosts: new Set<string>(), models: [], adopts: new Set<string>() }
      for (const h of c.hosts ?? []) entry.hosts.add(h)
      for (const s of c.supersedes ?? []) entry.adopts.add(s)
      entry.models.push(c.id.slice(c.provider.length + 1) || c.id)
      byProvider.set(c.provider, entry)
    }
    for (const [provider, { hosts, models, adopts }] of byProvider) {
      lines.push(`  ${provider}${models.length ? ` (${models.sort().join(', ')})` : ''}`)
      for (const host of [...hosts].sort()) lines.push(`    ${host}`)
      // F2: a pack that ADOPTS an older connector keeps an operator's existing
      // connection working, which is worth saying at install rather than
      // leaving them to discover it.
      if (adopts.size) lines.push(`    adopts existing connections of: ${[...adopts].sort().join(', ')}`)
    }
    lines.push('  Credentials stay with Tangen: a consuming extension is handed an authenticated client, never a token.')
  }
  const all = [...review.required, ...review.optional]
  if (all.length === 0) {
    lines.push('Requested permissions: none - this extension declares no grants and holds none.')
    return lines
  }
  lines.push('')
  lines.push('Requested permissions')
  const width = Math.max(...all.map((g) => g.grant.length), 12)
  for (const tier of TIERS) {
    const group = all.filter((g) => g.tier === tier)
    if (group.length === 0) continue
    group.forEach((g, i) => {
      const label = i === 0 ? tier.padEnd(10) : ''.padEnd(10)
      const tags: string[] = []
      if (g.optional) tags.push(g.enables ? `optional, enables ${g.enables}` : 'optional')
      if (g.blocked) tags.push('privileged: refused for a package install')
      const status = opts.status?.[g.grant]
      const words = `${g.reason ?? g.explanation}${g.reason ? `` : ''}`
      lines.push(`  ${label}${MARK[tier].padEnd(3)}${g.grant.padEnd(width + 2)}${words}${tags.length ? `  (${tags.join('; ')})` : ''}${status ? `  ${status}` : ''}`)
      if (g.reason) lines.push(`  ${''.padEnd(10)}${''.padEnd(3)}${''.padEnd(width + 2)}${g.explanation}`)
    })
  }
  lines.push('')
  lines.push(`This extension cannot: ${review.cannot.map((c) => `✓ ${c}`).join('  ')}`)
  if (review.added.length) lines.push(`New since the last approval: ${review.added.join(', ')}`)
  if (review.removed.length) lines.push(`No longer requested (revoked): ${review.removed.join(', ')}`)
  if (review.unknown.length) lines.push(`Unknown to this kernel (ignored): ${review.unknown.join(', ')}`)
  if (review.warnings.length) lines.push(`Publisher warnings: ${review.warnings.join('; ')}`)
  return lines
}

export interface ReviewOutcome {
  review: GrantReview
  /** The grants the installation records; null when the manifest declares none. */
  granted: string[] | null
  denied: string[]
}

/**
 * Review a manifest's grants for an install or an upgrade and decide. An
 * extension that declares no grants passes straight through (nothing to
 * record). A required grant that cannot be approved here refuses. Outside a
 * terminal `--yes` is required; in one the operator is asked.
 */
export async function reviewAndDecide(
  manifest: TangenExtensionManifest & { __dir?: string; __pkg?: string },
  input: { previouslyGranted?: readonly string[] | null; log: (line: string) => void; verb: 'install' | 'upgrade' },
  opts: ReviewCliOptions = {},
): Promise<ReviewOutcome> {
  if (!manifest.grants || !Array.isArray(manifest.grants.required)) {
    return { review: reviewGrants(manifest, { trust: 'trusted' }), granted: null, denied: [] }
  }
  const trust = trustOf(manifest)
  const review = reviewGrants(manifest, { trust, ...(input.previouslyGranted ? { previouslyGranted: input.previouslyGranted } : {}) })
  for (const line of renderGrantReview(review, { publisher: manifest.__pkg, connectors: (manifest as { connectors?: never[] }).connectors, kind: (manifest as { kind?: 'extension' | 'connector-pack' }).kind })) input.log(`[tangen] ${line}`)
  const refusedRequired = review.required.filter((g) => g.blocked).map((g) => g.grant)
  if (refusedRequired.length) {
    throw new Error(`${input.verb} of '${manifest.id}' refused: it requires ${refusedRequired.join(', ')}, which a package install cannot be granted (privileged). Install it from the project's own code to approve it, or ask the publisher for a narrower grant.`)
  }
  // K5.3: the project's policy. A required grant it refuses refuses the install; an optional one is simply denied.
  const policyVerdict = evaluateGrantPolicy(opts.policy ?? null, [...review.required, ...review.optional].map((g) => g.grant))
  const policyDenied = new Map(policyVerdict.denied.map((d) => [d.grant, d]))
  const requiredByPolicy = review.required.filter((g) => policyDenied.has(g.grant))
  if (requiredByPolicy.length) {
    const why = requiredByPolicy.map((g) => { const d = policyDenied.get(g.grant)!; return d.by === 'deny' ? `${g.grant} is denied by policy (${d.pattern})` : `${g.grant} is outside the policy's allow list` }).join('; ')
    throw new Error(`${input.verb} of '${manifest.id}' refused by tangen.policy.ts: ${why}.`)
  }
  for (const g of review.optional) { const d = policyDenied.get(g.grant); if (d) input.log(`[tangen] ${g.grant}: ${d.by === 'deny' ? `denied by policy (${d.pattern})` : 'outside the policy\'s allow list'} - not granted`) }
  const interactive = opts.interactive ?? Boolean(process.stdin.isTTY)
  const nothingNew = input.previouslyGranted && !review.needsReview
  let optional: boolean | readonly string[] | 'keep'
  if (opts.approveGrants !== undefined) {
    // The CI form: the approved set is exactly the list.
    const set = new Set(opts.approveGrants)
    const missing = review.required.filter((g) => !set.has(g.grant)).map((g) => g.grant)
    if (missing.length) throw new Error(`${input.verb} of '${manifest.id}' refused: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required but not in the approved set (--approve-grants).`)
    optional = review.optional.filter((g) => set.has(g.grant)).map((g) => g.grant)
  } else if (opts.approveOptional !== undefined) {
    optional = opts.approveOptional === 'all' ? true : opts.approveOptional === 'none' ? false : opts.approveOptional
  } else if (opts.yes) {
    optional = input.previouslyGranted ? 'keep' : true
    if (input.previouslyGranted) {
      // An upgrade with --yes keeps what was granted and approves new optional grants too.
      optional = [...(input.previouslyGranted ?? []), ...review.optional.filter((g) => !g.previouslyGranted).map((g) => g.grant)]
    }
  } else if (nothingNew) {
    optional = 'keep'
  } else if (review.required.length === 0 && review.optional.length === 0) {
    // E.14: a server entry that asks for nothing (grants: { required: [] }) has nothing to approve; the empty decision is still recorded.
    optional = false
  } else if (interactive && opts.ask) {
    const pending = review.optional.filter((g) => !g.previouslyGranted && !g.blocked)
    const grantOptional = pending.length ? await opts.ask('Grant optional permissions?', true) : false
    optional = grantOptional ? [...(input.previouslyGranted ?? []), ...pending.map((g) => g.grant)] : (input.previouslyGranted ? 'keep' : false)
    const proceed = await opts.ask(`Continue ${input.verb === 'install' ? 'installation' : 'upgrade'}?`, false)
    if (!proceed) throw new Error(`${input.verb} of '${manifest.id}' cancelled.`)
  } else {
    const what = review.added.length ? `new permissions (${review.added.join(', ')})` : 'permissions'
    throw new Error(`${input.verb} of '${manifest.id}' needs approval of its ${what}: run again with --yes (approves them, optional ones included), --approve-optional <grant,...|none>, or in a terminal to be asked.`)
  }
  if (policyDenied.size) {
    const wanted = optional === true ? review.optional.map((g) => g.grant) : optional === false ? [] : optional === 'keep' ? review.optional.filter((g) => g.previouslyGranted).map((g) => g.grant) : [...optional]
    optional = wanted.filter((g) => !policyDenied.has(g))
  }
  const decision = decideGrants(review, { optional })
  if (!decision.ok) throw new Error(`${input.verb} of '${manifest.id}' refused: ${decision.refused.join(', ')} cannot be granted here.`)
  input.log(`[tangen] Granted: ${decision.granted.join(', ') || 'none'}${decision.denied.length ? `   Denied: ${decision.denied.join(', ')}` : ''}`)
  return { review, granted: decision.granted, denied: decision.denied }
}

/** The names declared by a manifest, required and optional - for a status line. */
export function declaredGrantNames(manifest: TangenExtensionManifest): { required: string[]; optional: string[] } {
  return { required: grantNames(manifest.grants?.required), optional: grantNames(manifest.grants?.optional) }
}

/** A yes/no question on stdin for the interactive review. */
export async function askYesNo(question: string, defaultYes: boolean): Promise<boolean> {
  process.stdout.write(`${question} [${defaultYes ? 'Y/n' : 'y/N'}] `)
  const line = await new Promise<string>((resolve) => {
    let buf = ''
    const onData = (chunk: Buffer) => { buf += chunk.toString(); if (buf.includes('\n')) { process.stdin.off('data', onData); process.stdin.pause(); resolve(buf) } }
    process.stdin.resume(); process.stdin.on('data', onData)
  })
  const answer = line.trim().toLowerCase()
  if (answer === '') return defaultYes
  return answer === 'y' || answer === 'yes'
}
