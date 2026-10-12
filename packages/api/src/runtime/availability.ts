/**
 * File Name: availability.ts
 * Purpose: The difference between OFF and UNAVAILABLE (closure plan Phase 3,
 *          Unit 6). A capability that is available may be enabled or
 *          disabled by the composition; one that cannot run here - a native
 *          module that will not load, a transport nobody configured, a
 *          server extension that is not installed - is unavailable with a
 *          reason written for an operator: no secret, no path from a stack
 *          trace, no driver text. Nothing here crashes a process; a
 *          capability explicitly required by configuration is the
 *          registry's `strict` flag, and none is strict by default.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Probes are injectable (the sharp import, the
 *          environment) so every state is testable on one machine.
 */
import { resolvedDeployments } from '../config/state'
import type { ResolvedDeployment } from '@tangen/types'
import type { Availability } from './registry'
import { readKnowledgeSchemaStatus, knowledgeSchemaAdvice } from '@tangen/db'

/** A reason a human can act on, with nothing from the failure's internals. */
export function safeReason(prefix: string, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // Keep the first line only, strip absolute paths and anything after a colon-space chain that looks like a stack.
  const line = raw.split('\n')[0]!.replace(/\/[^\s'"]+/g, '<path>').slice(0, 160)
  return `${prefix}${line ? ` (${line})` : ''}`
}

/** Media needs sharp, a native module; a build for another platform, or a missing install, fails at import. */
export async function mediaAvailability(load: () => Promise<unknown> = () => import('sharp')): Promise<Availability> {
  try {
    await load()
    return { available: true }
  } catch (e) {
    return { available: false, reason: safeReason('image processing is unavailable: sharp did not load - reinstall @tangen/api dependencies for this platform', e) }
  }
}

export interface MailProjectLike {
  mail?: { service?: string; apiKey?: string; adapter?: unknown }
}

/**
 * Mail is available when at least one project configures a transport that
 * can actually send: a custom adapter, smtp with SMTP_HOST set, or
 * sendgrid/resend with an API key. Unconfigured is unavailable, not off:
 * the code is there, the deployment has not told it where to deliver.
 */
/**
 * Whether outbound mail can be sent: a custom adapter object, or - per the
 * resolved deployments - an SMTP host somebody set, or a resolved provider
 * key reference. Nothing here reads the process; the deployment's provenance
 * says what is configured, and no key material is ever inspected.
 */
export function mailAvailability(projects: ReadonlyArray<MailProjectLike>, deployments: ReadonlyArray<ResolvedDeployment> = resolvedDeployments()): Availability {
  const configs = projects.map((p) => p.mail).filter((m): m is NonNullable<MailProjectLike['mail']> => !!m)
  if (configs.length === 0) return { available: false, reason: 'no mail service is configured (mail.service in app/config/mail.ts)' }
  const smtpHostSet = deployments.some((d) => { const p = d.explain('mail.smtp.host'); return !!p && p.state !== 'missing' && p.source !== 'platform-default' })
  const apiKeyResolved = deployments.some((d) => (d.values['mail.apiKey'] as { resolved?: boolean } | undefined)?.resolved === true)
  const problems: string[] = []
  for (const m of configs) {
    if (m.adapter && typeof m.adapter === 'object') return { available: true }
    const service = m.service ?? 'smtp'
    if (service === 'smtp') {
      if (smtpHostSet) return { available: true }
      problems.push('smtp: mail.smtp.host is not configured (SMTP_HOST)')
    } else if (service === 'sendgrid' || service === 'resend') {
      if (apiKeyResolved) return { available: true }
      problems.push(`${service}: mail.apiKey is not resolved (name the variable in app/config/mail.ts; the deployment supplies it)`)
    } else {
      problems.push(`unknown mail service "${service}" (built-ins: smtp, sendgrid, resend)`)
    }
  }
  return { available: false, reason: `mail transport is not configured: ${[...new Set(problems)].join('; ')}` }
}

export interface KnowledgeProjectLike {
  knowledge?: { enabled?: boolean }
  config?: { knowledge?: { enabled?: boolean } }
}

/** Does any project enable knowledge? */
export function knowledgeWanted(projects: ReadonlyArray<KnowledgeProjectLike>): boolean {
  return projects.some((p) => p.knowledge?.enabled === true || p.config?.knowledge?.enabled === true)
}

/**
 * Knowledge is available when pgvector is enabled and the tables migration
 * 0041 declares exist; the reason otherwise is Phase 1's operator advice.
 * A deployment that does not want knowledge is "available, off" - the
 * database is not asked.
 */
export async function knowledgeAvailability(
  projects: ReadonlyArray<KnowledgeProjectLike>,
  exec: (text: string) => Promise<Array<Record<string, unknown>>>,
): Promise<Availability> {
  if (!knowledgeWanted(projects)) return { available: true }
  try {
    const status = await readKnowledgeSchemaStatus(async (text) => exec(text))
    const advice = knowledgeSchemaAdvice(status)
    return advice ? { available: false, reason: advice } : { available: true }
  } catch (e) {
    return { available: false, reason: safeReason('knowledge schema could not be checked', e) }
  }
}

// ── AI and MCP (closure plan Phase 9D, Units 2-4) ────────────────────────────

/** The environment variable each provider's key is read from. Names only. */
const AI_KEY_VARS = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
} as const

export type AiProviderId = keyof typeof AI_KEY_VARS

export interface AiProjectLike {
  ai?: { providers?: readonly string[]; disabled?: boolean }
  config?: { ai?: { providers?: readonly string[]; disabled?: boolean } }
}

/** `project.ai ?? project.config.ai` - exactly how every AI route resolves it. */
function aiConfigOf(p: AiProjectLike) { return p.ai ?? p.config?.ai }

/**
 * Which providers have a key resolvable in this process, from process env or
 * any environment's custom vars. Returns NAMES: a key value never leaves this
 * function, so nothing downstream can leak one into a descriptor or a log.
 */
/** What a resolved deployment tells availability: the provider keys' provenance and the permitted list. */
export interface AiDeploymentLike {
  get<T = unknown>(key: string): T | undefined
  explain(key: string): { secret?: { resolved: boolean } } | undefined
}

/**
 * The providers at least one served deployment has a resolved key for
 * (plan-config-resolver section 13): read from provenance, never from a
 * variable, so the answer is the resolver's and nothing else's.
 */
export function configuredAiProviders(deployments: ReadonlyArray<AiDeploymentLike>): AiProviderId[] {
  const out = new Set<AiProviderId>()
  // `ai.disabled` is the kill switch (aiWanted), not availability: a key that
  // resolves is available whether or not the workspace wants AI on.
  for (const d of deployments) {
    const permitted = d.get<string[]>('ai.providers')
    for (const name of Object.keys(AI_KEY_VARS) as AiProviderId[]) {
      if (permitted && permitted.length > 0 && !permitted.includes(name)) continue
      if (d.explain(`ai.apiKey.${name}`)?.secret?.resolved) out.add(name)
    }
  }
  return [...out]
}

/**
 * AI is wanted unless every project sets the kill switch. There is no
 * environment-level AI override in the repository, so there is none here.
 */
export function aiWanted(projects: ReadonlyArray<AiProjectLike>): boolean {
  if (projects.length === 0) return true
  return projects.some((p) => aiConfigOf(p)?.disabled !== true)
}

/**
 * AI is available when at least one permitted provider has a key. No key is
 * UNAVAILABLE, not off: the code is here, the deployment has not given it a
 * credential. The reason names the variables to set and never a value.
 */
export function aiAvailability(deployments: ReadonlyArray<AiDeploymentLike>): Availability {
  if (configuredAiProviders(deployments).length > 0) return { available: true }
  const permitted = new Set<string>()
  for (const d of deployments) for (const name of d.get<string[]>('ai.providers') ?? []) permitted.add(name)
  const vars = (Object.entries(AI_KEY_VARS) as Array<[AiProviderId, string]>)
    .filter(([name]) => permitted.size === 0 || permitted.has(name))
    .map(([, varName]) => varName)
  return { available: false, reason: `no AI provider key is configured: set one of ${vars.join(', ')} for this deployment` }
}

export interface McpProjectLike {
  mcp?: { enabled?: boolean }
  config?: { mcp?: { enabled?: boolean } }
}

/** Does any project enable MCP? Off by default. */
export function mcpWanted(projects: ReadonlyArray<McpProjectLike>): boolean {
  return projects.some((p) => p.mcp?.enabled === true || p.config?.mcp?.enabled === true)
}

/**
 * MCP is available when it is wanted and the optional `@tangen/mcp` package
 * loads. A deployment that does not want it is "available, off" - the import
 * is never attempted, which is the point of the package being optional.
 */
export async function mcpAvailability(
  projects: ReadonlyArray<McpProjectLike>,
  load: () => Promise<unknown> = () => import('@tangen/mcp'),
): Promise<Availability> {
  if (!mcpWanted(projects)) return { available: true }
  try {
    await load()
    return { available: true }
  } catch (e) {
    return { available: false, reason: safeReason('MCP is enabled but the optional @tangen/mcp package did not load - install @tangen/mcp', e) }
  }
}
