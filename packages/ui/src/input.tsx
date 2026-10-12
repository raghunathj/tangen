import React from 'react'
import { IconEyeFill, IconEyeOffFill, IconSearch } from '@tangen/icons'
import type { VariantProps } from 'tailwind-variants'
import { cx, focusInput, hasErrorInput, tv } from './utils'

const inputStyles = tv({
  base: [
    'relative block h-(--tg-control-h) w-full appearance-none rounded-control border px-2.5 py-0 text-ui shadow-raised outline-none transition-colors motion-fast',
    'border-border bg-surface-raised text-fg placeholder:text-fg-subtle',
    'hover:border-border-strong',
    'read-only:bg-surface read-only:shadow-none',
    'disabled:border-border-subtle disabled:bg-surface-hover disabled:text-fg-faint disabled:shadow-none disabled:placeholder:text-fg-faint',
    'aria-invalid:border-danger aria-invalid:ring-[3px] aria-invalid:ring-danger/20',
    focusInput,
    '[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
  ],
  variants: {
    hasError: { true: hasErrorInput },
    enableStepper: {
      false: '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
    },
  },
})

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputStyles> {
  label?: string
  inputClassName?: string
  icon?: React.ReactNode
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, inputClassName, hasError, enableStepper = true, type, label, id, icon, ...props }, ref) => {
    const [typeState, setTypeState] = React.useState(type)
    const isPassword = type === 'password'
    const isSearch = type === 'search'

    return (
      <div className={className}>
        {label && (
          <label htmlFor={id} className="mb-1.5 block text-ui-xs font-medium text-fg-muted">
            {label}
          </label>
        )}
        <div className="relative w-full">
          <input
            ref={ref}
            id={id}
            type={isPassword ? typeState : type}
            className={cx(
              inputStyles({ hasError, enableStepper }),
              isSearch || icon ? 'pl-8' : '',
              isPassword ? 'pr-10' : '',
              inputClassName,
            )}
            {...props}
          />
          {(isSearch || icon) && (
            <div className="pointer-events-none absolute bottom-0 left-2 flex h-full items-center justify-center text-fg-subtle">
              {icon ?? <IconSearch className="size-[1.125rem] shrink-0" aria-hidden="true" />}
            </div>
          )}
          {isPassword && (
            <div className="absolute bottom-0 right-0 flex h-full items-center justify-center px-3">
              <button
                aria-label="Toggle password visibility"
                type="button"
                className="h-fit w-fit rounded-xs text-fg-subtle hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus transition-colors motion-fast"
                onClick={() => setTypeState(typeState === 'password' ? 'text' : 'password')}
              >
                <span className="sr-only">{typeState === 'password' ? 'Show password' : 'Hide password'}</span>
                {typeState === 'password'
                  ? <IconEyeFill aria-hidden="true" className="size-5 shrink-0" />
                  : <IconEyeOffFill aria-hidden="true" className="size-5 shrink-0" />
                }
              </button>
            </div>
          )}
        </div>
      </div>
    )
  },
)
Input.displayName = 'Input'

export { Input, inputStyles }
