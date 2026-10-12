/**
 * File Name: palette-panel.tsx
 * Purpose: Studio's "Add section" panel - a Sheet listing every component
 *          allowed on the blocks field, grouped, with the dev-supplied
 *          thumbnail when a def has one and the auto letter tile otherwise.
 *          Picking a component inserts it at the requested position. The
 *          optional "Describe it" box generates ONE section (existing
 *          vocabulary only) from a short brief; failures render as a
 *          readable message in the box, never a blank spinner.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useState, type DragEvent as ReactDragEvent } from 'react'
import type { ComponentDef } from '@tangen/types'
import { Button, Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, Input, Spinner } from '@/kit'
import { clsx } from 'clsx'
import { paletteGroups, letterTile } from '../lib/palette'

export interface PalettePanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defs: ComponentDef[]
  onPick: (def: ComponentDef) => void
  /** Told which component is being dragged, so the canvas can accept it. */
  onDragType?: (name: string | null) => void
  /** Extra groups rendered after the component groups (e.g. saved presets). */
  extraGroups?: Array<{ name: string; items: Array<{ id: string; label: string; description?: string; onPick: () => void; onRename?: () => void; onDelete?: () => void }> }>
  /**
   * "Describe it": generate ONE section from a brief (existing vocabulary
   * only). Resolves when the section was inserted; a throw shows its message
   * in the box. Omit to hide the feature (e.g. no AI on this runtime).
   */
  onDescribe?: (brief: string) => Promise<void>
}

export function DescribeBox({ onDescribe }: { onDescribe: (brief: string) => Promise<void> }) {
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const trimmed = brief.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await onDescribe(trimmed)
      setBrief('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed - try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-sunken/50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle mb-2">Describe it</p>
      <textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        rows={2}
        placeholder="Describe the section, e.g. a testimonial quoting a happy customer"
        className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" disabled={busy || !brief.trim()} onClick={() => { void submit() }}>
          Generate section
        </Button>
        {busy && <Spinner size="sm" label="Generating…" />}
      </div>
      {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
      <p className="mt-2 text-[11px] text-fg-subtle">
        Drafts one section from the sections this page allows, copy included. It lands in the draft for you to edit.
      </p>
    </div>
  )
}

/**
 * The drag half of inserting a component: the canvas learns what is being
 * dragged through `onDragType`, and a payload is set because some browsers
 * refuse to start a drag without one. Shared with the Components panel so the
 * two panels cannot drift apart on how a drag begins.
 */
export function paletteDragProps(name: string, onDragType: ((name: string | null) => void) | undefined) {
  return {
    draggable: !!onDragType,
    onDragStart: (e: ReactDragEvent) => {
      onDragType?.(name)
      e.dataTransfer?.setData('text/plain', name)
    },
    onDragEnd: () => onDragType?.(null),
  }
}

export function Thumb({ def }: { def: ComponentDef }) {
  const [broken, setBroken] = useState(false)
  if (def.thumbnail && !broken) {
    return (
      <img
        src={def.thumbnail}
        alt=""
        onError={() => setBroken(true)}
        className="size-12 shrink-0 rounded-md border border-border object-cover bg-surface-sunken"
      />
    )
  }
  return (
    <span className="grid place-items-center size-12 shrink-0 rounded-md border border-border bg-surface-sunken text-lg font-semibold text-fg-muted">
      {letterTile(def.label || def.name)}
    </span>
  )
}

/**
 * The palette CONTENT, without a container. The icon rail renders this
 * directly; PalettePanel keeps wrapping it in a Sheet for callers that still
 * want the overlay form.
 */
export function PaletteBody({ defs, onPick, extraGroups, onDescribe, onDragType }: Omit<PalettePanelProps, 'open' | 'onOpenChange'>) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filtered = q
    ? defs.filter((d) => d.name.toLowerCase().includes(q) || d.label.toLowerCase().includes(q))
    : defs
  const groups = paletteGroups(filtered)
  const extras = (extraGroups ?? [])
    .map((g) => ({
      ...g,
      items: q ? g.items.filter((i) => i.label.toLowerCase().includes(q)) : g.items,
    }))
    .filter((g) => g.items.length > 0)

  return (
    <div className="space-y-5">
          <Input
            placeholder="Search sections"
            value={query}
            onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
          {onDescribe && !q && <DescribeBox onDescribe={onDescribe} />}
          {groups.length === 0 && extras.length === 0 && (
            <p className="text-xs text-fg-subtle">No sections match your search.</p>
          )}
          {groups.map((group) => (
            <div key={group.name}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle mb-2">{group.name}</p>
              <ul className="space-y-1.5">
                {group.defs.map((def) => (
                  <li key={def.name}>
                    <button
                      type="button"
                      {...paletteDragProps(def.name, onDragType)}
                      onClick={() => onPick(def)}
                      className="w-full flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left hover:border-accent hover:bg-accent-muted/30 transition-colors"
                    >
                      <Thumb def={def} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-fg truncate">{def.label || def.name}</span>
                        {def.description && (
                          <span className="block text-xs text-fg-muted truncate">{def.description}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {extras.map((group) => (
            <div key={group.name}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle mb-2">{group.name}</p>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li key={item.id} className="group/preset relative">
                    <button
                      type="button"
                      onClick={item.onPick}
                      className="w-full flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left hover:border-accent hover:bg-accent-muted/30 transition-colors"
                    >
                      <span className="grid place-items-center size-12 shrink-0 rounded-md border border-dashed border-border bg-surface-sunken text-lg font-semibold text-fg-muted">
                        {letterTile(item.label)}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-fg truncate">{item.label}</span>
                        {item.description && (
                          <span className="block text-xs text-fg-muted truncate">{item.description}</span>
                        )}
                      </span>
                    </button>
                    {(item.onRename || item.onDelete) && (
                      <span className="absolute top-1.5 right-1.5 hidden group-hover/preset:flex items-center gap-1">
                        {item.onRename && (
                          <button
                            type="button"
                            onClick={item.onRename}
                            className="px-1.5 py-0.5 rounded text-[11px] bg-surface border border-border text-fg-muted hover:text-fg"
                          >
                            Rename
                          </button>
                        )}
                        {item.onDelete && (
                          <button
                            type="button"
                            onClick={item.onDelete}
                            className={clsx('px-1.5 py-0.5 rounded text-[11px] bg-surface border border-border text-fg-muted hover:text-red-600')}
                          >
                            Delete
                          </button>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
    </div>
  )
}

/** The palette as an overlay - the Sheet form, wrapping the same body. */
export function PalettePanel({ open, onOpenChange, ...rest }: PalettePanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" dismissible className="w-[380px] sm:max-w-[380px]">
        <SheetHeader>
          <SheetTitle>Add section</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <PaletteBody {...rest} />
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
