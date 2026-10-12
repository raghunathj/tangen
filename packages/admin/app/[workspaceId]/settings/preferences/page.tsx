/**
 * File Name: page.tsx (settings/preferences)
 * Purpose: How the Admin looks on this device: the appearance as three
 *          preview tiles (the benchmark's Experience page, 2026-09-08) and
 *          the scrollbars as a card of choice rows. Both stay per-device
 *          (localStorage), never per member.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { clsx } from 'clsx'
import { IconCheck, IconEye, IconLayoutLeft } from '@tangen/icons'
import { RadioGroup, RadioGroupItem } from '@tangen/ui'
import { usePageHeader } from '@/lib/page-header'
import { SettingsSection } from '@/components/settings/settings-section'
import { useTheme, THEME_MODES, THEME_LABELS, type ThemeMode } from '@/lib/theme'
import { useScrollbars, type ScrollbarMode } from '@/lib/scrollbars'

/** A miniature of the Admin in one theme: a sidebar strip and a page with "Aa". */
function ThemePreview({ mode }: { mode: 'light' | 'dark' }) {
  const dark = mode === 'dark'
  return (
    <div className={clsx('flex h-full w-full', dark ? 'bg-[#1c1c1e]' : 'bg-[#f1f1f3]')} aria-hidden>
      <div className="w-[12%]" />
      <div className={clsx('my-4 mr-0 flex-1 rounded-l-lg border-l border-t border-b px-4 pt-3 text-2xl font-medium', dark ? 'border-[#3a3a3c] bg-[#2c2c2e] text-white' : 'border-[#e2e2e6] bg-white text-[#1c1c1e]')}>Aa</div>
    </div>
  )
}

function ThemeTile({ mode, current, onPick }: { mode: ThemeMode; current: ThemeMode; onPick: (m: ThemeMode) => void }) {
  const selected = current === mode
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onPick(mode)}
      className={clsx(
        'group flex flex-col gap-2 text-left outline-none',
        'focus-visible:[&>span:first-child]:outline-2 focus-visible:[&>span:first-child]:outline-offset-2 focus-visible:[&>span:first-child]:outline-focus',
      )}
    >
      <span className={clsx('relative block h-28 w-full overflow-hidden rounded-xl border transition-colors motion-fast', selected ? 'border-accent ring-2 ring-accent/30' : 'border-border hover:border-border-strong')}>
        {mode === 'system'
          ? <span className="flex h-full w-full"><span className="h-full w-1/2"><ThemePreview mode="light" /></span><span className="h-full w-1/2"><ThemePreview mode="dark" /></span></span>
          : <ThemePreview mode={mode} />}
        {selected && (
          <span className="absolute bottom-2 right-2 flex size-5 items-center justify-center rounded-full bg-accent text-accent-contrast" aria-hidden><IconCheck className="size-3" /></span>
        )}
      </span>
      <span className="text-sm text-fg-muted group-aria-checked:text-fg">{mode === 'system' ? 'System settings' : THEME_LABELS[mode]}</span>
    </button>
  )
}

const SCROLLBAR_CHOICES: Array<{ id: ScrollbarMode; icon: React.ReactNode; label: string; help: string }> = [
  { id: 'hidden', icon: <IconLayoutLeft />, label: 'Hidden until you scroll', help: 'Scrollbars appear while you scroll and fade away after.' },
  { id: 'classic', icon: <IconEye />, label: 'Classic scrollbars', help: 'Always visible, the way the operating system draws them.' },
]

export default function PreferencesPage() {
  usePageHeader({ description: 'How the Admin looks on this device. Saved in this browser only.' })
  const themeMode = useTheme((t) => t.mode)
  const setThemeMode = useTheme((t) => t.setMode)
  const scrollbars = useScrollbars((s) => s.mode)
  const setScrollbars = useScrollbars((s) => s.setMode)

  return (
    <div className="space-y-10">
      <SettingsSection title="Appearance" plain>
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {THEME_MODES.map((m) => <ThemeTile key={m} mode={m} current={themeMode} onPick={setThemeMode} />)}
        </div>
      </SettingsSection>

      <SettingsSection title="Scrollbars" description="Choose how the lists and the editor show their scrollbars." plain>
        <RadioGroup value={scrollbars} onValueChange={(v) => setScrollbars(v as ScrollbarMode)} aria-label="Scrollbars" className="gap-0 overflow-hidden rounded-xl border border-border-subtle bg-card">
          {SCROLLBAR_CHOICES.map((c, i) => (
            <label key={c.id} htmlFor={`scrollbars-${c.id}`} className={clsx('flex cursor-pointer items-center gap-4 px-4 py-3.5 transition-colors motion-fast hover:bg-surface-hover', i > 0 && 'border-t border-border-subtle')}>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-sunken text-accent-fg [&_svg]:size-5" aria-hidden>{c.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">{c.label}</span>
                <span className="block text-xs text-fg-subtle">{c.help}</span>
              </span>
              <RadioGroupItem id={`scrollbars-${c.id}`} value={c.id} />
            </label>
          ))}
        </RadioGroup>
      </SettingsSection>
    </div>
  )
}
