/**
 * File Name: presence.ts
 * Purpose: Who else is on this Studio page - the state this session
 *          publishes (with the block it is on, addressed the way the object
 *          editor can read), the others it shows, the words in the top bar,
 *          and the pure selectors a navigator row, a canvas badge and a
 *          surface band are built from.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Realtime R3's presence (docs/realtime.md, "Presence"
 *          and "Field presence"): Studio joins the SAME `object:<id>` scope
 *          the object editor joins, with `typeSlug` so the per-type
 *          aggregate mirrors it, and the same claim semantics - `editing`
 *          while a block is selected or work is unsaved, `viewing`
 *          otherwise, a read-only member never claiming. WHERE the work is
 *          rides in `field`, addressed exactly as Studio addresses a locale
 *          overlay: `<blocksField>.<key>.<slot>.<key>...` for a page block,
 *          `_surfaces.<global>.<chain>` for a block of a shared header or
 *          footer. The object editor's bare field name (`sections`) is the
 *          root of that address, so each side can place the other.
 *
 *          Pure helpers over the snapshot the hooks hand back, so the views
 *          stay renderers and the decisions are tested without a socket.
 *          The block selectors follow the kit's presence-views rules: the
 *          store's own session objects, one frozen empty array for nobody,
 *          one entry per person, my own tabs never "others" - which is what
 *          lets a selector hook skip the render when a row's people did not
 *          change. No cursors, no selections, no live text: the state is
 *          the block's ADDRESS, never its value.
 */
import type { PresenceSession, PresenceState } from '@/kit'
import { keyChain } from './locale-overlay'
import type { BlockRow } from './model'

/**
 * The slice of a presence snapshot these helpers read. Structural, so the
 * module depends on the kit's types only, the way the rest of Studio does.
 */
export interface PresenceSnapshotLike {
  /** This client's own session id, once the server acknowledged the join. */
  self: string | null
  members: readonly PresenceSession[]
}

/** The server keeps `block` and `field` to 200 characters; longer is cut, not refused. */
const ADDRESS_MAX = 200

/** The reserved root under which a shared surface's blocks are addressed. */
export const SURFACES_ROOT = '_surfaces'

/**
 * The reserved root for a shared INSTANCE's blocks. Reserved beside the
 * surfaces root for the same reason: a page field really called `_instances`
 * would put two different documents on one address.
 */
export const INSTANCES_ROOT = '_instances'

/**
 * The object whose presence scope this session joins for the open document.
 *
 * An INSTANCE is a content object, so it already has an `object:<id>` scope
 * of its own - the one the content editor joins for the same row. Joining it
 * is what makes two people editing one instance see each other the way they
 * do on a page, and what makes a colleague editing it in the content editor
 * visible from Studio. Publishing under a reserved root on the PAGE's scope
 * could only ever show the people who happened to be on the same page.
 *
 * A SURFACE is a global. It has no object scope of its own and is genuinely
 * edited from the page, so it keeps the page's - which is why the
 * `_surfaces.<global>` address root exists at all.
 */
export function presenceObjectFor(
  doc: { kind: 'page' } | { kind: 'surface'; global: string } | { kind: 'instance'; id: string },
  pageId: string | null | undefined,
): string | null {
  if (doc.kind === 'instance') return doc.id
  return pageId ?? null
}

// ── The address a session publishes ──────────────────────────────────────────

export interface PresenceFieldInput {
  /** The blocks field being edited (the region's, or the surface's). */
  blocksField: string | null | undefined
  /** The selected block's key chain (`keyChain`), null when nothing is selected or it cannot be addressed yet. */
  chain: readonly string[] | null | undefined
  /** The global being edited, when the document is a shared surface. */
  surface?: string | null
  /** The instance being edited, when the document is a shared instance. */
  instance?: string | null
}

/**
 * The `field` this session publishes. A page block is `<blocksField>.<chain>`,
 * so the object editor's label for that field owns it; a surface block is
 * `_surfaces.<global>.<chain>`, and a surface open with nothing selected is
 * still `_surfaces.<global>`, so the band can say who is in it. Nothing
 * selected on a page publishes no field at all (the object editor's rule:
 * no stale name left behind). An address the server would cut is shortened
 * by whole (slot, key) pairs from the end, so what is sent is always a real
 * ancestor rather than half a key.
 */
export function presenceFieldFor({ blocksField, chain, surface, instance }: PresenceFieldInput): string | undefined {
  const shared = surface
    ? `${SURFACES_ROOT}.${surface}`
    : instance
      ? `${INSTANCES_ROOT}.${instance}`
      : null
  const root = shared ?? blocksField
  if (!root) return undefined
  const segments = chain ? [...chain] : []
  if (segments.length === 0) return shared ? root : undefined
  // key, (slot, key)*: drop from the end in pairs until it fits; the root key
  // alone that does not fit falls back to the root.
  while (segments.length > 0) {
    const address = `${root}.${segments.join('.')}`
    if (address.length <= ADDRESS_MAX) return address
    segments.splice(Math.max(0, segments.length - 2))
  }
  return root.length <= ADDRESS_MAX ? root : undefined
}

