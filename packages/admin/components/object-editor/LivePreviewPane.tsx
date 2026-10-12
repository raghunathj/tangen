/**
 * File Name: LivePreviewPane.tsx
 * Purpose: Live-preview focus mode, composable pieces. The object editor owns a SINGLE top bar
 *   spanning both panes (editor + preview) and composes these: `PreviewBreakpoints` (centered
 *   device control), `ConnectionBadge` (front-end SDK handshake), a console toggle backed by
 *   `useLivePreviewConnection`, and `LivePreviewCanvas` (the framed site + origin-pinned
 *   postMessage push). Breakpoint + connection state is lifted to hooks so the shared bar can
 *   render the controls while the canvas stays a dumb frame.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import {
  IconPlus, IconX,
  IconComputer, IconTablet, IconSmartphone, IconChevronDown,
} from '@tangen/icons'

export interface PreviewSnapshot {
  id: string
  type: string
  title?: string
  slug?: string
  status?: string
  locale?: string
  values: Record<string, unknown>
}

export const PREVIEW_MESSAGE_TYPE = 'tangen:preview:update'
export const PREVIEW_READY_TYPE = 'tangen:preview:ready'
export const PREVIEW_CONSOLE_TYPE = 'tangen:preview:console'
/** Site → admin: the user navigated to a different object inside the pane. */
export const PREVIEW_NAVIGATE_TYPE = 'tangen:preview:navigate'
/** Admin → site: a browser-chrome command (back/forward/reload) from the toolbar. */
export const PREVIEW_COMMAND_TYPE = 'tangen:preview:command'

export function buildPreviewMessage(snap: PreviewSnapshot) {
  return { type: PREVIEW_MESSAGE_TYPE, object: snap }
}

const PRESETS = [
  { id: 'desktop', label: 'Desktop', width: null as number | null, Icon: IconComputer },
  { id: 'tablet', label: 'Tablet', width: 768, Icon: IconTablet },
  { id: 'mobile', label: 'Mobile', width: 375, Icon: IconSmartphone },
]
const CUSTOM_KEY = 'tangen:preview:breakpoints'
const MAX_CUSTOM = 4

interface CustomBp { label: string; width: number }
function loadCustom(): CustomBp[] {
  try {
    const arr = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]')
    return Array.isArray(arr) ? arr.filter((b) => typeof b?.width === 'number').slice(0, MAX_CUSTOM) : []
  } catch { return [] }
}

// ─── Breakpoints (device widths) — state lifted so the shared bar can render it ───

export interface PreviewBreakpointsApi {
  selected: string
  setSelected: (s: string) => void
  custom: CustomBp[]
  adding: boolean
  setAdding: (v: boolean | ((v: boolean) => boolean)) => void
  draftW: string
  setDraftW: (s: string) => void
  /** The resolved canvas width in px, or null for fluid (100%). */
  width: number | null
  addBreakpoint: () => void
  removeBreakpoint: (i: number) => void
  configBreakpoints: Array<{ name: string; width: number }>
}

