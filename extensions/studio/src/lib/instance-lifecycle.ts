/**
 * File Name: instance-lifecycle.ts
 * Purpose: The life of an Instance, as pure decisions: naming one, starting
 *   an empty one, turning a section into one, copying one, and the refusals
 *   that stop a shared tree nobody can use from being written.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The rule this module exists to satisfy (user,
 *   2026-08-26): "A designer must be able to create an Instance entirely from
 *   Studio-native Blocks/Layouts, save it, reuse it anywhere, and edit the
 *   shared source." Until I4 the only way to make one was the admin content
 *   editor, which is a developer/editor tool and the wrong place to make a
 *   DESIGN resource.
 *
 *   Nothing here writes. The caller uses the platform's own object create and
 *   draft-save paths - the same ones the New page flow uses - so drafts,
 *   revisions, RBAC and the activity log behave exactly as they do for any
 *   other content. This module only decides WHAT to write and refuses what
 *   should not be written.
 *
 *   The one decision worth naming: a section moved into an instance KEEPS its
 *   block keys. A block's own raw CSS compiles to a selector derived from its
 *   key (`.tg-s-<key>`, owned by the compiler), so re-keying here would
 *   silently detach every section rule from the block it was written for. I3
 *   made the same call for borrowed blocks at compose time, for the same
 *   reason: a key is style identity, not a serial number.
 */
import {
  INSTANCE_BLOCK_TYPE, readPlacement, pageBoundProps, pageBindingRefusal, instanceTitle,
  type InstancePlacement,
} from './instances'
import { cloneWithFreshKeys } from './presets'

/** Longest instance name accepted - beyond this it is a paste accident. */
export const INSTANCE_TITLE_MAX = 200

/** A validated name, or why it is not one. */
export type TitleCheck =
  | { ok: true; title: string }
  | { ok: false; error: string }

/**
 * The name an instance may be given.
 *
 * Names are unique here, unlike page titles, and deliberately: an instance is
 * addressed by NAME everywhere a person meets it - the panel row, the tree's
 * "Instance -> Latest Articles", the usage list in a delete refusal - so two
 * shared trees called the same thing cannot be told apart at exactly the
 * moment it matters. Matched case-insensitively, because "Latest articles"
 * and "Latest Articles" are the same mistake.
 */
export function checkInstanceTitle(raw: unknown, taken: Iterable<string> = []): TitleCheck {
  const title = typeof raw === 'string' ? raw.trim() : ''
  if (title === '') return { ok: false, error: 'Give the instance a name.' }
  if (title.length > INSTANCE_TITLE_MAX) {
    return { ok: false, error: `That name is too long (${INSTANCE_TITLE_MAX} characters max).` }
  }
  const lower = title.toLowerCase()
  for (const other of taken) {
    if (typeof other === 'string' && other.trim().toLowerCase() === lower) {
      return {
        ok: false,
        error: `An instance called "${title}" already exists. Two shared trees with one name cannot be told apart in the tree, the panel or a usage list.`,
      }
    }
  }
  return { ok: true, title }
}

/** What a create writes: the object's own fields, nothing else. */
export interface InstancePlan {
  title: string
  placement: InstancePlacement
  /** The shared tree the instance starts with. Empty for a blank one. */
  blocks: Array<Record<string, unknown>>
}

export type InstancePlanResult =
  | { ok: true; plan: InstancePlan }
  | { ok: false; error: string }

export interface NewInstanceInput {
  title: unknown
  placement?: unknown
  /** Starting blocks; absent or empty means a blank instance. */
  blocks?: unknown
}

/**
 * A new instance from the panel: a name, where the system places it, and an
 * empty tree to compose into.
 *
 * Empty is the honest start. A blank instance opens on the canvas with the
 * whole Builder Kit available, which is the point of the rule this satisfies:
 * composing needs no developer and no content editor.
 */
export function planNewInstance(
  input: NewInstanceInput,
  opts: { taken?: Iterable<string> } = {},
): InstancePlanResult {
  const name = checkInstanceTitle(input.title, opts.taken ?? [])
  if (!name.ok) return name
  const blocks = Array.isArray(input.blocks)
    ? input.blocks.filter((b): b is Record<string, unknown> => !!b && typeof b === 'object' && !Array.isArray(b))
    : []
  return { ok: true, plan: { title: name.title, placement: readPlacement(input.placement), blocks } }
}
/** True when this block is a reference to an instance rather than content. */
function isReference(block: Record<string, unknown>): boolean {
  return block._type === INSTANCE_BLOCK_TYPE
}

/**
 * Why this section may NOT become an instance, or null when it may.
 *
 * Separate from the naming step so the editor can ask BEFORE it opens a name
 * prompt: asking someone to name a thing and then refusing to make it is the
 * kind of control that appears to work.
 *
 * - A section that IS a reference is already shared. An instance whose only
 *   content is a pointer at another instance is an indirection nobody asked
 *   for, and the act a person meant is Edit instance.
 * - A prop bound to the HOST page's record has nothing to read on the next
 *   page that uses the instance. That refusal is I1's `pageBindingRefusal`,
 *   reused rather than restated, so this flow and the instance save cannot
 *   disagree about what a shared tree may bind to.
 */
