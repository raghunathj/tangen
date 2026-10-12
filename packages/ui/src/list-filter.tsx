/**
 * File Name: list-filter.tsx
 * Purpose: One "Filter" control for a list, in the view bar's own voice: a
 *          ghost trigger that opens every facet the list offers, and the chips
 *          that say what is active with a way to drop each one. The content
 *          list has had this shape for a while through its schema-driven
 *          FilterBar; this is the same affordance for a list whose facets are
 *          just a few named choices, so an extension's table filters the way
 *          the rest of the Admin does instead of parking dropdowns in the bar.
 *
 *          TWO STEPS, and the CONTENT LIST'S OWN PANEL (the user, 2026-09-20:
 *          "i dont know why we are not following the same filter style thats
 *          there in content object, font size, spacing, checkboxes is any of
 *          none of kind of things"). So this file holds the same shapes the
 *          grid's FilterBar draws: 12px rows at px-3 py-2, a drawn checkbox
 *          square, a full-width Apply, and the operator row at the bottom
 *          that turns a selection into "Is none of".
 *
 *          A facet that takes several options edits a DRAFT and commits it
 *          with Apply, so ticking three boxes narrows the list once, not
 *          three times - and leaving without Apply changes nothing.
 *
 * Author: Raghunath J
 * License: MIT
 */
import * as React from 'react'
import { IconX, IconArrowLeft, IconChevronRight, IconCheck } from '@tangen/icons'
import { Popover, PopoverTrigger, PopoverContent } from './popover'
import { cx } from './utils'

export interface ListFilterFacet {
  /** The key this facet's value is held under. */
  id: string
  /** What it filters on: "State", "Destination". */
  label: string
  options: Array<{ value: string; label: string }>
  /**
   * The value that means "not filtering". Defaults to the first option, so a
   * list's "All" option needs no extra declaration. Ignored by a `multiple`
   * facet, where neutral is nothing chosen.
   */
  neutral?: string
  /**
   * Several options at once (a run's kind: tasks AND cron). Neutral is an
   * EMPTY selection, so such a facet declares no "All" option - nothing
   * chosen already means all of them.
   */
  multiple?: boolean
  /** The glyph beside its name in the facet list. */
  icon?: React.ReactNode
}

/** Whether the chosen options are what the list keeps, or what it drops. */
export type ListFilterOp = 'in' | 'not-in'

/** One multi facet's answer: the options, and whether they are kept or dropped. */
export interface ListFilterSelection { op: ListFilterOp; values: string[] }

/**
 * The facet values a list is filtered by: facet id to chosen option(s). A
 * plain string is one answer, an array is several, and the object form adds
 * "none of" - all three read, so a stored view or a link keeps working.
 */
export type ListFilterValue = Record<string, string | string[] | ListFilterSelection | undefined>

const neutralOf = (facet: ListFilterFacet): string => facet.neutral ?? facet.options[0]?.value ?? ''

const isSelection = (raw: unknown): raw is ListFilterSelection =>
  typeof raw === 'object' && raw !== null && Array.isArray((raw as ListFilterSelection).values)

/**
 * What a facet is holding, as the options it actually offers, and how. A
 * single facet on its neutral option and a multi facet with nothing ticked
 * both read as empty, so one rule ("empty is not a filter") covers both.
 */
export function selectionOf(facet: ListFilterFacet, value: ListFilterValue): ListFilterSelection {
  const raw = value[facet.id]
  if (facet.multiple) {
    // A lone string is what one option in a URL or a stored view looks like.
    const chosen = isSelection(raw) ? raw.values : raw == null ? [] : Array.isArray(raw) ? raw : [raw]
    const op: ListFilterOp = isSelection(raw) && raw.op === 'not-in' ? 'not-in' : 'in'
    // Declared order, not click order, so a chip reads the same every time.
    return { op, values: facet.options.filter((o) => chosen.includes(o.value)).map((o) => o.value) }
  }
  const one = isSelection(raw) ? raw.values[0] : Array.isArray(raw) ? raw[0] : raw
  const current = typeof one === 'string' ? one : neutralOf(facet)
  if (current === neutralOf(facet)) return { op: 'in', values: [] }
  return { op: 'in', values: facet.options.some((o) => o.value === current) ? [current] : [] }
}

/** The options a facet is holding, whichever way they were written down. */
export function selectedOptions(facet: ListFilterFacet, value: ListFilterValue): string[] {
  return selectionOf(facet, value).values
}

/** How a chip reads: "Status is" for what is kept, "is none of" for dropped. */
export const opPhrase = (op: ListFilterOp): string => (op === 'not-in' ? 'is none of' : 'is')

/** The facets that are actually narrowing the list, with the options each chose. */
export function activeFilters(
  facets: readonly ListFilterFacet[],
  value: ListFilterValue,
): Array<{ facet: ListFilterFacet; value: string | string[]; label: string; op: ListFilterOp }> {
  const out: Array<{ facet: ListFilterFacet; value: string | string[]; label: string; op: ListFilterOp }> = []
  for (const facet of facets) {
    const { op, values } = selectionOf(facet, value)
    if (values.length === 0) continue
    const label = values.map((v) => facet.options.find((o) => o.value === v)!.label).join(', ')
    out.push({ facet, value: facet.multiple ? values : values[0]!, label, op })
  }
  return out
}

