/**
 * File Name: delivery-client.ts
 * Purpose: Reading a published page from the Delivery Layer - the visitor
 *          half of zero-build publishing.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This is what takes the authoring API out of the visitor
 *          path. A site resolves a route pointer, then fetches the immutable
 *          artifact it names, and never asks Studio anything - which is why a
 *          disabled Studio cannot take a published page down.
 *
 *          Two requests rather than one, deliberately. The pointer is the ONLY
 *          mutable thing a publish touches, so it must be revalidated;
 *          everything it names is immutable and can be cached forever.
 *          Collapsing them into one "give me the page" call would force a
 *          choice between an unrevalidatable page and an uncacheable artifact.
 *
 *          `fetch` is injected rather than assumed. That keeps this testable
 *          with no network and no DOM, and lets a framework with its own
 *          fetch - caching, revalidation, tracing - hand its own in instead
 *          of being bypassed.
 *
 *          The artifact shape is declared here rather than imported from the
 *          compiler. The browser does not compile, and a runtime that pulled
 *          in publish-time code to read a JSON file would carry it into every
 *          page. The two are held together by a cross-package acceptance test
 *          that publishes with the real compiler and reads with this.
 *
 *          No node builtins: this runs in a page.
 */

import type { DeliveredTier2Declaration } from './tier2-types'

/** Where the platform mounts delivery. */
export const DELIVERY_MOUNT = '/api/v1/delivery/'

/** Where published things live, matching the compiler's artifact paths. */
const ROOT = 'tangen'

/** One interaction as a published page declares it. */
export interface DeliveredInteraction {
  className: string
  interaction: {
    event: string
    action: string
    duration: number
    delay: number
    easing: string
  }
}

/** What a runtime must switch on for this page, and nothing more. */
export interface DeliveredRuntime {
  /** True when the enter-view shim has to run. */
  enterView: boolean
  interactions: DeliveredInteraction[]
  /**
   * Runtime modules this page needs BEYOND the enter-view shim.
   *
   * Optional because a page that needs none carries no such key: the artifact
   * is content-addressed, so emitting an empty list on every page would move
   * every hash ever published. Absent means "nothing extra".
   */
  modules?: string[]
  /** Tier 2 declarations, present only when `modules` names the interpreter. */
  tier2?: DeliveredTier2Declaration[]
}

/** One shared surface, as the /_surfaces artifact carries it. */
export interface DeliveredSurface {
  /** The global it came from. */
  name: string
  /** Which edge of every page it pins to. */
  position: 'header' | 'footer'
  blocks: Array<Record<string, unknown>>
}

/**
 * The shared INSTANCES, by instance id: one authored tree published once and
 * referenced from many pages.
 *
 * A map because a page's reference resolves BY ID; order means nothing here,
 * unlike a surface, which stacks in the order it was declared.
 */
export type DeliveredInstances = Record<string, Array<Record<string, unknown>>>

/**
 * What a page shares with every other page, resolved beside it: the header
 * and footer it wears, and the instances its references name. Published once
 * under `/_surfaces` rather than copied into each page, which is what lets
 * either change without republishing a single page.
 *
 * Its own version names the stylesheet those classes were published with,
 * which may be newer than the page's.
 */
export interface DeliveredSurfaces {
  version: string
  surfaces: DeliveredSurface[]
  /**
   * Optional because an artifact published before instances existed carries
   * no such key, and that absence must read as "none", never as broken.
   */
  instances?: DeliveredInstances
}

/** A published page, exactly as a visitor receives it. */
export interface DeliveredPage {
  version: string
  route: string
  blocks: Array<Record<string, unknown>>
  css: string
  /** Block types the page uses, so a runtime activates nothing else. */
  dependencies: string[]
  runtime: DeliveredRuntime
  /** Present on the shared artifact only - see `resolveSurfaces`. */
  surfaces?: DeliveredSurface[]
  /** Present on the shared artifact only - see `resolveSurfaces`. */
  instances?: DeliveredInstances
  /**
   * The shared surfaces and instances, attached by `resolvePage` when asked
   * for them. NOT part of the artifact: a page is content-addressed, and the
   * header - or an instance it uses - is allowed to change without the
   * page's hash moving. That is the whole point of resolving them here.
   */
  shared?: DeliveredSurfaces
}

/** The reserved route the shared surfaces publish under. */
export const SURFACES_ROUTE = '/_surfaces'

/** Where to look, and for what. */
export interface DeliveryTarget {
  route: string
  /**
   * Public routing identifiers - NOT credentials.
   *
   * Optional because a site that proxies delivery through its own origin
   * keeps them server-side and out of page source, which is the recommended
   * pattern. Forcing them into every URL would make that pattern impossible.
   */
  workspace?: string
  env?: string
  /** Where delivery is mounted; a proxying site points this at its own route. */
  mount?: string
}

/** A versioned artifact of a known page. */
export interface VersionedTarget extends DeliveryTarget {
  version: string
}

export interface ResolveOptions {
  /** Injected for testing, and so a framework's own fetch is not bypassed. */
  fetch?: typeof fetch
  /**
   * Also resolve the shared surfaces and attach them as `shared`. Off by
   * default: it is two more requests, and a site that renders its own
   * header and footer should not pay them.
   *
   * Kept because it shipped; `shared` is the name that says what the option
   * now does, since the same artifact also carries the instances a page's
   * references name.
   */
  surfaces?: boolean
  /**
   * Resolve the whole shared artifact - surfaces AND instances - and attach
   * it as `shared`. A site that renders its own header but uses instances
   * asks for this rather than for "surfaces".
   */
  shared?: boolean
}

