/**
 * File Name: icon-picker.tsx
 * Purpose: A small searchable icon picker over the FULL Remix icon set (any
 *   pick renders everywhere via DynamicIcon's lazy fallback). Used by the
 *   schema builder's new-type modal.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The full pack (~3200 icons, 2.3MB) loads on demand via
 *   '@tangen/icons/all' - this is a dev-only surface behind a lazy route, and
 *   a static namespace import here would drag the pack into eager bundles.
 */
import { useEffect, useState } from 'react'
import * as Curated from '@tangen/icons'
import { clsx } from 'clsx'
import { Button, Input } from '@/kit'
import { IconSearch } from '@tangen/icons'

type Pack = Record<string, React.ComponentType<{ className?: string }>>

let fullPack: Pack | null = null

/** The full Remix set, loaded lazily; null until the chunk lands. */
function useFullPack(): Pack | null {
  const [pack, setPack] = useState<Pack | null>(fullPack)
  useEffect(() => {
    if (pack) return
    let alive = true
    import('@tangen/icons/all')
      .then((m) => { fullPack = m as unknown as Pack; if (alive) setPack(fullPack) })
      .catch(() => { /* picker degrades to curated names */ })
    return () => { alive = false }
  }, [pack])
  return pack
}

/** Render a named icon, or nothing if the name is unknown. */
export function NamedIcon({ name, className }: { name?: string; className?: string }) {
  const pack = useFullPack()
  const Ico = name ? ((Curated as unknown as Pack)[name] ?? pack?.[name]) : null
  return Ico ? <Ico className={className} /> : null
}

export function IconPicker({ value, onChange }: { value?: string; onChange: (name: string) => void }) {
  const [q, setQ] = useState('')
  const pack = useFullPack()
  const all = pack
    ? Object.keys(pack).filter((k) => k.startsWith('Ri') && typeof pack[k] === 'function').sort()
    : []
  const filtered = (q ? all.filter((n) => n.toLowerCase().includes(q.toLowerCase())) : all).slice(0, 96)
  return (
    <div>
      <div className="mb-2">
        <Input value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder="Search icons…" icon={<IconSearch className="size-3.5" />} aria-label="Search icons" />
      </div>
      <div className="grid grid-cols-8 gap-1 max-h-44 overflow-y-auto p-1 rounded-md border border-border bg-surface-sunken/40">
        {!pack && <p className="col-span-8 text-xs text-fg-subtle p-2">Loading icons…</p>}
        {filtered.map((name) => {
          const Ico = pack?.[name]
          if (!Ico) return null
          return (
            <Button key={name} size="xs" variant="ghost" title={name} aria-label={name} onClick={() => onChange(name)}
              className={clsx('aspect-square size-auto p-0', value === name && 'bg-surface ring-2 ring-accent')}
              icon={<Ico className="size-4 text-fg-muted" />} />
          )
        })}
      </div>
    </div>
  )
}
