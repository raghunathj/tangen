/**
 * File Name: json-stream-scan.ts
 * Purpose: Settled-entry scanner for progressive structured streaming - feeds
 *          on the raw text deltas of a model's JSON output and emits entries
 *          the moment they are provably complete, so the admin can reveal
 *          fields while the model is still writing. Reveal only: the terminal
 *          parse of the full buffer remains the single source of truth.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: zero deps. A real character tokenizer (string/escape
 *          aware, depth counted) - no regex, no repair-parsing. The settlement
 *          rule is deterministic: an entry settles only when its value's
 *          closing delimiter is followed by a sibling separator (',') or the
 *          enclosing close ('}'/']') at the same depth. Markdown fences and
 *          pre/post prose are tolerated (scan locks onto the first '{').
 *          On ANY confusion the scanner stops settling for good - it NEVER
 *          throws; a truncated or malformed stream simply settles less.
 */

/** One provably-complete entry of the streamed object. */
export type SettledEntry =
  | { kind: 'title'; value: string }
  | { kind: 'field'; name: string; value: unknown }
  | { kind: 'create'; index: number; value: unknown }

export interface PreviewScanner {
  /** Feeds one raw text delta; returns the entries that settled as a result. */
  push(delta: string): SettledEntry[]
}

type State =
  | 'pre'              // before the root '{' (fences / prose skipped)
  | 'key-ws'           // inside the root object, expecting a key or '}'
  | 'key'              // inside a key string
  | 'colon'            // expecting ':' after a key
  | 'value-ws'         // expecting the first char of a root value
  | 'elem-ws'          // inside the _create array, expecting an element or ']'
  | 'value-string'     // inside a string value
  | 'value-container'  // inside an object/array value (depth tracked)
  | 'value-primitive'  // inside a number/true/false/null value
  | 'root-after-value' // root value complete, awaiting ',' or '}'
  | 'elem-after'       // array element complete, awaiting ',' or ']'
  | 'post'             // root object closed - everything after is ignored

const isWs = (c: string) => c === ' ' || c === '\n' || c === '\r' || c === '\t'
const startsPrimitive = (c: string) => c === '-' || (c >= '0' && c <= '9') || c === 't' || c === 'f' || c === 'n'

/**
 * Creates a scanner for one model output stream. Deltas may split anywhere -
 * mid escape, mid key, mid number - the scan position is purely buffer-driven,
 * so the settlement sequence is identical for every chunking of the same text.
 */
export function createPreviewScanner(): PreviewScanner {
  let buf = ''
  let pos = 0
  let dead = false
  let state: State = 'pre'
  let keyStart = 0
  let key = ''
  let valueStart = 0
  let valueEnd = 0
  let esc = false
  let inStr = false
  let depth = 0
  let valueCtx: 'root' | 'elem' = 'root'
  let createIndex = 0
  /** root-after-value should emit `key` on the separator (false after the _create array). */
  let pendingRoot = false

  /** Parses the settled slice; a parse failure is tokenizer confusion → lock down. */
  function parseSlice(): { ok: true; value: unknown } | { ok: false } {
    try {
      return { ok: true, value: JSON.parse(buf.slice(valueStart, valueEnd)) }
    } catch {
      dead = true
      return { ok: false }
    }
  }

  function settleRoot(out: SettledEntry[]) {
    if (!pendingRoot) return
    pendingRoot = false
    const parsed = parseSlice()
    if (!parsed.ok) return
    if (key === '__title') {
      if (typeof parsed.value === 'string') out.push({ kind: 'title', value: parsed.value })
    } else if (key !== '_create') {
      out.push({ kind: 'field', name: key, value: parsed.value })
    }
  }

  function settleElem(out: SettledEntry[]) {
    const parsed = parseSlice()
    if (parsed.ok) out.push({ kind: 'create', index: createIndex++, value: parsed.value })
  }

  function endValue(end: number) {
    valueEnd = end
    if (valueCtx === 'root') { pendingRoot = true; state = 'root-after-value' }
    else state = 'elem-after'
  }

  /** Dispatches the first char of a value; unknown starters are confusion. */
  function beginValue(c: string, ctx: 'root' | 'elem') {
    valueCtx = ctx
    valueStart = pos
    if (c === '"') { state = 'value-string'; esc = false }
    else if (c === '{' || c === '[') { state = 'value-container'; depth = 1; inStr = false; esc = false }
    else if (startsPrimitive(c)) state = 'value-primitive'
    else dead = true
  }

  return {
    push(delta: string): SettledEntry[] {
      buf += delta
      if (dead) return []
      const out: SettledEntry[] = []
      while (pos < buf.length && !dead) {
        const c = buf[pos]!
        switch (state) {
          case 'pre':
            if (c === '{') state = 'key-ws'
            pos++
            break

          case 'key-ws':
            if (isWs(c)) { pos++; break }
            if (c === '"') { keyStart = pos; esc = false; state = 'key'; pos++; break }
            if (c === '}') { state = 'post'; pos++; break }
            dead = true
            break

          case 'key':
            if (esc) esc = false
            else if (c === '\\') esc = true
            else if (c === '"') {
              try { key = String(JSON.parse(buf.slice(keyStart, pos + 1))) } catch { dead = true }
              state = 'colon'
            }
            pos++
            break

          case 'colon':
            if (isWs(c)) { pos++; break }
            if (c === ':') { state = 'value-ws'; pos++; break }
            dead = true
            break

          case 'value-ws':
            if (isWs(c)) { pos++; break }
            if (key === '_create' && c === '[') { createIndex = 0; state = 'elem-ws'; pos++; break }
            beginValue(c, 'root')
            if (!dead) pos++
            break

          case 'elem-ws':
            if (isWs(c)) { pos++; break }
            if (c === ']') { pendingRoot = false; state = 'root-after-value'; pos++; break }
            beginValue(c, 'elem')
            if (!dead) pos++
            break

          case 'value-string':
            if (esc) esc = false
            else if (c === '\\') esc = true
            else if (c === '"') endValue(pos + 1)
            pos++
            break

          case 'value-container':
            if (inStr) {
              if (esc) esc = false
              else if (c === '\\') esc = true
              else if (c === '"') inStr = false
            } else if (c === '"') inStr = true
            else if (c === '{' || c === '[') depth++
            else if (c === '}' || c === ']') {
              depth--
              if (depth === 0) endValue(pos + 1)
            }
            pos++
            break

          case 'value-primitive':
            // The boundary char is NOT consumed - the after-state handles it
            if (isWs(c) || c === ',' || c === '}' || c === ']') { endValue(pos); break }
            pos++
            break

          case 'root-after-value':
            if (isWs(c)) { pos++; break }
            if (c === ',') { settleRoot(out); state = 'key-ws'; pos++; break }
            if (c === '}') { settleRoot(out); state = 'post'; pos++; break }
            dead = true
            break

          case 'elem-after':
            if (isWs(c)) { pos++; break }
            if (c === ',') { settleElem(out); state = 'elem-ws'; pos++; break }
            if (c === ']') { settleElem(out); pendingRoot = false; state = 'root-after-value'; pos++; break }
            dead = true
            break

          case 'post':
            pos = buf.length
            break
        }
      }
      return out
    },
  }
}
