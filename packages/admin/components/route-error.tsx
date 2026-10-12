/**
 * File Name: route-error.tsx
 * Purpose: Root route `errorElement` — converts any render/loader throw (e.g. a
 *   malformed schema crashing a page) into a graceful full-page card instead of
 *   React Router's default white-screen. Mounted on the root route so it catches
 *   every descendant route.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useRouteError, isRouteErrorResponse, useNavigate } from 'react-router-dom'
import { IconWarning } from '@tangen/icons'

export function RouteError() {
  const error = useRouteError()
  const navigate = useNavigate()

  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'An unexpected error occurred.'
  const stack = error instanceof Error ? error.stack : undefined

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-sunken p-6">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-2.5 mb-2">
          <span className="flex size-9 items-center justify-center rounded-full bg-warning-muted border border-warning/40">
            <IconWarning className="size-5 text-warning-fg" />
          </span>
          <h1 className="text-base font-semibold text-fg">Something went wrong</h1>
        </div>
        <p className="text-sm text-fg-muted mb-3">
          This screen hit an error and couldn't render. Your data is safe - reload to try again,
          or head back and continue.
        </p>
        <pre className="mb-4 max-h-40 overflow-auto rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs text-fg-muted whitespace-pre-wrap break-words">
          {message}
        </pre>
        {import.meta.env.DEV && stack && (
          <details className="mb-4">
            <summary className="cursor-pointer text-xs text-fg-subtle select-none">Stack trace (dev)</summary>
            <pre className="mt-1 max-h-56 overflow-auto rounded-md border border-border bg-surface-sunken px-3 py-2 text-[11px] text-fg-subtle whitespace-pre-wrap break-words">
              {stack}
            </pre>
          </details>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-3 py-1.5 text-sm rounded-md bg-accent-strong text-white hover:opacity-90"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="px-3 py-1.5 text-sm rounded-md border border-border text-fg-muted hover:text-fg hover:bg-surface-hover"
          >
            Back to start
          </button>
        </div>
      </div>
    </div>
  )
}
