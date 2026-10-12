/**
 * File Name: locale-menu.tsx
 * Purpose: The language control - an icon that opens a chooser.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A bare <select> spent bar width proportional to the
 *          longest language name, for a control most sessions never touch.
 *          The icon carries the state instead: tinted while translating, so
 *          "you are not looking at the source language" stays visible without
 *          a word of chrome.
 */
import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { IconGlobe } from '@tangen/icons'

interface LocaleMenuProps {
  locales: Array<{ code: string; label: string }>
  active: string
  defaultLocale: string
  onPick: (code: string | null) => void
}

export function LocaleMenu({ locales, active, defaultLocale, onPick }: LocaleMenuProps) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const translating = active !== defaultLocale

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = locales.find((l) => l.code === active)

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={translating ? `Viewing ${current?.label ?? active}` : 'Language'}
        className={clsx(
          'flex items-center gap-1 h-7 px-1.5 rounded-md transition-colors duration-(--tg-motion-fast)',
          translating
            ? 'text-warning bg-warning-muted'
            : 'text-fg-subtle hover:text-fg hover:bg-surface-hover',
        )}
      >
        <IconGlobe className="size-4" />
        {/* The code only while translating - the state that matters, in the
            fewest characters that can carry it. */}
        {translating && <span className="text-[10px] font-medium uppercase">{active}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-md border border-border bg-surface-raised shadow-lg py-1">
          {locales.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => { setOpen(false); onPick(l.code === defaultLocale ? null : l.code) }}
              className={clsx(
                'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs',
                l.code === active ? 'bg-accent-muted text-accent-fg' : 'text-fg hover:bg-surface-hover',
              )}
            >
              <span className="flex-1 min-w-0 truncate">{l.label}</span>
              <span className="text-[10px] uppercase text-fg-subtle">{l.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
