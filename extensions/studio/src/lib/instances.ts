/**
 * File Name: instances.ts
 * Purpose: INSTANCES - one shared authored tree, referenced from many pages.
 *   The pure model: which content type is an instance type rather than a page
 *   type, where an instance is placed, how a page addresses one, which
 *   instances a tree references, the cycle refusal that keeps a shared tree
 *   from containing itself, and the detach copy.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure functions over plain data, tested without React or
 *   a server (tasks/plan-studio-instances.md, slice I1).
 *
 *   An Instance is a CONTENT OBJECT of a type the site declares, not a row in
 *   Studio's own key-value store. That is what gives it drafts, publish,
 *   revisions, localization, RBAC, presence and Porter for free - and it is
 *   what a global (one row per workspace, no draft, no status) cannot
 *   give. The cost is that the type must exist, so Studio degrades honestly
 *   when it does not: a reason, never an empty panel that looks like "you
 *   have no instances".
 *
 *   A type with a component field is a Studio PAGE by default, so being an
 *   instance type is DECLARED (`admin.studio = { role: 'instance' }`) rather
 *   than inferred. Placement is declared the same way, on the object: this is
 *   what retires `surfacePosition()`, which guesses a global's edge from a
 *   regex over its name and skips anything that names neither.
 *
 *   V1 has no overrides: an instance is identical everywhere it is used. The
 *   one escape hatch is DETACH, which swaps a single placement for an
 *   independent copy and stops following the source (one way - re-linking
 *   would need equality or merge semantics).
 */
import { INSTANCE_BLOCK_TYPE, composeInstances } from '@tangen/studio-schema'
import type { StudioBlock } from './ops'

// ── The type marker ──────────────────────────────────────────────────────────

/** What `admin.studio.role` must say for a type to be an instance type. */
export const INSTANCE_ROLE = 'instance'

/** What a visual editor treats a content type as. */
export type StudioTypeRole = 'page' | typeof INSTANCE_ROLE

/** The reserved presence/address root for an instance, beside `_surfaces`. */
export const INSTANCES_ROOT = '_instances'

/** The slice of a `GET /types` row the discovery reads. */
export interface InstanceTypeCandidate {
  name: string
  label?: string
  disabled?: boolean
  admin?: { studio?: { role?: unknown } } | null
  fields?: Array<{ name: string; label?: string; fieldType: string; disabled?: boolean; admin?: { hidden?: boolean } }>
}

/**
 * The Studio role a type declares. Matched EXACTLY: a stored admin config is
 * data, and data goes wrong quietly - `'Instance '` read loosely would turn a
 * page type shared for every site that ever typed it.
 */
export function studioRole(type: InstanceTypeCandidate | null | undefined): StudioTypeRole {
  const role = (type?.admin as { studio?: { role?: unknown } } | null | undefined)?.studio?.role
  return role === INSTANCE_ROLE ? INSTANCE_ROLE : 'page'
}

/** True when this type holds shared instances rather than pages. */
export function isInstanceType(type: InstanceTypeCandidate | null | undefined): boolean {
  return studioRole(type) === INSTANCE_ROLE
}

/** The instance type, as Studio needs to read and write it. */
export interface InstanceType {
  type: string
  label: string
  /** The component field holding the shared tree. */
  blocksField: string
  /** The select field carrying `placement`, when the type declares one. */
  placementField: string | null
  /** The field describing what the instance is for, when the type declares one. */
  descriptionField: string | null
}

/** Hidden from the editor by config or by soft-disable - the region rule. */
function excluded(field: { disabled?: boolean; admin?: { hidden?: boolean } }): boolean {
  return field.disabled === true || field.admin?.hidden === true
}

/**
 * Why there is no instance type here. Said rather than shown as an empty
 * panel: "no instances yet" and "this workspace has no instance type" are
 * different facts, and only one of them is fixed by making an instance.
 */
export function instanceTypeAbsent(): string {
  return 'This environment has no Instance type yet. Add one (a type with admin.studio.role = "instance" and a blocks field) and run tangen push.'
}

/**
 * The instance type declared by this environment, or the reason there is
 * none. The FIRST declared one wins: a second is a site's own business, and
 * Studio picking between them by some rule nobody wrote down would be a
 * guess.
 */
