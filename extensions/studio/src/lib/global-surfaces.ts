/**
 * File Name: global-surfaces.ts
 * Purpose: Global SURFACES - the header and footer every page shares. A
 *   Tangen global with a component field is one; this is the pure model of
 *   which globals qualify, where each pins onto a page, how a save body is
 *   shaped for the platform's globals route, and who may edit one.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure functions, tested without React or a server.
 *
 *          A global has no draft and no publish: a write to
 *          `PATCH /api/v1/globals/:name` is live for every reader at once.
 *          That is why a surface is saved EXPLICITLY in Studio rather than
 *          autosaved like the page, and why the save body carries only the
 *          surface field - the rest of the global (a site name, a logo) is
 *          somebody else's and must come through untouched.
 *
 *          Where a surface pins is read from its NAMES (the global's name
 *          and label, the field's name and label), because a global's field
 *          config is a closed type with no room for a position key. A global
 *          that names neither is listed with the reason instead of being
 *          guessed onto one edge of the page.
 */
import type { FieldDefinition } from '@tangen/types'

/** Which edge of the page a surface pins to. */
export type SurfacePosition = 'header' | 'footer'

/** The slice of a workspace global definition the discovery reads. */
export interface GlobalCandidate {
  name: string
  label?: string
  fields?: Array<{
    name: string
    label?: string
    fieldType: string
    config?: Record<string, unknown>
    disabled?: boolean
    admin?: { hidden?: boolean }
  }>
}

/** A global that is a Studio surface. */
export interface GlobalSurface {
  /** The global's name - the key of the platform route. */
  global: string
  label: string
  /** The component field holding the surface's blocks. */
  field: FieldDefinition
  position: SurfacePosition
}

/** A global with a blocks field Studio could not place. */
export interface SkippedGlobal {
  global: string
  reason: string
}

/** A surface with the blocks it currently holds. */
export interface LoadedSurface {
  surface: GlobalSurface
  blocks: Array<Record<string, unknown>>
}

/**
 * The delivery route the shared surfaces publish under - reserved beside
 * `/_styles`, for the same reason: a page slugged `_surfaces` would move this
 * pointer at its next publish and take the header off every page.
 */
export const SURFACES_ROUTE = '/_surfaces'

/**
 * Where a surface goes, from the names that describe it. Footer wins when
 * both words appear ("footer navigation" is a footer), and nothing matching
 * is null rather than a default: pinning a promo strip to the top of every
 * page because nobody said otherwise is the guess a marketer cannot undo.
 */
export function surfacePosition(names: string[]): SurfacePosition | null {
  const text = names.filter((n) => typeof n === 'string').join(' ')
  if (/footer|bottom/i.test(text)) return 'footer'
  if (/header|nav|top|masthead/i.test(text)) return 'header'
  return null
}

/** Hidden from the editor by config or by soft-disable - the region rule. */
function excluded(field: { disabled?: boolean; admin?: { hidden?: boolean } }): boolean {
  return field.disabled === true || field.admin?.hidden === true
}

/**
 * The globals that are surfaces, one per global: its FIRST editable
 * component field, positioned by name. A global with a blocks field and no
 * position is reported, not dropped - the label is what tells a developer
 * why their header is not on the canvas.
 */
export function discoverGlobalSurfaces(
  globals: GlobalCandidate[] | undefined,
): { surfaces: GlobalSurface[]; skipped: SkippedGlobal[] } {
  const surfaces: GlobalSurface[] = []
  const skipped: SkippedGlobal[] = []
  for (const g of globals ?? []) {
    if (!g || typeof g.name !== 'string') continue
    const field = (g.fields ?? []).find((f) => f.fieldType === 'component' && !excluded(f))
    if (!field) continue
    const position = surfacePosition([g.name, g.label ?? '', field.name, field.label ?? ''])
    if (!position) {
      skipped.push({
        global: g.name,
        reason: `"${g.label || g.name}" has a blocks field but nothing in its name says header or footer, so Studio cannot place it`,
      })
      continue
    }
    surfaces.push({ global: g.name, label: g.label || g.name, field: field as unknown as FieldDefinition, position })
  }
  return { surfaces, skipped }
}

/** The surface's blocks out of the stored global, junk-tolerant. */
export function surfaceBlocks(
  data: Record<string, unknown> | undefined | null,
  surface: GlobalSurface,
): Array<Record<string, unknown>> {
  const raw = data?.[surface.field.name]
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []
}

