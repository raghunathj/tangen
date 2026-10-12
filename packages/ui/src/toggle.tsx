'use client'
/**
 * File Name: toggle.tsx
 * Purpose: Toggle (Lightfield, 2026-09-12, after Geist): a Switch WITH its
 *          words - a short Title Case label and, optionally, one sentence
 *          that says what ON does. A toggle is for a single boolean that
 *          takes effect immediately (Password protection, Auto-cancel
 *          builds); a setting that waits for Save is a Checkbox.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Wraps ./switch. The whole row is the label, so the
 *          words are the click target too. `direction="switch-first"` puts
 *          the control before the words (a list of settings); the default
 *          puts it at the right edge (a settings row, the benchmark's way).
 */
import React from 'react'
import { Switch } from './switch'
import { cx } from './utils'

export interface ToggleProps extends Omit<React.ComponentPropsWithoutRef<typeof Switch>, 'children'> {
  /** The setting, in Title Case, one to four words. */
  label: React.ReactNode
  /** One sentence on what ON does. */
  description?: React.ReactNode
  /** Where the control sits: after the words (default) or before them. */
  direction?: 'label-first' | 'switch-first'
  /** `sm` for dense rows and property editors. */
  size?: 'sm' | 'md'
  /** The row's own classes (a border, padding). */
  className?: string
}

export const Toggle = React.forwardRef<React.ElementRef<typeof Switch>, ToggleProps>(
  ({ label, description, direction = 'label-first', size = 'md', className, disabled, id, ...props }, ref) => {
    const reactId = React.useId()
    const switchId = id ?? `toggle-${reactId}`
    const descId = description ? `${switchId}-desc` : undefined
    const words = (
      <span className="min-w-0 flex-1">
        <span className={cx('block font-medium text-fg', size === 'sm' ? 'text-ui-xs' : 'text-ui-sm', disabled && 'text-fg-muted')}>{label}</span>
        {description && <span id={descId} className={cx('mt-0.5 block text-fg-subtle', size === 'sm' ? 'text-ui-xs' : 'text-ui-xs')}>{description}</span>}
      </span>
    )
    const control = (
      <Switch
        ref={ref}
        id={switchId}
        size={size}
        disabled={disabled}
        aria-describedby={descId}
        className={cx('shrink-0', description ? 'mt-0.5' : undefined)}
        {...props}
      />
    )
    return (
      <label
        htmlFor={switchId}
        className={cx(
          'flex items-start gap-3 select-none',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          direction === 'switch-first' ? 'flex-row' : 'flex-row justify-between',
          className,
        )}
      >
        {direction === 'switch-first' ? <>{control}{words}</> : <>{words}{control}</>}
      </label>
    )
  },
)
Toggle.displayName = 'Toggle'
