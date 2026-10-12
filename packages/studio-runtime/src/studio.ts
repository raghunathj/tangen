/**
 * File Name: studio.ts
 * Purpose: Studio visual-edit overlay for a front-end site consuming Tangen.
 *   When the page renders inside a Tangen preview iframe (the admin's Studio
 *   or live-preview pane), `enableStudioOverlay` decorates every
 *   `[data-tangen-block]` element with a hover outline and a click target:
 *   clicking a block posts `{ type: 'studio:select', key }` to the parent
 *   admin, and an incoming `{ type: 'studio:highlight', key }` scrolls to and
 *   flashes the block. `tangenBlockAttrs` stamps the data attribute for the
 *   common map-over-blocks pattern.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Browser-only, guarded — safe to import server-side.
 *   Zero cost outside a preview: activation requires BOTH the framing iframe
 *   and the existing `preview_token` URL param (the admin's Preview button
 *   mints it — see ./preview.ts). No DOM mutation beyond outline styling.
 */

/** Site → admin: the user clicked a block inside the preview iframe. */
export const STUDIO_SELECT_TYPE = 'studio:select'
/** Admin → site: scroll to + flash a block (the Studio rail hovered/selected it). */
export const STUDIO_HIGHLIGHT_TYPE = 'studio:highlight'
/** The attribute a site stamps on each block's root element (value = the block's `_key`). */
export const TANGEN_BLOCK_ATTR = 'data-tangen-block'

/** Admin -> site: suspend or resume block selection (Studio's preview mode). */
export const STUDIO_OVERLAY_TYPE = 'studio:overlay'

/** Site -> admin, once on activation: the overlay is here, and what it can do. */
export const STUDIO_READY_TYPE = 'studio:ready'

/** Site -> admin: where every stamped block physically is, right now. */
export const STUDIO_GEOMETRY_TYPE = 'studio:geometry'

/** Admin -> site: measure ONE block for inline editing. */
/**
 * Draft stylesheet pushed into the preview. The live site loads published CSS
 * from the public styles.css route; the CANVAS must show unpublished work, so
 * Studio sends it over the channel it already has rather than inventing an
 * authenticated CSS URL - which would need a token the <link> cannot carry,
 * and Redis, which is optional on this platform.
 */
export const STUDIO_STYLES_TYPE = 'studio:styles'

export const STUDIO_MEASURE_TYPE = 'studio:measure'

/** Site -> admin: that block's box and the typography rendering it. */
export const STUDIO_MEASURED_TYPE = 'studio:measured'

/**
 * What this overlay build supports. Studio reads it from the ready
 * handshake, so a site on an older SDK is DETECTED rather than silently
 * behaving differently - preview still works there, it just cannot stop
 * clicks selecting, and Studio can say so instead of looking broken.
 */
export const STUDIO_OVERLAY_CAPABILITIES = ['suspend', 'geometry'] as const

/** The CSS class the overlay toggles to flash a highlighted block. */
const FLASH_CLASS = 'tangen-studio-flash'
const FLASH_MS = 1200

export interface StudioSelectMessage {
  type: typeof STUDIO_SELECT_TYPE
  /** The clicked block's `_key`. */
  key: string
}

export interface StudioHighlightMessage {
  type: typeof STUDIO_HIGHLIGHT_TYPE
  /** The `_key` of the block to flash. */
  key: string
}

/** Type-guard: is this postMessage a Studio block selection? */
export function isStudioSelectMessage(data: unknown): data is StudioSelectMessage {
  return !!data && typeof data === 'object'
    && (data as { type?: unknown }).type === STUDIO_SELECT_TYPE
    && typeof (data as { key?: unknown }).key === 'string'
}

/** Type-guard: is this postMessage a Studio block highlight request? */
/** Admin -> site suspend/resume. `active` must be an explicit boolean. */
export interface StudioOverlayMessage {
  type: typeof STUDIO_OVERLAY_TYPE
  active: boolean
}

export function isStudioOverlayMessage(data: unknown): data is StudioOverlayMessage {
  return !!data && typeof data === 'object'
    && (data as { type?: unknown }).type === STUDIO_OVERLAY_TYPE
    && typeof (data as { active?: unknown }).active === 'boolean'
}

/** One block's box, in VIEWPORT coordinates. */
export interface StudioBlockRect {
  key: string
  rect: { top: number; left: number; width: number; height: number }
}