/** Loaded surfaces by the edge they pin to, in the order they were declared. */
export function pinSurfaces(loaded: LoadedSurface[]): { header: LoadedSurface[]; footer: LoadedSurface[] } {
  return {
    header: loaded.filter((s) => s.surface.position === 'header'),
    footer: loaded.filter((s) => s.surface.position === 'footer'),
  }
}

/**
 * The body for `PATCH /api/v1/globals/:name`: the surface field alone. PATCH
 * merges top-level keys, so every other field of the global survives.
 */
export function surfaceSaveBody(surface: GlobalSurface, blocks: Array<Record<string, unknown>>): Record<string, unknown> {
  return { [surface.field.name]: blocks }
}

/**
 * The narrow Studio capability that grants saving an APPROVED surface.
 *
 * Deliberately not the platform's `globals` scope: that scope is arbitrary
 * write access to every global of the workspace, including the ones holding
 * API ids and site settings, which is why granting it turns an editor into
 * something close to an admin. This capability is bounded by what
 * `discoverGlobalSurfaces` classifies as a surface, and by the surface FIELD
 * of that global, so the widest thing it can ever do is change the header
 * and footer blocks a designer already put there.
 */
export const SURFACE_CAPABILITY = 'studio:globals'

/** The globals scope, as a permission bundle carries it. */
interface GlobalsScope {
  actions?: string[]
  allowedNames?: string[]
}

/**
 * The slice of the member's permission bundle the editability rule reads.
 *
 * Two shapes, because the editor hands this function the whole `me` object
 * from `GET /me/permissions`, where the SCOPES sit nested under
 * `permissions` and the expanded capability list sits at the top. The flat
 * shape is what a caller holding a bare bundle uses.
 */
export interface SurfaceBundle {
  capabilities?: string[] | 'all'
  permissions?: { admin?: boolean; globals?: GlobalsScope } | { admin: true }
  globals?: GlobalsScope
}

/** How a member came by the right to save a surface. */
export type SurfaceWriteVia = 'admin' | 'capability' | 'globals-scope'

export type SurfaceAccess = { ok: true; via: SurfaceWriteVia } | { ok: false; reason: string }

/** The globals scope of either bundle shape. */
function globalsScope(bundle: SurfaceBundle): GlobalsScope | undefined {
  const nested = (bundle.permissions as { globals?: GlobalsScope } | undefined)?.globals
  return bundle.globals ?? nested
}

/** The platform-wide fast path: an owner or admin session. */
function isAdminBundle(bundle: SurfaceBundle): boolean {
  if (bundle.capabilities === 'all') return true
  return (bundle.permissions as { admin?: boolean } | undefined)?.admin === true
}

/**
 * Whether this member may write a shared surface, and through WHICH door -
 * the server's gates restated for the editor, so a refusal is shown before a
 * save rather than as a 403 after it.
 *
 * Three ways in, checked in the order that keeps the answer stable:
 *
 * 1. an admin bundle, on the platform-wide fast path;
 * 2. `studio:globals`, the narrow Studio capability, enforced by Studio's own
 *    `PATCH surfaces/:global` and bounded to approved surfaces;
 * 3. the platform `globals` scope with `write`, enforced by the platform's
 *    own globals route and narrowed by `allowedNames` when it lists names.
 *
 * `via` is not decoration: it decides which ROUTE the save takes, so a
 * member who holds only the old scope keeps working exactly as before.
 */
export function canEditSurfaces(bundle: SurfaceBundle | null | undefined, global: string): SurfaceAccess {
  if (!bundle) return { ok: false, reason: 'Your permissions have not loaded yet' }
  if (isAdminBundle(bundle)) return { ok: true, via: 'admin' }
  const held = bundle.capabilities
  if (Array.isArray(held) && held.includes(SURFACE_CAPABILITY)) return { ok: true, via: 'capability' }
  const scope = globalsScope(bundle)
  if (!scope?.actions?.includes('write')) {
    return {
      ok: false,
      reason: 'Your role cannot save shared surfaces. It needs the Studio capability studio:globals ("Save the shared header and footer"), or the platform globals scope with write.',
    }
  }
  if (scope.allowedNames && !scope.allowedNames.includes(global)) {
    return { ok: false, reason: `Your role is not permitted to edit the "${global}" global` }
  }
  return { ok: true, via: 'globals-scope' }
}