export type ParsedPresenceField =
  | { kind: 'page'; field: string; chain: string[] }
  | { kind: 'surface'; global: string; chain: string[] }
  | { kind: 'instance'; id: string; chain: string[] }

/** An address read back: the root it belongs to and the chain under it. Null for nothing or a malformed one. */
export function parsePresenceField(field: string | null | undefined): ParsedPresenceField | null {
  if (!field) return null
  const parts = field.split('.')
  if (parts.some((p) => p === '')) return null
  if (parts[0] === SURFACES_ROOT) {
    if (parts.length < 2) return null
    return { kind: 'surface', global: parts[1]!, chain: parts.slice(2) }
  }
  if (parts[0] === INSTANCES_ROOT) {
    if (parts.length < 2) return null
    return { kind: 'instance', id: parts[1]!, chain: parts.slice(2) }
  }
  return { kind: 'page', field: parts[0]!, chain: parts.slice(1) }
}

/** The last block key of an address (keys sit at the even positions of the chain), null for a bare root. */
export function deepestBlockKey(field: string | null | undefined): string | null {
  const parsed = parsePresenceField(field)
  if (!parsed || parsed.chain.length === 0) return null
  const last = parsed.chain.length - 1
  // A chain that ends on a slot name has no block under it yet.
  return last % 2 === 0 ? parsed.chain[last]! : parsed.chain[last - 1]!
}

/** Whether a session's field is this address or anything nested under it (never a sibling sharing a prefix). */
export function fieldAtOrUnder(sessionField: string | null | undefined, address: string): boolean {
  if (!sessionField || !address) return false
  return sessionField === address || sessionField.startsWith(`${address}.`)
}

// ── The state this session publishes ─────────────────────────────────────────

export interface StudioPresenceInput {
  selectedKey: string | null
  breakpoint: string
  /** Whether this member may change the page; a viewer never claims. */
  canEdit: boolean
  /** The selected block's address (`presenceFieldFor`); the shared document alone when one is open with nothing selected. */
  field?: string | null
  /** The page's content type, so the server mirrors the session on the list's aggregate. */
  typeSlug?: string | null
  /** Unsaved work here: editing even with nothing selected, as the object editor's form is. */
  dirty?: boolean
}

/**
 * What this session says it is doing. `editing` while a block is selected,
 * a surface is open or work is unsaved, `viewing` otherwise - the object
 * editor's own rule, so the advisory claim means the same thing from both
 * tools. `block` keeps the bare key for the summary line; `field` carries
 * the address the object editor can place.
 */
export function studioPresenceState(input: StudioPresenceInput): PresenceState {
  const block = input.selectedKey ? input.selectedKey.slice(0, ADDRESS_MAX) : undefined
  const field = input.field ? input.field.slice(0, ADDRESS_MAX) : undefined
  const editing = input.canEdit && (!!block || !!field || !!input.dirty)
  const state: PresenceState = { state: editing ? 'editing' : 'viewing' }
  if (block) state.block = block
  if (field) state.field = field
  if (input.typeSlug) state.typeSlug = input.typeSlug
  state.meta = { breakpoint: input.breakpoint }
  return state
}

// ── The others ───────────────────────────────────────────────────────────────

/** One key per person: the member, else the API key, else the session itself. */
const personKey = (s: PresenceSession): string => s.memberId ?? s.apiKeyId ?? s.id

