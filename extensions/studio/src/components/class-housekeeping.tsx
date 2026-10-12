/**
 * File Name: class-housekeeping.tsx
 * Purpose: The class housekeeping list surface - duplicate groups with a
 *          keeper to choose and merge, and unworn classes to select and
 *          delete, each line showing its usage before the action.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Collapsed by default and lazy: opening it triggers the
 *          environment-wide usage scan, which reads every page and is not
 *          something the Style panel should do on every selection. Until the
 *          scan has answered, nothing here can be actioned - the usage count
 *          IS the safety, so it is shown before the button and the button
 *          waits for it.
 *
 *          Every decision is in lib/housekeeping.ts (tested); this only draws
 *          it. Actions need studio:manage, like deleting a class does: the
 *          list still shows without it, so a designer can see the mess and
 *          ask, but the buttons say why they are off.
 */
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { IconChevronRight } from '@tangen/icons'
import type { StyleClass } from '../lib/classes'
import { housekeepingReport, type UsageMap } from '../lib/housekeeping'

export interface ClassHousekeepingProps {
  classes: StyleClass[]
  /** Environment-wide usage, or null until the scan has answered. */
  usage: UsageMap | null
  /** Called when the surface opens; loads `usage`. */
  onOpen: () => void
  loading?: boolean
  /** Whether this member may merge and delete (studio:manage AND studio:design). */
  canManage: boolean
  onMerge: (keeperId: string, removeIds: string[]) => void
  onDelete: (ids: string[]) => void
  busy?: boolean
}

const usageText = (elements: number, pages: number) =>
  elements === 0
    ? 'not worn'
    : `${elements} element${elements === 1 ? '' : 's'} on ${pages} page${pages === 1 ? '' : 's'}`

export function ClassHousekeeping({
  classes, usage, onOpen, loading, canManage, onMerge, onDelete, busy,
}: ClassHousekeepingProps) {
  const [open, setOpen] = useState(false)
  const [keepers, setKeepers] = useState<Record<number, string>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => { if (open) onOpen() }, [open, onOpen])

  const report = usage ? housekeepingReport(classes, usage) : null
  const disabledWhy = !canManage
    ? 'Merging and deleting classes needs the Manage Studio and Design capabilities'
    : !usage ? 'Checking where each class is used' : undefined
  const actionsOff = !!disabledWhy || !!busy

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="group border-t border-border"
    >
      <summary className="flex items-center gap-1.5 py-1.5 cursor-pointer list-none select-none">
        <IconChevronRight className="size-3 shrink-0 text-fg-subtle transition-transform duration-(--tg-motion-fast) group-open:rotate-90" />
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
          Housekeeping
        </span>
        {report && report.total > 0 && (
          <span className="text-[10px] tabular-nums text-warning">{report.total}</span>
        )}
      </summary>

      <div className="pb-2 space-y-3 text-[11px]">
        {loading && !usage && <p className="text-fg-subtle">Checking every page for class usage...</p>}
        {disabledWhy && usage && <p className="text-fg-subtle">{disabledWhy}.</p>}
        {report && report.total === 0 && <p className="text-fg-subtle">Nothing to tidy: no duplicates, nothing unworn.</p>}

        {report && report.duplicates.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
              Duplicates - same properties, different names
            </p>
            {report.duplicates.map((group, gi) => {
              const keeper = keepers[gi] ?? group.keeper
              const removeIds = group.members.map((m) => m.cls.id).filter((id) => id !== keeper)
              return (
                <div key={group.members.map((m) => m.cls.id).join('+')} className="rounded-md border border-border p-1.5 space-y-1">
                  {group.members.map((m) => (
                    <label key={m.cls.id} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name={`keeper-${gi}`}
                        checked={keeper === m.cls.id}
                        onChange={() => setKeepers((prev) => ({ ...prev, [gi]: m.cls.id }))}
                        className="accent-accent"
                      />
                      <span className="flex-1 min-w-0 truncate font-medium text-fg">.{m.cls.name}</span>
                      <span className={clsx('shrink-0 tabular-nums', m.elements === 0 ? 'text-fg-subtle' : 'text-fg-muted')}>
                        {usageText(m.elements, m.pages)}
                      </span>
                    </label>
                  ))}
                  <button
                    type="button"
                    disabled={actionsOff}
                    title={disabledWhy}
                    onClick={() => onMerge(keeper, removeIds)}
                    className="mt-0.5 w-full rounded border border-border px-2 py-1 text-[10px] font-medium text-accent-fg hover:bg-surface-sunken disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Merge into .{group.members.find((m) => m.cls.id === keeper)?.cls.name} and keep it
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {report && report.unused.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
              Unworn - no element on any page uses these
            </p>
            {report.unused.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={(e) => setSelected((prev) => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(c.id)
                    else next.delete(c.id)
                    return next
                  })}
                  className="accent-accent"
                />
                <span className="flex-1 min-w-0 truncate font-medium text-fg">.{c.name}</span>
                <span className="shrink-0 text-fg-subtle">not worn</span>
              </label>
            ))}
            <button
              type="button"
              disabled={actionsOff || selected.size === 0}
              title={disabledWhy}
              onClick={() => {
                const ids = report.unused.map((c) => c.id).filter((id) => selected.has(id))
                setSelected(new Set())
                onDelete(ids)
              }}
              className="mt-0.5 w-full rounded border border-border px-2 py-1 text-[10px] font-medium text-danger hover:bg-surface-sunken disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Delete {selected.size === 0 ? 'selected' : `${selected.size} selected`}
            </button>
          </div>
        )}
      </div>
    </details>
  )
}