/**
 * The storage path of a route pointer.
 *
 * Refuses traversal rather than sanitising it, because the same string
 * becomes a storage key on the other end and a quietly rewritten path hides
 * the intent instead of reporting it. This mirrors the compiler's
 * `routePointerPath`; the acceptance test publishes with one and reads with
 * the other so they cannot drift apart unnoticed.
 */
function pointerPath(route: string): string {
  if (route.includes('..')) throw new Error(`Route "${route}" cannot contain ".."`)
  const clean = route.replace(/^\/+|\/+$/g, '')
  if (!/^[A-Za-z0-9/_-]*$/.test(clean)) {
    throw new Error(`Route "${route}" has characters that cannot be a path`)
  }
  // The root route still needs a name of its own.
  return `${ROOT}/routes/${clean === '' ? '_root' : clean}.json`
}

/** One delivery URL, with the routing identifiers only when they are needed. */
function deliveryUrl(baseUrl: string, path: string, target: DeliveryTarget): string {
  const mount = target.mount ?? DELIVERY_MOUNT
  const base = `${baseUrl.replace(/\/+$/, '')}${mount}${path}`
  if (!target.workspace && !target.env) return base
  const query = new URLSearchParams()
  if (target.workspace) query.set('workspace', target.workspace)
  if (target.env) query.set('env', target.env)
  return `${base}?${query.toString()}`
}

/** The mutable pointer for a route. */
export function routePointerUrl(baseUrl: string, target: DeliveryTarget): string {
  return deliveryUrl(baseUrl, pointerPath(target.route), target)
}

/** The immutable page definition for one version. */
export function pageUrl(baseUrl: string, target: VersionedTarget): string {
  return deliveryUrl(baseUrl, `${ROOT}/builds/${target.version}/page.json`, target)
}

/**
 * The immutable stylesheet for one version.
 *
 * Its own URL so a `<link>` can reach it directly and a browser can cache it
 * independently of the page definition.
 */
export function stylesheetUrl(baseUrl: string, target: VersionedTarget): string {
  return deliveryUrl(baseUrl, `${ROOT}/builds/${target.version}/page.css`, target)
}

/** The ambient fetch, when a caller has no reason to supply one. */
function ambientFetch(): typeof fetch {
  const f = (globalThis as { fetch?: typeof fetch }).fetch
  if (!f) throw new Error('No fetch is available - pass one in options.fetch')
  return f
}

/** A JSON body, or null when there is nothing usable to read. */
async function readJson<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null
  try {
    return JSON.parse(await res.text()) as T
  } catch {
    // Corrupt bytes read as unpublished. A visitor gets the site's 404, which
    // is a page, rather than an exception, which is not.
    return null
  }
}

/**
 * The version a route currently serves, or null when nothing is published.
 *
 * Revalidated on every request: the pointer is what a publish moves, so a
 * cached copy would pin visitors to a version the designer already replaced.
 */
export async function resolveVersion(
  baseUrl: string, target: DeliveryTarget, options: ResolveOptions = {},
): Promise<string | null> {
  const f = options.fetch ?? ambientFetch()
  const res = await f(routePointerUrl(baseUrl, target), { cache: 'no-cache' })
  const body = await readJson<{ version?: unknown }>(res)
  return typeof body?.version === 'string' ? body.version : null
}

/**
 * The published page for a route, or null when nothing is published there.
 *
 * Null rather than a throw throughout: an unpublished path is a 404 the site
 * renders, and a delivery hiccup should cost the page its Studio content, not
 * the whole request.
 */
export async function resolvePage(
  baseUrl: string, target: DeliveryTarget, options: ResolveOptions = {},
): Promise<DeliveredPage | null> {
  const version = await resolveVersion(baseUrl, target, options)
  if (!version) return null

  const f = options.fetch ?? ambientFetch()
  // Immutable by construction - a publish writes a NEW version rather than
  // mutating this one - so revalidating it would be a request for nothing.
  const res = await f(pageUrl(baseUrl, { ...target, version }), { cache: 'force-cache' })
  const page = await readJson<DeliveredPage>(res)
  if (!page || typeof page.version !== 'string') return null
  if (!options.shared && !options.surfaces) return page
  // Added, never always present: a site reading `shared` can tell "never
  // published" (absent) from "published with nothing declared" (empty).
  const shared = await resolveSurfaces(baseUrl, target, options)
  return shared ? { ...page, shared } : page
}

/** A JSON object, or nothing usable. Junk on the wire reads as absent. */
function instancesOf(value: unknown): DeliveredInstances {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: DeliveredInstances = {}
  for (const [id, blocks] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(blocks)) out[id] = blocks as Array<Record<string, unknown>>
  }
  return out
}

/**
 * What every page shares - the header and footer it wears, and the instances
 * its references name - or null when nothing was ever published there. The
 * same two reads as a page, under the reserved route.
 *
 * A missing `surfaces` list or `instances` map reads as none declared rather
 * than as an error: an artifact published before either existed is still a
 * valid artifact, and a site reading it must render, not throw.
 */
export async function resolveSurfaces(
  baseUrl: string, target: Omit<DeliveryTarget, 'route'>, options: ResolveOptions = {},
): Promise<DeliveredSurfaces | null> {
  // The shared artifact is a page artifact under a reserved route, so the
  // page resolver reads it; asking for neither keeps this from recursing.
  const artifact = await resolvePage(baseUrl, { ...target, route: SURFACES_ROUTE }, { fetch: options.fetch })
  if (!artifact) return null
  return {
    version: artifact.version,
    surfaces: Array.isArray(artifact.surfaces) ? artifact.surfaces : [],
    instances: instancesOf(artifact.instances),
  }
}
