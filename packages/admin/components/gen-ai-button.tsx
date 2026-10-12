/**
 * File Name: gen-ai-button.tsx
 * Purpose: The one Gen AI entry button — used in the TopBar, the object editor,
 *          and the media gallery so the affordance reads identically everywhere.
 *          A slowly rotating gradient border (CSS .genai-border) draws the eye;
 *          it speeds up on hover, stops under prefers-reduced-motion, and goes
 *          static grey when disabled (no Gen AI host on the current page).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: border animation lives in app/globals.css.
 */
import { clsx } from 'clsx'
import { IconSparkles } from '@tangen/icons'

export function GenAIButton({ onClick, children, title, disabled, size = 'sm' }: {
  onClick: () => void
  children: React.ReactNode
  title?: string
  disabled?: boolean
  /** `xs` (24px) beside the header's and toolbars' controls; `sm` (32px) in forms. */
  size?: 'xs' | 'sm'
}) {
  const geometry = size === 'xs'
    ? 'h-6 gap-1 rounded-control px-[7px] text-ui-xs [&_svg]:size-3.5'
    : 'h-8 gap-1.5 rounded-lg px-3 text-xs [&_svg]:size-3.5'
  return (
    <button
      type="button"
      title={title ?? 'Open Gen AI'}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex shrink-0 items-center whitespace-nowrap font-medium transition-colors',
        geometry,
        disabled
          ? 'cursor-not-allowed border border-border bg-surface-sunken text-fg-subtle'
          : 'genai-border cursor-pointer text-accent-fg shadow-sm hover:text-accent-fg',
      )}
    >
      <IconSparkles aria-hidden />
      {children}
    </button>
  )
}
