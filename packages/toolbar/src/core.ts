/**
 * File Name: core.ts
 * Purpose: The floating Tangen toolbar - a draggable Tangen-icon button that
 *          expands into a panel with Performance / Requests / Console tabs
 *          and an "Edit this page" action, rendered inside a Shadow DOM so
 *          host-site CSS and the toolbar can never style each other.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: mountToolbar is SSR-safe (no-op without a document)
 *          and idempotent. All state comes from ./state; collectors (vitals,
 *          console, SDK request feed) are wired in ./collect. Rendering is a
 *          simple full re-render of the open panel on state change - the
 *          data is tiny and the panel is closed most of the time.
 */
import { getState, subscribe, setPage, type ToolbarState, type VitalSample } from './state'
import { initVitalsCollection, initConsoleCollection, initRequestCollection } from './collect'
import { initSsrTimingsCollection } from './ssr'
import { canExpandRequests, getExpandedQmId, getDetailSlot, toggleRequestDetail, collapseRequestDetail } from './detail'

export interface ToolbarConfig {
  /** Admin base INCLUDING workspace + env, e.g. https://admin.site.com/wsp_x/production */
  adminUrl?: string
  /** Explicit kill switch - mount becomes a no-op when false. */
  enabled?: boolean
}

const POS_KEY = 'tangen.toolbar.pos'
const TABS = ['Performance', 'Requests', 'Console'] as const
type Tab = typeof TABS[number]