export function usePreviewBreakpoints(configBreakpoints: Array<{ name: string; width: number }> = []): PreviewBreakpointsApi {
  const [selected, setSelected] = useState<string>('desktop')  // 'desktop' | 'cfg:<i>' | 'custom:<i>'
  const [custom, setCustom] = useState<CustomBp[]>(() => (typeof localStorage !== 'undefined' ? loadCustom() : []))
  const [adding, setAdding] = useState(false)
  const [draftW, setDraftW] = useState('')

  const width: number | null = selected.startsWith('custom:')
    ? custom[Number(selected.slice(7))]?.width ?? null
    : selected.startsWith('cfg:')
    ? configBreakpoints[Number(selected.slice(4))]?.width ?? null
    : PRESETS.find((d) => d.id === selected)?.width ?? null

  function addBreakpoint() {
    const w = Math.round(Number(draftW))
    if (!Number.isFinite(w) || w < 200 || w > 3840 || custom.length >= MAX_CUSTOM) return
    const next = [...custom, { label: `${w}px`, width: w }].slice(0, MAX_CUSTOM)
    setCustom(next); setSelected(`custom:${next.length - 1}`); setAdding(false); setDraftW('')
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }
  function removeBreakpoint(i: number) {
    const next = custom.filter((_, j) => j !== i)
    setCustom(next); setSelected('desktop')
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  return { selected, setSelected, custom, adding, setAdding, draftW, setDraftW, width, addBreakpoint, removeBreakpoint, configBreakpoints }
}

/**
 * The centered device-breakpoint control for the shared top bar.
 *
 * `bare` drops the pill border for a dense bar that already separates its
 * groups (Studio's), where a second bordered container reads as an odd
 * floating box rather than a group.
 *
 * `collapseCustom` folds saved custom widths into a dropdown. Inline they
 * grow the control with every width added, which crowds a shared bar - and
 * they are the least-used entries there.
 */
export function PreviewBreakpoints({ bp, bare, collapseCustom }: {
  bp: PreviewBreakpointsApi
  bare?: boolean
  collapseCustom?: boolean
}) {
  const { selected, setSelected, custom, adding, setAdding, draftW, setDraftW, width, addBreakpoint, removeBreakpoint, configBreakpoints } = bp
  const [customOpen, setCustomOpen] = useState(false)
  const customBox = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!customOpen) return
    const onDown = (e: MouseEvent) => { if (!customBox.current?.contains(e.target as Node)) setCustomOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [customOpen])

  const activeCustom = /^custom:(\d+)$/.exec(selected)
  const activeCustomWidth = activeCustom ? custom[Number(activeCustom[1])]?.width : undefined

  return (
    <div className="flex items-center gap-1">
      <div className={bare ? 'flex items-center gap-0.5' : 'flex items-center gap-0.5 rounded-md border border-border p-0.5'}>
        {PRESETS.map(({ id, label, Icon }) => (
          <button key={id} type="button" title={label} aria-pressed={selected === id} onClick={() => setSelected(id)}
            className={clsx('grid place-items-center size-7 rounded', selected === id ? 'bg-accent-muted text-accent-fg' : 'text-fg-subtle hover:bg-surface-hover')}>
            <Icon className="size-4" />
          </button>
        ))}
        {configBreakpoints.map((b, i) => (
          <button key={`cfg${i}`} type="button" title={`${b.name} · ${b.width}px`} aria-pressed={selected === `cfg:${i}`} onClick={() => setSelected(`cfg:${i}`)}
            className={clsx('px-2 h-7 text-[11px] font-medium rounded', selected === `cfg:${i}` ? 'bg-accent-muted text-accent-fg' : 'text-fg-subtle hover:bg-surface-hover')}>
            {b.name}
          </button>
        ))}
        {collapseCustom ? (
          custom.length > 0 && (
            <div ref={customBox} className="relative">
              <button
                type="button"
                onClick={() => setCustomOpen((o) => !o)}
                title="Saved custom widths"
                className={clsx('flex items-center gap-0.5 px-1.5 h-7 rounded text-[11px] tabular-nums',
                  activeCustomWidth ? 'bg-accent-muted text-accent-fg' : 'text-fg-subtle hover:bg-surface-hover')}
              >
                {activeCustomWidth ?? 'Custom'}
                <IconChevronDown className="size-3" />
              </button>
              {customOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 w-32 rounded-md border border-border bg-surface-raised shadow-lg py-1">
                  {custom.map((b, i) => (
                    <div key={i} className="group flex items-center">
                      <button
                        type="button"
                        onClick={() => { setSelected(`custom:${i}`); setCustomOpen(false) }}
                        className={clsx('flex-1 text-left px-3 py-1 text-[11px] tabular-nums',
                          `custom:${i}` === selected ? 'text-accent-fg' : 'text-fg hover:bg-surface-hover')}
                      >
                        {b.width}px
                      </button>
                      <button
                        type="button"
                        title="Remove"
                        onClick={() => removeBreakpoint(i)}
                        className="opacity-0 group-hover:opacity-100 grid place-items-center size-6 mr-1 rounded text-fg-subtle hover:text-danger"
                      >
                        <IconX className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        ) : custom.map((b, i) => (
          <span key={i} className={clsx('group relative flex items-center rounded', `custom:${i}` === selected ? 'bg-accent-muted' : 'hover:bg-surface-hover')}>
            <button type="button" onClick={() => setSelected(`custom:${i}`)}
              className={clsx('px-1.5 h-7 text-[11px] tabular-nums', `custom:${i}` === selected ? 'text-accent-fg' : 'text-fg-subtle')}>{b.width}</button>
            <button type="button" title="Remove" onClick={() => removeBreakpoint(i)}
              // bg-fg is the FOREGROUND colour used as a background, so its text
              // must invert with the theme: text-white here was a white circle
              // with white text under Studio's dark skin.
              className="hidden group-hover:grid place-items-center absolute -top-1 -right-1 size-3.5 rounded-full bg-fg text-fg-inverted">
              <IconX className="size-2.5" />
            </button>
          </span>
        ))}
        {custom.length < MAX_CUSTOM && (
          <button type="button" title="Add a custom width" onClick={() => setAdding((v) => !v)}
            className="grid place-items-center size-7 rounded text-fg-subtle hover:bg-surface-hover">
            <IconPlus className="size-4" />
          </button>
        )}
      </div>
      {adding && (
        <form onSubmit={(e) => { e.preventDefault(); addBreakpoint() }} className="flex items-center gap-1">
          <input autoFocus type="number" min={200} max={3840} value={draftW} placeholder="px"
            onChange={(e) => setDraftW((e.target as HTMLInputElement).value)}
            className="w-16 px-2 py-1 text-xs rounded-md border border-border bg-surface outline-none focus:ring-2 focus:ring-indigo-200" />
          <button type="submit" className="px-2 py-1 text-xs rounded-md bg-accent-strong text-white">Add</button>
        </form>
      )}
      <span className="text-[11px] text-fg-subtle tabular-nums w-12 text-right">{width ? `${width}px` : 'Fluid'}</span>
    </div>
  )
}

// ─── Front-end connection + forwarded console — lifted to a hook ───

export interface ConsoleEntry { level: string; text: string; at: number }

/**
 * Listens for the front-end SDK handshake (→ connected) and forwarded console
 * entries, origin-pinned to targetOrigin. Resets on reload/src change; warns if
 * no handshake arrives within ~6s.
 */
export function useLivePreviewConnection(targetOrigin: string, reloadKey: number, src: string) {
  const [connected, setConnected] = useState<boolean | null>(null)  // null = waiting
  const [logs, setLogs] = useState<ConsoleEntry[]>([])
  useEffect(() => {
    const originEq = (o: string) => o.replace(/\/+$/, '') === targetOrigin.replace(/\/+$/, '')
    setConnected(null); setLogs([])
    const onMsg = (e: MessageEvent) => {
      if (!originEq(e.origin)) return
      const t = (e.data as any)?.type
      if (t === PREVIEW_READY_TYPE || t === PREVIEW_MESSAGE_TYPE) setConnected(true)
      else if (t === PREVIEW_CONSOLE_TYPE) {
        const d = e.data as any
        setConnected(true)
        setLogs((l) => [...l.slice(-199), { level: String(d.level ?? 'log'), text: String(d.text ?? ''), at: Number(d.at) || Date.now() }])
      }
    }
    window.addEventListener('message', onMsg)
    const timer = setTimeout(() => setConnected((c) => (c === null ? false : c)), 6000)
    return () => { window.removeEventListener('message', onMsg); clearTimeout(timer) }
  }, [targetOrigin, reloadKey, src])
  return { connected, logs, clearLogs: () => setLogs([]) }
}

/** The Live / No-SDK badge for the shared bar's right cluster. */
export function ConnectionBadge({ connected }: { connected: boolean | null }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap',
      connected === false ? 'text-amber-600' : 'text-fg')}
      title={connected === false ? 'No SDK handshake - add onLivePreview() to your site for live updates' : connected ? 'Front-end SDK connected' : 'Waiting for the front-end…'}>
      <span className={clsx('size-1.5 rounded-full', connected === false ? 'bg-warning' : connected ? 'bg-success animate-pulse' : 'bg-fg-faint')} aria-hidden />
      {connected === false ? 'No SDK' : 'Live'}
    </span>
  )
}

/** The forwarded front-end console drawer (opt-in via onLivePreview({ forwardConsole: true })). */
export function PreviewConsole({ logs, onClear, onClose }: { logs: ConsoleEntry[]; onClear: () => void; onClose: () => void }) {
  return (
    <div className="h-48 shrink-0 border-t border-border bg-[#0f1117] text-gray-200 flex flex-col">
      <div className="flex items-center gap-2 px-3 h-8 border-b border-white/10 shrink-0">
        <span className="text-[11px] font-medium text-gray-400">Console · front-end</span>
        <div className="flex-1" />
        <button type="button" onClick={onClear} className="text-[11px] text-gray-400 hover:text-white">Clear</button>
        <button type="button" aria-label="Close console" onClick={onClose} className="text-gray-400 hover:text-white"><IconX className="size-3.5" /></button>
      </div>
      <div className="flex-1 overflow-auto font-mono text-[11px] leading-relaxed px-3 py-2">
        {logs.length === 0 ? (
          <p className="text-gray-500">No logs yet. Enable <code className="text-gray-300">forwardConsole: true</code> in <code className="text-gray-300">onLivePreview()</code> on your site.</p>
        ) : logs.map((l, i) => (
          <div key={i} className={clsx('whitespace-pre-wrap break-words py-0.5',
            l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-300' : l.level === 'info' ? 'text-sky-300' : 'text-gray-300')}>
            <span className="text-gray-600 mr-2">{l.level}</span>{l.text}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── The canvas — framed site + origin-pinned live push (no chrome of its own) ───

interface LivePreviewCanvasProps {
  src: string
  targetOrigin: string
  snapshot: PreviewSnapshot
  /** Device width in px, or null for fluid. */
  width: number | null
  /** Bump to force an iframe reload. */
  reloadKey: number
  /** Studio seam: receive the iframe element so the caller can post its own
   *  messages (e.g. studio:highlight) into the frame. */
  onFrame?: (el: HTMLIFrameElement | null) => void
  /** Studio seam: canvas zoom (1 = 100%). A caller drawing over the frame
   *  must scale its own geometry by the same factor. */
  zoom?: number
  /** Studio seam: drop the mat around the frame so the page fills the canvas,
   *  the way a design tool's artboard does. The object editor keeps the mat -
   *  there the preview is a panel among panels, not the workspace. */
  flush?: boolean
}

export function LivePreviewCanvas({ src, targetOrigin, snapshot, width, reloadKey, onFrame, zoom, flush }: LivePreviewCanvasProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [ready, setReady] = useState(false)
  // Latest snapshot, so the handshake listener can push it without re-subscribing.
  const snapshotRef = useRef(snapshot)
  useEffect(() => { snapshotRef.current = snapshot }, [snapshot])

  // A reload re-frames the site — wait for the fresh load before pushing again.
  useEffect(() => { setReady(false) }, [reloadKey])

  // Push the live snapshot (debounced) as the editor changes, once the frame is ready.
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => {
      try { iframeRef.current?.contentWindow?.postMessage(buildPreviewMessage(snapshot), targetOrigin) } catch { /* refused */ }
    }, 120)
    return () => clearTimeout(t)
  }, [ready, snapshot, targetOrigin])

  // Push the moment the frame (re)subscribes: its READY handshake is the exact
  // point it can receive state. This is what re-hydrates a reload or in-pane
  // navigation with the live/localized snapshot, instead of racing the timer
  // above against the fresh page's subscription (which dropped the locale).
  useEffect(() => {
    const norm = (o: string) => o.replace(/\/+$/, '')
    const onReady = (e: MessageEvent) => {
      if (norm(e.origin) !== norm(targetOrigin)) return
      if ((e.data as { type?: string } | null)?.type !== PREVIEW_READY_TYPE) return
      try { iframeRef.current?.contentWindow?.postMessage(buildPreviewMessage(snapshotRef.current), targetOrigin) } catch { /* refused */ }
    }
    window.addEventListener('message', onReady)
    return () => window.removeEventListener('message', onReady)
  }, [targetOrigin])

  // Zoom scales the frame about its top-left so the artboard grows down and
  // right into the scroll box. Callers that draw over the frame must scale
  // their geometry to match (Studio does; see canvas-frame.ts).
  const z = typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1

  return (
    <div className={`flex-1 min-h-0 overflow-auto bg-surface-sunken${flush ? '' : ' p-4'}`}>
      <div
        className="mx-auto h-full"
        style={{
          width: width ? `${width}px` : '100%',
          maxWidth: z === 1 ? '100%' : undefined,
          transition: 'width .25s ease',
          transform: z === 1 ? undefined : `scale(${z})`,
          transformOrigin: 'top left',
        }}
      >
        <iframe
          key={reloadKey}
          ref={(el) => { iframeRef.current = el; onFrame?.(el) }}
          src={src}
          title="Live preview"
          onLoad={() => setReady(true)}
          className={`w-full h-full bg-white${flush ? '' : ' border border-border rounded-lg shadow-lg'}`}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
      </div>
    </div>
  )
}