export function discoverInstanceType(
  types: InstanceTypeCandidate[] | undefined | null,
): { type: InstanceType | null; reason: string | null } {
  let brokenReason: string | null = null
  for (const t of types ?? []) {
    if (!t || typeof t.name !== 'string' || t.disabled === true) continue
    if (!isInstanceType(t)) continue
    const blocks = (t.fields ?? []).find((f) => f.fieldType === 'component' && !excluded(f))
    if (!blocks) {
      brokenReason ??= `"${t.label || t.name}" is declared as an Instance type but has no component field, so there is no shared tree to edit.`
      continue
    }
    const named = (name: string, fieldType: string): string | null => {
      const f = (t.fields ?? []).find((x) => x.name === name && x.fieldType === fieldType && !excluded(x))
      return f ? f.name : null
    }
    return {
      type: {
        type: t.name,
        label: t.label || t.name,
        blocksField: blocks.name,
        placementField: named('placement', 'select'),
        descriptionField: named('description', 'textarea') ?? named('description', 'text'),
      },
      reason: null,
    }
  }
  return { type: null, reason: brokenReason ?? instanceTypeAbsent() }
}

// ── Placement ────────────────────────────────────────────────────────────────

/** Where the system places an instance. `manual` is placed by hand on a page. */
export type InstancePlacement = 'manual' | 'header' | 'footer'

/** The declared placements, in the order the panel groups them. */
export const INSTANCE_PLACEMENTS: InstancePlacement[] = ['manual', 'header', 'footer']

/**
 * A stored placement value. Anything unrecognised is `manual`, never a guess
 * from the title: pinning a promo strip to the top of every page because its
 * name contains "top" is exactly the wart this model retires.
 */
export function readPlacement(value: unknown): InstancePlacement {
  return value === 'header' || value === 'footer' ? value : 'manual'
}

/** How the panel says a placement. */
export function placementLabel(placement: InstancePlacement): string {
  if (placement === 'header') return 'Header'
  if (placement === 'footer') return 'Footer'
  return 'Placed by hand'
}

// ── The list ─────────────────────────────────────────────────────────────────

/** One instance as the panel lists it. */
export interface InstanceSummary {
  id: string
  title: string
  placement: InstancePlacement
  description?: string
  /** Draft / published, when the row carries it. */
  status?: string
  /**
   * The instances THIS instance references. Carried on the row because a
   * cycle has to be refused before the write, and asking the server for one
   * tree at a time mid-save is a race the editor would lose.
   */
  references?: string[]
}

/** What an instance is called, never a blank row. */
export function instanceTitle(instance: { title?: string | null }): string {
  const title = typeof instance.title === 'string' ? instance.title.trim() : ''
  return title === '' ? 'Untitled instance' : title
}

/** Instances by placement, declaration order kept inside each group. */
export function groupByPlacement<T extends { placement: InstancePlacement }>(
  list: T[],
): Record<InstancePlacement, T[]> {
  return {
    manual: list.filter((i) => i.placement === 'manual'),
    header: list.filter((i) => i.placement === 'header'),
    footer: list.filter((i) => i.placement === 'footer'),
  }
}

/** Title and description search, case-insensitive; an empty query matches all. */
export function searchInstances<T extends { title?: string | null; description?: string | null }>(
  list: T[],
  query: string,
): T[] {
  const q = (query ?? '').trim().toLowerCase()
  if (q === '') return list
  return list.filter((i) => `${i.title ?? ''} ${i.description ?? ''}`.toLowerCase().includes(q))
}

// ── The reference block ──────────────────────────────────────────────────────

/**
 * The wire name of the reference block, and the composition that turns one
 * into the tree it names.
 *
 * Both come from the CONTRACT package rather than being declared here,
 * because the site's renderer resolves references too. Two definitions of
 * what a reference means is two chances for the canvas to show a designer
 * something a visitor will not get.
 */
export { INSTANCE_BLOCK_TYPE, composeInstances }

/**
 * The props Studio OWNS on a reference. Both are set when a reference is
 * placed and neither is drawn as a control: typing an object id into a text
 * box is not an edit anyone means to make, and a label typed by hand would
 * disagree with the instance at the next rename.
 */
