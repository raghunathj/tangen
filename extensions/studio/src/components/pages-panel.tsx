/**
 * File Name: pages-panel.tsx
 * Purpose: The Pages panel - every page Studio can open, and the way to make
 *          a new one without leaving the builder.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Shares `pageGroups` with the top-bar switcher, so the
 *          two surfaces can never disagree about what exists or how it is
 *          grouped. Creating a page opens the SAME dialog the Studio home
 *          page uses - one create path, one set of rules.
 *
 *          Who is on each page comes from the per-type presence aggregate
 *          (docs/realtime.md), the way the admin's objects list does it:
 *          the panel WATCHES `objects:<type>` once per type (never a
 *          subscription per row) and each row selects its own people
 *          through the kit's selectors (othersOnObject, rowPresenceModel),
 *          so a row re-renders only when its people change. A Studio
 *          session names its type on join, so Studio and object-editor
 *          sessions both appear here.
 */
import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { IconPlus, IconSearch } from '@tangen/icons'
import { Button, usePresenceSelector, usePresenceWatch, othersOnObject, rowPresenceModel, rowPresenceLabel, initialsOf } from '@/kit'
import { pageGroups } from '../lib/page-switcher'
import type { StudioType } from '../lib/model'
import { statusMeta } from '../lib/viewport'

export interface PagesPresence {
  currentMemberId: string | null
}

interface PagesPanelProps {
  types: StudioType[]
  rowsByType: Record<string, unknown[]>
  currentType?: string
  currentId?: string
  loading?: boolean
  canCreate: boolean
  onPick: (type: string, id: string) => void
  onNew: () => void
  /** Present when the panel should show who is on each page. */
  presence?: PagesPresence
}

/** One watch per type while the panel is open; a component so the hook count follows the group count. */
function TypePresenceWatch({ type }: { type: string }) {
  usePresenceWatch(`objects:${type}`, {})
  return null
}

/** The avatars beside a page: at most three and a "+N", editors first. */
function PagePresence({ type, id, currentMemberId }: PagesPresence & { type: string; id: string }) {
  const people = usePresenceSelector(`objects:${type}`, (s) => othersOnObject(s, id, currentMemberId), {})
  const model = rowPresenceModel(people)
  if (model.avatars.length === 0) return null
  const names = people.map(rowPresenceLabel).join(', ')
  return (
    <span className="inline-flex items-center -space-x-1 shrink-0" data-testid="page-presence" data-page-presence={id} role="status" aria-label={names}>
      {model.avatars.map((s) => (
        <span
          key={s.id}
          title={rowPresenceLabel(s)}
          className={clsx(
            'flex size-4 items-center justify-center overflow-hidden rounded-full border border-surface bg-surface-sunken text-[7px] font-medium text-fg ring-1',
            s.state === 'editing' ? 'ring-amber-400' : 'ring-border',
          )}
        >
          {s.avatar ? <img src={s.avatar} alt="" className="size-full object-cover" /> : initialsOf(s.name)}
        </span>
      ))}
      {model.more > 0 && (
        <span title={names} className="flex h-4 min-w-4 items-center justify-center rounded-full border border-surface bg-surface-sunken px-1 text-[8px] font-medium text-fg-muted ring-1 ring-border">
          +{model.more}
        </span>
      )}
    </span>
  )
}

export function PagesPanel({
  types, rowsByType, currentType, currentId, loading, canCreate, onPick, onNew, presence,
}: PagesPanelProps) {
  const [query, setQuery] = useState('')
  const groups = useMemo(
    () => pageGroups(types, rowsByType, { query, currentType, currentId }),
    [types, rowsByType, query, currentType, currentId],
  )

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-2 pb-2 space-y-2 shrink-0">
        {canCreate && (
          <Button size="sm" variant="secondary" className="w-full" onClick={onNew}>
            <IconPlus className="size-3.5 mr-1" />
            New page
          </Button>
        )}
        <div className="flex items-center gap-2 px-2 h-7 rounded-md border border-border bg-surface-sunken">
          <IconSearch className="size-3.5 text-fg-subtle shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages"
            className="flex-1 min-w-0 bg-transparent text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 pb-2">
        {loading ? (
          <p className="px-3 py-2 text-xs text-fg-subtle">Loading pages…</p>
        ) : groups.length === 0 ? (
          <p className="px-3 py-2 text-xs text-fg-subtle">
            {query ? 'No pages match.' : 'No pages yet.'}
          </p>
        ) : groups.map((g) => (
          <div key={g.type}>
            {presence && <TypePresenceWatch type={g.type} />}
            <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
              {g.label}
            </p>
            {g.pages.map((p) => (
              <button
                key={`${p.type}:${p.id}`}
                type="button"
                onClick={() => { if (!p.current) onPick(p.type, p.id) }}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs',
                  p.current ? 'bg-accent-muted text-accent-fg' : 'text-fg hover:bg-surface-hover',
                )}
              >
                <span className={clsx('size-1.5 rounded-full shrink-0', statusMeta(p.status).dot)} />
                <span className="flex-1 min-w-0 truncate">{p.title}</span>
                {presence && <PagePresence currentMemberId={presence.currentMemberId} type={p.type} id={p.id} />}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