/**
 * Which facet the menu is showing the options of. A list with ONE facet opens
 * on it: a step naming a single choice, with a chevron to the only thing
 * behind it, is a step nobody wants.
 */
export function stepFor(facets: readonly ListFilterFacet[], stepId: string | null): ListFilterFacet | undefined {
  if (stepId) return facets.find((f) => f.id === stepId)
  return facets.length === 1 ? facets[0] : undefined
}

/** The value with one multi facet's draft committed. */
export function applyDraft(
  value: ListFilterValue,
  facet: ListFilterFacet,
  draft: readonly string[],
  op: ListFilterOp = 'in',
): ListFilterValue {
  const values = facet.options.filter((o) => draft.includes(o.value)).map((o) => o.value)
  // Nothing chosen is not filtering, so the operator is moot: store the plain
  // empty form rather than an empty "none of".
  return { ...value, [facet.id]: values.length === 0 ? [] : { op, values } }
}

/** Whether a draft would change the list. Order is not a change; the operator is. */
export function draftChanged(
  facet: ListFilterFacet,
  value: ListFilterValue,
  draft: readonly string[],
  op: ListFilterOp = 'in',
): boolean {
  const applied = selectionOf(facet, value)
  const next = facet.options.filter((o) => draft.includes(o.value)).map((o) => o.value)
  if (applied.values.length !== next.length) return true
  if (applied.values.some((v, i) => v !== next[i])) return true
  return next.length > 0 && applied.op !== op
}

/** Every facet back to neutral: its "All" option, or nothing chosen. */
export function clearedFilters(facets: readonly ListFilterFacet[]): ListFilterValue {
  return Object.fromEntries(facets.map((f) => [f.id, f.multiple ? [] : neutralOf(f)]))
}

const GHOST = [
  'inline-flex h-7 shrink-0 items-center gap-1 rounded-control px-2 text-ui transition-colors motion-fast',
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
  'hover:bg-surface-hover hover:text-fg data-[state=open]:bg-surface-selected data-[state=open]:text-fg',
].join(' ')

export interface ListFilterProps {
  facets: readonly ListFilterFacet[]
  value: ListFilterValue
  onChange: (next: ListFilterValue) => void
  /** The trigger's word. Default "Filter". */
  label?: string
  className?: string
}

// The content list's own panel metrics, so a filter reads the same wherever
// it is opened: 12px rows, 8/12px gutters, a drawn box, a hairline above
// Apply and above the operator rows.
const ROW = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-fg transition-colors motion-fast hover:bg-surface-sunken outline-none focus-visible:bg-surface-sunken'
const BOX = 'flex size-3.5 shrink-0 items-center justify-center rounded'
const SECTION = 'px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle'

/** The operator row at the bottom of the panel, the grid's "Is any of". */
function OperatorRows({ op, onChange }: { op: ListFilterOp; onChange: (next: ListFilterOp) => void }) {
  return (
    <div className="border-t border-border">
      {([['in', 'Is any of'], ['not-in', 'Is none of']] as const).map(([value, label]) => (
        <button key={value} type="button" className={ROW} onClick={() => onChange(value)}>
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            {op === value && <IconCheck className="size-3.5 text-accent-fg" aria-hidden />}
          </span>
          {label}
        </button>
      ))}
    </div>
  )
}

