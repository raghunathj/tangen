/**
 * File Name: code-block.tsx
 * Purpose: <CodeBlock> — dark code panel with a copy button. The canonical
 *          way to show copyable snippets in admin screens (the kitchen-sink
 *          Example component composes it).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Part of the stable @/kit surface.
 */
import { useState } from 'react'
import { IconCopy, IconCheck } from '@tangen/icons'
import { cx } from '@tangen/ui'
import { copyToClipboard } from '@/lib/clipboard'

export interface CodeBlockProps {
  code: string
  /** Hide the copy button (e.g. for output samples). */
  copyable?: boolean
  className?: string
}

export function CodeBlock({ code, copyable = true, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={cx('relative rounded-md bg-surface-inverted', className)}>
      {copyable && (
        <button
          type="button"
          onClick={() => {
            void copyToClipboard(code.trim())
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="absolute top-2 right-2 z-10 rounded bg-surface-inverted p-1 text-surface/60 hover:text-surface transition-colors"
          title="Copy"
          aria-label="Copy"
        >
          {copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
        </button>
      )}
      <div className="overflow-x-auto">
        <pre className={cx('p-4 text-xs leading-relaxed text-surface whitespace-pre', copyable && 'pr-10')}>
          {code.trim()}
        </pre>
      </div>
    </div>
  )
}
