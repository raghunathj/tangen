/**
 * File Name: index.ts
 * Purpose: THE Tangen Admin Kit barrel — the single stable import surface for
 *          site & extension developers building admin screens
 *          (`import { … } from '@/kit'`). Everything exported here follows
 *          the platform design system and carries a compatibility promise;
 *          anything imported from deeper paths is internal and may change.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Curated re-exports of battle-tested internals + the
 *          kit-native primitives/shells/data layer. Becomes the published
 *          @tangen/admin-kit package when the npm pipeline lands.
 *          Reference: docs/admin-kit.md · living showcase: the Kitchen Sink
 *          extension (extensions/kitchen-sink — every component with code)
 */

// ── Design-system primitives (@tangen/ui) ────────────────────────────────────
export {
  Button, buttonVariants, type ButtonProps,
  Badge, badgeVariants, type BadgeProps,
  Input, type InputProps,
  Select, SelectItem,
  SearchSelect, type SearchSelectProps, type SearchSelectOption,
  MultiSelect, type MultiSelectProps, type MultiSelectOption,
  Dialog, DialogTrigger, DialogClose, DialogPortal, DialogOverlay,
  DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription,
  Sheet, SheetTrigger, SheetClose, SheetPortal, SheetOverlay,
  SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription,
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
  Metabox,
  Table, TableRoot, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, TableFoot, TableCaption,
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
  // UI V2 primitives (spec §10, §12, §13)
  Textarea, type TextareaProps,
  Checkbox, RadioGroup, RadioGroupItem, ChoiceRow,
  Switch, Toggle, type ToggleProps,
  Menu, MenuTrigger, MenuContent, MenuItem, MenuCheckboxItem, MenuRadioItem, MenuRadioGroup,
  MenuLabel, MenuSeparator, MenuShortcut, MenuGroup, MenuPortal, MenuSub, MenuSubTrigger, MenuSubContent,
  Popover, PopoverTrigger, PopoverAnchor, PopoverClose, PopoverContent,
  Tabs, TabsList, TabsTrigger, TabsContent,
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator,
  SubNav, SubNavItem,
  PropertyRow, type PropertyRowProps,
  DataList, ListChip, TEXT_LINK, type ListChipProps,
  Section, Panel, PanelRow, type SectionProps, type PanelProps, type PanelRowProps,
  ListFilter, ListFilterChips, activeFilters, clearedFilters,
  type ListFilterFacet, type ListFilterValue,
  type DataListProps, type DataListColumn, type DataListBulkAction,
  toast, Toaster, type ToastOptions, type ToastAction, type ToastLink,
  cx,
  // Typography & feedback atoms — token-backed; prefer over raw text-* classes
  Heading, type HeadingProps,
  Text, type TextProps,
  Label, type LabelProps,
  InlineCode,
  Divider, type DividerProps,
  Callout, type CalloutProps,
  ViewBar, type ViewBarProps, type ViewBarSearch,
} from '@tangen/ui'

export { DatePicker } from '@/components/ui/date-picker'

// ── Kit primitives ────────────────────────────────────────────────────────────
export {
  Card, type CardProps,
  EmptyState, type EmptyStateProps,
  ErrorState, type ErrorStateProps,
  Skeleton, type SkeletonProps,
  Spinner, type SpinnerProps,
} from './primitives'
export { ConfirmDialog, useConfirm, type ConfirmDialogProps, type ConfirmOptions } from './confirm'
export { FilterDropdown } from './filter-dropdown'
export type { FilterDropdownOption, FilterDropdownProps } from './filter-dropdown'
export { CodeBlock, type CodeBlockProps } from './code-block'
export { SettingsSection, type SettingsSectionProps } from '@/components/settings/settings-section'
export { FactGrid, FactRow } from '@/components/settings/fact-grid'
export { MediaTile, type MediaTileProps } from './media-tile'

// Promoted micro-components (checkbox pills, controlled accordions, tab bars)
export { ActionPill, AccordionSection, TabBar, humanizeAction } from '@/components/api-keys/primitives'

// ── Permissions (RBAC) ────────────────────────────────────────────────────────
export {
  useCan, IfCan, RequirePermission, NoPermission, checkAdminAccess,
} from '@/lib/rbac'

// ── Page header system ────────────────────────────────────────────────────────
export {
  usePageHeader, usePageHeaderActions,
  type PageHeaderConfig, type HeaderCrumb, type HeaderTab,
} from '@/lib/page-header'
/** Browser-tab title for detail pages whose header doesn't carry the entity name. */
export { usePageTitle } from '@/lib/page-title'

// ── Supported surfaces that extensions used to reach through deep imports
//    (UI V2 stage V10): the same modules, now under the stability promise. ──
export { DynamicIcon } from '@/components/dynamic-icon'
export { useAuthStore } from '@/lib/auth'
export { useCapabilities } from '@/lib/use-capabilities'
export { useContentTypes, type ContentTypeItem } from '@/lib/use-content-types'
export { useReusableComponents } from '@/lib/use-reusable-components'
export { roleMeta, isProductionRole, type RoleMeta } from '@/lib/role-meta'
export { cachedAdminGet, cachedWorkspaceGet } from '@/lib/api-cache'
export { buildThumbnailUrl } from '@/lib/media'
export { slugify, buildCreateBody, buildUpdateBody, normalizeObjectData } from '@/lib/editor'

