'use client'
import React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { IconExpandUpDown, IconCheck, IconChevronUp, IconChevronDown, IconX } from '@tangen/icons'
import { cx, focusInput, hasErrorInput, tv } from './utils'

const selectTriggerStyles = tv({
  base: [
    'group/trigger relative flex h-(--tg-control-h) w-full cursor-default select-none items-center justify-between gap-2 truncate rounded-control border px-2.5 text-ui shadow-raised outline-none transition-colors motion-fast',
    'border-border bg-surface-raised text-fg',
    'hover:border-border-strong',
    'data-[state=open]:border-focus-border',
    'data-[disabled]:cursor-not-allowed data-[disabled]:border-border-subtle data-[disabled]:bg-surface-hover data-[disabled]:text-fg-faint data-[disabled]:shadow-none',
    'aria-invalid:border-danger aria-invalid:ring-[3px] aria-invalid:ring-danger/20',
    focusInput,
  ],
  variants: {
    hasError: { true: hasErrorInput },
  },
})

export interface SelectProps extends React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root> {
  id?: string
  className?: string
  hasError?: boolean
  placeholder?: string
  /** Names the trigger when no visible text does. Goes ON the trigger. */
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  /**
   * Makes the field CLEARABLE: an x inside it, before the chevron, shown
   * while a value is set. A Clear button outside the field is a second
   * control for the same decision and reads as unrelated (the user,
   * 2026-09-20) - clearing belongs in the field, where the value is.
   */
  onClear?: () => void
}

/**
 * The naming props belong on the TRIGGER, not on Root: Root renders no DOM
 * node, so an `aria-label` passed through it disappeared and the trigger - a
 * button whose content is the chosen value - was left unnamed (axe
 * button-name, found on the SEO settings page 2026-09-19). A row label
 * pointing at the trigger does not name it either: a button takes its name
 * from its content.
 */
const Select = ({
  children, id, className, hasError, placeholder, onClear,
  'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledby, 'aria-describedby': ariaDescribedby,
  ...props
}: SelectProps) => (
  <SelectPrimitive.Root {...props}>
    <SelectPrimitive.Trigger
      id={id}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      aria-describedby={ariaDescribedby}
      className={cx(selectTriggerStyles({ hasError }), className)}
    >
      <span className="flex-1 truncate text-left data-[placeholder]:text-fg-subtle">
        <SelectPrimitive.Value placeholder={placeholder ?? '- Select -'} />
      </span>
      {onClear && props.value !== undefined && props.value !== '' && !props.disabled && (
        // Inside the field, before the chevron. `pointer-down` is where Radix
        // opens the menu, so both are stopped: clearing must not also open it.
        <span
          role="button"
          tabIndex={-1}
          aria-label="Clear"
          title="Clear"
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClear() }}
          className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-full text-fg-subtle transition-colors motion-fast hover:bg-surface-hover hover:text-fg"
        >
          <IconX className="size-3" aria-hidden />
        </span>
      )}
      <SelectPrimitive.Icon asChild>
        <IconExpandUpDown className="size-4 shrink-0 text-fg-subtle group-data-[disabled]/trigger:text-fg-faint" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        // The available height keeps a long list - or a short one opened near the
        // window edge, inside a dialog - from being cut off: it scrolls instead.
        className="relative z-(--tg-z-popover) max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg bg-surface-raised shadow-popover"
        position="popper"
        sideOffset={4}
        collisionPadding={8}
      >
        <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1 text-fg-muted">
          <IconChevronUp className="size-4" aria-hidden />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="max-h-(--radix-select-content-available-height) overflow-y-auto p-1">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1 text-fg-muted">
          <IconChevronDown className="size-4" aria-hidden />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
)

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ children, className, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cx(
      'relative flex h-7 cursor-default select-none items-center rounded-control pl-7 pr-2 text-ui-sm text-fg outline-none',
      'hover:bg-surface-sunken data-[highlighted]:bg-surface-sunken data-[highlighted]:text-fg',
      'data-[state=checked]:font-medium',
      'data-[disabled]:pointer-events-none data-[disabled]:text-fg-faint',
      className,
    )}
    {...props}
  >
    <span className="absolute left-1.5 flex size-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <IconCheck className="size-4 text-accent-fg" aria-hidden />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = 'SelectItem'

export { Select, SelectItem }
