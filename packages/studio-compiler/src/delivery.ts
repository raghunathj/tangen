/**
 * File Name: delivery.ts
 * Purpose: The published artifact contract, and the Delivery Provider
 *          abstraction that gets artifacts to visitors.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Tangen Studio must NOT require Tangen-hosted delivery
 *          infrastructure. A self-hosted install has to work out of the box,
 *          so a filesystem provider is the DEFAULT rather than a fallback,
 *          and object storage or a CDN is an adapter over this same contract.
 *          Nothing here may assume a CDN account exists.
 *
 *          Two properties carry the whole design:
 *
 *          Artifacts are IMMUTABLE and content-addressed. A publish never
 *          mutates what live visitors are already reading, which is what
 *          makes long-lived caching safe and rollback trivial.
 *
 *          The route pointer is the ONLY mutable thing. Publishing writes a
 *          new artifact then moves one small pointer; rollback moves it back.
 *          Neither needs a client deployment.
 *
 *          The provider surface is deliberately three methods. Anything wider
 *          would smuggle in assumptions about storage and stop a plain
 *          directory from being a legitimate backend.
 */

import {
  normalizeInteraction, needsRuntime, normalizeTier2Interaction, tier2Declaration,
  type Interaction, type Tier2Interaction, type Tier2Declaration, type RuntimeModule,
} from '@tangen/studio-schema'
import { interactionCss, KEYFRAMES_CSS } from './interaction-css'

/** Where published things live, so a host can serve or ignore one subtree. */
const ROOT = 'tangen'

/** One settled interaction, bound to the class it animates. */
export interface PageInteraction {
  className: string
  interaction: Interaction
}

/**
 * What a runtime must activate for this page, and nothing more.
 *
 * `dependencies` answers "which block types"; this answers the other half -
 * "does any script have to run at all". Only `enter-view` costs a visitor any
 * JavaScript, so a page of hovers and load animations reports false here and
 * ships no observer.
 *
 * The interaction DECLARATIONS travel here as well as in the stylesheet,
 * because the artifact is the contract: a runtime that never saw the
 * authoring session has to be able to READ what the page declares, and a
 * stylesheet is not readable data.
 */
export interface RuntimeManifest {
  enterView: boolean
  interactions: PageInteraction[]
  /**
   * Modules this page needs BEYOND the Tier 1 shim, which `enterView`
   * already answers.
   *
   * ABSENT when there are none, and that absence is the whole point.
   * `artifactId` hashes the canonical artifact, so emitting `modules: []` on
   * every page would move every content hash ever published and invalidate
   * every cached artifact - for a feature those pages do not use. Omitting
   * the key leaves untouched pages untouched.
   */
  modules?: RuntimeModule[]
  /**
   * Tier 2 declarations, as the interpreter reads them.
   *
   * Absent for the same reason. These carry SELECTORS rather than class
   * names, because the artifact is the contract: an adapter in any framework
   * hands them straight to the interpreter without knowing Tangen names
   * things by class.
   */
  tier2?: Tier2Declaration[]
}

/** A published page, exactly as a visitor receives it. */
export interface PageArtifact {
  /** Content hash. The artifact is immutable, so this identifies it forever. */
  version: string
  route: string
  blocks: Array<Record<string, unknown>>
  css: string
  /** Block types this page uses, so the runtime activates nothing else. */
  dependencies: string[]
  /** What the runtime has to switch on, so it switches on nothing else. */
  runtime: RuntimeManifest
  /**
   * The shared surfaces - a header and a footer every page wears - as
   * published. Present only on an artifact that carries them (the shared
   * `/_surfaces` artifact); a page's own artifact never gains the key, so
   * no content hash ever published moves because surfaces exist now.
   */
  surfaces?: PublishedSurface[]
  /**
   * The shared INSTANCES, by instance id: one authored tree published once
   * and referenced from many pages.
   *
   * Rides the same artifact as the surfaces, and for the same reason a
   * surface does not ride each page: an instance must be able to change
   * without republishing a single page that uses it, so a page artifact
   * carries a REFERENCE and the composition happens at request time.
   *
   * A map rather than a list, because a reference resolves BY ID and order
   * means nothing here - unlike a surface, which stacks in the order it was
   * declared. Absent on a page's own artifact, exactly like `surfaces`.
   */
  instances?: PublishedInstances
}

/**
 * Shared instances as a visitor receives them: block trees by instance id,
 * stripped exactly like a page's blocks.
 */
export type PublishedInstances = Record<string, Array<Record<string, unknown>>>