export const INSTANCE_REF_PROPS = new Set(['instanceId', 'label'])

/** The slice of a component def the availability check reads. */
interface DefLike { name?: string }

/**
 * Whether a reference may be placed in the slot currently selected, and the
 * def to build it from. Mirrors `loopAvailability`: the SLOT decides, exactly
 * as it does for a drop, so the panel can disable Place with the reason
 * instead of offering a control that quietly does nothing.
 */
export function instanceAvailability<T extends DefLike>(
  defs: T[] | undefined,
): { ok: true; def: T } | { ok: false; reason: string } {
  const def = (defs ?? []).find((d) => d && d.name === INSTANCE_BLOCK_TYPE)
  if (def) return { ok: true, def }
  return {
    ok: false,
    reason: 'This spot does not take an Instance. Enable the Builder Kit on this field, or select a place that does.',
  }
}

/** What a page's reference block carries. */
export interface InstanceRef {
  instanceId: string
  /** Cached, so the tree can still name the row when the instance cannot be read. */
  label: string
}

/** The reference this block is, or null when it is not one. */
export function instanceRefOf(block: unknown): InstanceRef | null {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null
  const b = block as Record<string, unknown>
  if (b._type !== INSTANCE_BLOCK_TYPE) return null
  const instanceId = typeof b.instanceId === 'string' ? b.instanceId.trim() : ''
  if (instanceId === '') return null
  return { instanceId, label: typeof b.label === 'string' ? b.label : '' }
}

/** A fresh reference to one instance, ready to insert. */
export function makeInstanceBlock(
  instance: { id: string; title?: string | null },
  mintKey: () => string,
): StudioBlock {
  return {
    _type: INSTANCE_BLOCK_TYPE,
    _key: mintKey(),
    instanceId: instance.id,
    label: instanceTitle(instance),
  }
}

/** One reference found in a tree. */
export interface FoundReference extends InstanceRef {
  /** The reference block's own `_key`. */
  key: string
}

/** Every reference in a tree, at any depth, in document order. */
export function instanceReferences(tree: unknown): FoundReference[] {
  const out: FoundReference[] = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const entry of value) walk(entry); return }
    if (!value || typeof value !== 'object') return
    const block = value as Record<string, unknown>
    const ref = instanceRefOf(block)
    if (ref) out.push({ key: typeof block._key === 'string' ? block._key : '', ...ref })
    for (const child of Object.values(block)) {
      if (Array.isArray(child) || (child && typeof child === 'object')) walk(child)
    }
  }
  walk(tree)
  return out
}

/**
 * The instances a tree uses, deduped, in first-use order. This is the USAGE
 * question shaped: counting how many PAGES use an instance needs an index or
 * a scan across every page, which is slice I3's job, not this module's.
 */
export function referencedInstanceIds(tree: unknown): string[] {
  return [...new Set(instanceReferences(tree).map((r) => r.instanceId))]
}

// ── The canvas ───────────────────────────────────────────────────────────────

/**
 * Which content a reference shows on the CANVAS, and why.
 *
 * A page is edited against what a VISITOR gets, so a reference shows the
 * instance's published tree - the draft belongs to whoever is editing the
 * instance, and showing it here would let a designer lay out a page against
 * content the site does not have. Editing the instance itself shows its own
 * draft, because that is the document being edited and a canvas that showed
 * the published version would ignore every keystroke.
 *
 * Said out loud rather than left implicit: a canvas that quietly disagrees
 * with the live site is the one failure a visual editor cannot recover from.
 */
export function canvasInstanceNote(editingInstance: boolean): string {
  return editingInstance
    ? 'The canvas shows this instance\'s draft. Pages keep showing the published version until you publish it.'
    : 'Instances on this page show their PUBLISHED content, which is what a visitor gets.'
}

/**
 * Which reference each borrowed block key came from.
 *
 * The site's overlay posts a block key on click and knows nothing about
 * documents. A click inside a composed instance therefore sends a key the
 * host page's tree does not contain, and the editor would select nothing -
 * which reads as broken. This maps it back to the reference row, which is
 * the block the host page actually owns and the one offering Edit instance
 * and Detach.
 *
 * First writer wins where an instance is placed twice: both placements edit
 * the same tree, so either row is a correct answer.
 */
