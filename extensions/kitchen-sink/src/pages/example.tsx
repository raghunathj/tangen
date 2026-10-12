import { useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { IconCode, IconCopy, IconCheck } from '@tangen/icons'

/** Breadcrumb trail for a sink sub-page: Kitchen Sink (link) → current. */
export function useSinkCrumbs(current: string) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  return [
    { label: 'Kitchen Sink', href: `/${workspaceId}/extensions/kitchen-sink` },
    { label: current },
  ]
}

/**
 * The showcase building block: renders a live preview with a code-mode
 * toggle — the </> icon reveals the exact source to copy. Every example in
 * the Kitchen Sink pages goes through this so "what you see" and "what you
 * paste" never drift.
 */
export function Example({ title, description, code, children }: {
  title: string
  description?: string
  code: string
  children: ReactNode
}) {
  const [showCode, setShowCode] = useState(false)
  const [copied, setCopied] = useState(false)

  return (
    <section className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
        <div>
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-fg-subtle">{description}</p>}
        </div>
        <button
          type="button"
          onClick={() => setShowCode((v) => !v)}
          title={showCode ? 'Hide code' : 'Show code'}
          className={`shrink-0 p-1.5 rounded-md transition-colors ${showCode ? 'bg-accent-muted text-accent-fg' : 'text-fg-subtle hover:text-fg-muted hover:bg-surface-hover'}`}
        >
          <IconCode className="size-4" />
        </button>
      </div>

      <div className="p-4">{children}</div>

      {showCode && (
        <div className="relative border-t border-border bg-surface-inverted overflow-x-auto">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(code.trim()).catch(() => {})
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="absolute top-2 right-2 p-1 rounded text-fg-subtle hover:text-white transition-colors"
            title="Copy"
          >
            {copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
          </button>
          <pre className="p-4 pr-10 text-xs leading-relaxed text-surface whitespace-pre">{code.trim()}</pre>
        </div>
      )}
    </section>
  )
}

/** Page scaffold shared by every category page — consistent width + spacing. */
export function ExampleStack({ children }: { children: ReactNode }) {
  return <div className="max-w-3xl space-y-6 pb-16">{children}</div>
}
