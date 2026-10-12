/**
 * File Name: textarea.tsx
 * Purpose: Textarea (UI V2 spec §10): the Input treatment on a multi-line
 *          control - raised surface, hairline border, hover and focus and
 *          invalid states from the same helpers - so a summary field and a
 *          title field are visibly one family.
 *
 * Author: Raghunath J
 * License: MIT
 */
import React from 'react'
import { cx, focusInput, hasErrorInput } from './utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean
  /** Grow with content instead of scrolling (CSS field-sizing where supported). */
  autoGrow?: boolean
}

const textareaStyles = [
  'block w-full min-h-20 appearance-none rounded-control border px-2.5 py-2 text-ui leading-5 shadow-raised outline-none transition-colors motion-fast',
  'border-border bg-surface-raised text-fg placeholder:text-fg-subtle',
  'hover:border-border-strong',
  'read-only:bg-surface read-only:shadow-none',
  'disabled:border-border-subtle disabled:bg-surface-hover disabled:text-fg-faint disabled:shadow-none',
  'aria-invalid:border-danger aria-invalid:ring-[3px] aria-invalid:ring-danger/20',
  ...focusInput,
]

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, hasError, autoGrow, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cx(textareaStyles, hasError && hasErrorInput, autoGrow && '[field-sizing:content] resize-none', className)}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

export { Textarea, textareaStyles }
