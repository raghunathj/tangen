/// <reference types="vite/client" />

interface ImportMetaEnv {
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// ── Virtual modules provided by Tangen's Vite plugins ────────────────────────

declare module 'virtual:tangen/app-ui-registry' {
  import type { DataListUIComponent, DataListBulkAction } from '@tangen/ui'
  import type { AdminExtension } from '@tangen/types'
  /** Slug → React component map registered in app/admin/index.ts.
   *  String references to app/admin/pages.ts exports arrive here already
   *  resolved into React.lazy wrappers (Suspense baked in). */
  export const APP_UI_REGISTRY: Record<string, DataListUIComponent>
  /** Type name → bulk action array registered in app/admin/index.ts.
   *  Always statically imported — handlers stay synchronous. */
  export const APP_BULK_ACTIONS: Record<string, DataListBulkAction[]>
  /** Custom pages and sidebar nav entries registered via `extension` export.
   *  Route components referenced by name from app/admin/pages.ts are lazy. */
  export const ADMIN_EXTENSION: AdminExtension
}

declare module 'virtual:tangen/field-type-ui' {
  import type { FieldTypeUIDef } from '@/lib/field-type-ui'
  /** Custom field type name → its admin Input + optional client validator. */
  export const FIELD_TYPE_UI: Record<string, FieldTypeUIDef>
}

declare module 'virtual:tangen/extension-panels' {
  import type { ComponentType } from 'react'
  import type { AdminNavEntry, AdminAccessRule } from '@tangen/types'
  export const EXTENSION_PANELS: Record<string, Record<string, ComponentType<any>>>
  /** Extension id → resolved full admin pages (manifest `pages:`). */
  export const EXTENSION_PAGES: Record<string, Array<{
    path: string
    component: ComponentType<any>
    nav?: AdminNavEntry
    access?: AdminAccessRule
  }>>
  /** Extension id → declared command-palette quick actions (manifest `commands:`). */
  export const EXTENSION_COMMANDS: Record<string, Array<{ label: string; icon?: string; to: string }>>
  /** Extension id → Admin slot items (manifest `slots:`, Extension Kernel K7.2), components lazy. */
  export const EXTENSION_SLOTS: Record<string, Array<{
    extensionId: string
    slot: string
    id: string
    component: ComponentType<any>
    label?: string
    priority?: number
    access?: AdminAccessRule
  }>>
}
