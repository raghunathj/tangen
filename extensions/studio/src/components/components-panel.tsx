/**
 * File Name: components-panel.tsx
 * Purpose: The Components panel - everything insertable, filed under the
 *          origin it came from (Developer, Saved, Pre-built), every entry
 *          wearing its origin, empty origins explaining themselves, and one
 *          search across all of them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Filing and search live in lib/component-origins.ts
 *          (pure, tested). A component entry inserts and drags exactly as
 *          the Elements panel's does - same `onPick`, same drag props from
 *          palette-panel.tsx - so the two panels cannot disagree about where
 *          a block lands. A Saved entry inserts by cloning its stored block
 *          (the preset path); a suggestion by its own pick.
 */
import { useMemo, useState } from 'react'
import type { ComponentDef } from '@tangen/types'
import { clsx } from 'clsx'
import { Input } from '@/kit'
import { letterTile } from '../lib/palette'
import type { StudioPreset } from '../lib/presets'
import {
  componentSections, searchComponentSections,
  type ComponentEntry, type ComponentOrigin, type SuggestionLike,
} from '../lib/component-origins'
import { Thumb, paletteDragProps } from './palette-panel'

export interface ComponentsPanelProps {
  /** What may be inserted here - the same vocabulary the Elements panel gets. */
  defs: ComponentDef[]
  presets: StudioPreset[]
  suggestions?: SuggestionLike[]
  /** Inserting a component: the Elements panel's own handler. */
  onPick: (def: ComponentDef) => void
  /** Told which component is being dragged, so the canvas can accept it. */
  onDragType?: (name: string | null) => void
  onPickPreset: (preset: StudioPreset) => void
  /** Present only for members who may manage presets. */
  onRenamePreset?: (preset: StudioPreset) => void
  onDeletePreset?: (preset: StudioPreset) => void
  /** Rendered under the search when not searching (the "Describe it" box). */
  children?: React.ReactNode
}

/** One colour per origin, so a row read alone still says where it came from. */
const BADGE: Record<ComponentOrigin, string> = {
  developer: 'bg-accent-muted text-accent-fg',
  saved: 'bg-success-muted text-success',
  prebuilt: 'bg-surface-sunken text-fg-muted border border-border',
}

export function OriginBadge({ origin, label }: { origin: ComponentOrigin; label: string }) {
  return (
    <span
      className={clsx('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none', BADGE[origin])}
      title={`Origin: ${label}`}
    >
      {label}
    </span>
  )
}

function SavedTile({ label }: { label: string }) {
  return (
    <span className="grid place-items-center size-12 shrink-0 rounded-md border border-dashed border-border bg-surface-sunken text-lg font-semibold text-fg-muted">
      {letterTile(label)}
    </span>
  )
}

function Entry({
  entry, originLabel, onPick, onDragType, onPickPreset, onRenamePreset, onDeletePreset,
}: {
  entry: ComponentEntry
  originLabel: string
} & Pick<ComponentsPanelProps, 'onPick' | 'onDragType' | 'onPickPreset' | 'onRenamePreset' | 'onDeletePreset'>) {
  const pick = () => {
    if (entry.def) onPick(entry.def)
    else if (entry.preset) onPickPreset(entry.preset)
    else if (entry.suggestion) entry.suggestion.onPick()
  }
  const manage = entry.preset && (onRenamePreset || onDeletePreset)
  return (
    <li className="group/entry relative">
      <button
        type="button"
        // A component drags exactly as an Element does; a preset or a
        // suggestion inserts on click only, as before.
        {...(entry.def ? paletteDragProps(entry.def.name, onDragType) : {})}
        onClick={pick}
        className="w-full flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left hover:border-accent hover:bg-accent-muted/30 transition-colors"
      >
        {entry.def ? <Thumb def={entry.def} /> : <SavedTile label={entry.label} />}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 min-w-0">
            <span className="block text-sm font-medium text-fg truncate">{entry.label}</span>
            <OriginBadge origin={entry.origin} label={originLabel} />
          </span>
          {entry.description && (
            <span className="block text-xs text-fg-muted truncate">{entry.description}</span>
          )}
        </span>
      </button>
      {manage && (
        <span className="absolute top-1.5 right-1.5 hidden group-hover/entry:flex items-center gap-1">
          {onRenamePreset && (
            <button
              type="button"
              onClick={() => onRenamePreset(entry.preset!)}
              className="px-1.5 py-0.5 rounded text-[11px] bg-surface border border-border text-fg-muted hover:text-fg"
            >
              Rename
            </button>
          )}
          {onDeletePreset && (
            <button
              type="button"
              onClick={() => onDeletePreset(entry.preset!)}
              className="px-1.5 py-0.5 rounded text-[11px] bg-surface border border-border text-fg-muted hover:text-red-600"
            >
              Delete
            </button>
          )}
        </span>
      )}
    </li>
  )
}

/** Entries of one origin, sub-grouped by the group they were declared with. */
function grouped(entries: ComponentEntry[]): Array<{ name: string | null; entries: ComponentEntry[] }> {
  const out: Array<{ name: string | null; entries: ComponentEntry[] }> = []
  for (const e of entries) {
    const name = e.group ?? null
    let g = out.find((x) => x.name === name)
    if (!g) { g = { name, entries: [] }; out.push(g) }
    g.entries.push(e)
  }
  return out
}

export function ComponentsPanel({
  defs, presets, suggestions, onPick, onDragType, onPickPreset, onRenamePreset, onDeletePreset, children,
}: ComponentsPanelProps) {
  const [query, setQuery] = useState('')
  const sections = useMemo(
    () => componentSections({ defs, presets, suggestions }),
    [defs, presets, suggestions],
  )
  const shown = useMemo(() => searchComponentSections(sections, query), [sections, query])
  const searching = query.trim() !== ''

  return (
    <div className="space-y-5">
      <Input
        placeholder="Search components"
        aria-label="Search components"
        value={query}
        onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
      />
      {!searching && children}
      {shown.length === 0 && (
        <p className="text-xs text-fg-subtle">No components match your search.</p>
      )}
      {shown.map((section) => (
        <section key={section.origin} aria-label={section.label}>
          <div className="mb-2">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              <span>{section.label}</span>
              <span className="font-normal normal-case tracking-normal text-fg-subtle">
                {section.entries.length}
              </span>
            </p>
            <p className="text-[11px] text-fg-subtle">{section.note}</p>
          </div>
          {section.empty ? (
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-fg-muted">
              {section.empty}
            </p>
          ) : (
            <div className="space-y-3">
              {grouped(section.entries).map((g) => (
                <div key={g.name ?? '(none)'}>
                  {g.name && (
                    <p className="mb-1.5 text-[11px] font-medium text-fg-muted">{g.name}</p>
                  )}
                  <ul className="space-y-1.5">
                    {g.entries.map((entry) => (
                      <Entry
                        key={entry.id}
                        entry={entry}
                        originLabel={section.label}
                        onPick={onPick}
                        onDragType={onDragType}
                        onPickPreset={onPickPreset}
                        onRenamePreset={onRenamePreset}
                        onDeletePreset={onDeletePreset}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