/** The sessions that are not mine (this tab, or another tab under my member), one per person, in store order. */
function othersOf(snapshot: PresenceSnapshotLike, currentMemberId: string | null, keep: (s: PresenceSession) => boolean): PresenceSession[] {
  const seen = new Set<string>()
  const out: PresenceSession[] = []
  for (const s of snapshot.members) {
    if (s.id === snapshot.self) continue
    if (currentMemberId && s.memberId === currentMemberId) continue
    if (!keep(s)) continue
    const key = personKey(s)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

const editorsFirst = (a: PresenceSession, b: PresenceSession): number =>
  Number(b.state === 'editing') - Number(a.state === 'editing') || a.since - b.since

/**
 * Everyone on the scope who is not me: one entry per person (my own other
 * tabs included in "me"), editors first, then by arrival.
 */
export function othersHere(snapshot: PresenceSnapshotLike, currentMemberId: string | null): PresenceSession[] {
  return othersOf(snapshot, currentMemberId, () => true).sort(editorsFirst)
}

/** The same frozen empty array every time nobody is there, so a row with no editors never re-renders for anyone else. */
const NOBODY: ReadonlyArray<PresenceSession> = Object.freeze([]) as unknown as ReadonlyArray<PresenceSession>

/**
 * The other people editing one block right now - on the block itself or on
 * anything nested under it, so a folded section still shows the work inside
 * it - one session per person, the store's own objects, in store order. A
 * session on the bare blocks field (the object editor, outside any block) is
 * not on a block.
 * @param snapshot - The scope's presence (`object:<id>`).
 * @param address - The row's address (`rowAddresses`), null for a row that has none yet.
 * @param currentMemberId - The signed-in member; their sessions are excluded.
 */
export function othersEditingBlock(
  snapshot: PresenceSnapshotLike,
  address: string | null | undefined,
  currentMemberId: string | null,
): ReadonlyArray<PresenceSession> {
  if (!address) return NOBODY
  const out = othersOf(snapshot, currentMemberId, (s) => s.state === 'editing' && fieldAtOrUnder(s.field, address))
  return out.length === 0 ? NOBODY : out
}

/**
 * The other people editing ANY addressed block right now, whichever
 * document it sits in (the canvas shows the page and its surfaces at once):
 * one per person, the store's own objects. Someone on a bare field or on a
 * surface with nothing selected names no block and is not here.
 * @param snapshot - The page scope's presence.
 * @param currentMemberId - The signed-in member; their sessions are excluded.
 */
export function othersOnAnyBlock(snapshot: PresenceSnapshotLike, currentMemberId: string | null): ReadonlyArray<PresenceSession> {
  const out = othersOf(snapshot, currentMemberId, (s) => s.state === 'editing' && deepestBlockKey(s.field) !== null)
  return out.length === 0 ? NOBODY : out
}

/**
 * The other people in a shared surface - editing a block of it or just
 * looking at it - editors first, one per person, the store's own objects.
 * @param snapshot - The page scope's presence; a surface is edited from a page.
 * @param global - The global's name.
 * @param currentMemberId - The signed-in member; their sessions are excluded.
 */
export function othersInSurface(
  snapshot: PresenceSnapshotLike,
  global: string,
  currentMemberId: string | null,
): ReadonlyArray<PresenceSession> {
  if (!global) return NOBODY
  const out = othersOf(snapshot, currentMemberId, (s) => fieldAtOrUnder(s.field, `${SURFACES_ROOT}.${global}`))
  return out.length === 0 ? NOBODY : out.sort(editorsFirst)
}

/** How many other tabs or devices of mine are on the scope: a forgotten tab explaining itself. */
export function ownOtherTabs(snapshot: PresenceSnapshotLike, currentMemberId: string | null): number {
  if (!currentMemberId) return 0
  let n = 0
  for (const s of snapshot.members) {
    if (s.id !== snapshot.self && s.memberId === currentMemberId) n++
  }
  return n
}

/** Copy for a block badge's tooltip and accessible name. */
export function blockEditingLabel(session: Pick<PresenceSession, 'name'>): string {
  return `${session.name} is editing this block`
}

/**
 * Every navigator row to its presence address, so a row's selector is a
 * string compare. Computed once per tree, not per row per render. A row
 * whose chain has a block without a `_key` yet has no address (a base save
 * mints one), exactly as the locale overlay cannot address it.
 */
export function rowAddresses(
  rows: readonly BlockRow[],
  blocks: unknown,
  doc: { blocksField: string | null | undefined; surface?: string | null; instance?: string | null },
): Map<string, string> {
  const out = new Map<string, string>()
  if (!doc.blocksField) return out
  for (const row of rows) {
    const chain = keyChain(blocks, row.path)
    if (!chain) continue
    const address = presenceFieldFor({
      blocksField: doc.blocksField, chain, surface: doc.surface, instance: doc.instance,
    })
    if (address) out.set(row.key, address)
  }
  return out
}

// ── The words ────────────────────────────────────────────────────────────────

/**
 * "editing Hero heading", "editing Sections", "editing", "viewing", "idle".
 * A field address names its deepest block through `labelFor`; a bare field
 * (the object editor's) is named through `fieldLabel` when the page knows
 * it, else said as it came.
 */
export function sessionDoing(
  s: PresenceSession,
  labelFor: (blockKey: string) => string | null,
  fieldLabel?: (field: string) => string | null,
): string {
  if (s.state === 'editing') {
    const key = deepestBlockKey(s.field) ?? s.block ?? null
    const label = key ? labelFor(key) : null
    if (label) return `editing ${label}`
    if (s.field && !key) return `editing ${fieldLabel?.(s.field) ?? s.field}`
    return 'editing'
  }
  return s.state === 'idle' ? 'idle' : 'viewing'
}

/** The one line beside the avatars. Empty when nobody else is here. */
export function presenceSummary(
  others: readonly PresenceSession[],
  labelFor: (blockKey: string) => string | null,
  fieldLabel?: (field: string) => string | null,
): string {
  if (others.length === 0) return ''
  if (others.length === 1) return `${others[0]!.name} is ${sessionDoing(others[0]!, labelFor, fieldLabel)}`
  const editors = others.filter((s) => s.state === 'editing').map((s) => s.name)
  const editing = editors.length > 0 ? `, ${editors.join(' and ')} editing` : ''
  return `${others.length} others here${editing}`
}

/** Up to two initials from a name or an email; "?" when there is nothing. */
export function initialsOf(name: string): string {
  return name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?'
}

/** Member id -> display name for everyone on the scope, so a change notice can name its actor. */
export function memberNames(snapshot: PresenceSnapshotLike): Map<string, string> {
  const out = new Map<string, string>()
  for (const s of snapshot.members) {
    if (s.memberId && !out.has(s.memberId)) out.set(s.memberId, s.name)
  }
  return out
}
