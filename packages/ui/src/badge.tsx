import React from 'react'
import type { VariantProps } from 'tailwind-variants'
import { cx, tv } from './utils'

/**
 * Badge - a small state label. Neutral by default; the accent and status
 * variants ride the `*-muted` tint and `*-fg` text tokens (spec §1), so a
 * badge reads the same on every surface in both themes and never paints a
 * raw palette step.
 */
const badgeVariants = tv({
  base: 'inline-flex h-5 items-center gap-x-1 whitespace-nowrap rounded-sm px-1.5 text-ui-2xs ring-1 ring-inset [&_svg]:size-3',
  variants: {
    variant: {
      default:  'bg-accent-muted text-accent-fg ring-accent/20',
      neutral:  'bg-surface-hover text-fg-muted ring-border',
      success:  'bg-success-muted text-success-fg ring-success/20',
      error:    'bg-danger-muted text-danger-fg ring-danger/20',
      warning:  'bg-warning-muted text-warning-fg ring-warning/25',
      info:     'bg-info-muted text-info-fg ring-info/20',
    },
  },
  defaultVariants: { variant: 'default' },
})

export interface BadgeProps
  extends React.ComponentPropsWithoutRef<'span'>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cx(badgeVariants({ variant }), className)} {...props} />
  ),
)
Badge.displayName = 'Badge'

export { Badge, badgeVariants }