// ── Contextual navigation (UI V2 spec §15) ────────────────────────────────────
/** Declare a context for a route family: while the route is inside it, the
 *  sidebar shows that tree (with a way back) instead of the primary tree. */
export { registerContextNav, type ContextNav, type ContextNavItem, type ContextNavResolver } from '@/lib/context-nav'

// ── Theme (UI V2 spec §4) ─────────────────────────────────────────────────────
/** The theme preference store: light, dark or system, persisted; the pre-paint
 *  script and the account menu use the same key. */
export { useTheme, THEME_MODES, THEME_LABELS, type ThemeMode, type ResolvedTheme } from '@/lib/theme'

// ── Realtime (R1 of tasks/plan-realtime.md) ──────────────────────────────────
/** Subscribe to a topic for an environment; refetch on event, never replicate. */
export { useRealtime, useRealtimeStatus, type RealtimeEvent } from '@/lib/realtime'
/** R3: presence on a scope (join while mounted, selector reads, the advisory editing claim). */
export { usePresence, usePresenceSelector, usePresenceWatch, useEditingClaim, type PresenceSession, type PresenceClaim, type PresenceState } from '@/lib/realtime'
/** The "changed elsewhere" decision for an object editor (another actor wrote what this form holds). */
export { isChangedElsewhere, changedElsewhereLabel } from '@/lib/realtime'
/**
 * The pure presence selectors (@tangen/realtime-admin's presence-views),
 * so an extension draws field, row and block presence from the kit alone:
 * who else edits a field (a dotted address matches its root), who is on a
 * list row and what a row draws, the words and initials.
 */
export {
  othersEditingField, editingFieldLabel, initialsOf, othersOnObject, rowPresenceModel, rowPresenceLabel, type RowPresenceModel,
  fieldAtOrUnder, fieldRootOf, sessionDoing,
} from '@/lib/realtime'

// ── Data access ───────────────────────────────────────────────────────────────
export { useAdminClient } from '@/lib/admin-client'
export { adminFetch, adminFetchStream, adminFetchFile, ApiError } from '@/lib/api'
export {
  type KitQuery, type KitQueryResult, type DataSource,
  fromObjects, fromTable, fromAdminRoute, fromFetch, fromArray,
  useKitQuery, type UseKitQueryResult,
} from './data'

// ── Content-aware components ─────────────────────────────────────────────────
export { MediaPicker } from '@/components/fields/media-picker'
export { RelationPicker } from '@/components/fields/relation-picker'
export { MultiRelationPicker } from '@/components/fields/multi-relation-picker'
// Connectors B3: which connection, and which resource inside it. Both store
// ids, never labels, and both render the platform's one state derivation.
export { ConnectionPicker, ResourcePicker, type ConnectionPickerProps, type ResourcePickerProps, type PickableConnection } from '@/components/fields/connection-picker'
// The form for DECLARED config fields (B3 + D1): one renderer for the six
// kinds a contributed node or a flow preset may ask for, so the Flows builder
// and a host's "add a destination" dialog draw the same controls.
export { ConfigFields, missingConfigFields, type ConfigFieldSpec, type ConfigFieldsProps } from '@/components/fields/config-fields'
// A field that takes data from a run: `{{` offers what the run resolves, and
// the data button browses it by group.
export { TokenInput, type TokenInputProps } from './token-input'
export {
  activeToken, applyToken, insertToken, filterTokens, groupTokens, formFieldTokens,
  type TokenOption, type ActiveToken,
} from '@/lib/token-suggest'
export { FieldControl } from '@/components/fields/field-control'
export { LabelInput } from '@/components/labels/label-input'
/** Client-side field validation (required + format), same rules as the editor. */
export { validateFields } from '@/lib/editor'
export { AdminDataList } from '@/components/admin-data-list'
/** A table-shaped settings page asks for the wide column; the default is the 900px one. */
export { useSettingsWidth, type SettingsWidth } from '@/lib/settings-width'
/**
 * An extension's OWN generated settings form (from its manifest `settings`),
 * for an extension that has a page of its own: bring the form to where the
 * feature lives instead of sending an operator to Settings > Extensions.
 * Same store, same validation, same grant gating - one form, reachable twice.
 */
export { ExtensionSettingsForm } from '@/components/extensions/extension-settings-form'
export { FilterBar } from '@/components/object-list/filter-bar'
export type { FilterableField, FieldFilter, DateFilters, Status } from '@/components/object-list/types'
export { useLocaleStore } from '@/lib/locale'

// ── Page shells ───────────────────────────────────────────────────────────────
export { PageFrame, type PageFrameProps, type PageFrameWidth } from './shells/page-frame'
export { AdminPage, type AdminPageProps } from './shells/admin-page'
export { ListPage, type ListPageProps } from './shells/list-page'
export { DetailPage, type DetailPageProps } from './shells/detail-page'
export { FormSection, FormRow, FormFooter } from './shells/form'
export { AutoForm, type AutoFormProps } from './shells/auto-form'
