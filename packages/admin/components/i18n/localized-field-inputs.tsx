/**
 * File Name: localized-field-inputs.tsx
 * Purpose: Hygraph-style inline localization — beneath a localized field's
 *          default input, one block per working locale with that locale's
 *          color rail and language badge. Heavy structured fields (repeater,
 *          component, json) collapse to a summary row; "Copy from <default>"
 *          clones the default as a starting point.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: colors are assigned per locale by the editor
 *          (localeColor) and reused in the Localizations panel legend.
 */
import { useState } from 'react'
import { clsx } from 'clsx'
import { IconChevronDown } from '@tangen/icons'
import { FieldControl } from '@/components/fields/field-control'
import type { FieldDefinition } from '@tangen/types'

export interface WorkingLocale { code: string; label: string }

/** Stable per-locale accents — assigned by locale order, used everywhere. */
export const LOCALE_COLORS = [
  { dot: 'bg-emerald-400', rail: 'border-emerald-300', badge: 'bg-emerald-50 text-emerald-700' },  // tg-raw-ok: the locale colour rails are a categorical palette, not a status
  { dot: 'bg-amber-400', rail: 'border-amber-300', badge: 'bg-amber-50 text-amber-700' },  // tg-raw-ok: the locale colour rails are a categorical palette, not a status
  { dot: 'bg-sky-400', rail: 'border-sky-300', badge: 'bg-sky-50 text-sky-700' },  // tg-raw-ok: the locale colour rails are a categorical palette, not a status
  { dot: 'bg-rose-400', rail: 'border-rose-300', badge: 'bg-rose-50 text-rose-700' },  // tg-raw-ok: the locale colour rails are a categorical palette, not a status
  { dot: 'bg-violet-400', rail: 'border-violet-300', badge: 'bg-violet-50 text-violet-700' },  // tg-raw-ok: the locale colour rails are a categorical palette, not a status
  { dot: 'bg-teal-400', rail: 'border-teal-300', badge: 'bg-teal-50 text-teal-700' },  // tg-raw-ok: the locale colour rails are a categorical palette, not a status
] as const

export type LocaleColor = (typeof LOCALE_COLORS)[number]

/** Deterministic color for a locale — by its position in the workspace list. */
export function localeColor(code: string, orderedCodes: string[]): LocaleColor {
  const idx = Math.max(0, orderedCodes.indexOf(code))
  return LOCALE_COLORS[idx % LOCALE_COLORS.length]
}

/** Structured fields whose locale inputs start collapsed to keep the page calm. */
const HEAVY_TYPES = new Set(['repeater', 'component', 'json'])

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true
  if (Array.isArray(v)) return v.length === 0
  return false
}

/** Deep-clones a default value for use as a translation starting point. */
function cloneValue(v: unknown): unknown {
  if (v === null || v === undefined) return v
  if (typeof v !== 'object') return v
  try { return structuredClone(v) } catch { return JSON.parse(JSON.stringify(v)) }
}

function summarize(v: unknown): string {
  if (isEmpty(v)) return 'empty - falls back to the default'
  if (Array.isArray(v)) return `${v.length} ${v.length === 1 ? 'row' : 'rows'}`
  return 'has content'
}

/** The "<Language>" badge — colored, unmistakable. */
export function LocaleBadge({ locale, color }: { locale: WorkingLocale; color: LocaleColor }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium', color.badge)}>
      <span className={clsx('size-1.5 rounded-full', color.dot)} />
      {locale.label}
    </span>
  )
}

function LocaleRow({
  field, locale, color, value, defaultValue, defaultLabel, onChange, workspaceId, typeName, resetKey,
}: {
  field: FieldDefinition
  locale: WorkingLocale
  color: LocaleColor
  value: unknown
  defaultValue?: unknown
  defaultLabel?: string
  onChange: (value: unknown) => void
  workspaceId: string
  typeName: string
  resetKey?: number
}) {
  const heavy = HEAVY_TYPES.has(field.fieldType)
  const [expanded, setExpanded] = useState(!heavy)

  return (
    <div className={clsx('border-l-2 pl-3', color.rail)}>
      <div
        className={clsx('flex items-center gap-2 mb-1.5', heavy && 'cursor-pointer select-none')}
        onClick={heavy ? () => setExpanded((e) => !e) : undefined}
      >
        <span className="text-[13px] font-medium text-fg">{field.label}</span>
        <LocaleBadge locale={locale} color={color} />
        {heavy && !expanded && (
          <span className="text-[11px] text-fg-subtle">· {summarize(value)}</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {isEmpty(value) && !isEmpty(defaultValue) && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(cloneValue(defaultValue)); setExpanded(true) }}
              className="text-[11px] text-accent hover:text-accent-fg cursor-pointer"
              title={`Start from the ${defaultLabel ?? 'default'} value and translate in place`}
            >
              Copy from {defaultLabel ?? 'default'}
            </button>
          )}
          {heavy && (
            <IconChevronDown className={clsx('size-3.5 text-fg-subtle transition-transform', expanded && 'rotate-180')} />
          )}
        </span>
      </div>
      {expanded && (
        <FieldControl
          field={field}
          value={value}
          onChange={onChange}
          workspaceId={workspaceId}
          typeName={typeName}
          resetKey={resetKey}
        />
      )}
    </div>
  )
}

export function LocalizedFieldInputs({
  field, locales, colors, drafts, defaultValue, defaultLabel, onChange, workspaceId, typeName, resetKey,
}: {
  field: FieldDefinition
  locales: WorkingLocale[]
  /** Per-locale accent colors keyed by code (from localeColor). */
  colors: Record<string, LocaleColor>
  drafts: Record<string, Record<string, unknown>>
  defaultValue?: unknown
  defaultLabel?: string
  onChange: (locale: string, value: unknown) => void
  workspaceId: string
  typeName: string
  resetKey?: number
}) {
  if (locales.length === 0) return null
  return (
    <div className="mt-3 space-y-3">
      {locales.map((l) => (
        <LocaleRow
          key={l.code}
          field={field}
          locale={l}
          color={colors[l.code] ?? LOCALE_COLORS[0]}
          value={drafts[l.code]?.[field.name]}
          defaultValue={defaultValue}
          defaultLabel={defaultLabel}
          onChange={(v) => onChange(l.code, v)}
          workspaceId={workspaceId}
          typeName={typeName}
          resetKey={resetKey}
        />
      ))}
    </div>
  )
}
