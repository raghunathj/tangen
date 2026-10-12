/**
 * File Name: code.tsx
 * Purpose: Code widgets shared across the flows extension - a CodeMirror
 *          editor (JavaScript for the code node, JSON for config/test
 *          input) and a zero-dependency syntax-highlighted JSON block
 *          for read-only run output.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: codemirror + language packs are extension-local
 *          deps (resolve from extensions/flows/node_modules) and load
 *          lazily so the canvas chunk stays lean. HighlightedJson is a
 *          tiny regex tokenizer - cheap enough to render per step row.
 */
import { useEffect, useRef } from 'react'

/** Lazy CodeMirror editor; mounts once, syncs external value changes. */
export function CodeEditor({ value, onChange, lang = 'javascript', maxHeight = '280px' }: {
  value: string
  onChange: (v: string) => void
  lang?: 'javascript' | 'json'
  maxHeight?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const viewRef = useRef<{ state: { doc: { toString(): string; length: number } }; dispatch: (t: unknown) => void; destroy: () => void } | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    let disposed = false
    const langImport = lang === 'json' ? import('@codemirror/lang-json') : import('@codemirror/lang-javascript')
    void Promise.all([import('codemirror'), langImport]).then(([cm, langMod]) => {
      if (disposed || !ref.current || viewRef.current) return
      const { EditorView, basicSetup } = cm
      const language = lang === 'json'
        ? (langMod as { json: () => unknown }).json()
        : (langMod as { javascript: () => unknown }).javascript()
      const view = new EditorView({
        doc: value,
        parent: ref.current,
        extensions: [
          basicSetup,
          language,
          EditorView.theme({ '&': { fontSize: '12px', maxHeight }, '.cm-scroller': { overflow: 'auto' } }),
          EditorView.updateListener.of((u: { docChanged: boolean; state: { doc: { toString(): string } } }) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString())
          }),
        ],
      })
      viewRef.current = view as never
    })
    return () => { disposed = true; viewRef.current?.destroy(); viewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Sync external value changes (e.g. switching to another node) into the doc.
  useEffect(() => {
    const view = viewRef.current
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    }
  }, [value])
  return <div ref={ref} className="border border-border rounded-md overflow-hidden bg-surface" />
}

// string (then optional colon = it's a key) | true/false/null | number
const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

/** Read-only, syntax-colored, 2-space-indented JSON. */
export function HighlightedJson({ value, className }: { value: unknown; className?: string }) {
  let text: string
  try { text = JSON.stringify(value, null, 2) ?? 'null' } catch { text = String(value) }
  const out: React.ReactNode[] = []
  let last = 0
  let k = 0
  let m: RegExpExecArray | null
  JSON_TOKEN.lastIndex = 0
  while ((m = JSON_TOKEN.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] !== undefined) {
      if (m[2]) {
        out.push(<span key={k++} className="text-sky-700 dark:text-sky-400">{m[1]}</span>, m[2])
      } else {
        out.push(<span key={k++} className="text-success-fg dark:text-success">{m[1]}</span>)
      }
    } else if (m[3]) {
      out.push(<span key={k++} className="text-purple-600 dark:text-purple-400">{m[3]}</span>)
    } else if (m[4]) {
      out.push(<span key={k++} className="text-warning-fg dark:text-warning">{m[4]}</span>)
    }
    last = JSON_TOKEN.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return (
    <pre className={className ?? 'text-xs font-mono text-fg-muted bg-surface-sunken rounded-md p-2 overflow-auto max-h-48 whitespace-pre-wrap break-all'}>{out}</pre>
  )
}
