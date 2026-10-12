/**
 * File Name: list-toolbar.tsx
 * Purpose: The shared list toolbar LEFT cluster — ViewDropdown (status + saved views)
 *   + FilterBar (field/date/locale/label filters). Both AdminDataList and the content
 *   list's taxonomy-tree view render this identical block; extracting it means a
 *   cross-cutting filter (Locales, Labels) is wired ONCE, not duplicated per surface.
 *   Renders as a fragment so it drops into either toolbar container (both use the same
 *   `flex … gap-2` layout with a trailing flex-1 spacer + save button).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { ViewDropdown } from './view-dropdown'
import { FilterBar, type FilterBarProps } from './filter-bar'
import type { Status, SavedView } from './types'

export interface ListToolbarProps extends FilterBarProps {
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
}

export function ListToolbar({
  status, onStatusChange, savedViews, activeViewId, hasActiveFilters,
  onSelectView, onClearActiveView, onSaveView, onDeleteView, currentMemberId,
  ...filterBar
}: ListToolbarProps) {
  return (
    <>
      <ViewDropdown
        status={status}
        onStatusChange={onStatusChange}
        savedViews={savedViews}
        activeViewId={activeViewId}
        hasActiveFilters={hasActiveFilters}
        onSelectView={onSelectView}
        onClearActiveView={onClearActiveView}
        onSaveView={onSaveView}
        onDeleteView={onDeleteView}
        currentMemberId={currentMemberId}
      />
      <FilterBar {...filterBar} />
    </>
  )
}
