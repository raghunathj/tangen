// Admin panel extension surface - custom pages, bulk actions, shared UI.
// pages/  → full admin pages (register below via extension.routes)
// actions/ → bulk/row-action modal components (APP_UI_REGISTRY)
// components/ → shared React components used by your pages
// Reference: docs/extending-admin.md
import type { AdminExtension, AdminUIComponent } from '@tangen/cms'

export const APP_UI_REGISTRY: Record<string, AdminUIComponent> = {}
export const APP_BULK_ACTIONS: Record<string, unknown> = {}
export const extension: AdminExtension = { routes: [] }
