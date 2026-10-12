'use client'
/**
 * File Name: checkbox.tsx
 * Purpose: Checkbox and RadioGroup (UI V2 spec §10) over Radix: 16px,
 *          radius sm, `accent` when checked with the contrast mark, the same
 *          focus ring as every other control, disabled by colour. Indigo
 *          appears on the indicator only - the label stays neutral.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @radix-ui/react-checkbox, @radix-ui/react-radio-group.
 *          Replaces the raw <input type="checkbox"> sites progressively;
 *          `indeterminate` renders a dash for a partial selection.
 */
import React from 'react'
import * as C from '@radix-ui/react-checkbox'
import * as R from '@radix-ui/react-radio-group'
import { IconCheck, IconMinus } from '@tangen/icons'
import { cx, focusRing } from './utils'

const CONTROL = [
  'peer inline-flex size-4 shrink-0 cursor-pointer items-center justify-center border transition-colors motion-fast',
  'border-border-strong bg-surface-raised shadow-raised',
  'hover:border-fg-subtle',
  'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-contrast',
  'data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-accent-contrast',
  'disabled:cursor-default disabled:border-border-subtle disabled:bg-surface-hover disabled:shadow-none disabled:data-[state=checked]:bg-accent-muted disabled:data-[state=checked]:text-fg-faint',
  'aria-invalid:border-danger',
  focusRing,
].join(' ')

const Checkbox = React.forwardRef<
  React.ElementRef<typeof C.Root>,
  React.ComponentPropsWithoutRef<typeof C.Root>
>(({ className, ...props }, ref) => (
  <C.Root ref={ref} className={cx(CONTROL, 'rounded-sm', className)} {...props}>
    <C.Indicator className="flex items-center justify-center">
      {props.checked === 'indeterminate'
        ? <IconMinus className="size-3" aria-hidden />
        : <IconCheck className="size-3" aria-hidden />}
    </C.Indicator>
  </C.Root>
))
Checkbox.displayName = 'Checkbox'

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof R.Root>,
  React.ComponentPropsWithoutRef<typeof R.Root>
>(({ className, ...props }, ref) => (
  <R.Root ref={ref} className={cx('grid gap-2', className)} {...props} />
))
RadioGroup.displayName = 'RadioGroup'

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof R.Item>,
  React.ComponentPropsWithoutRef<typeof R.Item>
>(({ className, ...props }, ref) => (
  <R.Item ref={ref} className={cx(CONTROL, 'rounded-full', className)} {...props}>
    <R.Indicator className="flex items-center justify-center">
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
    </R.Indicator>
  </R.Item>
))
RadioGroupItem.displayName = 'RadioGroupItem'

/** A control with its label on one line, the label in the default text
 *  colour and clickable; help text under it in `fg-subtle`. */
export function ChoiceRow({
  control, label, help, htmlFor, className, disabled,
}: { control: React.ReactNode; label: React.ReactNode; help?: React.ReactNode; htmlFor?: string; className?: string; disabled?: boolean }) {
  return (
    <div className={cx('flex items-start gap-2.5', className)}>
      <span className="flex h-5 items-center">{control}</span>
      <div className="min-w-0">
        <label htmlFor={htmlFor} className={cx('block text-ui-sm text-fg', disabled ? 'text-fg-faint' : 'cursor-pointer')}>{label}</label>
        {help && <p className="mt-0.5 text-ui-xs text-fg-subtle">{help}</p>}
      </div>
    </div>
  )
}

export { Checkbox, RadioGroup, RadioGroupItem }