/** Which edge of a page a shared surface pins to. */
export type SurfacePosition = 'header' | 'footer'

/** A shared surface as the compiler is handed it. */
export interface SurfaceInput {
  /** The global it came from - what names it in the artifact. */
  name: string
  position: SurfacePosition
  blocks: Array<Record<string, unknown>>
}

/** A shared surface as a visitor receives it: stripped like a page's blocks. */
export type PublishedSurface = SurfaceInput

/** An interaction as authored, before it is settled. */
export interface PageInteractionInput {
  className: string
  interaction: unknown
}

/** What the compiler is asked to publish. */
export interface PageInput {
  route: string
  blocks: Array<Record<string, unknown>>
  css: string
  /** Interactions the page declares. Absent means the page animates nothing. */
  interactions?: PageInteractionInput[]
  /**
   * Shared surfaces riding this artifact. Absent for a page; the shared
   * artifact under `/_surfaces` carries every surface the workspace
   * declares, an empty list included, so a runtime can tell "none declared"
   * from "not published".
   */
  surfaces?: SurfaceInput[]
  /**
   * Shared instances riding this artifact, by id. Absent for a page; the
   * shared artifact carries every published instance, an empty map included,
   * so a runtime can tell "none published" from "not published".
   */
  instances?: PublishedInstances
  /**
   * CSS that belongs to THIS page alone - its sections' raw CSS and its own
   * (section-css.ts), already compiled and scoped. Emitted LAST, after the
   * workspace stylesheet and its motion: it is the most specific intent a
   * page carries. Absent or empty keeps a page's bytes and its id exactly as
   * they were before the escape hatch existed.
   */
  pageCss?: string
}

/**
 * Storage behind the delivery layer.
 *
 * Three methods on purpose: a filesystem directory, an S3 bucket, an R2
 * bucket and an in-memory map can all satisfy this, which is what keeps
 * self-hosting a first-class case rather than a degraded one.
 */
export interface DeliveryProvider {
  read(path: string): Promise<string | null>
  write(path: string, body: string): Promise<void>
  list(prefix: string): Promise<string[]>
}

/** Authoring-only keys that must never reach a visitor. */
// `_studio` is NOT authoring: it holds the block's classes and breakpoint
// visibility, which are what the published stylesheet targets. Stripping it
// published a page that wore no class at all while the artifact still shipped
// the whole stylesheet - which read as fine in review and reached nothing.
const AUTHORING_KEYS = new Set(['_draft', '_disabled', '_label'])

/** A block the designer hid. It must not be published, not merely unmarked. */
function isHidden(value: unknown): boolean {
  return !!value && typeof value === 'object' && (value as { _disabled?: unknown })._disabled === true
}

/**
 * Deep copy without authoring metadata. Published output is not a draft.
 *
 * Hidden blocks are DROPPED rather than stripped of their marker. `_disabled`
 * is authoring metadata, so removing the key alone would publish the very
 * block a designer hid - and Studio promises hidden sections stay
 * unpublished. The published snapshot still carries them, so the artifact is
 * the last place that promise can be kept.
 */
function stripAuthoring(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => !isHidden(v)).map(stripAuthoring)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (AUTHORING_KEYS.has(k)) continue
    out[k] = stripAuthoring(v)
  }
  return out
}

/** Stable stringify, so key ORDER never changes a content hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

/**
 * The interactions this page can actually deliver.
 *
 * An unusable declaration is DROPPED rather than repaired: a guessed event
 * would compile into a rule that silently does nothing, which is worse for a
 * designer than the interaction visibly not being there. A class name that
 * cannot be a selector is dropped for a stricter reason - the manifest and
 * the stylesheet have to agree, and a manifest entry whose CSS was refused
 * would tell a runtime to wait for motion that was never emitted.
 */
function settleInteractions(page: PageInput): Array<PageInteraction & { css: string }> {
  const out: Array<PageInteraction & { css: string }> = []
  for (const raw of page.interactions ?? []) {
    if (!raw || typeof raw.className !== 'string') continue
    const interaction = normalizeInteraction(raw.interaction)
    if (!interaction) continue
    const css = interactionCss(raw.className, interaction)
    if (!css) continue
    out.push({ className: raw.className, interaction, css })
  }
  return out
}

/**
 * The Tier 2 interactions this page can actually deliver.
 *
 * Tier 1 is tried FIRST and Tier 2 only reads what Tier 1 refused, so an
 * interaction can never be settled twice - once as CSS and once as a
 * declaration - and play twice on the visitor's page.
 *
 * Nothing here emits CSS, deliberately. The interpreter moves an element to
 * its start state after it loads, so the authored state has to be the visible
 * one: a stylesheet that hid the element first would leave the page blank on
 * any load where the chunk did not arrive, and no try/catch could recover it.
 */
