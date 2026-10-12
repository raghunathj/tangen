/**
 * File Name: data-list.ts
 * Purpose: Shared sort-configuration type for the DataList component, kept in
 *   @tangen/types so both admin pages and site developer tooling can share it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None — single standalone interface.
 */

/**
 * Sort configuration for DataList — passed as sortConfig prop and returned by onSortChange.
 * Kept in @tangen/types so both admin pages and site developer tooling can share the type.
 */
export interface DataListSortConfig {
  field: string
  direction: 'asc' | 'desc'
}
