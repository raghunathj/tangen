/**
 * File Name: push-overlay.tsx
 * Purpose: Full-screen blocking overlay for schema activities (save → push → dev-server
 *   hot reload). These take several seconds and half-updated UI invites stray clicks —
 *   the overlay makes the wait explicit and keeps the surface inert until applied.
 *
 * Author: Raghunath J
 * License: MIT
 */

export function PushOverlay({ show, label, sublabel }: {
  show: boolean
  label: string
  sublabel?: string
}) {
  if (!show) return null
  return (
    <div className="fixed inset-0 z-[70] bg-surface/75 backdrop-blur-sm flex flex-col items-center justify-center gap-3" role="status" aria-live="polite">
      <div className="size-8 rounded-full border-2 border-border-strong border-t-accent-strong animate-spin" />
      <p className="text-sm font-medium text-fg">{label}</p>
      <p className="text-xs text-fg-muted max-w-sm text-center">
        {sublabel ?? 'Applying to the dev server - schema pushes trigger a reload and take a few seconds.'}
      </p>
    </div>
  )
}
