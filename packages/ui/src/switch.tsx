'use client'
/**
 * File Name: switch.tsx
 * Purpose: Switch (UI V2 spec §10) over Radix Switch: a 32x18 track, the
 *          thumb raised on the surface token, `accent` when on, neutral
 *          tint when off, disabled by colour, the shared focus ring.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @radix-ui/react-switch. `size="sm"` (28x16) for dense
 *          rows and property editors.
 */
import React from 'react'
import * as S from '@radix-ui/react-switch'
import { cx, focusRing } from './utils'

const Switch = React.forwardRef<
  React.ElementRef<typeof S.Root>,
  React.ComponentPropsWithoutRef<typeof S.Root> & { size?: 'sm' | 'md' }
>(({ className, size = 'md', ...props }, ref) => (
  <S.Root
    ref={ref}
    className={cx(
      'peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors motion-fast',
      'bg-fg-faint data-[state=checked]:bg-accent',
      'hover:bg-fg-subtle data-[state=checked]:hover:bg-accent-strong',
      'disabled:cursor-default disabled:bg-surface-selected disabled:data-[state=checked]:bg-accent-muted',
      size === 'sm' ? 'h-4 w-7' : 'h-[18px] w-8',
      focusRing,
      className,
    )}
    {...props}
  >
    <S.Thumb
      className={cx(
        'pointer-events-none block rounded-full bg-white shadow-raised transition-transform motion-fast',
        // Disabled by TOKEN, thumb included: in dark a dimmed track under a bright white thumb read as an ordinary off switch (2026-09-12).
        'data-[disabled]:bg-fg-faint data-[disabled]:shadow-none',
        size === 'sm'
          ? 'size-3 translate-x-0.5 data-[state=checked]:translate-x-3.5'
          : 'size-3.5 translate-x-0.5 data-[state=checked]:translate-x-[14px]',
      )}
    />
  </S.Root>
))
Switch.displayName = 'Switch'

export { Switch }
