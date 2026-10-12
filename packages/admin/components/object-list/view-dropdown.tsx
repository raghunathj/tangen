/**
 * File Name: view-dropdown.tsx
 * Purpose: The view switcher at the left of a list's view bar (the grid
 *          benchmark): "All Posts · 8" as ghost text with a chevron, and a
 *          Menu of the status views, the saved views (deletable by their
 *          owner) and "Save as new view" when filters are active.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: On the Menu primitive, so it is the same surface as
 *          every other menu and the filter popovers.
 */
import {
  Menu, MenuTrigger, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuRadioGroup, MenuRadioItem,
} from '@tangen/ui'
import { IconChevronDown, IconPlus, IconGlobe, IconLock, IconTrash, IconTable } from '@tangen/icons'
import { clsx } from 'clsx'
import type { SavedView } from './types'

type Status = 'all' | 'draft' | 'published' | 'archived'

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: 'all',       label: 'All' },
  { value: 'draft',     label: 'Drafts' },
  { value: 'published', label: 'Published' },
  { value: 'archived',  label: 'Archived' },
]

interface ViewDropdownProps {
  status: Status
  onStatusChange: (s: Status) => void
  savedViews: SavedView[]
  activeViewId: string | null
  hasActiveFilters: boolean
  onSelectView: (view: SavedView) => void
  onClearActiveView: () => void
  onSaveView: () => void
  onDeleteView: (id: string) => void
  currentMemberId?: string
  /** The list's total, read after the view's name ("All · 8"). */
  count?: number
  /** The collection's name, so the default view reads "All Posts". */
  collectionLabel?: string
}

export function ViewDropdown({
  status, onStatusChange, savedViews, activeViewId, hasActiveFilters,
  onSelectView, onClearActiveView, onSaveView, onDeleteView, currentMemberId, count, collectionLabel,
}: ViewDropdownProps) {
  const activeView = savedViews.find((v) => v.id === activeViewId)
  const statusLabel = STATUS_OPTIONS.find((o) => o.value === status)?.label ?? 'All'
  const buttonLabel = activeView?.name ?? (status === 'all' && collectionLabel ? `All ${collectionLabel}` : statusLabel)

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          data-testid="view-switcher"
          className={clsx(
            'inline-flex h-7 min-w-0 shrink items-center gap-1.5 rounded-control px-1.5 text-ui font-medium text-fg transition-colors motion-fast hover:bg-surface-hover',
            'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus data-[state=open]:bg-surface-selected',
          )}
        >
          <IconTable className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          <span className="truncate">{buttonLabel}</span>
          {typeof count === 'number' && <span className="shrink-0 font-normal text-fg-subtle tabular-nums">{`· ${count}`}</span>}
          <IconChevronDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>Status</MenuLabel>
        <MenuRadioGroup
          value={activeViewId ? '' : status}
          onValueChange={(v) => { onStatusChange(v as Status); onClearActiveView() }}
        >
          {STATUS_OPTIONS.map((opt) => (
            <MenuRadioItem key={opt.value} value={opt.value}>{opt.label}</MenuRadioItem>
          ))}
        </MenuRadioGroup>

        {savedViews.length > 0 && (
          <>
            <MenuSeparator />
            <MenuLabel>Saved views</MenuLabel>
            <MenuRadioGroup value={activeViewId ?? ''} onValueChange={(id) => { const v = savedViews.find((s) => s.id === id); if (v) onSelectView(v) }}>
              {savedViews.map((view) => (
                <MenuRadioItem key={view.id} value={view.id} className="group/view">
                  <span className="min-w-0 flex-1 truncate">{view.name}</span>
                  {view.visibility === 'shared'
                    ? <IconGlobe className="size-3.5 text-fg-faint" aria-hidden />
                    : <IconLock className="size-3.5 text-fg-faint" aria-hidden />}
                  {view.createdBy === currentMemberId && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDeleteView(view.id) }}
                      onPointerDown={(e) => e.stopPropagation()}
                      aria-label={`Delete view ${view.name}`}
                      title="Delete view"
                      className="flex size-5 items-center justify-center rounded-xs text-fg-subtle opacity-0 transition-opacity motion-fast group-hover/view:opacity-100 focus-visible:opacity-100 hover:bg-danger-muted hover:text-danger-fg"
                    >
                      <IconTrash className="size-3.5" aria-hidden />
                    </button>
                  )}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </>
        )}

        {hasActiveFilters && (
          <>
            <MenuSeparator />
            <MenuItem onSelect={onSaveView}><IconPlus aria-hidden />Save as new view</MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  )
}