/**
 * Where the blocks are. Rects are VIEWPORT-relative - exactly what
 * getBoundingClientRect returns - which is what the admin needs, since it
 * draws over the iframe and knows the iframe's own offset. That choice is
 * what makes sticky headers, scrolled pages and CSS transforms report where
 * they actually render, with no arithmetic on either side.
 */
export interface StudioGeometryMessage {
  type: typeof STUDIO_GEOMETRY_TYPE
  blocks: StudioBlockRect[]
  viewport: { width: number; height: number }
  scroll: { x: number; y: number }
}

export function isStudioGeometryMessage(data: unknown): data is StudioGeometryMessage {
  return !!data && typeof data === 'object'
    && (data as { type?: unknown }).type === STUDIO_GEOMETRY_TYPE
    && Array.isArray((data as { blocks?: unknown }).blocks)
}

/** Admin -> site measure request. */
export interface StudioStylesMessage {
  type: typeof STUDIO_STYLES_TYPE
  /** The whole draft stylesheet. Empty string removes the override. */
  css: string
}

export function isStudioStylesMessage(data: unknown): data is StudioStylesMessage {
  const m = data as StudioStylesMessage | null
  return !!m && m.type === STUDIO_STYLES_TYPE && typeof m.css === 'string'
}

export interface StudioMeasureMessage {
  type: typeof STUDIO_MEASURE_TYPE
  key: string
}

export function isStudioMeasureMessage(data: unknown): data is StudioMeasureMessage {
  return !!data && typeof data === 'object'
    && (data as { type?: unknown }).type === STUDIO_MEASURE_TYPE
    && typeof (data as { key?: unknown }).key === 'string'
}

/** The typography an inline editor must copy so the words do not jump. */
export interface StudioTextStyle {
  fontFamily?: string
  fontSize?: string
  fontWeight?: string
  color?: string
  textAlign?: string
  lineHeight?: string
  letterSpacing?: string
}

/**
 * One block, measured. Computed styles force layout, so this is asked for
 * per block on demand rather than broadcast with the geometry stream.
 */
export interface StudioMeasuredMessage {
  type: typeof STUDIO_MEASURED_TYPE
  key: string
  rect: { top: number; left: number; width: number; height: number }
  style: StudioTextStyle
}

export function isStudioMeasuredMessage(data: unknown): data is StudioMeasuredMessage {
  const d = data as { type?: unknown; key?: unknown; rect?: unknown; style?: unknown }
  return !!data && typeof data === 'object'
    && d.type === STUDIO_MEASURED_TYPE
    && typeof d.key === 'string'
    && !!d.rect && typeof d.rect === 'object'
    && !!d.style && typeof d.style === 'object'
}

/** Site -> admin activation announcement. */
export interface StudioReadyMessage {
  type: typeof STUDIO_READY_TYPE
  capabilities: string[]
}

export function isStudioReadyMessage(data: unknown): data is StudioReadyMessage {
  return !!data && typeof data === 'object'
    && (data as { type?: unknown }).type === STUDIO_READY_TYPE
    && Array.isArray((data as { capabilities?: unknown }).capabilities)
}

export function isStudioHighlightMessage(data: unknown): data is StudioHighlightMessage {
  return !!data && typeof data === 'object'
    && (data as { type?: unknown }).type === STUDIO_HIGHLIGHT_TYPE
    && typeof (data as { key?: unknown }).key === 'string'
}

/**
 * Attribute helper for the common map-over-blocks pattern — spread it onto each
 * block's root element:
 *
 *   blocks.map((b) => <section key={b._key} {...tangenBlockAttrs(b._key)}>…</section>)
 */
/**
 * Separates a template block's key from the index of the row rendering it.
 *
 * A loop renders ONE stored block once per record, so the page holds several
 * live elements that all edit the same block. They need distinct identities
 * or Studio cannot tell which row was clicked, and the geometry map - keyed
 * by block key - keeps only the last row's rect. `~` is not produced by key
 * generation, so an instance key can never collide with a stored one.
 */
export const STUDIO_INSTANCE_SEP = '~'

/** Names one rendered occurrence of a template block: `t1` row 2 -> `t1~2`. */
export function instanceKey(templateKey: string, index: number): string {
  return `${templateKey}${STUDIO_INSTANCE_SEP}${index}`
}

/**
 * Maps a rendered key back to the stored block that edits it. Only a
 * TRAILING `~<digits>` is a row suffix: a key that merely contains a tilde is
 * an ordinary key and round-trips untouched.
 */
export function templateKeyOf(key: string): string {
  return key.replace(/~\d+$/, '')
}

