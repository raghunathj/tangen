/**
 * File Name: admin-page.tsx
 * Purpose: <AdminPage> — the base page shell for custom admin screens: wires
 *          the platform header system, the RBAC access gate, loading state,
 *          and the standard scroll container so every custom page looks and
 *          behaves like a native Tangen screen.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Part of the stable @/kit surface.
 */
import type { ReactNode } from 'react'
import type { AdminAccessRule } from '@tangen/types'
import { usePageHeader, type HeaderCrumb, type HeaderTab } from '@/lib/page-header'
import { RequirePermission } from '@/components/require-permission'
import { Skeleton } from '../primitives'
import { PageFrame, type PageFrameWidth } from './page-frame'

export interface AdminPageProps {
  /** Header title (or pass full breadcrumbs instead). */
  title?: string
  icon?: ReactNode
  /** Short grayed description after the title. */
  description?: string
  breadcrumbs?: HeaderCrumb[]
  /** Right-side header actions (Buttons). */
  actions?: ReactNode
  /** Header tabs row. */
  tabs?: HeaderTab[]
  activeTab?: string
  onTabChange?: (id: string) => void
  /** RBAC gate — { roles } and/or { capability }; renders NoPermission otherwise. */
  access?: AdminAccessRule
  /** Skeleton the body while the page's data loads. */
  loading?: boolean
  /** Remove the default body padding. */
  flush?: boolean
  /** Width follows the task (UI V2 spec §14): `form` 720px, `document` 840px, `full` (default). */
  width?: PageFrameWidth
  /** A toolbar row under the header that never scrolls away. */
  toolbar?: ReactNode
  /** A right column (an inspector, a rail). */
  aside?: ReactNode
  className?: string
  children: ReactNode
}

/** Base shell - header + access gate + the PageFrame content model. */
export function AdminPage({
  title, icon, description, breadcrumbs, actions, tabs, activeTab, onTabChange,
  access, loading, flush, width, toolbar, aside, className, children,
}: AdminPageProps) {
  usePageHeader(
    { title, icon, description, breadcrumbs, actions, tabs, activeTab, onTabChange },
    [title, description, actions, tabs, activeTab, loading],
  )

  const body = (
    <PageFrame width={width} toolbar={toolbar} aside={aside} flush={flush} contentClassName={className}>
      {loading ? <Skeleton variant="rows" rows={6} /> : children}
    </PageFrame>
  )

  if (access) {
    return <RequirePermission access={access}>{body}</RequirePermission>
  }
  return body
}
