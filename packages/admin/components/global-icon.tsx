/**
 * File Name: global-icon.tsx
 * Purpose: The glyph beside a global's name, with a fallback. A global's
 *          `icon` is optional, and the globals list renders its icon box
 *          unconditionally, so an undeclared icon used to show as an EMPTY
 *          grey square - one per global, which told a reader nothing and
 *          looked like a failed image.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `DynamicIcon` already falls back for an UNKNOWN name
 *          (it renders a document icon); the gap was an ABSENT one. The
 *          fallback is `IconGlobe`, which is what the Globals empty state
 *          already uses, so the section has one glyph for "a global" whether
 *          or not a project names its own.
 */
import { IconGlobe } from '@tangen/icons'
import { DynamicIcon } from '@/components/dynamic-icon'

export function GlobalIcon({ name, className }: { name?: string | { src: string }; className?: string }) {
  if (!name) return <IconGlobe className={className} />
  return <DynamicIcon name={name} className={className} />
}
