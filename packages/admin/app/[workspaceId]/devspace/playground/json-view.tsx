/**
 * File Name: json-view.tsx
 * Purpose: Playground JSON surfaces — a collapsible, syntax-colored JSON tree
 *          for responses (close objects/arrays like a devtools inspector) and
 *          a lazy CodeMirror JSON editor (highlighting + lint) for request
 *          bodies with a Beautify action.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'

// ── Collapsible JSON tree ─────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return <span className="inline-block w-3 text-fg-subtle select-none">{open ? '▾' : '▸'}</span>
}

function Leaf({ value }: { value: unknown }) {
  if (value === null) return <span className="text-fg-subtle">null</span>
  switch (typeof value) {
    case 'string': return <span className="text-success-fg dark:text-success">"{value}"</span>
    case 'number': return <span className="text-info-fg dark:text-info">{String(value)}</span>
    case 'boolean': return <span className="text-violet-700 dark:text-violet-400">{String(value)}</span>
    default: return <span className="text-fg-subtle">{String(value)}</span>
  }
}

function Node({ name, value, depth, defaultOpen }: {
  name: string | null
  value: unknown
  depth: number
  defaultOpen: boolean
}) {
  const isObj = value !== null && typeof value === 'object'
  const [open, setOpen] = useState(defaultOpen)

  const label = name !== null && (
    <span className="text-warning-fg dark:text-amber-300">{JSON.stringify(name)}<span className="text-fg-subtle">: </span></span>
  )

  if (!isObj) {
    return <div style={{ paddingLeft: depth * 14 }} className="pl-3">{label}<Leaf value={value} /></div>
  }

  const isArr = Array.isArray(value)
  const entries = isArr ? (value as unknown[]).map((v, i) => [i, v] as const) : Object.entries(value as Record<string, unknown>)
  const braces = isArr ? ['[', ']'] : ['{', '}']

  if (entries.length === 0) {
    return <div style={{ paddingLeft: depth * 14 }} className="pl-3">{label}<span className="text-fg-subtle">{braces[0]}{braces[1]}</span></div>
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ paddingLeft: depth * 14 }}
        className="w-full text-left hover:bg-surface-hover/60 rounded-sm"
      >
        <Chevron open={open} />
        {label}
        <span className="text-fg-subtle">{braces[0]}</span>
        {!open && <span className="text-fg-subtle"> {isArr ? `${entries.length} item${entries.length === 1 ? '' : 's'}` : `${entries.length} key${entries.length === 1 ? '' : 's'}`} {braces[1]}</span>}
      </button>
      {open && (
        <>
          {entries.map(([k, v]) => (
            <Node key={String(k)} name={isArr ? null : String(k)} value={v} depth={depth + 1} defaultOpen={depth < 2} />
          ))}
          <div style={{ paddingLeft: depth * 14 }} className="pl-3 text-fg-subtle">{braces[1]}</div>
        </>
      )}
    </div>
  )
}

/** Devtools-style tree: nodes/arrays collapse, first two levels start open. */
export function JsonTree({ value, className }: { value: unknown; className?: string }) {
  return (
    <div className={clsx('text-xs font-mono leading-5', className)}>
      <Node name={null} value={value} depth={0} defaultOpen />
    </div>
  )
}

// ── CodeMirror JSON editor (lazy) ────────────────────────────────────────────

export function JsonEditor({ value, onChange, minHeight = '9rem' }: {
  value: string
  onChange: (text: string) => void
  minHeight?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<{ state: { doc: { toString(): string } }; dispatch: (spec: unknown) => void; destroy(): void } | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let disposed = false
    ;(async () => {
      try {
        const [{ EditorView, basicSetup }, { json }, { playgroundTheme }] = await Promise.all([
          import('codemirror'),
          import('@codemirror/lang-json'),
          import('./cm-theme'),
        ])
        if (disposed || !host.current) return
        viewRef.current?.destroy()
        viewRef.current = new EditorView({
          doc: value,
          parent: host.current,
          extensions: [
            basicSetup,
            ...playgroundTheme,
            json(),
            EditorView.updateListener.of((u: { docChanged: boolean; state: { doc: { toString(): string } } }) => {
              if (u.docChanged) onChangeRef.current(u.state.doc.toString())
            }),
          ],
        }) as never
      } catch {
        setFailed(true)
      }
    })()
    return () => { disposed = true; viewRef.current?.destroy(); viewRef.current = null }
    // mount once — external value changes are pushed via the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // External loads (catalog sample, history, saved request) replace the doc
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.toString().length, insert: value } })
    }
  }, [value])

  if (failed) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        rows={7}
        spellCheck={false}
        className="w-full border border-border rounded-md px-2.5 py-1.5 text-sm font-mono text-fg bg-surface focus:outline-none"
      />
    )
  }
  return (
    <div
      ref={host}
      style={{ minHeight }}
      className="border border-border rounded-md overflow-hidden bg-surface [&_.cm-editor]:text-[12.5px] [&_.cm-editor]:min-h-[inherit]"
    />
  )
}

/** Pretty-prints JSON text; returns null when it doesn't parse. */
export function beautifyJson(text: string): string | null {
  try { return JSON.stringify(JSON.parse(text || '{}'), null, 2) } catch { return null }
}
