/**
 * File Name: style-controls.tsx
 * Purpose: The visual controls a style panel is made of - a length with a
 *          unit picker, a colour with a swatch, and a font picker.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Built for the registry-driven Style panel (WF-T13d) and
 *          used first by the Creative section, so the control set is proven on
 *          a real surface before ~60 properties are built on it.
 *
 *          Every control refuses to MANGLE what it cannot represent: a value
 *          like `calc(100% - 2rem)` or `auto` falls back to a text input
 *          rather than being read as a number and silently rewritten.
 */
import { clsx } from 'clsx'
import { parseLength, formatLength, normalizeHex, isColorish, KEYWORD_LENGTHS } from '../lib/css-value'
import { GOOGLE_FONTS, fontStack } from '@tangen/studio'
import { CONTROL_CLS } from './inspector-row'

/**
 * The units offered when a caller names none. A property that DECLARES its
 * units gets exactly those: letter-spacing and the four border widths do not
 * accept a percentage, and offering one produced a value that saved,
 * compiled, and was then dropped by the browser without a word.
 */
const UNITS = ['px', 'rem', '%', 'em', 'vh', 'vw'] as const

interface ValueProps {
  value: unknown
  onChange: (v: string) => void
  placeholder?: string
}

/**
 * A number plus a unit. Values the split cannot represent keep a plain text
 * box, so nothing is lost by opening this control on them.
 */
export function LengthControl({ value, onChange, placeholder, units }: ValueProps & { units?: readonly string[] }) {
  const offered = units && units.length > 0 ? units : UNITS
  const text = typeof value === 'string' ? value : ''
  const parsed = parseLength(text)
  const editable = parsed.value !== undefined || text === ''

  if (!editable) {
    return (
      <div className="flex items-center gap-1">
        <input
          value={text}
          onChange={(e) => onChange(e.target.value)}
          className={CONTROL_CLS}
          title={parsed.keyword ? 'A keyword, not a measurement' : 'An expression - edited as text'}
        />
      </div>
    )
  }

  const unit = parsed.unit ?? offered[0]
  return (
    <div className="flex items-center gap-1">
      <input
        value={parsed.value ?? ''}
        inputMode="decimal"
        placeholder={placeholder ? placeholder.replace(/^e\.g\.\s*/, '') : ''}
        onChange={(e) => {
          const raw = e.target.value.trim()
          if (raw === '') return onChange('')
          const n = Number(raw)
          onChange(Number.isFinite(n) ? formatLength(n, unit) : raw)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
          e.preventDefault()
          const step = e.shiftKey ? 10 : 1
          const next = (parsed.value ?? 0) + (e.key === 'ArrowUp' ? step : -step)
          onChange(formatLength(next, unit))
        }}
        className={clsx(CONTROL_CLS, 'flex-1 min-w-0')}
      />
      <select
        value={unit}
        onChange={(e) => onChange(formatLength(parsed.value ?? 0, e.target.value))}
        title="Unit"
        className="h-(--tg-control-h) shrink-0 rounded-md border border-border bg-surface px-1 text-(length:--tg-text-label) text-fg-muted focus:outline-none"
      >
        {/* A stored value may carry a unit this property no longer offers -
            keep it selectable so it stays visible and editable rather than
            silently reading as the first option. */}
        {[...new Set([...offered, ...(parsed.unit ? [parsed.unit] : [])])].map((u) => <option key={u} value={u}>{u}</option>)}
        {KEYWORD_LENGTHS.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
    </div>
  )
}

/** A swatch beside the literal value, so tokens and hex both stay editable. */
export function ColorControl({ value, onChange }: ValueProps) {
  const text = typeof value === 'string' ? value : ''
  return (
    <div className="flex items-center gap-1">
      <input
        type="color"
        value={normalizeHex(text)}
        onChange={(e) => onChange(e.target.value)}
        title="Pick a colour"
        className="size-(--tg-control-h) shrink-0 rounded-md border border-border bg-surface p-0.5 cursor-pointer"
      />
      <input
        value={text}
        placeholder="#000000"
        onChange={(e) => onChange(e.target.value)}
        className={clsx(
          CONTROL_CLS, 'flex-1 min-w-0',
          // A value the swatch cannot show is legal but worth flagging.
          text !== '' && !isColorish(text) && 'border-warning',
        )}
      />
    </div>
  )
}

/** The curated webfont list, each option previewed in its own face. */
export function FontControl({ value, onChange }: ValueProps) {
  const text = typeof value === 'string' ? value : ''
  return (
    <select
      value={text}
      onChange={(e) => onChange(e.target.value)}
      style={text ? { fontFamily: fontStack(text) } : undefined}
      className={clsx(CONTROL_CLS, 'cursor-pointer')}
    >
      <option value="">Inherit</option>
      {(['sans', 'serif', 'mono', 'display'] as const).map((cat) => (
        <optgroup key={cat} label={cat}>
          {GOOGLE_FONTS.filter((f) => f.category === cat).map((f) => (
            <option key={f.name} value={f.name} style={{ fontFamily: fontStack(f.name) }}>
              {f.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