/**
 * The surface a write may name, or null.
 *
 * "Approved" means declared as a surface IN CODE: a global the discovery
 * classified as a header or a footer. Nothing else is reachable through the
 * Studio write route, which is what keeps a grant of `studio:globals` from
 * ever becoming arbitrary globals write access. The match is exact, because
 * a global name is an identifier and a near miss is a mistake, not an
 * intention.
 */
export function approvedSurface(surfaces: GlobalSurface[], global: string): GlobalSurface | null {
  if (!global) return null
  return surfaces.find((s) => s.global === global) ?? null
}

/**
 * The blocks a surface write may store, refusing everything else.
 *
 * A global also carries a site name, a logo, an analytics id. The Studio
 * route may touch exactly ONE field of it, so a body naming any other key is
 * refused BY NAME rather than quietly dropped: a save that silently ignores
 * half of what it was sent is worse than one that says no.
 */
export function readSurfaceWrite(surface: GlobalSurface, body: unknown): Array<Record<string, unknown>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('A surface save needs an object holding the surface field')
  }
  const field = surface.field.name
  const b = body as Record<string, unknown>
  const extra = Object.keys(b).filter((k) => k !== field)
  if (extra.length > 0) {
    throw new Error(`Studio may only write the "${field}" field of "${surface.global}" - refused: ${extra.join(', ')}`)
  }
  if (!(field in b)) throw new Error(`A surface save needs the "${field}" field`)
  const blocks = b[field]
  if (!Array.isArray(blocks) || blocks.some((x) => !x || typeof x !== 'object' || Array.isArray(x))) {
    throw new Error(`"${field}" must be a list of blocks`)
  }
  return blocks as Array<Record<string, unknown>>
}

/** Whether a block tree holds a key, at any depth. */
function holdsKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((v) => holdsKey(v, key))
  if (!value || typeof value !== 'object') return false
  const b = value as Record<string, unknown>
  if (b._key === key) return true
  return Object.values(b).some((v) => (Array.isArray(v) || (v && typeof v === 'object')) && holdsKey(v, key))
}

/**
 * The surface holding a block key, or null when the page owns it. The
 * site's overlay posts a key on click and does not know which document it
 * came from; this is how a click on the header lands in the header.
 */
export function surfaceForKey(loaded: LoadedSurface[], key: string): GlobalSurface | null {
  for (const { surface, blocks } of loaded) {
    if (holdsKey(blocks, key)) return surface
  }
  return null
}

/** "Header: Site header" - the band and the tree name a surface this way. */
export function surfaceLabel(surface: GlobalSurface): string {
  return `${surface.position === 'header' ? 'Header' : 'Footer'}: ${surface.label}`
}

/** Unsaved blocks per surface, keyed by global name. */
export type SurfaceDrafts = Record<string, Array<Record<string, unknown>>>

/** The surface being edited, or null for the page - a vanished one falls back too. */
export function resolveSurface(loaded: LoadedSurface[], wanted: string | null): LoadedSurface | null {
  if (!wanted) return null
  return loaded.find((s) => s.surface.global === wanted) ?? null
}

/** What the editor shows for a surface: its draft, else what is stored. */
export function draftBlocks(loaded: LoadedSurface[], drafts: SurfaceDrafts, global: string): Array<Record<string, unknown>> {
  return drafts[global] ?? resolveSurface(loaded, global)?.blocks ?? []
}

/**
 * The surfaces with unsaved changes. Compared by content, not by the
 * presence of a draft: an edit that was undone back to the stored state has
 * nothing to save, and a Save button that would write the same bytes live
 * is a control that does nothing.
 */
export function dirtySurfaces(loaded: LoadedSurface[], drafts: SurfaceDrafts): string[] {
  const out: string[] = []
  for (const [global, draft] of Object.entries(drafts)) {
    const stored = resolveSurface(loaded, global)?.blocks ?? []
    if (JSON.stringify(draft) !== JSON.stringify(stored)) out.push(global)
  }
  return out
}

/** The loaded list after a save landed - that one surface's stored blocks replaced. */
export function withSavedSurface(loaded: LoadedSurface[], global: string, blocks: Array<Record<string, unknown>>): LoadedSurface[] {
  return loaded.map((s) => (s.surface.global === global ? { ...s, blocks } : s))
}