function settleTier2(page: PageInput): Tier2Interaction[] {
  const out: Tier2Interaction[] = []
  for (const raw of page.interactions ?? []) {
    if (!raw || typeof raw.className !== 'string') continue
    if (normalizeInteraction(raw.interaction)) continue
    const interaction = normalizeTier2Interaction(raw.interaction)
    if (!interaction) continue
    out.push(interaction)
  }
  return out
}

/** What the runtime is told to switch on. */
export function runtimeManifest(page: PageInput): RuntimeManifest {
  const settled = settleInteractions(page)
  const manifest: RuntimeManifest = {
    enterView: settled.some((s) => needsRuntime(s.interaction)),
    interactions: settled.map(({ className, interaction }) => ({ className, interaction })),
  }
  const tier2 = settleTier2(page)
  // The keys are ADDED rather than always present, so a page with no Tier 2
  // serializes exactly as it did before Tier 2 existed - which is what keeps
  // its content hash, and therefore every cached copy of it, valid.
  if (tier2.length > 0) {
    manifest.modules = ['interactions-tier2']
    manifest.tier2 = tier2.map(tier2Declaration)
  }
  return manifest
}

/**
 * The page stylesheet, with its compiled motion.
 *
 * A page that animates nothing keeps its CSS byte for byte: keyframes there
 * would be dead weight downloaded by every visitor, which is the exact cost
 * the dependency model exists to avoid. When there IS motion the shared
 * keyframes are emitted ONCE, not per class.
 */
export function composeCss(page: PageInput): string {
  const settled = settleInteractions(page)
  const own = typeof page.pageCss === 'string' ? page.pageCss : ''
  if (settled.length === 0) return own ? [page.css, own].filter(Boolean).join('\n') : page.css
  return [page.css, KEYFRAMES_CSS, ...settled.map((s) => s.css), own].filter(Boolean).join('\n')
}

/**
 * The content address of a page.
 *
 * Identical content must yield an identical id, so republishing an unchanged
 * page does not churn caches or create a pointless version.
 *
 * Interactions are part of the address. A version that ignored them would let
 * a page whose motion changed keep its old id - and immutable caching would
 * then serve the previous motion forever.
 */
export function artifactId(page: PageInput): string {
  const input = canonical(stripAuthoring({
    route: page.route,
    blocks: page.blocks,
    css: composeCss(page),
    runtime: runtimeManifest(page),
    // Undefined is dropped by `canonical`, so a page without surfaces hashes
    // exactly as it did before the key existed.
    surfaces: page.surfaces,
    // Same rule, same reason: a page has no instances map, so its id is the
    // id it had before instances were a thing.
    instances: page.instances,
  }))
  // Two FNV-1a passes over different seeds. Dependency-free by necessity -
  // this package must stay importable anywhere - and wide enough that two
  // pages in one site will not collide.
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x811c9dc5) >>> 0
  }
  return (a.toString(36) + b.toString(36)).slice(0, 12)
}

/** Every block type on the page, deduplicated, however deeply nested. */
function collectDependencies(blocks: unknown): string[] {
  const found = new Set<string>()
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (!n || typeof n !== 'object') return
    const type = (n as { _type?: unknown })._type
    if (typeof type === 'string') found.add(type)
    for (const v of Object.values(n as Record<string, unknown>)) walk(v)
  }
  walk(blocks)
  return [...found]
}

/** The immutable path of one artifact file. */
export function artifactPath(version: string, file: string): string {
  return `${ROOT}/builds/${version}/${file}`
}

/**
 * The mutable pointer for a route.
 *
 * Routes are author-supplied and become file paths, so traversal is refused
 * outright rather than sanitised into something surprising.
 */
export function routePointerPath(route: string): string {
  if (route.includes('..')) {
    throw new Error(`Route "${route}" cannot contain ".."`)
  }
  const clean = route.replace(/^\/+|\/+$/g, '')
  if (!/^[A-Za-z0-9/_-]*$/.test(clean)) {
    throw new Error(`Route "${route}" has characters that cannot be a path`)
  }
  // The root route still needs a name of its own.
  return `${ROOT}/routes/${clean === '' ? '_root' : clean}.json`
}