export function sectionRefusal(block: unknown): string | null {
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    return 'Select a section on the page to turn into an instance.'
  }
  const section = block as Record<string, unknown>
  if (isReference(section)) {
    return 'That section is already a reference to an instance, so there is nothing new to share. Open it with Edit instance instead.'
  }
  return pageBindingRefusal(pageBoundProps(section))
}

export interface FromSectionInput {
  title: unknown
  placement?: unknown
  /** The selected section, as it stands on the page. */
  block: unknown
}

/**
 * "Create instance from this section": the section's blocks become the new
 * instance's, and the caller swaps the section for a reference in place.
 *
 * Keys are KEPT (see the module note): a block's raw CSS compiles to a
 * selector derived from its key, so re-keying here would quietly unstyle the
 * section the moment it was shared.
 */
export function planInstanceFromSection(
  input: FromSectionInput,
  opts: { taken?: Iterable<string> } = {},
): InstancePlanResult {
  const refused = sectionRefusal(input.block)
  if (refused) return { ok: false, error: refused }

  const name = checkInstanceTitle(input.title, opts.taken ?? [])
  if (!name.ok) return name

  return {
    ok: true,
    plan: {
      title: name.title,
      placement: readPlacement(input.placement),
      // A copy, so planning never mutates the page's own tree; the same keys,
      // so the section's raw CSS still finds the blocks it was written for.
      blocks: [JSON.parse(JSON.stringify(input.block)) as Record<string, unknown>],
    },
  }
}

/** The `_studio` bag's raw CSS on one block, or the empty string for none. */
function rawCssOf(block: Record<string, unknown>): string {
  const bag = block._studio
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return ''
  const css = (bag as Record<string, unknown>).css
  return typeof css === 'string' ? css.trim() : ''
}

/** How many blocks in this subtree carry raw CSS of their own. */
export function sectionCssCount(value: unknown): number {
  let found = 0
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { for (const entry of node) walk(entry); return }
    if (!node || typeof node !== 'object') return
    const block = node as Record<string, unknown>
    if (rawCssOf(block) !== '') found += 1
    for (const child of Object.values(block)) {
      if (child && typeof child === 'object') walk(child)
    }
  }
  walk(value)
  return found
}

/**
 * The honest warning before a section carrying its own raw CSS becomes
 * shared, or null when there is nothing to warn about.
 *
 * A block's raw CSS (X-T1) is compiled into the PAGE's artifact. The shared
 * artifact carries the workspace stylesheet only, so a rule written on a
 * section stops applying the moment that section renders through a reference
 * instead. That gap is real today and it is the same one a shared SURFACE has
 * (I3, learned (a)); saying so here beats a designer finding it on the live
 * site. Classes and tokens are workspace-wide and travel as they already do.
 */
export function sectionCssWarning(block: unknown): string | null {
  const count = sectionCssCount(block)
  if (count === 0) return null
  const what = count === 1 ? 'This section has' : `${count} blocks in this section have`
  return `${what} raw CSS of its own. An instance's raw CSS is not carried in the shared artifact yet, so those rules stop applying once the section renders through a reference. Classes and tokens travel as they do now.`
}

/**
 * What a copy of this name is called: "Latest Articles copy", then "Latest
 * Articles copy 2". Counted rather than suffixed blindly, because a designer
 * duplicating three times should get three names and not one refusal twice.
 */
export function copyTitle(title: string, taken: Iterable<string> = []): string {
  const used = new Set<string>()
  for (const t of taken) if (typeof t === 'string') used.add(t.trim().toLowerCase())
  // Room for " 999" inside the length limit, so even a maximal name copies.
  const base = `${title.trim().slice(0, INSTANCE_TITLE_MAX - 9)} copy`
  if (!used.has(base.toLowerCase())) return base
  for (let n = 2; n < 1000; n += 1) {
    const next = `${base} ${n}`
    if (!used.has(next.toLowerCase())) return next
  }
  return base
}

export interface DuplicateSource {
  title?: string | null
  placement?: unknown
  blocks?: unknown
}

/**
 * A new instance minted from an existing one's blocks.
 *
 * Two deliberate differences from the source:
 *
 * - FRESH keys at every depth. The copy is an independent tree, and two trees
 *   sharing keys would share selection identity and raw-CSS selectors, so an
 *   edit aimed at one would appear to land on the other. This is the opposite
 *   of the moved-section case above, and for the same reason: a key is style
 *   identity, so a copy must not inherit one.
 * - Placement `manual`, whatever the source's was. Duplicating the header
 *   should not put a second header on every page of the site; placing a copy
 *   is a decision, and this flow is a copy.
 */
export function planDuplicateInstance(
  source: DuplicateSource,
  opts: { taken?: Iterable<string> } = {},
): InstancePlanResult {
  const taken = opts.taken ?? []
  const name = checkInstanceTitle(copyTitle(instanceTitle(source), taken), taken)
  if (!name.ok) return name
  const blocks = Array.isArray(source.blocks)
    ? (cloneWithFreshKeys(source.blocks) as unknown[]).filter(
      (b): b is Record<string, unknown> => !!b && typeof b === 'object' && !Array.isArray(b),
    )
    : []
  return { ok: true, plan: { title: name.title, placement: 'manual', blocks } }
}
