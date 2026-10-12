/**
 * File Name: filter-dropdown.tsx
 * Purpose: The content-list style filter pill - a bordered button opening a
 *          Radix dropdown with check-marked options - extracted so extension
 *          and settings lists (flows, forms, jobs) match the content type
 *          list instead of falling back to native browser selects.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Visual twin of components/object-list/view-dropdown.tsx
 *          minus saved views. The trigger tints indigo while a non-default
 *          option is active so applied filters read at a glance.
 */
import { Menu, MenuTrigger, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem } from '@tangen/ui'
import { IconChevronDown } from '@tangen/icons'
import { clsx } from 'clsx'

export interface FilterDropdownOption {
  value: string
  label: string
}

export interface FilterDropdownProps {
  /** Section heading inside the menu (e.g. "Status"). */
  label: string
  options: FilterDropdownOption[]
  value: string
  onChange: (value: string) => void
  /** The option meaning "no filter" - the trigger stays neutral on it. Default: first option. */
  defaultValue?: string
  className?: string
}

export function FilterDropdown({ label, options, value, onChange, defaultValue, className }: FilterDropdownProps) {
  const neutral = defaultValue ?? options[0]?.value ?? ''
  const active = value !== neutral
  const current = options.find((o) => o.value === value) ?? options[0]

  // The view bar's ghost text (the grid benchmark), lit while a value is set;
  // the options as a radio group on the Menu primitive.
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={`Filter by ${label.toLowerCase()}`}
          className={clsx(
            'inline-flex h-7 shrink-0 items-center gap-1 rounded-control px-2 text-ui transition-colors motion-fast',
            'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
            'hover:bg-surface-hover hover:text-fg data-[state=open]:bg-surface-selected data-[state=open]:text-fg',
            active ? 'font-medium text-fg' : 'text-fg-muted',
            className,
          )}
        >
          {current?.label ?? label}
          <IconChevronDown className="size-4 text-fg-subtle" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>{label}</MenuLabel>
        <MenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((opt) => (
            <MenuRadioItem key={opt.value} value={opt.value}>{opt.label}</MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  )
}
