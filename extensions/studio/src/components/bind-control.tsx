/**
 * File Name: bind-control.tsx
 * Purpose: The "Connect Data" control - lets a bindable prop inside a loop
 *          item template read from the current record instead of carrying a
 *          fixed value. Renders the static editor until the prop is
 *          connected, then a source-field picker plus a fallback box.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: All decisions come from lib/binding.ts (pure, unit-
 *          tested) - this file is presentation only. The control appears
 *          ONLY when the block sits inside a kit.loop and the prop is on
 *          the bindable whitelist, so style and layout props can never be
 *          driven by content.
 */
import { useCallback, type ReactNode } from 'react'
import { boundPath, makeBinding, type SourceField } from '../lib/binding'

interface BindControlProps {
  /** The prop's stored value: a descriptor when connected, else the value. */
  value: unknown
  /** Fields of the loop's collection the picker may offer. */
  sourceFields: SourceField[]
  /** The collection name, shown so the author knows what they are binding to. */
  source: string
  /** Writes the new prop value (a descriptor, or the static value again). */
  onChange: (value: unknown) => void
  /** The static editor rendered while the prop is not connected. */
  children: ReactNode
}

export function BindControl({ value, sourceFields, source, onChange, children }: BindControlProps) {
  const path = boundPath(value)
  const connected = path !== null
  const fallback = connected ? (value as { fallback?: unknown }).fallback : undefined

  const connect = useCallback(() => {
    onChange(makeBinding(sourceFields[0]?.name ?? ''))
  }, [onChange, sourceFields])

  // Disconnecting keeps the fallback as the new static value when there is
  // one - the author's own words survive the round trip rather than the
  // prop silently emptying.
  const disconnect = useCallback(() => {
    onChange(typeof fallback === 'string' ? fallback : '')
  }, [onChange, fallback])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-fg-subtle">
          {connected ? `From ${source || 'the record'}` : null}
        </span>
        <button
          type="button"
          onClick={connected ? disconnect : connect}
          className="shrink-0 text-[11px] font-medium text-accent-fg hover:underline"
          title={connected ? 'Use a fixed value instead' : 'Read this from the current record'}
        >
          {connected ? 'Disconnect' : 'Connect data'}
        </button>
      </div>

      {connected ? (
        <div className="space-y-1.5">
          <select
            value={path ?? ''}
            onChange={(e) => onChange(makeBinding(e.target.value, fallback))}
            className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-fg"
          >
            {sourceFields.length === 0 && <option value="">No fields available</option>}
            {sourceFields.map((f) => (
              <option key={f.name} value={f.name}>{f.label}</option>
            ))}
          </select>
          <input
            type="text"
            value={typeof fallback === 'string' ? fallback : ''}
            placeholder="Fallback when empty"
            onChange={(e) => onChange(makeBinding(path ?? '', e.target.value || undefined))}
            className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-fg"
          />
        </div>
      ) : (
        children
      )}
    </div>
  )
}
