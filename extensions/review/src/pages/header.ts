/**
 * File Name: header.ts
 * Purpose: The Review page header, shared by the queue and both workflow
 *          screens. Forms keeps this in a layout.tsx that wraps its pages;
 *          extension pages have no layout concept (ExtensionPageDef declares
 *          components, not wrappers), so the three pages call this hook
 *          instead and get an identical title, icon and tab row.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The queue's three scopes stay STATE tabs - the header
 *          activates link tabs by pathname alone, and all three scopes share
 *          one pathname (they differ by ?tab=), so as links they would light
 *          up together. Workflows is a real route, so it is a LINK tab and
 *          stays lit on the detail screen too (longest matching href wins).
 *          No em dashes in UI copy.
 */
import { createElement } from 'react'
import { usePageHeader } from '@/kit'
import { DynamicIcon } from '@/kit'

export interface ReviewHeaderOptions {
  workspaceId?: string
  /** review:manage - the Workflows tab is theirs alone. */
  canManage: boolean
  /** Active QUEUE scope, or null on the workflow screens. */
  activeTab: string | null
  onTabChange?: (id: string) => void
}

/** Extension root for the Review pages. */
export function reviewBase(workspaceId?: string): string {
  return `/${workspaceId}/extensions/review`
}

export function useReviewHeader(
  { workspaceId, canManage, activeTab, onTabChange }: ReviewHeaderOptions,
  deps: unknown[] = [],
): void {
  const base = reviewBase(workspaceId)
  usePageHeader({
    title: 'Review',
    icon: createElement(DynamicIcon, { name: 'IconShieldCheck', className: 'size-4' }),
    description: 'The editorial work queue - review items in place or open them in the editor',
    tabs: [
      { id: 'mine', label: 'Assigned to me' },
      { id: 'all', label: 'All in review' },
      { id: 'done', label: 'Done recently' },
      ...(canManage ? [{ id: 'workflows', label: 'Workflows', href: `${base}/workflows` }] : []),
    ],
    // On the workflow screens no scope is active; the link tab lights itself.
    activeTab: activeTab ?? '',
    onTabChange,
  }, [base, canManage, activeTab, ...deps])
}
