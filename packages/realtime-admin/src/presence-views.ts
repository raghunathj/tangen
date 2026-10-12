/**
 * File Name: presence-views.ts
 * Purpose: The pure selectors the admin's presence views are built from -
 *          who else is editing one field, and which people are on one row
 *          of a list - shaped so a selector-based hook re-renders a field
 *          or a row only when ITS people change.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tasks/realtime-client-architecture.md sections 16-18
 *          (selector reactivity: a component subscribes to the smallest
 *          slice it needs) and 22-24 (field presence is advisory, "Omkar is
 *          editing this field", never a lock). Two rules make the selector
 *          rule hold without a custom equals: the functions return the
 *          store's own session objects rather than copies, and the client
 *          store keeps an untouched member's object identity across
 *          changes to other members, so the default shallow equality sees
 *          the same references and skips the render. A person with two
 *          tabs on the same field is one person here (deduped by member,
 *          then key, then session), as EditingPresence does in the header.
 *          Own sessions - this tab and my other tabs - are never "others".
 *          A field matches its ROOT: a session addressed inside it
 *          (`sections.k1.children.k2`, the way Studio names a block) lands
 *          on the `sections` label, and the words name the root.
 */
import type { PresenceScopeSnapshot, PresenceSession } from '@tangen/realtime'

const NOBODY: ReadonlyArray<PresenceSession> = Object.freeze([]) as unknown as ReadonlyArray<PresenceSession>

/** One key per person: the member, else the API key, else the session itself. */
const personKey = (s: PresenceSession): string => s.memberId ?? s.apiKeyId ?? s.id

