/**
 * File Name: index.ts
 * Purpose: Barrel re-export of all public components and types from the @tangen/ui package.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Re-exports from sibling component files; requires React and Tailwind CSS.
 */

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from './accordion'
export {
  Metabox, MetaboxRoot, MetaboxContent,
  type MetaboxProps,
} from './metabox'
export { cx, tv, twMergeConfig, focusInput, focusRing, hasErrorInput } from './utils'
export { Button, buttonVariants, type ButtonProps } from './button'
export { Badge, badgeVariants, type BadgeProps } from './badge'
export { Input, inputStyles, type InputProps } from './input'
export { Textarea, textareaStyles, type TextareaProps } from './textarea'
export { Checkbox, RadioGroup, RadioGroupItem, ChoiceRow } from './checkbox'
export { Switch } from './switch'
export { Toggle, type ToggleProps } from './toggle'
export { Select, SelectItem, type SelectProps } from './select'
export { SearchSelect, type SearchSelectProps, type SearchSelectOption } from './search-select'
export { MultiSelect, type MultiSelectProps, type MultiSelectOption } from './multi-select'
export {
  Dialog, DialogTrigger, DialogClose, DialogPortal, DialogOverlay,
  DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription,
} from './dialog'
export {
  Sheet, SheetTrigger, SheetClose, SheetPortal, SheetOverlay,
  SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription,
  makeCloseGuards,
} from './sheet'
export { toast, useToastStore, type ToastVariant, type ToastItem, type ToastOptions, type ToastAction, type ToastLink } from './toast'
export { Toaster } from './toaster'
export {
  Heading, type HeadingProps,
  Text, type TextProps,
  Label, type LabelProps,
  InlineCode,
  Divider, type DividerProps,
} from './typography'
export { Callout, type CalloutProps } from './callout'
export { ViewBar, type ViewBarProps, type ViewBarSearch } from './view-bar'
export { Table, TableRoot, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, TableFoot, TableCaption } from './table'
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './tooltip'
export {
  Menu, MenuTrigger, MenuContent, MenuItem, MenuCheckboxItem, MenuRadioItem, MenuRadioGroup,
  MenuLabel, MenuSeparator, MenuShortcut, MenuGroup, MenuPortal, MenuSub, MenuSubTrigger, MenuSubContent,
} from './menu'
export { Popover, PopoverTrigger, PopoverAnchor, PopoverClose, PopoverContent } from './popover'
export { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs'
export { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from './breadcrumb'
export { SubNav, SubNavItem } from './sub-nav'
export { PropertyRow, type PropertyRowProps } from './property-row'
export {
  DataList,
  type DataListColumn,
  type DataListSortConfig,
  type DataListBulkAction,
  type DataListUIComponent,
  type DataListHeadingConfig,
  type DataListEmptyStateConfig,
  type DataListProps,
} from './data-list'
export { ListChip, TEXT_LINK, type ListChipProps } from './list-chip'
export { Section, Panel, PanelRow, type SectionProps, type PanelProps, type PanelRowProps } from './panel'
export {
  ListFilter, ListFilterChips, activeFilters, clearedFilters,
  type ListFilterFacet, type ListFilterValue, type ListFilterProps,
} from './list-filter'
