/**
 * File Name: variants.ts
 * Purpose: A/B bucketing helpers for the Variants extension - pickVariant
 *   deterministically assigns a visitor to the base or variant object of an
 *   experiment, and getOrCreateVisitorId manages the visitor-id cookie for
 *   server-side use.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure and SSR-safe by design - zero dependencies, no
 *   browser globals required (crypto is used only when available, with a
 *   Math.random fallback). The experiment shape matches the Variants
 *   extension's key route GET /api/v1/ext/variants/experiments.
 */

/** One running experiment as served by the Variants extension's key route. */
export interface VariantExperiment {
  experimentId: string
  baseObjectId: string
  variantObjectId: string
  /** Percentage of visitors (0-100) bucketed into the variant. */
  split: number
  /** Content type of both objects (informational for fetching). */
  typeName?: string
}

/** Result of getOrCreateVisitorId. */
export interface VisitorIdResult {
  visitorId: string
  /**
   * Present only when a fresh id was minted - send it as a Set-Cookie header
   * (or equivalent) so the visitor keeps their bucket on the next request.
   */
  setCookie?: string
}

/**
 * FNV-1a 32-bit hash - tiny, dependency-free, and well distributed enough
 * for percentage bucketing.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    // hash *= 16777619, in 32-bit space without BigInt
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash >>> 0
}

/**
 * Deterministically picks which object a visitor should see for an
 * experiment. The same visitorId + experimentId always yields the same
 * bucket, buckets are independent across experiments, and the fraction of
 * visitors bucketed into the variant approximates `split` percent.
 *
 * Returns the objectId to fetch (variant when the visitor's bucket falls
 * under the split, base otherwise). Pure and safe on server and client.
 */
export function pickVariant(
  experiment: Pick<VariantExperiment, 'experimentId' | 'baseObjectId' | 'variantObjectId' | 'split'>,
  visitorId: string,
): string {
  const split = Math.min(100, Math.max(0, experiment.split))
  const bucket = fnv1a(`${visitorId}:${experiment.experimentId}`) % 100
  return bucket < split ? experiment.variantObjectId : experiment.baseObjectId
}

/** Random url-safe id (crypto when available, Math.random fallback - SSR-safe). */
function randomId(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16)
    cryptoObj.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  let out = ''
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16)
  return out
}

/**
 * Reads the visitor id from a Cookie header, minting one when absent.
 * Designed for server-side use (middleware, route handlers): pass the
 * incoming `Cookie` header; when `setCookie` comes back, forward it as a
 * `Set-Cookie` response header so the visitor keeps their bucket.
 *
 * Works without any browser globals (document, window are never touched).
 */
export function getOrCreateVisitorId(
  cookieHeader?: string,
  cookieName = 'tangen_vid',
): VisitorIdResult {
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=')
      if (eq === -1) continue
      const name = part.slice(0, eq).trim()
      if (name === cookieName) {
        const value = part.slice(eq + 1).trim()
        if (value) return { visitorId: value }
      }
    }
  }
  const visitorId = randomId()
  return {
    visitorId,
    // One year, whole site, Lax: enough for stable bucketing without
    // touching cross-site behavior. Add `Secure`/`HttpOnly` at the edge
    // if your deployment wants them.
    setCookie: `${cookieName}=${visitorId}; Path=/; Max-Age=31536000; SameSite=Lax`,
  }
}