let host: HTMLDivElement | null = null
let shadow: ShadowRoot | null = null
let activeConfig: ToolbarConfig = {}
let activeTab: Tab = 'Performance'
let open = false
let unsub: (() => void) | null = null
let historyPatched = false

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
.root { position: fixed; bottom: 16px; right: 16px; z-index: 2147483000; }
.btn {
  width: 42px; height: 42px; border-radius: 12px; border: 1px solid #d4d4dd;
  background: #ffffff; cursor: grab; display: flex; align-items: center;
  justify-content: center; box-shadow: 0 4px 14px rgba(0,0,0,.18); touch-action: none;
  user-select: none; padding: 0;
}
.btn:active { cursor: grabbing; }
.btn.warn { box-shadow: 0 0 0 2px #f59e0b, 0 4px 14px rgba(0,0,0,.18); }
.btn.bad { box-shadow: 0 0 0 2px #ef4444, 0 4px 14px rgba(0,0,0,.18); }
.panel {
  position: absolute; width: 360px; max-height: min(420px, 70vh); overflow-y: auto;
  background: #ffffff; border: 1px solid #e2e2e9; border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0,0,0,.16); color: #1f2430; font-size: 12px;
}
.panel.up { bottom: calc(100% + 8px); } .panel.down { top: calc(100% + 8px); }
.panel.left { left: 0; } .panel.right { right: 0; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 10px; border-bottom: 1px solid #ececf2; position: sticky; top: 0; background: #fff; }
.title { font-weight: 600; font-size: 12px; }
.edit { font-size: 11px; font-weight: 600; color: #fff; background: #4f46e5; border: none;
  border-radius: 8px; padding: 4px 10px; cursor: pointer; text-decoration: none; }
.edit:hover { background: #4338ca; }
.tabs { display: flex; gap: 2px; padding: 6px 8px 0; }
.tab { border: none; background: none; font-size: 11px; font-weight: 600; color: #6b7280;
  padding: 4px 8px; border-radius: 8px 8px 0 0; cursor: pointer; }
.tab.on { color: #4f46e5; background: #eef2ff; }
.body { padding: 8px 10px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 3px 0; }
.k { color: #6b7280; } .v { font-variant-numeric: tabular-nums; }
.chip { display: inline-block; border: 1px solid; border-radius: 999px; padding: 1px 7px;
  font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; margin: 1px 2px 1px 0; }
.chip.good { color: #047857; border-color: #a7f3d0; background: #ecfdf5; }
.chip.warn { color: #b45309; border-color: #fde68a; background: #fffbeb; }
.chip.bad { color: #b91c1c; border-color: #fecaca; background: #fef2f2; }
.chip.muted { color: #6b7280; border-color: #e5e7eb; background: #f9fafb; }
.req { border-top: 1px solid #f1f1f5; padding: 4px 0; }
.req .path { font-family: ui-monospace, monospace; font-size: 11px; word-break: break-all; }
.req[data-qm] { cursor: pointer; }
.req[data-qm]:hover { background: #f9fafb; }
.caret { display: inline-block; width: 10px; color: #9ca3af; font-size: 9px; }
.qm-detail { margin: 4px 0 2px 10px; border-left: 2px solid #e5e7eb; padding-left: 8px; cursor: default; }
.qrow { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 2px 0; }
.qrow .shape { font-family: ui-monospace, monospace; font-size: 10px; color: #374151; word-break: break-all; }
.qrow .qms { color: #6b7280; font-size: 10px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.srv { display: inline-block; color: #4338ca; border: 1px solid #c7d2fe; background: #eef2ff;
  border-radius: 999px; padding: 0 6px; font-size: 9px; font-weight: 600; vertical-align: 1px; }
.req .meta { color: #6b7280; font-size: 10px; font-variant-numeric: tabular-nums; }
.log { border: 1px solid; border-radius: 8px; padding: 4px 6px; margin: 3px 0; }
.log.error { border-color: #fecaca; background: #fef2f2; }
.log.warn { border-color: #fde68a; background: #fffbeb; }
.log pre { margin: 2px 0 0; font-family: ui-monospace, monospace; font-size: 10px;
  white-space: pre-wrap; word-break: break-all; max-height: 64px; overflow-y: auto; }
.empty { color: #9ca3af; padding: 6px 0; }
.foot { color: #9ca3af; font-size: 10px; padding: 4px 10px 8px; }
`

// The Tangen hut mark (same path the admin's workspace switcher renders).
const LOGO = `<svg width="22" height="22" viewBox="0 0 111 111" fill="none" aria-hidden="true">
<path d="M59.5048 13.8758L102.228 87.875H106.375V97.125H4.625V87.875H8.77076L51.4943 13.8758C52.7712 11.6636 55.5999 10.9057 57.812 12.1829C58.515 12.5888 59.0992 13.1727 59.5048 13.8758ZM55.5 59.7772L40.0464 87.875H70.954L55.5 59.7772Z" fill="#5B4CF5"/>
</svg>`

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtVital(name: string, v: VitalSample): string {
  return name === 'CLS' ? v.value.toFixed(3) : `${Math.round(v.value)}ms`
}

function toneOf(r: VitalSample['rating']): 'good' | 'warn' | 'bad' {
  return r === 'good' ? 'good' : r === 'needs-improvement' ? 'warn' : 'bad'
}

/** Worst signal drives the button ring: console errors or any poor vital. */
function overallTone(s: ToolbarState): '' | 'warn' | 'bad' {
  if (s.console.some((e) => e.level === 'error')) return 'bad'
  const ratings = Object.values(s.vitals).map((v) => v!.rating)
  if (ratings.includes('poor')) return 'bad'
  if (ratings.includes('needs-improvement') || s.console.length > 0) return 'warn'
  return ''
}

export function buildEditUrl(adminUrl: string, page: { type: string; id: string }): string {
  return `${adminUrl.replace(/\/$/, '')}/objects/${encodeURIComponent(page.type)}/${encodeURIComponent(page.id)}?preview=1`
}

function renderPerformance(s: ToolbarState): string {
  const chips = (Object.entries(s.vitals) as Array<[string, VitalSample]>)
    .map(([n, v]) => `<span class="chip ${toneOf(v.rating)}" title="Core Web Vitals rating: ${v.rating}">${n} ${fmtVital(n, v)}</span>`)
    .join('')
  return `
    <div class="row"><span class="k">Page load</span><span class="v">${s.loadMs != null ? `${s.loadMs}ms` : 'measuring...'}</span></div>
    <div>${chips || '<span class="empty">Collecting page vitals...</span>'}</div>`
}

/** Inline drill-down block under an expanded request row. */
function renderQmDetail(qmId: string): string {
  const slot = getDetailSlot(qmId)
  if (!slot || slot.status === 'loading') {
    return `<div class="qm-detail"><span class="empty">Loading query detail...</span></div>`
  }
  if (slot.status === 'unavailable' || !slot.detail) {
    return `<div class="qm-detail"><span class="empty">Detail unavailable: the entry expired or capture is off.</span></div>`
  }
  const d = slot.detail
  const summary = `${d.queryCount} queries · db ${Math.round(d.dbMs)}ms` +
    `${d.waitMs > 0 ? ` · waited ${Math.round(d.waitMs)}ms` : ''}` +
    `${d.dupCount > 0 ? ` · ${d.dupCount} dup` : ''}` +
    `${d.droppedQueries > 0 ? ` · ${d.droppedQueries} dropped` : ''}`
  const rows = d.queries.map((q) =>
    `<div class="qrow"><span class="shape">${esc(q.shape)}</span>` +
    `<span class="qms">${q.durationMs}ms${q.waitMs ? ` (waited ${q.waitMs}ms)` : ''}${q.error ? ' · error' : ''}</span></div>`,
  ).join('')
  return `<div class="qm-detail"><div class="meta">${summary}</div>${rows || '<span class="empty">No queries in this request.</span>'}</div>`
}

function renderRequests(s: ToolbarState): string {
  if (s.requests.length === 0) {
    return `<p class="empty">No SDK requests observed yet. Browser-side SDK calls appear here automatically; server-rendered sites can relay their fetches via the SSR timings tag (docs/toolbar.md).</p>`
  }
  const expandable = canExpandRequests()
  const expanded = getExpandedQmId()
  return [...s.requests].reverse().map((r) => {
    const st = r.serverTiming
    const server = st ? ` · db ${Math.round(st.dbMs)}ms${st.queueMs ? ` (+${Math.round(st.queueMs)}ms queued)` : ''}${st.queries != null ? ` · ${st.queries}q` : ''}${st.dup ? ` · ${st.dup} dup` : ''}` : ''
    const badge = r.source === 'server' ? '<span class="srv" title="Fetched during the server render, relayed via the SSR timings tag">server</span> ' : ''
    const canDrill = expandable && !!r.qmId
    const isOpen = canDrill && r.qmId === expanded
    const caret = canDrill ? `<span class="caret">${isOpen ? '▾' : '▸'}</span>` : ''
    const attrs = canDrill ? ` data-qm="${esc(r.qmId!)}" title="Click for per-query detail"` : ''
    return `<div class="req"${attrs}><div class="path">${caret}${badge}${esc(r.method)} ${esc(r.path)}</div>
      <div class="meta">${r.status} · ${Math.round(r.wallMs)}ms${server}</div>${isOpen ? renderQmDetail(r.qmId!) : ''}</div>`
  }).join('')
}

function renderConsole(s: ToolbarState): string {
  if (s.console.length === 0) return `<p class="empty">No errors or warnings captured.</p>`
  return [...s.console].reverse().slice(0, 20).map((e) =>
    `<div class="log ${e.level}"><strong style="font-size:10px">${e.level}</strong><pre>${esc(e.text)}</pre></div>`,
  ).join('')
}

function render(): void {
  if (!shadow) return
  const s = getState()
  const btn = shadow.querySelector('.btn') as HTMLButtonElement | null
  if (btn) btn.className = `btn ${overallTone(s)}`.trim()

  const panel = shadow.querySelector('.panel') as HTMLDivElement | null
  if (!panel) return
  const editUrl = activeConfig.adminUrl && s.page
    ? buildEditUrl(activeConfig.adminUrl, s.page)
    : null
  const body =
    activeTab === 'Performance' ? renderPerformance(s)
    : activeTab === 'Requests' ? renderRequests(s)
    : renderConsole(s)
  panel.innerHTML = `
    <div class="head">
      <span class="title">${s.page?.title ? esc(s.page.title) : 'Tangen'}</span>
      ${editUrl ? `<a class="edit" href="${esc(editUrl)}" target="_blank" rel="noopener">Edit this page</a>` : ''}
    </div>
    <div class="tabs">${TABS.map((t) =>
      `<button class="tab ${t === activeTab ? 'on' : ''}" data-tab="${t}">${t}</button>`).join('')}</div>
    <div class="body">${body}</div>
    <div class="foot">Tangen Toolbar - server timings need monitoring on AND the API key's toolbar permission (docs/toolbar.md).</div>`
}

function loadPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (typeof p?.x === 'number' && typeof p?.y === 'number') return p
  } catch { /* ignore */ }
  return null
}

/**
 * Mounts the floating toolbar. SSR-safe no-op without a document; idempotent;
 * `enabled: false` makes it a no-op so sites can gate on their own env flag.
 */
export function mountToolbar(config: ToolbarConfig = {}): void {
  if (typeof document === 'undefined') return
  if (config.enabled === false) return
  if (host) return
  activeConfig = config

  initVitalsCollection()
  initConsoleCollection()
  initRequestCollection()
  initSsrTimingsCollection()

  // Page identity must not survive navigation: a page that reports nothing
  // (home, listings) would otherwise show the PREVIOUS page's Edit target.
  // Pages that do report re-set it on mount, after the URL changes.
  if (!historyPatched) {
    historyPatched = true
    let currentPath = window.location.pathname
    const maybeClear = () => {
      if (window.location.pathname !== currentPath) {
        currentPath = window.location.pathname
        setPage(null)
      }
    }
    const origPush = history.pushState.bind(history)
    const origReplace = history.replaceState.bind(history)
    history.pushState = (...args: Parameters<History['pushState']>) => { origPush(...args); maybeClear() }
    history.replaceState = (...args: Parameters<History['replaceState']>) => { origReplace(...args); maybeClear() }
    window.addEventListener('popstate', maybeClear)
  }

  host = document.createElement('div')
  host.setAttribute('data-tangen-toolbar', '')
  shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = CSS
  shadow.appendChild(style)

  const root = document.createElement('div')
  root.className = 'root'
  const saved = loadPos()
  if (saved) {
    root.style.left = `${saved.x}px`
    root.style.top = `${saved.y}px`
    root.style.right = 'auto'
    root.style.bottom = 'auto'
  }
  root.innerHTML = `<div class="panel up right" style="display:none"></div>
    <button class="btn" title="Tangen Toolbar (drag to move, click to open)" type="button">${LOGO}</button>`
  shadow.appendChild(root)

  const btn = root.querySelector('.btn') as HTMLButtonElement
  const panel = root.querySelector('.panel') as HTMLDivElement

  // Drag with click-toggle suppression (4px threshold), position persisted.
  let drag: { sx: number; sy: number; bx: number; by: number; moved: boolean } | null = null
  btn.addEventListener('pointerdown', (e) => {
    const r = root.getBoundingClientRect()
    drag = { sx: e.clientX, sy: e.clientY, bx: r.left, by: r.top, moved: false }
    btn.setPointerCapture(e.pointerId)
  })
  btn.addEventListener('pointermove', (e) => {
    if (!drag) return
    const dx = e.clientX - drag.sx
    const dy = e.clientY - drag.sy
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true
    if (drag.moved) {
      const x = Math.min(Math.max(8, drag.bx + dx), window.innerWidth - 50)
      const y = Math.min(Math.max(8, drag.by + dy), window.innerHeight - 50)
      root.style.left = `${x}px`
      root.style.top = `${y}px`
      root.style.right = 'auto'
      root.style.bottom = 'auto'
    }
  })
  btn.addEventListener('pointerup', () => {
    if (drag?.moved) {
      const r = root.getBoundingClientRect()
      try { localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left, y: r.top })) } catch { /* private mode */ }
    } else {
      open = !open
      panel.style.display = open ? '' : 'none'
      // Open toward the roomy side.
      const r = root.getBoundingClientRect()
      panel.classList.toggle('up', r.top > window.innerHeight / 2)
      panel.classList.toggle('down', r.top <= window.innerHeight / 2)
      panel.classList.toggle('left', r.left < 380)
      panel.classList.toggle('right', r.left >= 380)
      if (open) render()
    }
    drag = null
  })

  panel.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-tab]') as HTMLElement | null
    if (t) {
      activeTab = t.dataset.tab as Tab
      render()
      return
    }
    // Clicks inside the expanded detail block must not collapse it (text selection).
    if ((e.target as HTMLElement).closest('.qm-detail')) return
    const q = (e.target as HTMLElement).closest('[data-qm]') as HTMLElement | null
    if (q?.dataset.qm) toggleRequestDetail(q.dataset.qm, render)
  })

  unsub = subscribe(() => { if (open) render() })
  document.body.appendChild(host)
}

/** Removes the toolbar and its subscriptions. Safe to call when not mounted. */
export function unmountToolbar(): void {
  unsub?.()
  unsub = null
  host?.remove()
  host = null
  shadow = null
  open = false
  activeTab = 'Performance'
  collapseRequestDetail()
}

/** Test hook - whether the toolbar is currently mounted. */
export function _isMounted(): boolean {
  return host !== null
}