/** The sessions that are not mine (this tab, or another tab under my member), one per person, oldest first. */
function othersOf(snapshot: Pick<PresenceScopeSnapshot, 'members' | 'self'>, currentMemberId: string | null, keep: (s: PresenceSession) => boolean): PresenceSession[] {
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

// ── Addressing inside a field ────────────────────────────────────────────────
// A session's `field` may be a dotted address under a top-level field: Studio
// publishes the selected block as `<blocksField>.<key>.<slot>.<key>` and a
// shared surface's block as `_surfaces.<global>.<chain>` (docs/realtime.md,
// "Addressing inside a field"). The object editor's bare field name is the
// ROOT of that address, so a label matches the root and the words name it.

/** The reserved root under which Studio addresses a shared surface's blocks. */
export const SURFACES_ROOT = '_surfaces'

/** Whether a session's field is this address or anything nested under it (never a sibling sharing a prefix). */
export function fieldAtOrUnder(sessionField: string | null | undefined, address: string): boolean {
  if (!sessionField || !address) return false
  return sessionField === address || sessionField.startsWith(`${address}.`)
}

/**
 * The top-level field an address belongs to: `sections` for
 * `sections.k1.children.k2`, `title` for `title`. A shared surface's
 * address names its global (`siteHeader` for `_surfaces.siteHeader.k1`),
 * which is no field of the object; null for nothing or a bare `_surfaces`.
 */
export function fieldRootOf(field: string | null | undefined): string | null {
  if (!field) return null
  const dot = field.indexOf('.')
  const root = dot === -1 ? field : field.slice(0, dot)
  if (root !== SURFACES_ROOT) return root
  const rest = dot === -1 ? '' : field.slice(dot + 1)
  const next = rest.indexOf('.')
  const global = next === -1 ? rest : rest.slice(0, next)
  return global || null
}

/**
 * The other people editing one field right now (`state: 'editing'` with
 * `field` on this one, or on an address nested under it), one session per
 * person, the store's own objects. The same frozen empty array every time
 * nobody is, so a field with no editors never re-renders for anyone
 * else's changes.
 * @param snapshot - The scope's presence (`object:<id>`).
 * @param field - The field name this view belongs to, or an address inside it.
 * @param currentMemberId - The signed-in member; their sessions are excluded.
 */
export function othersEditingField(
  snapshot: Pick<PresenceScopeSnapshot, 'members' | 'self'>,
  field: string,
  currentMemberId: string | null,
): ReadonlyArray<PresenceSession> {
  if (!field) return NOBODY
  const out = othersOf(snapshot, currentMemberId, (s) => s.state === 'editing' && fieldAtOrUnder(s.field, field))
  return out.length === 0 ? NOBODY : out
}

/**
 * "editing Sections", "editing", "idle", "viewing": what a session is doing,
 * naming the owning root of a dotted address rather than the raw chain,
 * through `fieldLabel` when the caller knows the field's label.
 * @param session - The session's state and field.
 * @param fieldLabel - The label for a root field name; a null or empty answer falls back to the name.
 */
export function sessionDoing(
  session: Pick<PresenceSession, 'state'> & { field?: string | null },
  fieldLabel?: (root: string) => string | null | undefined,
): string {
  if (session.state === 'editing') {
    const root = fieldRootOf(session.field)
    if (!root) return 'editing'
    return `editing ${fieldLabel?.(root) || root}`
  }
  return session.state === 'idle' ? 'idle' : 'viewing'
}

/** Copy for the avatar's tooltip and accessible name. */
export function editingFieldLabel(session: Pick<PresenceSession, 'name'>): string {
  return `${session.name} is editing this field`
}

/** Initials for an avatar without an image: the first letters of the first two name parts. */
export function initialsOf(name: string): string {
  return name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?'
}

// ── Rows of a list (the per-type aggregate) ───────────────────────────────────

/**
 * The other people on one object of a list, read from the per-type
 * aggregate scope (`objects:<type>`, whose sessions carry `objectId`):
 * editors first, then by arrival, one per person, the store's own objects.
 * The same frozen empty array whenever nobody is there, so a row with no
 * one on it never re-renders for the other rows' changes.
 * @param snapshot - The aggregate scope's presence.
 * @param objectId - The row's object id.
 * @param currentMemberId - The signed-in member; their sessions are excluded.
 */
export function othersOnObject(
  snapshot: Pick<PresenceScopeSnapshot, 'members' | 'self'>,
  objectId: string,
  currentMemberId: string | null,
): ReadonlyArray<PresenceSession> {
  if (!objectId) return NOBODY
  const out = othersOf(snapshot, currentMemberId, (s) => s.objectId === objectId)
  if (out.length === 0) return NOBODY
  return out.sort((a, b) => Number(b.state === 'editing') - Number(a.state === 'editing') || a.since - b.since)
}

export interface RowPresenceModel {
  /** The avatars to draw, at most `max`. */
  avatars: ReadonlyArray<PresenceSession>
  /** How many more people are on the row beyond the avatars drawn. */
  more: number
  /** Someone on the row is editing it. */
  editing: boolean
}

const EMPTY_ROW: RowPresenceModel = Object.freeze({ avatars: NOBODY, more: 0, editing: false })

/**
 * What a row draws for its people: the first `max` as avatars, the rest as
 * a "+N", and whether any of them is editing. Pure; the selector above
 * feeds it, so the row's render is a formatting step.
 * @param people - othersOnObject's result (editors first).
 * @param max - Avatars to draw before "+N". Default 3.
 */
export function rowPresenceModel(people: ReadonlyArray<PresenceSession>, max = 3): RowPresenceModel {
  if (people.length === 0) return EMPTY_ROW
  const cap = Math.max(0, max)
  return {
    avatars: people.length > cap ? people.slice(0, cap) : people,
    more: Math.max(0, people.length - cap),
    editing: people.some((s) => s.state === 'editing'),
  }
}

/** Copy for a row avatar's tooltip: "Priya is editing", with the field's root when it is known. */
export function rowPresenceLabel(session: Pick<PresenceSession, 'name' | 'state' | 'field'>): string {
  return `${session.name} is ${sessionDoing(session)}`
}
