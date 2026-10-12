/**
 * File Name: documents.ts
 * Purpose: The EDITED DOCUMENT - what the canvas, the tree, the inspector,
 *   protection, undo and presence are all pointed at. One of three things: a
 *   region of the page, a shared surface, or an instance.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Studio grew this notion one document at a time. The
 *   page was the only one; then `activeSurface` switched the edited document
 *   to a global's blocks and every downstream seam learned to ask "is a
 *   surface open?". A third kind would have made that question a chain of
 *   ternaries in a 4000-line component, so it is a value instead: everything
 *   downstream asks the DOCUMENT what it is.
 *
 *   The rules that matter are here rather than in the page, because they are
 *   rules: which scope a document's folds and undo stack belong to (a block
 *   key belongs to one document, so an undo across a switch would write the
 *   remembered tree into the wrong field), and what happens when the document
 *   somebody last had open no longer exists.
 */

/** Which document the editor is pointed at. */
export type EditedDocRef =
  | { kind: 'page' }
  | { kind: 'surface'; global: string }
  | { kind: 'instance'; id: string }

/** The page: what Studio opens with, and what everything falls back to. */
export const PAGE_DOC: EditedDocRef = { kind: 'page' }

/** True when two references name the same document. */
export function sameDoc(a: EditedDocRef, b: EditedDocRef): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'surface' && b.kind === 'surface') return a.global === b.global
  if (a.kind === 'instance' && b.kind === 'instance') return a.id === b.id
  return true
}

/**
 * The scope a document's remembered folds and its undo stack belong to.
 *
 * A page's scope is its REGION, because a type with two component fields
 * edits one at a time and a block key belongs to one of them. A surface and
 * an instance are documents of their own, so each gets a scope of its own -
 * without which `applyHistory` would write one document's remembered tree
 * into whichever field happens to be active.
 */
export function documentScope(ref: EditedDocRef, region: string | null): string | null {
  if (ref.kind === 'surface') return `surface:${ref.global}`
  if (ref.kind === 'instance') return `instance:${ref.id}`
  return region
}

/** What exists to be opened, so a vanished document can fall back. */
export interface AvailableDocs {
  /** Global names of the loaded surfaces. */
  surfaces: readonly string[]
  /** Ids of the instances this environment has. */
  instances: readonly string[]
}

/**
 * The document to actually edit, given the one that was wanted.
 *
 * The wish outlives what it points at: a surface list arrives after the first
 * render, an instance is deleted by a colleague, a page switch carries the
 * selection to a type that has neither. Falling back to the page beats an
 * editor pointed at nothing - the same rule `resolveRegion` and
 * `resolveSurface` already follow.
 */
export function resolveDocRef(ref: EditedDocRef | null | undefined, available: AvailableDocs): EditedDocRef {
  if (!ref || ref.kind === 'page') return PAGE_DOC
  if (ref.kind === 'surface') return available.surfaces.includes(ref.global) ? ref : PAGE_DOC
  return available.instances.includes(ref.id) ? ref : PAGE_DOC
}

/** Why the editor is not on the document that was asked for. */
export interface DropNotice { title: string; detail: string }

/**
 * Whether the fallback above needs SAYING.
 *
 * Falling back to the page beats an editor pointed at nothing, but doing it
 * silently is its own product bug: "Edit instance" on a reference whose
 * instance was deleted, or which this role cannot read, then appears to work
 * and does nothing at all. `ready` is what separates "not there" from "not
 * read yet", because only one of those is worth interrupting somebody about.
 *
 * Only an instance is announced: it is the one document opened by ID, and the
 * only one that can vanish between somebody seeing it and pressing it.
 */
export function documentDropped(opts: {
  wanted: EditedDocRef
  active: EditedDocRef
  /** Whether what exists has actually been read yet. */
  ready: boolean
}): DropNotice | null {
  if (!opts.ready) return null
  if (opts.wanted.kind !== 'instance') return null
  if (sameDoc(opts.wanted, opts.active)) return null
  return {
    title: 'That instance is not open',
    detail: 'Studio could not find it in this environment: it may have been deleted, '
      + 'or your role may not read it. The page is on the canvas instead.',
  }
}

/** How the panel header, the inspector and the band name the open document. */
export interface DocumentNames {
  /** "Header: Site header" for a surface. */
  surface: (global: string) => string
  /** "Instance: Latest Articles". */
  instance: (id: string) => string
  /** The page's region label ("Sections"). */
  region: () => string
}

export function documentLabel(ref: EditedDocRef, names: DocumentNames): string {
  if (ref.kind === 'surface') return names.surface(ref.global)
  if (ref.kind === 'instance') return names.instance(ref.id)
  return names.region()
}

/**
 * Whether this document autosaves.
 *
 * The page and an instance are content objects with drafts, so their edits
 * save on a debounce like any other content. A shared surface is a global -
 * one row per workspace and environment, no draft, no status - so its edits
 * are held and saved EXPLICITLY. Two things that behave that differently must
 * not look like one list, which is why the surface bands exist.
 */
export function autosaves(ref: EditedDocRef): boolean {
  return ref.kind !== 'surface'
}
