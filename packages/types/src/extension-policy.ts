/**
 * File Name: extension-policy.ts
 * Purpose: The project's grant policy (Extension Kernel K5.3,
 *          tasks/plan-extension-kernel.md; proposal F.3). A `tangen.policy.ts`
 *          allows or denies grants by pattern, org-wide and committed: deny
 *          wins over allow, an allow list refuses anything outside it, and
 *          without a policy the review's own decision stands. Pure, so the
 *          CLI at install and a CI check give the same answer.
 *
 * Author: Raghunath J
 * License: MIT
 */

export interface GrantPolicy {
  /** Patterns a grant must match to be approvable at all; omit to allow anything not denied. */
  allow?: string[]
  /** Patterns that are never approved; wins over `allow`. */
  deny?: string[]
}

export interface PolicyDenial {
  grant: string
  /** `deny`: a deny pattern matched; `allow`: an allow list exists and nothing in it matched. */
  by: 'deny' | 'allow'
  /** The pattern that decided, for a deny. */
  pattern?: string
}

/**
 * `content:read` exact; `content:*` the family; `content:update*` a prefix;
 * `network:*.example.com` a host wildcard (subdomains only); `*` everything.
 */
export function matchesGrantPattern(pattern: string, grant: string): boolean {
  if (pattern === '*') return true
  if (!pattern.includes('*')) return pattern === grant
  const escaped = pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
  // A host wildcard `*.suffix` must match at least one label before the dot.
  const body = escaped.join('[^\\s]*')
  const re = new RegExp(`^${body}$`)
  if (!re.test(grant)) return false
  if (/:\*\.[^*]+$/.test(pattern)) {
    const suffix = pattern.slice(pattern.indexOf('*.') + 2)
    const host = grant.slice(grant.indexOf(':') + 1)
    return host.endsWith(`.${suffix}`) && host.length > suffix.length + 1
  }
  return true
}

/** The grants the policy lets through, and the ones it refuses with why. */
export function evaluateGrantPolicy(policy: GrantPolicy | null | undefined, grants: readonly string[]): { allowed: string[]; denied: PolicyDenial[] } {
  if (!policy) return { allowed: [...grants], denied: [] }
  const allowed: string[] = []
  const denied: PolicyDenial[] = []
  for (const grant of grants) {
    const deny = (policy.deny ?? []).find((p) => matchesGrantPattern(p, grant))
    if (deny) { denied.push({ grant, by: 'deny', pattern: deny }); continue }
    if (policy.allow && !policy.allow.some((p) => matchesGrantPattern(p, grant))) { denied.push({ grant, by: 'allow' }); continue }
    allowed.push(grant)
  }
  return { allowed, denied }
}

/** Shape check for a loaded `tangen.policy.ts`; returns the problems, empty when fine. */
export function validateGrantPolicy(input: unknown): string[] {
  const problems: string[] = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['must be an object: { allow?: string[], deny?: string[] }']
  for (const key of ['allow', 'deny'] as const) {
    const v = (input as Record<string, unknown>)[key]
    if (v === undefined) continue
    if (!Array.isArray(v)) { problems.push(`${key} must be an array of grant patterns`); continue }
    v.forEach((p, i) => { if (typeof p !== 'string' || !p.trim()) problems.push(`${key}[${i}] must be a grant pattern like content:* or network:*.example.com`) })
  }
  return problems
}