export function borrowedKeyOwners(
  blocks: unknown,
  instances: Record<string, unknown> | null | undefined,
): Map<string, string> {
  const owners = new Map<string, string>()
  if (!instances) return owners

  const claim = (tree: unknown, refKey: string, chain: string[]): void => {
    if (Array.isArray(tree)) { for (const entry of tree) claim(entry, refKey, chain); return }
    if (!tree || typeof tree !== 'object') return
    const block = tree as Record<string, unknown>
    const nested = instanceRefOf(block)
    if (nested && !chain.includes(nested.instanceId)) {
      const inner = instances[nested.instanceId]
      if (Array.isArray(inner)) claim(inner, refKey, [...chain, nested.instanceId])
    }
    const key = typeof block._key === 'string' ? block._key : ''
    if (key !== '' && !owners.has(key)) owners.set(key, refKey)
    for (const child of Object.values(block)) {
      if (child && typeof child === 'object') claim(child, refKey, chain)
    }
  }

  for (const found of instanceReferences(blocks)) {
    const tree = instances[found.instanceId]
    if (Array.isArray(tree) && found.key !== '') claim(tree, found.key, [found.instanceId])
  }
  return owners
}

/**
 * Tree rows relabelled from the LIVE instance titles.
 *
 * A reference caches the instance's title so the tree still reads when the
 * instance cannot be read at all. When it CAN be read, the live title wins:
 * without this a rename would leave every page that uses the instance saying
 * the old name until somebody happened to re-save it, which is a stale label
 * on a document nobody is looking at.
 *
 * Returns the input unchanged (reference-equal) when nothing is relabelled,
 * so a page with no references costs nothing.
 */
export function relabelReferences<T extends { key: string; label: string }>(
  rows: T[],
  refs: FoundReference[],
  titleOf: (id: string) => string | null | undefined,
): T[] {
  const live = new Map<string, string>()
  for (const ref of refs) {
    if (ref.key === '') continue
    const title = titleOf(ref.instanceId)
    if (typeof title === 'string' && title.trim() !== '') live.set(ref.key, `Instance -> ${title.trim()}`)
  }
  if (live.size === 0) return rows
  let changed = false
  const out = rows.map((row) => {
    const label = live.get(row.key)
    if (label === undefined || label === row.label) return row
    changed = true
    return { ...row, label }
  })
  return changed ? out : rows
}

// ── Usage across the environment ─────────────────────────────────────────────

/**
 * One document the usage scan reads: a page, or another instance, with its
 * component-field regions. Both kinds are scanned, because an instance may
 * hold a reference to another one and that is a usage like any other.
 */
export interface UsageDocument {
  id: string
  type: string
  title: string
  /** Whether this document is itself an instance, so the message can say so. */
  isInstance: boolean
  /** Every component-field region of the document; each is a block list. */
  regions: unknown[]
}

/** One document that uses an instance, and how many times. */
export interface InstanceUser {
  id: string
  type: string
  title: string
  isInstance: boolean
  placements: number
}

/** How many places an instance is used, and which documents they are in. */
export interface InstanceUsage {
  placements: number
  users: InstanceUser[]
}

/**
 * Usage by instance id across every document scanned. An instance nobody
 * uses is ABSENT rather than zero, so a caller cannot mistake "not scanned"
 * for "not used".
 *
 * A scan rather than a maintained index, for the same reason class usage is
 * one: a stale index answering zero is the single wrong answer that leads to
 * a delete. It also gets DETACH right for free - a detached placement holds
 * ordinary blocks and no reference, so it stops being counted the moment it
 * stops following the source, where an index would have to remember to
 * forget the row.
 */
export function instanceUsageAcrossPages(documents: UsageDocument[]): Record<string, InstanceUsage> {
  const out: Record<string, InstanceUsage> = {}
  for (const doc of documents) {
    const here = new Map<string, number>()
    for (const region of doc.regions) {
      for (const found of instanceReferences(region)) {
        here.set(found.instanceId, (here.get(found.instanceId) ?? 0) + 1)
      }
    }
    for (const [id, placements] of here) {
      const entry = (out[id] ??= { placements: 0, users: [] })
      entry.placements += placements
      entry.users.push({ id: doc.id, type: doc.type, title: doc.title, isInstance: doc.isInstance, placements })
    }
  }
  return out
}

