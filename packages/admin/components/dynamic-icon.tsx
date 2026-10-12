/**
 * File Name: dynamic-icon.tsx
 * Purpose: Resolve an `IconRef` (a @tangen/icons name, as carried in nav metadata,
 *          or a custom `{ src }` image) to something renderable: a known name maps
 *          to its icon component, a `{ src }` object renders as an <img>, and an
 *          unknown name falls back to a document icon. Shared by the sidebar and
 *          the command palette so both resolve icons identically.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The curated @tangen/icons set (self-contained, ~46KB)
 *          resolves statically - every config-facing IconName renders with no
 *          flash. Raw Ri* names (the documented escape hatch) resolve from
 *          '@tangen/icons/all', which loads the full 2.3MB remixicon pack
 *          LAZILY on first exotic name; a size-reserving placeholder renders
 *          until that chunk lands.
 */
import { useSyncExternalStore } from 'react'
import * as Curated from '@tangen/icons'
import { IconFileText } from '@tangen/icons'

type IconComp = React.ComponentType<{ className?: string }>

let pack: Record<string, IconComp> | null = null
let loading: Promise<void> | null = null
const subs = new Set<() => void>()

/** Kick off (or await) the full-pack chunk (raw Ri* names). Idempotent. */
export function preloadIcons(): Promise<void> {
  if (pack) return Promise.resolve()
  if (!loading) {
    loading = import('@tangen/icons/all')
      .then((m) => {
        pack = m as unknown as Record<string, IconComp>
        for (const s of subs) s()
      })
      .catch(() => { loading = null })
  }
  return loading
}

function subscribe(cb: () => void): () => void {
  subs.add(cb)
  return () => { subs.delete(cb) }
}

// Unknown names silently falling back to the document icon made typos hard to
// spot - in dev, say so once per name. (Vite statically replaces
// import.meta.env.DEV in builds; bun aliases import.meta.env to process.env.)
const warnedNames = new Set<string>()

function warnUnknownIcon(name: string): void {
  if (!import.meta.env.DEV) return
  if (warnedNames.has(name)) return
  warnedNames.add(name)
  console.warn(
    `[DynamicIcon] Unknown icon name "${name}" - rendering the IconFileText fallback. ` +
    `Use a @tangen/icons name (e.g. IconSparkles) or a raw Ri* remixicon name.`,
  )
}

/** Render prop is permissive (any string, or a `{ src }` image); config fields
 *  are the strict `IconRef` that type-checks the name. */
export function DynamicIcon({ name, className }: { name?: string | { src: string }; className?: string }) {
  const p = useSyncExternalStore(subscribe, () => pack, () => pack)
  if (name && typeof name === 'object') return <img src={name.src} alt="" className={className} />
  if (!name) return <IconFileText className={className} />
  const CuratedIcon = (Curated as unknown as Record<string, IconComp>)[name]
  if (CuratedIcon) return <CuratedIcon className={className} />
  if (!p) {
    void preloadIcons()
    // Reserve the icon's box so nothing shifts when the full pack lands.
    return <span className={className} aria-hidden="true" />
  }
  const Icon = p[name]
  if (!Icon) {
    warnUnknownIcon(name)
    return <IconFileText className={className} />
  }
  return <Icon className={className} />
}
