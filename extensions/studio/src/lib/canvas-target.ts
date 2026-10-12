/**
 * File Name: canvas-target.ts
 * Purpose: WHICH DOCUMENT THE CANVAS SHOWS. The preview frame's address, the
 *   live snapshot pushed into it, and the document a click inside it belongs
 *   to - all derived from the document being edited rather than from the page
 *   Studio happened to open with.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Studio's canvas was built when the page was the only
 *   document. The frame's URL was minted once, from the page, and nothing
 *   rebuilt it; the live snapshot always carried the page's id, type and
 *   values. Surfaces survived that because a surface is a global with no id
 *   of its own: it genuinely renders INSIDE the page, so composing it there
 *   is right. An INSTANCE does not survive it. An instance is a content
 *   object with an id, a draft and a preview of its own, so a canvas still
 *   pointed at the page shows a different document than the one being edited
 *   - which is how "created an instance, the canvas jumped to a post" happens.
 *
 *   The rule, said once here so every seam agrees: the canvas previews the
 *   ACTIVE DOCUMENT. A page and an instance are objects and are previewed by
 *   id and type; a surface has no id and stays composed inside the page.
 *   When the target cannot be built - no preview URL, a template that needs a
 *   slug the document has not got, an identity not read yet - the canvas says
 *   so in words. It never shows another document instead, because a canvas
 *   showing the wrong document is indistinguishable from a broken editor and
 *   gives the person no reason at all.
 */
import type { EditedDocRef } from './documents'
import { PAGE_DOC } from './documents'

// ── The target ───────────────────────────────────────────────────────────────

/** Which of the two previewable documents a target names. */
export type PreviewDoc = 'page' | 'instance'

/** What a previewable document knows about itself. */
export interface PreviewIdentity {
  id: string | null
  type: string | null
  /** Its slug, for a template addressed by slug. */
  slug?: string | null
  /** Whether the object itself has been read, so its slug is actually known. */
  loaded?: boolean
}

export type PreviewTarget =
  /** Preview this object at this template. */
  | { kind: 'object'; doc: PreviewDoc; id: string; type: string; slug?: string; template: string }
  /** Not enough is known yet. Show nothing, say nothing final. */
  | { kind: 'pending'; title: string; detail: string }
  /** It cannot be previewed, and this is why. */
  | { kind: 'none'; title: string; detail: string }

export interface PreviewInput {
  /** The document being edited. */
  doc: EditedDocRef
  /** The page Studio opened with. */
  page: PreviewIdentity
  /** The instance being edited, once it is known. */
  instance?: PreviewIdentity | null
  /**
   * `frontend.previewUrl` for the page's type. `null` means configured as
   * unavailable; `undefined` means the config has not arrived yet, which is
   * a different fact and must not read as "not configured".
   */
  pageTemplate?: string | null
  /** The same for the instance TYPE, so a `previewUrls` override is honoured. */
  instanceTemplate?: string | null
}

/** What the canvas says while it is still working out what to show. */
export const PREVIEW_OPENING = {
  title: 'Opening the preview',
  detail: 'Studio is reading the document to show on the canvas.',
} as const
const OPENING = PREVIEW_OPENING

/**
 * A preview token is what lets the site read a DRAFT, so without one the
 * canvas has nothing honest to render. Said here rather than leaving the
 * frame on whatever it happened to be showing.
 */
export const PREVIEW_TOKEN_REFUSAL = {
  title: 'The preview token could not be minted',
  detail: 'Studio could not get a preview token for this document, so the site cannot read its draft. '
    + 'Reload Studio, and check that your role may read this content type.',
} as const

/** A preview URL with nowhere to talk back to: the site origin is unset. */
export const PREVIEW_NO_FRONTEND = {
  title: 'Live preview is not configured',
  detail: 'Set the site URL for this environment (frontend.url) so the canvas can talk to the preview.',
} as const

/** The words a page with no preview URL has always shown. Unchanged on purpose. */
const NO_PAGE_URL = {
  title: 'Live preview is not configured',
  detail: 'Set a preview URL for this environment (frontend.previewUrl) to design on the live page.',
} as const

const NO_INSTANCE_URL = {
  title: 'This instance cannot be previewed',
  detail: 'An instance is a content object of its own, so the canvas previews it by id. '
    + 'Set frontend.previewUrl for this environment, or a frontend.previewUrls entry for the instance type.',
} as const

function noSlug(doc: PreviewDoc): { kind: 'none'; title: string; detail: string } {
  return {
    kind: 'none',
    title: doc === 'instance' ? 'This instance cannot be previewed' : 'This page cannot be previewed',
    detail: `The preview URL is addressed by slug, and this ${doc} has no slug. `
      + 'Give it one, or address the preview by id instead (a {id} placeholder, or a bare URL).',
  }
}

