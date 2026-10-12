/**
 * File Name: locales.ts
 * Purpose: The working locales of the workspace as the Forms admin needs
 *          them (the non-default ones, their codes), and one stable tone per
 *          locale so a translation row reads as that language everywhere.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useLocaleStore } from '@/kit'

export interface WorkingLocale { code: string; label: string }

export function useWorkingLocales(): { enabled: boolean; locales: WorkingLocale[]; codes: string[]; defaultLocale: string } {
  const enabled = useLocaleStore((s) => s.enabled)
  const all = useLocaleStore((s) => s.locales)
  const defaultLocale = useLocaleStore((s) => s.defaultLocale)
  const locales = enabled ? all.filter((l) => l.code !== defaultLocale) : []
  return { enabled: enabled && locales.length > 0, locales, codes: all.map((l) => l.code), defaultLocale }
}

const TONES = [
  { dot: 'bg-accent', rail: 'border-l-accent' },
  { dot: 'bg-success', rail: 'border-l-success' },
  { dot: 'bg-warning', rail: 'border-l-warning' },
  { dot: 'bg-info', rail: 'border-l-info' },
  { dot: 'bg-danger', rail: 'border-l-danger' },
]

/** The tone a locale wears, stable for the workspace's locale order. */
export function localeTone(code: string, codes: string[]): { dot: string; rail: string } {
  const i = Math.max(0, codes.indexOf(code))
  return TONES[i % TONES.length]!
}