/** Compiles a page into its published form. */
export function buildArtifact(page: PageInput): PageArtifact {
  const blocks = stripAuthoring(page.blocks) as Array<Record<string, unknown>>
  const artifact: PageArtifact = {
    version: artifactId(page),
    route: page.route,
    blocks,
    css: composeCss(page),
    dependencies: collectDependencies(blocks),
    runtime: runtimeManifest(page),
  }
  // Added, never always present - see PageArtifact.surfaces. The dependency
  // list is recomputed once, over everything the artifact actually carries:
  // a runtime that activated only the page's block types would leave a
  // header, or an instance, rendered by nothing.
  const shared: unknown[] = [blocks]
  if (page.surfaces !== undefined) {
    const surfaces = page.surfaces.map((s) => ({
      name: s.name, position: s.position,
      blocks: stripAuthoring(s.blocks) as Array<Record<string, unknown>>,
    }))
    artifact.surfaces = surfaces
    shared.push(...surfaces.map((s) => s.blocks))
  }
  if (page.instances !== undefined) {
    const instances: PublishedInstances = {}
    for (const [id, tree] of Object.entries(page.instances)) {
      instances[id] = stripAuthoring(tree) as Array<Record<string, unknown>>
      shared.push(instances[id])
    }
    artifact.instances = instances
  }
  if (shared.length > 1) artifact.dependencies = collectDependencies(shared)
  return artifact
}

/** An in-memory provider, for tests and for a dry run. */
export function memoryDelivery(): DeliveryProvider {
  const store = new Map<string, string>()
  return {
    async read(path) { return store.get(path) ?? null },
    async write(path, body) { store.set(path, body) },
    async list(prefix) { return [...store.keys()].filter((k) => k.startsWith(prefix)) },
  }
}

/**
 * Writes a page ATOMICALLY and points its route at the result.
 *
 * Compile, write every immutable artifact, verify each one, and only then
 * move the pointer. A failure at any step throws and changes nothing a
 * visitor can see - the previous published version stays live.
 *
 * Verification is a read-back rather than trust: a pointer aimed at an
 * artifact that was never stored turns every visit into a 404, which is the
 * same failure `rollbackRoute` already refuses to create.
 */
export async function publishArtifact(provider: DeliveryProvider, page: PageInput): Promise<PageArtifact> {
  const artifact = buildArtifact(page)

  // CSS is its own file so it can be cached and fetched independently of the
  // page definition, and so a <link> can reach it directly.
  const files: Array<[string, string]> = [
    [artifactPath(artifact.version, 'page.css'), artifact.css],
    [artifactPath(artifact.version, 'page.json'), JSON.stringify(artifact)],
  ]

  for (const [path, body] of files) {
    try {
      await provider.write(path, body)
    } catch (err) {
      throw new Error(
        `Could not publish ${path}: ${err instanceof Error ? err.message : String(err)}. `
        + 'Nothing was changed - the previous published version is still live.',
      )
    }
    // Read back rather than trusting the write. Storage that accepts a write
    // and keeps nothing - or keeps part of it - is worse than storage that
    // throws, because only reading reveals it, and by then the pointer would
    // already be aimed at an artifact that is not there.
    if (await provider.read(path) !== body) {
      throw new Error(
        `Could not verify ${path} after writing it. `
        + 'Nothing was changed - the previous published version is still live.',
      )
    }
  }

  // The pointer moves LAST and only once every artifact is verified. This
  // ordering is the whole guarantee: a failure anywhere above leaves the
  // route serving the previous version, and a pointer can never aim at
  // something that was never stored.
  await provider.write(
    routePointerPath(page.route),
    JSON.stringify({ route: page.route, version: artifact.version }),
  )
  return artifact
}

/** The version a route currently serves, or null when nothing is published. */
export async function resolveRoute(provider: DeliveryProvider, route: string): Promise<string | null> {
  const raw = await provider.read(routePointerPath(route))
  if (!raw) return null
  try {
    const v = (JSON.parse(raw) as { version?: unknown }).version
    return typeof v === 'string' ? v : null
  } catch {
    // A corrupt pointer reads as unpublished: a visitor gets a 404 rather
    // than a server error.
    return null
  }
}

/**
 * Points a route back at an earlier version.
 *
 * Refuses a version that was never published, because a pointer to a missing
 * artifact turns every visit into a 404 - the opposite of what a rollback is
 * for.
 */
export async function rollbackRoute(
  provider: DeliveryProvider, route: string, version: string,
): Promise<void> {
  const exists = await provider.read(artifactPath(version, 'page.json'))
  if (!exists) {
    throw new Error(`Version "${version}" has not been published, so there is nothing to roll back to`)
  }
  await provider.write(routePointerPath(route), JSON.stringify({ route, version }))
}
