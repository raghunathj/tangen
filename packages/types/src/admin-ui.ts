/**
 * File Name: admin-ui.ts
 * Purpose: Defines the props contract and component type for app-registered admin
 * UI components such as bulk-action modals registered via adminUI.components in
 * tangen.config.ts.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None — @tangen/types must stay framework-agnostic; no React import.
 */

/**
 * Props received by every app-defined admin UI component — custom bulk-action modals,
 * sidebar panels, or any component registered via adminUI.components in tangen.config.ts.
 *
 * Index signature allows passing extra context via DataListBulkAction.modalProps.
 */
export interface AdminUIComponentProps {
  /** Selected row IDs — set when the component is used as a bulk-action modal. */
  ids?: string[]
  /** Call to close the modal shell provided by DataList. */
  onClose?: () => void
  /** Current environment slug (e.g. 'development', 'production'). */
  env: string
  /** Current workspace ID. */
  workspaceId: string
  /** Content type name — set in object-type contexts. */
  typeName?: string
  /** Extra context passed via DataListBulkAction.modalProps. */
  [key: string]: unknown
}

/**
 * Structural type for a React component that accepts AdminUIComponentProps.
 * Defined without a React import so @tangen/types stays framework-agnostic;
 * React.ComponentType<AdminUIComponentProps> satisfies this type structurally.
 */
export type AdminUIComponent = (props: AdminUIComponentProps) => unknown