/** "1 page", "2 pages and 1 instance" - what the users of an instance are. */
function whereUsed(users: InstanceUser[]): string {
  const pages = users.filter((u) => !u.isInstance).length
  const instances = users.length - pages
  const parts: string[] = []
  if (pages > 0) parts.push(`${pages} page${pages === 1 ? '' : 's'}`)
  if (instances > 0) parts.push(`${instances} instance${instances === 1 ? '' : 's'}`)
  return parts.join(' and ')
}

/**
 * The honest statement of consequence, said BEFORE an edit rather than
 * discovered after one. This is the whole compensation V1 offers for having
 * no overrides: an instance is identical everywhere it is used, so the
 * number of places it is used is the size of every edit.
 */
export function usageSentence(title: string, usage: InstanceUsage | undefined | null): string {
  const placements = usage?.placements ?? 0
  if (placements === 0 || !usage) {
    return `Nothing uses "${title}" yet, so changing it changes nothing else.`
  }
  const count = placements === 1 ? 'will update 1 usage' : `will update all ${placements} usages`
  return `Changes to "${title}" ${count}, on ${whereUsed(usage.users)}.`
}

/**
 * The consequence line when the count is NOT in.
 *
 * "Nobody uses this" and "nobody has counted yet" are different facts, and
 * `usageSentence` cannot tell them apart because an absent entry means both.
 * A confirmation that has to say something must not say the reassuring one:
 * telling somebody that changing a shared tree "changes nothing else", when
 * the scan simply has not answered, is the single wrong answer that leads to
 * an edit nobody meant.
 */
export function usageUnknownSentence(title: string): string {
  return `Changes to "${title}" reach every page that uses it. That count could not be read here, so treat it as more than one.`
}

/**
 * The honest consequence, whether or not the count is in. Takes the whole
 * MAP rather than one entry, so a caller cannot accidentally pass the
 * undefined that means "not counted" where the one that means "not used"
 * was intended.
 */
export function usageConsequence(
  title: string,
  usage: Record<string, InstanceUsage> | null | undefined,
  id: string,
): string {
  return usage ? usageSentence(title, usage[id]) : usageUnknownSentence(title)
}

/** How many users a refusal names before it starts counting them instead. */
const NAMED_USERS = 5

/** How a user of an instance is named in a refusal. */
function userName(user: InstanceUser): string {
  return user.isInstance ? `the "${user.title}" instance` : user.title
}

/**
 * Why this instance may NOT be deleted, or null when it may.
 *
 * Deleting one that is in use leaves a gap on every page using it, and the
 * person deleting it is usually not looking at any of them. So the refusal
 * NAMES where, and says what to do instead - detach the placements to keep
 * what was authored, or remove them - because "in use" alone is a puzzle
 * rather than a fix.
 */
export function instanceDeleteRefusal(title: string, usage: InstanceUsage | undefined | null): string | null {
  if (!usage || usage.placements === 0) return null
  const named = usage.users.slice(0, NAMED_USERS).map(userName)
  const rest = usage.users.length - named.length
  const list = rest > 0 ? `${named.join(', ')}, and ${rest} more` : named.join(', ')
  return `"${title}" is still used in ${usage.placements} place${usage.placements === 1 ? '' : 's'}, on ${whereUsed(usage.users)}: ${list}. `
    + 'Detach those placements to keep what was authored, or remove them, and then delete it.'
}

// ── Cycles ───────────────────────────────────────────────────────────────────

/** A refused save, with the chain that caused it. */
export interface InstanceCycle {
  /** Instance ids, first to last; the last repeats an earlier one. */
  chain: string[]
  /** The refusal as a person reads it, naming every step. */
  reason: string
}

export interface CycleInput {
  /** The instance being saved, or null when the tree is a page's. */
  rootId: string | null
  /** The tree about to be written. */
  tree: unknown
  /** The instances one instance references, or undefined when it cannot be read. */
  referencesOf: (id: string) => string[] | undefined
  /** An instance's title, for the message. */
  labelOf: (id: string) => string
}

