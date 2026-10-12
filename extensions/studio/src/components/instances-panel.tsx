/**
 * File Name: instances-panel.tsx
 * Purpose: The Instances panel - every shared authored tree this environment
 *          has, grouped by where the system places it, searchable, and
 *          honest when there is no Instance type to have one.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The model lives in lib/instances.ts (pure, tested);
 *          this renders it. The list is fetched by the page rather than here,
 *          because the editor needs the same rows to open an instance on the
 *          canvas, to label a reference in the tree, and to answer "does this
 *          instance still exist" - two fetches of one list is two answers.
 *
 *          An absent Instance type is a REASON, never an empty list: "you
 *          have no instances" and "this environment has no Instance type" are
 *          different facts, and only one of them is fixed by making an
 *          instance.
 */
import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { IconPlus, IconSearch, IconShare } from '@tangen/icons'
import { Spinner } from '@/kit'
import {
  groupByPlacement, searchInstances, instanceTitle, placementLabel, usageSentence,
  instanceDeleteRefusal,
  INSTANCE_PLACEMENTS, type InstancePlacement, type InstanceSummary, type InstanceUsage,
} from '../lib/instances'

interface InstancesPanelProps {
  instances: InstanceSummary[]
  loading: boolean
  /** Why there is nothing to list - no Instance type, or no table for it yet. */
  reason: string | null
  /** A failed read, said rather than shown as "no instances". */
  error?: string | null
  /** The instance currently open on the canvas, if any. */
  activeId?: string | null
  /** Open one for editing - the canvas switches to it. */
  onOpen: (instance: InstanceSummary) => void
  /** Place a reference to one on this page. Absent when nothing can take one. */
  onInsert?: (instance: InstanceSummary) => void
  /** Why a reference cannot be placed here, when it cannot. */
  insertUnavailable?: string | null
  /**
   * Usage across the environment, by instance id. Absent while it is still
   * being counted: an instance nobody uses and an instance nobody has
   * counted yet are different facts, and only one of them is safe to delete
   * on.
   */
  usage?: Record<string, InstanceUsage> | null
  /** Delete one. Absent when this member may not, so no dead control appears. */
  onDelete?: (instance: InstanceSummary) => void
  /**
   * Make a new one, here. Absent when this member may not create instances,
   * or when there is no Instance type to make one in.
   *
   * This control is the point of I4: an Instance is a DESIGN resource, and a
   * designer who has to leave for the content editor to make one has been
   * given a developer dependency for ordinary visual composition.
   */
  onNew?: () => void
  /** Rename one. Safe whatever the usage: a reference points at an id. */
  onRename?: (instance: InstanceSummary) => void
  /** Mint a new instance from this one's blocks, with fresh keys. */
  onDuplicate?: (instance: InstanceSummary) => void
}

