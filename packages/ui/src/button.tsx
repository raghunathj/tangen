import React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { IconSpinner } from '@tangen/icons'
import type { VariantProps } from 'tailwind-variants'
import { cx, focusRing, tv } from './utils'

/**
 * Button - the hierarchy of UI V2 spec §9. One `primary` per view (the
 * action that advances the task), `secondary` as the default, `ghost` in
 * toolbars and rows, `destructive` after confirmation, `link` inline.
 * Every colour is a semantic token; every height is a size variant; the
 * open state of a trigger (`data-state="open"` from Radix) reads as
 * selected; disabled is colour, never whole-control opacity.
 */
const buttonVariants = tv({
  base: [
    'relative inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-control border border-transparent text-center font-medium',
    'transition-colors motion-fast cursor-pointer select-none',
    'disabled:pointer-events-none disabled:shadow-none',
    '[&_svg]:shrink-0',
    focusRing,
  ],
  variants: {
    variant: {
      primary: [
        'bg-accent text-accent-contrast',
        'hover:bg-accent-strong',
        'data-[state=open]:bg-accent-strong',
        'disabled:bg-accent-muted disabled:text-fg-faint',
      ],
      secondary: [
        'border-border bg-surface-raised text-fg shadow-raised',
        'hover:bg-surface-hover hover:border-border-strong',
        'data-[state=open]:bg-surface-selected',
        'disabled:bg-surface-hover disabled:text-fg-faint disabled:border-border-subtle',
      ],
      light: [
        'bg-surface-hover text-fg',
        'hover:bg-surface-selected',
        'data-[state=open]:bg-surface-selected',
        'disabled:bg-surface-hover disabled:text-fg-faint',
      ],
      ghost: [
        'bg-transparent text-fg-muted',
        'hover:bg-surface-hover hover:text-fg',
        'data-[state=open]:bg-surface-selected data-[state=open]:text-fg',
        'disabled:text-fg-faint',
      ],
      destructive: [
        'bg-danger text-accent-contrast',
        'hover:bg-danger-fg',
        'disabled:bg-danger-muted disabled:text-fg-faint',
      ],
      link: [
        'h-auto border-0 bg-transparent px-0 text-accent-fg underline-offset-4',
        'hover:underline',
        'disabled:text-fg-faint',
      ],
    },
    size: {
      xs: 'h-6 px-[7px] text-ui-xs gap-1 [&_svg]:size-4',
      sm: 'h-7 px-2.5 text-ui-sm gap-1.5 [&_svg]:size-4',
      md: 'h-8 px-3 text-ui-sm gap-1.5 [&_svg]:size-4',
      lg: 'h-9 px-4 text-ui gap-2 [&_svg]:size-4',
    },
    /** A square icon-only button: pass `icon` with no children, or set this. */
    iconOnly: {
      true: 'px-0',
    },
  },
  compoundVariants: [
    { iconOnly: true, size: 'xs', class: 'w-6' },
    { iconOnly: true, size: 'sm', class: 'w-7' },
    { iconOnly: true, size: 'md', class: 'w-8' },
    { iconOnly: true, size: 'lg', class: 'w-9' },
  ],
  defaultVariants: { variant: 'primary', size: 'md' },
})

export interface ButtonProps
  extends React.ComponentPropsWithoutRef<'button'>,
    Omit<VariantProps<typeof buttonVariants>, 'iconOnly'> {
  /**
   * Style something else as this button - a router Link, an anchor. Exactly
   * ONE child element, which owns its own content: `icon` and `isLoading`
   * decoration is not applied, because Radix's Slot can only clone a single
   * element and a wrapper would leave the child unstyled.
   */
  asChild?: boolean
  isLoading?: boolean
  loadingText?: string
  icon?: React.ReactNode
  /** Which side of the label the icon renders on. Default 'start'. */
  iconPosition?: 'start' | 'end'
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild, isLoading, loadingText, className, disabled, variant, size, children, icon, iconPosition = 'start', ...props }, ref) => {
    const Component = asChild ? Slot : 'button'
    const iconOnly = !!icon && (children === undefined || children === null || children === false)

    // `asChild` hands the styling to whatever element the caller supplies -
    // a router Link, usually. Radix's Slot can only clone ONE element, so the
    // decoration below (a fragment, even around a single child) has to be
    // skipped: with it, Slot found no element to clone and the child rendered
    // UNSTYLED - a plain 16px link where a button was expected (found on
    // Settings > Extensions, 2026-09-20). The child owns its own content
    // here, `icon` and `isLoading` included.
    if (asChild) {
      return (
        <Slot
          ref={ref}
          className={cx(buttonVariants({ variant, size, iconOnly }), className)}
          aria-busy={isLoading || undefined}
          data-disabled={disabled || isLoading || undefined}
          {...props}
        >
          {children}
        </Slot>
      )
    }

    return (
      <Component
        ref={ref}
        className={cx(buttonVariants({ variant, size, iconOnly }), className)}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading ? (
          <span className="pointer-events-none flex shrink-0 items-center justify-center gap-1.5">
            <IconSpinner className="shrink-0 animate-spin" aria-hidden="true" />
            <span className="sr-only">{loadingText ?? 'Loading'}</span>
            {loadingText ?? children}
          </span>
        ) : (
          <>
            {icon && iconPosition === 'start' && <span className="flex shrink-0 items-center">{icon}</span>}
            {children}
            {icon && iconPosition === 'end' && <span className="flex shrink-0 items-center">{icon}</span>}
          </>
        )}
      </Component>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