/** True when the key names a repeated row rather than a stored block. */
export function isInstanceKey(key: string): boolean {
  return /~\d+$/.test(key)
}

export function tangenBlockAttrs(key: string): Record<string, string> {
  return { [TANGEN_BLOCK_ATTR]: key }
}

/**
 * True only when the page runs inside a Tangen preview: framed by the admin
 * AND carrying the short-lived `preview_token` URL param the admin's Preview
 * flow mints. A normal tab (even with a token) or a random iframe (no token)
 * both stay false, so the overlay is inert everywhere but the real preview.
 */
export function isStudioPreview(): boolean {
  const w = (globalThis as { window?: any }).window
  if (!w) return false
  let framed: boolean
  try { framed = w.self !== w.top } catch { framed = true }
  if (!framed) return false
  try {
    return new URLSearchParams(String(w.location?.search ?? '')).has('preview_token')
  } catch { return false }
}

/** Best-effort admin origin from the framing referrer, for a scoped postMessage target. */
function originFromReferrer(w: any): string | undefined {
  try {
    const ref = w.document?.referrer
    return ref ? new URL(ref).origin : undefined
  } catch { return undefined }
}

export interface StudioOverlayOptions {
  /**
   * The admin origin (e.g. https://admin.example.com). Scopes the select post
   * AND pins incoming highlight messages to that origin. Defaults to the
   * framing referrer's origin; strongly recommended in production.
   */
  adminOrigin?: string
  /** Outline color for hover/flash. Defaults to a Studio indigo. */
  color?: string
}

/**
 * Activate the Studio visual-edit overlay. No-op (returns a noop disposer)
 * unless the page runs inside a Tangen preview — safe to call unconditionally
 * from a site layout. Returns a disposer that removes every listener and the
 * injected style tag.
 */
/**
 * Published Studio stylesheets on the page: the site marks its link with
 * `data-tangen-published-styles`, and the known delivery URL shapes are
 * recognised as a fallback for sites that have not.
 */
const PUBLISHED_STYLES = 'link[rel="stylesheet"][data-tangen-published-styles], link[rel="stylesheet"][href*="studio-styles"], link[rel="stylesheet"][href*="studio-delivery"], link[rel="stylesheet"][href*="/api/v1/delivery/"], link[rel="stylesheet"][href*="/ext/studio/styles"]'

/** The slice of a stylesheet link this needs; the package has no DOM lib. */
interface StylesheetLink { disabled: boolean }

/** The slice of MutationObserver this needs, so a test can hand in a fake. */
type ObserverCtor = new (cb: () => void) => { observe(target: unknown, init: { childList: boolean; subtree: boolean }): void; disconnect(): void }

/**
 * Keeps the published stylesheets off for as long as a draft stands in.
 *
 * Disabling the links once is not enough. The admin pushes the first draft on
 * `studio:ready`, and a site that fetches its content after mounting - the
 * live-preview page does - mounts the published `<link>` AFTER that push, so
 * it arrived enabled and the published base layered under the draft until
 * the designer's next edit. Measured at 535ms to ready with zero blocks on
 * the page, and the link appearing afterwards. While a draft is present,
 * every link added later is disabled as it appears.
 */
export function holdPublishedStyles(
  doc: { querySelectorAll(selector: string): ArrayLike<StylesheetLink>; documentElement?: unknown },
  Observer: ObserverCtor | undefined,
): { set(enabled: boolean): void; stop(): void } {
  let observer: InstanceType<ObserverCtor> | null = null
  const stop = () => { observer?.disconnect(); observer = null }
  return {
    set(enabled) {
      setPublishedStylesEnabled(doc, enabled)
      if (enabled) { stop(); return }
      if (observer || !Observer || !doc.documentElement) return
      observer = new Observer(() => setPublishedStylesEnabled(doc, false))
      observer.observe(doc.documentElement, { childList: true, subtree: true })
    },
    stop,
  }
}

/** Turns the published stylesheets off while a draft stands in for them. */
export function setPublishedStylesEnabled(
  doc: { querySelectorAll(selector: string): ArrayLike<StylesheetLink> }, enabled: boolean,
): number {
  let n = 0
  for (const link of Array.from(doc.querySelectorAll(PUBLISHED_STYLES))) {
    link.disabled = !enabled
    n++
  }
  return n
}

/**
 * Finds the element for a block key, tolerating the two identities a page
 * can carry. An exact stamp wins; failing that the key is treated as a
 * TEMPLATE key and the first rendered row of it answers - which is what lets
 * the rail highlight a block that only exists inside a loop.
 */