/**
 * What the canvas must show for the document being edited.
 *
 * A surface resolves to the PAGE deliberately: a global has no id to preview,
 * it is rendered by the site's layout around the page, and composing it there
 * is what a designer means by editing a header.
 */
export function previewTarget(input: PreviewInput): PreviewTarget {
  const wantsInstance = input.doc.kind === 'instance'
  const doc: PreviewDoc = wantsInstance ? 'instance' : 'page'
  const identity = wantsInstance ? input.instance ?? null : input.page
  const template = wantsInstance ? input.instanceTemplate : input.pageTemplate

  // The instance the editor holds must be the one the document names, or the
  // canvas would preview whichever instance was open a moment ago.
  if (wantsInstance && (!identity || identity.id !== (input.doc as { id: string }).id)) return { kind: 'pending', ...OPENING }
  if (template === undefined) return { kind: 'pending', ...OPENING }
  if (template === null || template.trim() === '') {
    return { kind: 'none', ...(doc === 'instance' ? NO_INSTANCE_URL : NO_PAGE_URL) }
  }
  if (!identity?.id || !identity.type) return { kind: 'pending', ...OPENING }

  const slug = typeof identity.slug === 'string' && identity.slug.trim() !== '' ? identity.slug : undefined
  if (/\{slug\}/.test(template)) {
    // An empty slug in a slug template requests some OTHER page (or a 404),
    // so it waits while the object is being read and refuses once it is read.
    if (!slug) return identity.loaded === false ? { kind: 'pending', ...OPENING } : noSlug(doc)
  }
  return { kind: 'object', doc, id: identity.id, type: identity.type, slug, template }
}

/** One string per distinct canvas address, so the frame reloads exactly when it must. */
export function previewTargetKey(target: PreviewTarget): string {
  if (target.kind !== 'object') return `${target.kind}:${target.title}`
  return `object:${target.doc}:${target.id}:${target.type}:${target.slug ?? ''}:${target.template}`
}

export function sameTarget(a: PreviewTarget, b: PreviewTarget): boolean {
  return previewTargetKey(a) === previewTargetKey(b)
}

// ── The live snapshot ────────────────────────────────────────────────────────

/** The shape LivePreviewCanvas pushes into the frame (PreviewSnapshot). */
export interface CanvasSnapshot {
  id: string
  type: string
  title?: string
  slug?: string
  status?: string
  locale?: string
  values: Record<string, unknown>
}

export interface SnapshotInput {
  target: PreviewTarget
  /** The page's own state: everything the object editor would push. */
  page: { title?: string; slug?: string; status?: string; field: string | null; values: Record<string, unknown> }
  /** The open instance's own state. Its blocks field, never the page's. */
  instance?: { title?: string; slug?: string; status?: string; field: string | null } | null
  /** The blocks the canvas must render, already composed for the open document. */
  composed: unknown
  /** The locale being edited, when translating. */
  locale?: string
}

/**
 * What the frame is TOLD it is rendering, to match what it was sent to fetch.
 *
 * The site's preview client merges this over the draft it loaded, so a
 * snapshot describing the page while the frame holds the instance would paint
 * the page's title, body and fields straight onto the instance. That is the
 * same bug as the wrong URL, one layer down, and it is why this is derived
 * from the target rather than from the page.
 */
export function canvasSnapshot(input: SnapshotInput): CanvasSnapshot | null {
  const { target } = input
  if (target.kind !== 'object') return null
  if (target.doc === 'instance') {
    const field = input.instance?.field
    return {
      id: target.id,
      type: target.type,
      title: input.instance?.title,
      slug: target.slug,
      status: input.instance?.status,
      locale: input.locale,
      values: field ? { [field]: input.composed } : {},
    }
  }
  const values = input.page.field
    ? { ...input.page.values, [input.page.field]: input.composed }
    : input.page.values
  return {
    id: target.id,
    type: target.type,
    title: input.page.title,
    slug: input.page.slug ?? target.slug,
    status: input.page.status,
    locale: input.locale,
    values,
  }
}

// ── Clicking inside the frame ────────────────────────────────────────────────

/**
 * The document a clicked key belongs to.
 *
 * The site's overlay knows keys, not documents. A key a surface owns opens
 * that surface, wherever you clicked it from. Everything else belongs to
 * whatever the frame is currently rendering: the page, or the INSTANCE when
 * one is open - because the canvas is showing the instance, so its keys are
 * the instance's. Sending them to the page (what Studio did before the canvas
 * followed the document) would close the instance the moment anyone clicked
 * inside it.
 */
export function docForClickedKey(opts: { active: EditedDocRef; surfaceOwner: string | null }): EditedDocRef {
  if (opts.surfaceOwner) return { kind: 'surface', global: opts.surfaceOwner }
  if (opts.active.kind === 'instance') return opts.active
  return PAGE_DOC
}
