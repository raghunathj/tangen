/**
 * File Name: token-picker.tsx
 * Purpose: The visual token picker the kit style panel renders for token-
 *          typed props - one dumb, schema-driven component for all five
 *          families: palette slots as color swatches (var(--tg-bg-<slot>)),
 *          space slots as a size ladder, type slots as an "Aa" text ramp,
 *          radius slots as rounded squares, width slots as bars. The slot
 *          lists arrive as props (the page fetches GET tokens once); the
 *          picker knows nothing about widgets or workspaces - the
 *          contract's no-per-widget-forks rule.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Samples size off scaleSample (index-relative), so
 *          extended slots join the ladder with no per-slot knowledge.
 */
import { clsx } from 'clsx'
import type { TokenFamily } from '../tokens'
import { paletteSwatchCss, scaleSample } from '../lib/style-panel'

export interface TokenPickerProps {
  family: TokenFamily
  /** The workspace's effective slot list for this family (GET tokens). */
  slots: readonly string[]
  value: unknown
  onChange: (slot: string) => void
}

/** The per-family sample tile, sized by ladder position - pure visuals. */
function Sample({ family, slot, at }: { family: TokenFamily; slot: string; at: number }) {
  switch (family) {
    case 'palette':
      return (
        <span
          className="size-6 rounded-full border border-border-strong shadow-xs"
          style={{ background: paletteSwatchCss(slot) }}
        />
      )
    case 'space':
      return (
        <span className="flex items-end h-6">
          <span className="w-4 rounded-sm bg-accent-muted border border-accent/40" style={{ height: `${4 + at * 20}px` }} />
        </span>
      )
    case 'type':
      return (
        <span className="leading-none text-fg" style={{ fontSize: `${10 + at * 10}px` }}>
          Aa
        </span>
      )
    case 'radius':
      return (
        <span
          className="size-6 bg-surface-sunken border border-border-strong"
          style={{ borderRadius: `${at * 12}px` }}
        />
      )
    case 'width':
      return (
        <span className="flex items-center h-6">
          <span className="h-1.5 rounded-full bg-accent-muted border border-accent/40" style={{ width: `${10 + at * 22}px` }} />
        </span>
      )
  }
}

/**
 * One row of slot tiles; the current value shows a ring, every tile names
 * its slot. Selecting fires onChange with the raw slot value - the block
 * stores plain token slot strings, exactly what the select would store.
 */
export function TokenPicker({ family, slots, value, onChange }: TokenPickerProps) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup">
      {slots.map((slot, i) => {
        const selected = value === slot
        return (
          <button
            key={slot}
            type="button"
            role="radio"
            aria-checked={selected}
            title={slot}
            onClick={() => onChange(slot)}
            className={clsx(
              'flex flex-col items-center gap-1 rounded-md border px-1.5 py-1.5 min-w-10 transition-colors',
              selected
                ? 'border-accent bg-accent-muted/60 ring-1 ring-accent'
                : 'border-transparent hover:border-border hover:bg-surface-hover',
            )}
          >
            <span className="grid place-items-center h-6">
              <Sample family={family} slot={slot} at={scaleSample(i, slots.length)} />
            </span>
            <span className={clsx('text-[10px] leading-none max-w-14 truncate', selected ? 'text-accent-fg font-medium' : 'text-fg-subtle')}>
              {slot}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * The palette as a strip of swatches that sits IN the row. A colour needs no
 * label to be understood, so the tiles-with-names ladder is wasted height
 * here - the swatch is the value.
 */
export function SwatchStrip({ slots, value, onChange }: Omit<TokenPickerProps, 'family'>) {
  return (
    <div className="flex items-center gap-1 h-(--tg-control-h) flex-wrap" role="radiogroup">
      {slots.map((slot) => {
        const selected = value === slot
        return (
          <button
            key={slot}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={slot}
            title={slot}
            onClick={() => onChange(slot)}
            className={clsx(
              'size-4 rounded-full border transition-all duration-(--tg-motion-fast)',
              selected
                ? 'border-accent ring-2 ring-accent/40 scale-110'
                : 'border-border-strong hover:scale-110',
            )}
            style={{ background: paletteSwatchCss(slot) }}
          />
        )
      })}
    </div>
  )
}