function findBlockEl(doc: any, key: string): any {
  const esc = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const exact = doc.querySelector?.(`[${TANGEN_BLOCK_ATTR}="${esc}"]`)
  if (exact) return exact
  const nodes = doc.querySelectorAll?.(`[${TANGEN_BLOCK_ATTR}]`) ?? []
  for (const el of Array.from(nodes as ArrayLike<any>)) {
    const k = el.getAttribute?.(TANGEN_BLOCK_ATTR)
    if (k && templateKeyOf(k) === key) return el
  }
  return null
}

export function enableStudioOverlay(opts: StudioOverlayOptions = {}): () => void {
  const w = (globalThis as { window?: any }).window
  if (!w || !isStudioPreview()) return () => {}
  const doc = w.document
  if (!doc?.createElement || typeof doc.addEventListener !== 'function') return () => {}

  const color = opts.color ?? '#6366f1'
  const adminOrigin = opts.adminOrigin ?? originFromReferrer(w)

  // Outline decoration only — hover rides pure CSS, no per-element JS.
  const style = doc.createElement('style')
  style.setAttribute('data-tangen-studio', '')
  const decoration = [
    `[${TANGEN_BLOCK_ATTR}]{cursor:pointer}`,
    `[${TANGEN_BLOCK_ATTR}]:hover{outline:2px solid ${color};outline-offset:2px}`,
    `[${TANGEN_BLOCK_ATTR}].${FLASH_CLASS}{outline:2px solid ${color};outline-offset:2px}`,
  ].join('\n')
  style.textContent = decoration
  doc.head?.appendChild(style)

  // Studio's preview mode suspends selection. While suspended the handler
  // must not preventDefault either - letting the click through is precisely
  // what makes links behave and the page read as a visitor sees it.
  let active = true

  // Click → select. Capture phase so links/buttons inside a block cannot
  // navigate the preview away from under the editor.
  const onClick = (e: { target?: any; preventDefault?: () => void; stopPropagation?: () => void }) => {
    if (!active) return
    const el = e.target?.closest?.(`[${TANGEN_BLOCK_ATTR}]`)
    if (!el) return
    const key = el.getAttribute(TANGEN_BLOCK_ATTR)
    if (!key) return
    e.preventDefault?.()
    e.stopPropagation?.()
    const msg: StudioSelectMessage = { type: STUDIO_SELECT_TYPE, key }
    try { w.parent?.postMessage(msg, adminOrigin ?? '*') } catch { /* not framed - best effort */ }
  }
  doc.addEventListener('click', onClick, true)

  /** Outlines are decoration only, so suspending just empties the rule. */
  const setDecoration = (on: boolean) => {
    style.textContent = on ? decoration : ''
  }

  // Highlight ← admin. Origin-pinned when we know the admin origin.
  let flashTimer: ReturnType<typeof setTimeout> | undefined
  let draftStyle: any = null
  const published = holdPublishedStyles(doc, w.MutationObserver)
  const onMessage = (e: { origin?: string; data?: unknown }) => {
    if (adminOrigin && e.origin !== adminOrigin) return
    if (isStudioMeasureMessage(e.data)) {
      // Deliberately answered even when suspended: suspending stops CLICKS
      // from selecting, it does not stop the admin asking where a thing is.
      const key = e.data.key
      const el = findBlockEl(doc, key)
      if (!el) return
      const r = el.getBoundingClientRect?.()
      if (!r) return
      const cs = w.getComputedStyle?.(el) ?? {}
      const msg: StudioMeasuredMessage = {
        type: STUDIO_MEASURED_TYPE,
        key,
        rect: {
          top: Math.round(r.top), left: Math.round(r.left),
          width: Math.round(r.width), height: Math.round(r.height),
        },
        style: {
          fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
          color: cs.color, textAlign: cs.textAlign, lineHeight: cs.lineHeight,
          letterSpacing: cs.letterSpacing,
        },
      }
      try { w.parent?.postMessage(msg, adminOrigin ?? '*') } catch { /* not framed */ }
      return
    }
    if (isStudioStylesMessage(e.data)) {
      // One element, reused: replacing textContent restyles the page without
      // a reload, which is what makes editing feel live.
      if (!draftStyle) {
        draftStyle = doc.createElement('style')
        draftStyle.setAttribute('data-tangen-studio-draft', '')
        doc.head?.appendChild(draftStyle)
      }
      draftStyle.textContent = e.data.css
      // The draft REPLACES the published stylesheet; it must not layer on top
      // of it. A stylesheet only adds rules, so a declaration the draft no
      // longer contains would keep applying from the published base - the
      // canvas showed a stale `display:inline` for hours after the draft had
      // dropped it. Every published Studio stylesheet is disabled while a
      // draft is present, and re-enabled if the draft is withdrawn - including
      // a link the site mounts AFTER the push, see holdPublishedStyles.
      published.set(e.data.css === '')
      // Geometry changes when styling does - a taller block moves everything
      // below it, and the overlays would otherwise point at stale boxes.
      scheduleGeometry()
      return
    }
    if (isStudioOverlayMessage(e.data)) {
      active = e.data.active
      setDecoration(active)
      // Coming back from preview, the admin needs the current picture.
      if (active) scheduleGeometry()
      return
    }
    // Highlight still works while suspended - the rail may point at a block
    // even when the page is being read rather than edited.
    if (!isStudioHighlightMessage(e.data)) return
    const el = findBlockEl(doc, e.data.key)
    if (!el) return
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch { /* older engines */ }
    el.classList?.add(FLASH_CLASS)
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => el.classList?.remove(FLASH_CLASS), FLASH_MS)
  }
  // ── Geometry ────────────────────────────────────────────────────────────
  // Coalesced to one report per animation frame: scrolling changes every
  // rect, so this is throttled the way any scroll handler must be.
  // `pending` is set BEFORE scheduling, not derived from the frame id: a
  // synchronous or polyfilled rAF runs the callback first and returns its id
  // afterwards, so assigning the id as the flag would latch the throttle
  // permanently shut after the first report.
  let pending = false
  let frameId = 0
  const postGeometry = () => {
    if (!active) return
    const nodes = doc.querySelectorAll?.(`[${TANGEN_BLOCK_ATTR}]`) ?? []
    const blocks: StudioBlockRect[] = []
    for (const el of Array.from(nodes as ArrayLike<any>)) {
      const key = el.getAttribute?.(TANGEN_BLOCK_ATTR)
      if (!key) continue   // a nameless rect helps nobody
      const r = el.getBoundingClientRect?.()
      if (!r) continue
      blocks.push({
        key,
        rect: {
          top: Math.round(r.top), left: Math.round(r.left),
          width: Math.round(r.width), height: Math.round(r.height),
        },
      })
    }
    const msg: StudioGeometryMessage = {
      type: STUDIO_GEOMETRY_TYPE,
      blocks,
      viewport: { width: Math.round(w.innerWidth ?? 0), height: Math.round(w.innerHeight ?? 0) },
      scroll: { x: Math.round(w.scrollX ?? 0), y: Math.round(w.scrollY ?? 0) },
    }
    try { w.parent?.postMessage(msg, adminOrigin ?? '*') } catch { /* not framed */ }
  }
  const scheduleGeometry = () => {
    if (!active || pending) return
    pending = true
    frameId = w.requestAnimationFrame?.(() => { pending = false; frameId = 0; postGeometry() }) ?? 0
    // No rAF at all (older engines): report straight away.
    if (!frameId && pending) { pending = false; postGeometry() }
  }

  // Scroll is captured so inner scrollers move the report too, not just the
  // page. Resize covers layout changes the page makes on its own.
  w.addEventListener('scroll', scheduleGeometry, true)
  w.addEventListener('resize', scheduleGeometry)

  w.addEventListener('message', onMessage)

  // Announce the overlay and what it supports. Studio uses this to tell a
  // site that CAN suspend from one on an older SDK that cannot - and to know
  // the overlay is installed at all, which it previously had no way to see.
  try {
    const ready: StudioReadyMessage = {
      type: STUDIO_READY_TYPE,
      capabilities: [...STUDIO_OVERLAY_CAPABILITIES],
    }
    w.parent?.postMessage(ready, adminOrigin ?? '*')
  } catch { /* not framed - best effort */ }
  scheduleGeometry()

  return () => {
    active = false
    if (frameId) w.cancelAnimationFrame?.(frameId)
    w.removeEventListener?.('scroll', scheduleGeometry, true)
    w.removeEventListener?.('resize', scheduleGeometry)
    doc.removeEventListener?.('click', onClick, true)
    w.removeEventListener?.('message', onMessage)
    if (flashTimer) clearTimeout(flashTimer)
    try { style.remove() } catch { /* already gone */ }
    try { draftStyle?.remove() } catch { /* already gone */ }
    published.stop()
  }
}
