/**
 * File Name: detail-page.tsx
 * Purpose: <DetailPage> — the shell for record/detail screens: breadcrumb
 *          trail with back navigation, header actions, and a content column.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Part of the stable @/kit surface.
 */
import type { ReactNode } from 'react'
import { AdminPage, type AdminPageProps } from './admin-page'
import type { HeaderCrumb } from '@/lib/page-header'

export interface DetailPageProps extends Omit<AdminPageProps, 'breadcrumbs' | 'title'> {
  /** Parent trail — e.g. [{ label: 'Bookings', href: '…' }]. */
  parent: HeaderCrumb | HeaderCrumb[]
  /** The record's display name (last crumb). */
  title: string
  children: ReactNode
}

/** Record screen shell — "Parent > Record" breadcrumbs + the base shell. */
export function DetailPage({ parent, title, children, ...page }: DetailPageProps) {
  const trail = Array.isArray(parent) ? parent : [parent]
  return (
    <AdminPage breadcrumbs={[...trail, { label: title }]} {...page}>
      {children}
    </AdminPage>
  )
}
