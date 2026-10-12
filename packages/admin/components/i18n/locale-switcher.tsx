/**
 * File Name: locale-switcher.tsx
 * Purpose: The single, shared ambient-locale selector used everywhere a locale
 *          switch appears — the TopBar (workspace-wide), the globals editor, and
 *          any surface that edits localized fields against the ambient locale.
 *          One look everywhere: the translate-2 icon + a dropdown sized like the
 *          Save button. Reads/writes the shared useLocaleStore.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Renders nothing when localization is disabled or a single
 *          locale is configured, so callers can drop it in unconditionally.
 */
import { clsx } from 'clsx'
import { IconLanguage } from '@tangen/icons'
import { useLocaleStore } from '@/lib/locale'

export function LocaleSwitcher({
  label,
  className,
}: {
  /** Optional prefix (e.g. "Editing" in the globals footer). Omitted in the TopBar. */
  label?: string
  className?: string
}) {
  const enabled = useLocaleStore((st) => st.enabled)
  const locales = useLocaleStore((st) => st.locales)
  const defaultLocale = useLocaleStore((st) => st.defaultLocale)
  const activeLocale = useLocaleStore((st) => st.activeLocale)

  // Nothing to switch between → render nothing.
  if (!enabled || locales.length < 2) return null

  return (
    <div className={clsx('inline-flex items-center gap-1.5', className)}>
      <IconLanguage className="size-4 text-fg-subtle shrink-0" aria-hidden />
      {label && <span className="text-[11px] text-fg-subtle">{label}</span>}
      <select
        value={activeLocale ?? ''}
        onChange={(e) =>
          useLocaleStore.getState().setLocale((e.target as HTMLSelectElement).value || null)
        }
        aria-label="Editing language"
        title="Changed values save to this language"
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-fg-muted cursor-pointer focus:outline-none focus:border-accent focus:ring-1 focus:ring-indigo-200"
      >
        {locales.map((l) => (
          <option key={l.code} value={l.code === defaultLocale ? '' : l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </div>
  )
}