/** The view bar's right-hand Filter control: one trigger, two steps inside. */
export function ListFilter({ facets, value, onChange, label = 'Filter', className }: ListFilterProps) {
  const active = activeFilters(facets, value)
  const [open, setOpen] = React.useState(false)
  const [stepId, setStepId] = React.useState<string | null>(null)
  const step = stepFor(facets, stepId)
  const [draft, setDraft] = React.useState<string[]>([])
  const [op, setOp] = React.useState<ListFilterOp>('in')

  // Every opening starts where it should: the facet list, or the only facet,
  // with its draft holding what is actually applied.
  React.useEffect(() => {
    if (!open) { setStepId(null); return }
    if (step) { const applied = selectionOf(step, value); setDraft(applied.values); setOp(applied.op) }
  }, [open])

  if (facets.length === 0) return null

  function openFacet(facet: ListFilterFacet) {
    const applied = selectionOf(facet, value)
    setStepId(facet.id)
    setDraft(applied.values)
    setOp(applied.op)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={active.length ? `${label}, ${active.length} active` : label}
          className={cx(GHOST, active.length ? 'font-medium text-fg' : 'text-fg-muted', className)}
        >
          {label}
          {active.length > 0 && <span className="text-fg-subtle tabular-nums">{active.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent flush align="end" className="w-60 overflow-hidden">
        {!step ? (
          // Step one: what can be filtered on.
          <div className="py-1.5">
            <p className={SECTION}>Filter by</p>
            {facets.map((facet) => (
              <button key={facet.id} type="button" className={ROW} onClick={() => openFacet(facet)}>
                <span className="shrink-0 text-fg-subtle [&_svg]:size-3.5">{facet.icon}</span>
                <span className="flex-1 truncate">{facet.label}</span>
                <IconChevronRight className="size-3.5 shrink-0 text-fg-faint" aria-hidden />
              </button>
            ))}
          </div>
        ) : (
          <div>
            {/* Back header - absent when there is nowhere to go back to. */}
            {facets.length > 1 ? (
              <button
                type="button"
                onClick={() => setStepId(null)}
                className="flex w-full items-center gap-1.5 border-b border-border px-3 py-2.5 text-xs text-fg-muted transition-colors motion-fast hover:text-fg"
              >
                <IconArrowLeft className="size-3.5" aria-hidden />
                {step.label}
              </button>
            ) : (
              <p className={cx(SECTION, 'pt-2')}>{step.label}</p>
            )}

            {step.multiple ? (
              <>
                <div className="max-h-64 overflow-y-auto py-1.5">
                  {step.options.map((o) => {
                    const checked = draft.includes(o.value)
                    return (
                      <label key={o.value} className={cx(ROW, 'cursor-pointer select-none rounded')}>
                        <span className={cx(BOX, checked ? 'bg-accent-strong' : 'border border-border-strong bg-surface')}>
                          {checked && <IconCheck className="size-2.5 text-accent-contrast" aria-hidden />}
                        </span>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={() => setDraft(checked ? draft.filter((v) => v !== o.value) : [...draft, o.value])}
                        />
                        <span className="truncate">{o.label}</span>
                      </label>
                    )
                  })}
                </div>
                <div className="border-t border-border px-2 py-1.5">
                  <button
                    type="button"
                    disabled={!draftChanged(step, value, draft, op)}
                    onClick={() => { onChange(applyDraft(value, step, draft, op)); setOpen(false) }}
                    className="w-full rounded-md bg-accent-strong py-1.5 text-xs font-medium text-accent-contrast transition-colors motion-fast disabled:opacity-40"
                  >
                    Apply
                  </button>
                </div>
                <OperatorRows op={op} onChange={setOp} />
              </>
            ) : (
              // One answer: picking it IS applying it.
              <div className="py-1.5">
                {step.options.map((o) => {
                  const current = selectionOf(step, value).values[0] ?? neutralOf(step)
                  return (
                    <button
                      key={o.value}
                      type="button"
                      className={ROW}
                      onClick={() => { onChange({ ...value, [step.id]: o.value }); setOpen(false) }}
                    >
                      <span className="flex size-3.5 shrink-0 items-center justify-center">
                        {current === o.value && <IconCheck className="size-3.5 text-accent-fg" aria-hidden />}
                      </span>
                      <span className="truncate">{o.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export interface ListFilterChipsProps extends ListFilterProps {
  /** The right-edge action that drops every filter. Default "Reset". */
  resetLabel?: string
  /** The trigger after the chips that adds another facet. Default "Add filter". */
  addLabel?: string
}

/**
 * What the list is currently narrowed by: one chip each with its own way out,
 * a way to add another, and Reset at the right edge - the row the content list
 * shows while it is filtered. Renders nothing when nothing is active, but the
 * CALLER should still pass `filterRow` only while `activeFilters` is non-empty:
 * the bar draws that row's frame around whatever it is given.
 */
export function ListFilterChips({ facets, value, onChange, resetLabel = 'Reset', addLabel = 'Add filter', className }: ListFilterChipsProps) {
  const active = activeFilters(facets, value)
  if (active.length === 0) return null
  const remaining = facets.filter((f) => !active.some((a) => a.facet.id === f.id))
  return (
    <div className={cx('flex w-full flex-wrap items-center gap-1.5', className)}>
      {active.map(({ facet, label, op }) => (
        <button
          key={facet.id}
          type="button"
          onClick={() => onChange({ ...value, [facet.id]: facet.multiple ? [] : neutralOf(facet) })}
          className="inline-flex h-6 items-center gap-1 rounded-full bg-accent-muted px-2 text-ui-xs font-medium text-accent-fg transition-colors motion-fast hover:bg-surface-hover"
          aria-label={`Clear the ${facet.label.toLowerCase()} filter`}
        >
          <span className="opacity-80">{`${facet.label} ${opPhrase(op)}`}</span>
          {label}
          <IconX className="size-3" aria-hidden />
        </button>
      ))}
      {remaining.length > 0 && (
        <ListFilter facets={remaining} value={value} onChange={onChange} label={`+ ${addLabel}`} />
      )}
      <button
        type="button"
        onClick={() => onChange({ ...value, ...clearedFilters(facets) })}
        className="ml-auto inline-flex h-6 items-center rounded-control px-1.5 text-ui-xs font-medium text-fg-muted transition-colors motion-fast hover:bg-surface-hover hover:text-fg"
      >
        {resetLabel}
      </button>
    </div>
  )
}
