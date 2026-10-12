/**
 * File Name: extension-updates.ts
 * Purpose: Whether a newer version of an extension exists (the user,
 *          2026-09-20: "have a endpoint option to check if new version is
 *          available").
 *
 *          There are TWO different questions here and the screen must not
 *          blur them:
 *
 *          1. The code in this project already ships a newer manifest than
 *             the installed row records - an UPGRADE, which the platform runs
 *             itself, because it has migrations to apply and grants to
 *             review.
 *          2. The registry has a newer package than the one installed - an
 *             UPDATE, which only the project's own dependency install can do
 *             (`bun add`), and which then becomes case 1.
 *
 *          This module answers the second and says nothing else: it takes a
 *          package NAME and asks the configured registry for its
 *          `dist-tags.latest`. Never a URL from a manifest, never a
 *          credential, never any workspace data - the only thing that leaves
 *          the installation is the package name, and only when an operator
 *          asks.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { compareSemver, parseSemver } from '@tangen/types'

/** The default public registry; a private one is set per installation. */
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

/** Where to ask. `TANGEN_EXTENSION_REGISTRY` points a project at its own. */
export function registryUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.TANGEN_EXTENSION_REGISTRY ?? '').trim()
  if (raw === '' || !/^https?:\/\//i.test(raw)) return DEFAULT_REGISTRY
  return raw.replace(/\/+$/, '')
}

/**
 * The package to ask about, from how the extension was resolved. A path is
 * not a package: an extension living in the project's own tree has no
 * registry to check, and saying so is the honest answer.
 */
export function packageOf(resolve: string | undefined | null): string | null {
  if (typeof resolve !== 'string') return null
  const spec = resolve.trim()
  if (spec === '' || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('~')) return null
  // `@scope/name` or `name`, with no version range and no subpath.
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(spec)) return null
  return spec
}

export interface UpdateVerdict {
  /** The version installed here, as recorded. */
  current: string | null
  /** `dist-tags.latest` at the registry, when it could be read. */
  latest: string | null
  /** True only when both versions parse and latest is genuinely newer. */
  updateAvailable: boolean
  /** The package asked about; null when the extension is not from a registry. */
  package: string | null
  /** Why there is no answer, in words an operator can act on. */
  message?: string
}

/** Pure: what two versions mean. Anything unparseable is NOT an update. */
export function compareVersions(current: string | null, latest: string | null): boolean {
  const c = current ? parseSemver(current) : null
  const l = latest ? parseSemver(latest) : null
  if (!c || !l) return false
  return compareSemver(l, c) > 0
}

/** The `latest` dist-tag out of a registry document, or null. */
export function latestFromPackument(doc: unknown): string | null {
  if (!doc || typeof doc !== 'object') return null
  const tags = (doc as Record<string, unknown>)['dist-tags']
  if (!tags || typeof tags !== 'object') return null
  const latest = (tags as { latest?: unknown }).latest
  return typeof latest === 'string' && parseSemver(latest) ? latest : null
}

export interface UpdateCheckDeps {
  fetch?: typeof fetch
  registry?: string
  /** How long an answer is reused, so a page of 20 rows is not 20 requests a click. */
  ttlMs?: number
  now?: () => number
}

interface CacheEntry { at: number; latest: string | null; message?: string }
const cache = new Map<string, CacheEntry>()

/** Forget every cached answer. For a forced re-check, and for tests. */
export function clearUpdateCache(): void { cache.clear() }

/**
 * Ask the registry what the latest version of ONE package is. Never throws:
 * a registry that is down, slow or unreachable is a missing answer, not a
 * failed page.
 */
export async function checkForUpdate(
  input: { package: string | null; current: string | null },
  deps: UpdateCheckDeps = {},
): Promise<UpdateVerdict> {
  const pkg = input.package
  if (!pkg) {
    return {
      current: input.current, latest: null, updateAvailable: false, package: null,
      message: 'This extension is resolved from a path in the project, so there is no registry to check.',
    }
  }
  const registry = deps.registry ?? registryUrl()
  const ttlMs = deps.ttlMs ?? 10 * 60_000
  const now = deps.now ?? Date.now
  const key = `${registry} ${pkg}`
  const hit = cache.get(key)
  if (hit && now() - hit.at < ttlMs) {
    return {
      current: input.current, latest: hit.latest, package: pkg,
      updateAvailable: compareVersions(input.current, hit.latest),
      ...(hit.message ? { message: hit.message } : {}),
    }
  }

  const doFetch = deps.fetch ?? fetch
  let latest: string | null = null
  let message: string | undefined
  try {
    const res = await doFetch(`${registry}/${pkg.replace('/', '%2f')}`, {
      headers: { Accept: 'application/vnd.npm.install-v1+json', 'User-Agent': 'tangen-extension-updates/1' },
      signal: AbortSignal.timeout(8_000),
    })
    if (res.status === 404) message = `The registry has no package '${pkg}'.`
    else if (!res.ok) message = `The registry answered ${res.status}.`
    else {
      latest = latestFromPackument(await res.json())
      if (latest === null) message = 'The registry gave no latest version for this package.'
    }
  } catch (e) {
    message = `The registry could not be reached: ${(e as Error).message}`
  }
  cache.set(key, { at: now(), latest, ...(message ? { message } : {}) })
  return {
    current: input.current, latest, package: pkg,
    updateAvailable: compareVersions(input.current, latest),
    ...(message ? { message } : {}),
  }
}