/**
 * The cycle this write would create, or null.
 *
 * An instance may hold a reference to another instance, so A -> B -> A is
 * reachable in two saves and would render forever. Refused with the CHAIN
 * named: "Latest Articles -> Newsletter CTA -> Latest Articles" is a fix,
 * where "circular reference" is a puzzle. An instance nobody can read is
 * treated as referencing nothing rather than as an error - the save is
 * refused for cycles, not for a missing row.
 */
export function findInstanceCycle({ rootId, tree, referencesOf, labelOf }: CycleInput): InstanceCycle | null {
  const direct = referencedInstanceIds(tree)
  if (rootId === null) return null

  // Depth-first from the root over the graph the write would create, with the
  // path carried so the refusal can name it.
  const seen = new Set<string>()
  const walk = (id: string, path: string[]): string[] | null => {
    if (path.includes(id)) return [...path, id]
    // A node already cleared on another branch cannot start a cycle - this is
    // what keeps a diamond (two instances sharing a third) from reading as one.
    if (seen.has(id)) return null
    const next = path.concat(id)
    for (const child of referencesOf(id) ?? []) {
      const found = walk(child, next)
      if (found) return found
    }
    seen.add(id)
    return null
  }

  for (const id of direct) {
    const chain = walk(id, [rootId])
    if (chain) {
      const named = chain.map(labelOf).join(' -> ')
      return {
        chain,
        reason: `An Instance cannot contain itself: ${named}. Remove one of those references and try again.`,
      }
    }
  }
  return null
}

// ── Loop context inside a shared tree ────────────────────────────────────────

/** The only binding root a template has: the loop's own record. */
const LOOP_ROOT = 'item.'

/** A prop bound to something other than the loop record. */
export interface PageBoundProp {
  key: string
  prop: string
  bind: string
}

/**
 * Props inside a tree bound to anything other than the enclosing loop's
 * record. A loop inside an instance may query a collection freely - that is
 * the whole Instance + Loop composition - but a prop reading the HOST page's
 * record is meaningless in a tree that renders on many pages.
 */
export function pageBoundProps(tree: unknown): PageBoundProp[] {
  const out: PageBoundProp[] = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const entry of value) walk(entry); return }
    if (!value || typeof value !== 'object') return
    const block = value as Record<string, unknown>
    const key = typeof block._key === 'string' ? block._key : ''
    for (const [prop, child] of Object.entries(block)) {
      if (!child || typeof child !== 'object') continue
      const bind = (child as { $bind?: unknown }).$bind
      if (typeof bind === 'string') {
        if (!bind.startsWith(LOOP_ROOT)) out.push({ key, prop, bind })
        continue
      }
      walk(child)
    }
  }
  walk(tree)
  return out
}

/** The refusal for those props, or null when there are none. */
export function pageBindingRefusal(found: PageBoundProp[]): string | null {
  if (found.length === 0) return null
  const named = [...new Set(found.map((f) => f.bind))].join(', ')
  return `An Instance is shared by every page that uses it, so a value taken from the page's own record has nothing to read here: ${named}. Bind inside a Loop instead, or put this block on the page.`
}

// ── Detach ───────────────────────────────────────────────────────────────────

/** Deep copy with a fresh `_key` at every depth. */
function freshKeys(value: unknown, mintKey: () => string): unknown {
  if (Array.isArray(value)) return value.map((v) => freshKeys(v, mintKey))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = k === '_key' ? mintKey() : freshKeys(v, mintKey)
    }
    return out
  }
  return value
}

/**
 * The blocks a DETACHED placement gets: an independent copy of the instance's
 * tree with fresh keys, owned by the page from then on.
 *
 * Detaching is one way in V1. The copy is ordinary blocks - edited, styled and
 * translated like anything else the page owns - and it stops following the
 * source, so a later instance edit does not reach it and it is not a usage.
 * There is no third state: a placement either follows the source exactly, or
 * is detached entirely. Re-linking would need equality or merge semantics,
 * which is the override system V1 deliberately does not open.
 */
export function detachedBlocks(blocks: unknown, mintKey: () => string): StudioBlock[] {
  if (!Array.isArray(blocks)) return []
  return blocks
    .filter((b) => !!b && typeof b === 'object' && !Array.isArray(b))
    .map((b) => freshKeys(b, mintKey) as StudioBlock)
}