export function InstancesPanel({
  instances, loading, reason, error, activeId, onOpen, onInsert, insertUnavailable,
  usage, onDelete, onNew, onRename, onDuplicate,
}: InstancesPanelProps) {
  const [query, setQuery] = useState('')
  /**
   * The delete that was refused, and why, shown on the row it was aimed at.
   *
   * The server refuses a delete while anything still references the instance
   * and answers with the list. Shown HERE rather than as a toast because the
   * list is the useful part: "still in use" is a puzzle, and the pages using
   * it are the fix. Computed from the count the panel already holds, so the
   * refusal arrives before the round trip; the server stays the real gate,
   * because its count is taken across every page and this one is a snapshot.
   */
  const [refused, setRefused] = useState<{ id: string; message: string } | null>(null)
  const shown = useMemo(() => searchInstances(instances, query), [instances, query])
  const grouped = useMemo(() => groupByPlacement(shown), [shown])
  const canInsert = !!onInsert && !insertUnavailable

  /** Delete, unless the count in hand already says it will be refused. */
  const requestDelete = (instance: InstanceSummary) => {
    const message = usage ? instanceDeleteRefusal(instanceTitle(instance), usage[instance.id]) : null
    if (message) { setRefused({ id: instance.id, message }); return }
    setRefused(null)
    onDelete?.(instance)
  }

  const rowAction = 'text-[11px] font-medium text-fg-muted hover:text-fg hover:underline'

  const row = (instance: InstanceSummary) => {
    const open = instance.id === activeId
    return (
      <li key={instance.id}>
        <div
          data-instance={instance.id}
          className={clsx(
            'w-full rounded-lg border bg-surface px-3 py-2.5 transition-colors',
            open ? 'border-accent bg-accent-muted/20' : 'border-border hover:border-accent',
          )}
        >
          <div className="flex items-start gap-3">
            <span className="grid place-items-center size-8 shrink-0 rounded-md border border-border bg-surface-sunken text-fg-muted">
              <IconShare className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-fg truncate">{instanceTitle(instance)}</span>
              {instance.description && (
                <span className="block text-xs text-fg-muted truncate">{instance.description}</span>
              )}
              {open && <span className="block text-[11px] text-accent-fg">Editing this instance</span>}
              {/* The consequence, said before the edit rather than found
                  after it. V1 has no overrides, so an instance is identical
                  everywhere it is used and the number of places it is used
                  IS the size of every change made here. */}
              {usage && (
                <span className="block pt-1 text-[11px] text-fg-subtle" data-usage={instance.id}>
                  {usageSentence(instanceTitle(instance), usage[instance.id])}
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => onOpen(instance)}
              className="text-[11px] font-medium text-accent-fg hover:underline"
            >
              Edit instance
            </button>
            {onInsert && (
              <button
                type="button"
                onClick={() => { if (canInsert) onInsert(instance) }}
                disabled={!canInsert}
                title={insertUnavailable ?? `Place ${instanceTitle(instance)} on this page`}
                className={clsx(
                  'text-[11px] font-medium',
                  canInsert ? 'text-fg-muted hover:text-fg hover:underline' : 'text-fg-subtle cursor-not-allowed',
                )}
              >
                Place on this page
              </button>
            )}
            <span className="ml-auto flex items-center gap-3">
              {onRename && (
                /* Safe whatever the usage count says: a reference points at an
                   id, so every placement follows the new name at once. */
                <button
                  type="button"
                  onClick={() => onRename(instance)}
                  title={`Rename ${instanceTitle(instance)}`}
                  className={rowAction}
                >
                  Rename
                </button>
              )}
              {onDuplicate && (
                <button
                  type="button"
                  onClick={() => onDuplicate(instance)}
                  title={`Make a new instance from ${instanceTitle(instance)}`}
                  className={rowAction}
                >
                  Duplicate
                </button>
              )}
              {onDelete && (
                /* Offered whatever the count says: the REFUSAL is the honest
                   place for "it is still used", because it can name where,
                   and a control that is simply missing explains nothing. */
                <button
                  type="button"
                  onClick={() => requestDelete(instance)}
                  title={`Delete ${instanceTitle(instance)}`}
                  className="text-[11px] font-medium text-fg-subtle hover:text-danger hover:underline"
                >
                  Delete
                </button>
              )}
            </span>
          </div>
          {refused?.id === instance.id && (
            <p
              role="alert"
              data-delete-refused={instance.id}
              className="mt-2 rounded-md border border-danger/40 bg-danger-muted/20 px-2 py-1.5 text-[11px] text-danger"
            >
              {refused.message}
            </p>
          )}
        </div>
      </li>
    )
  }

  const group = (placement: InstancePlacement) => {
    const rows = grouped[placement]
    if (rows.length === 0) return null
    return (
      <div key={placement} className="space-y-1.5">
        <p className="px-1 text-[11px] font-semibold text-fg-muted uppercase tracking-wide">
          {placementLabel(placement)}
        </p>
        <ul className="space-y-1.5">{rows.map(row)}</ul>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-2 pb-2 shrink-0 space-y-2">
        {onNew && (
          <button
            type="button"
            onClick={onNew}
            className="flex w-full items-center justify-center gap-1.5 h-7 rounded-md border border-dashed border-border text-xs font-medium text-fg-muted hover:border-accent hover:text-accent-fg transition-colors"
          >
            <IconPlus className="size-3.5" />
            New instance
          </button>
        )}
        <div className="flex items-center gap-2 px-2 h-7 rounded-md border border-border bg-surface-sunken">
          <IconSearch className="size-3.5 text-fg-subtle shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQuery('') } }}
            placeholder="Search instances"
            aria-label="Search instances"
            className="flex-1 min-w-0 bg-transparent text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-2 space-y-3">
        {insertUnavailable && onInsert && (
          <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-fg-muted" role="note">
            {insertUnavailable}
          </p>
        )}
        {loading ? (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-fg-subtle">
            <Spinner size="sm" label="Loading instances…" />
            Reading the shared instances…
          </div>
        ) : error ? (
          <p className="px-1 py-2 text-xs text-red-600" role="alert">{error}</p>
        ) : reason ? (
          /* Not an empty state: there is no Instance type here, and making an
             instance is not what fixes that. */
          <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-fg-muted" role="note">
            {reason}
          </p>
        ) : shown.length === 0 ? (
          <p className="px-1 py-2 text-xs text-fg-subtle">
            {query
              ? 'No instances match.'
              : onNew
                ? 'No instances yet. Press New instance to make one, compose it on the canvas, then place it on any page.'
                : 'No instances yet. Your role can use instances but not create them.'}
          </p>
        ) : (
          INSTANCE_PLACEMENTS.map(group)
        )}
        {!loading && !error && !reason && shown.length > 0 && (
          <p className="px-1 pt-1 text-[11px] text-fg-subtle">
            An instance is one shared tree: edit it once and every page using it changes.
          </p>
        )}
      </div>
    </div>
  )
}
