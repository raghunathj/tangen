

import { useEffect, useRef, useState } from 'react'
import { IconPlus, IconSearch } from '@tangen/icons'
import { DynamicIcon } from '@/components/dynamic-icon'
import { clsx } from 'clsx'
import type { ComponentDef } from '@tangen/types'
import { filterComponents } from '@/lib/component-editor'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface BlockPaletteProps {
  components: ComponentDef[]
  onSelect: (def: ComponentDef) => void
}

export function BlockPalette({ components, onSelect }: BlockPaletteProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeGroup, setActiveGroup] = useState<string>('All')
  const inputRef = useRef<HTMLInputElement>(null)

  // Collect unique group names preserving insertion order
  const groups: string[] = ['All']
  for (const c of components) {
    if (c.group && !groups.includes(c.group)) groups.push(c.group)
  }

  const byQuery = filterComponents(components, query)
  const filtered = activeGroup === 'All'
    ? byQuery
    : byQuery.filter(c => c.group === activeGroup)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveGroup('All')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  function pick(def: ComponentDef) {
    onSelect(def)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-accent-fg hover:text-accent-fg border border-dashed border-accent/30 hover:border-accent hover:bg-accent-muted transition-colors w-full justify-center"
      >
        <IconPlus className="size-4" />
        Add New Block
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden" showClose={false}>
          <DialogHeader className="px-5 pt-5 pb-0">
            <DialogTitle className="text-base font-semibold text-fg">Add New Block</DialogTitle>
          </DialogHeader>

          {/* Search */}
          <div className="px-5 pt-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-sunken border border-border focus-within:border-accent focus-within:ring-2 focus-within:ring-indigo-100 transition">
              <IconSearch className="size-4 text-fg-subtle shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery((e.target as HTMLInputElement).value)
                  setActiveGroup('All')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setOpen(false); return }
                  if (e.key === 'Enter' && filtered.length === 1) { pick(filtered[0]); return }
                }}
                placeholder="Search blocks…"
                className="flex-1 min-w-0 bg-transparent text-sm text-fg placeholder:text-fg-subtle outline-none"
              />
            </div>
          </div>

          {/* Group filter tabs */}
          {groups.length > 1 && (
            <div className="px-5 pt-3 flex gap-1.5 flex-wrap">
              {groups.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setActiveGroup(g)}
                  className={clsx(
                    'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                    activeGroup === g
                      ? 'bg-accent-strong text-white'
                      : 'bg-surface-hover text-fg-muted hover:bg-surface-hover',
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
          )}

          {/* Block grid */}
          <div className="px-5 py-4 overflow-y-auto max-h-80">
            {filtered.length === 0 ? (
              <p className="text-sm text-fg-subtle italic text-center py-8">No blocks match</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {filtered.map((def) => (
                  <button
                    key={def.name}
                    type="button"
                    onClick={() => pick(def)}
                    className="text-left px-3 py-3 rounded-lg border border-border bg-surface hover:border-accent hover:bg-accent-muted hover:shadow-sm transition-all group"
                  >
                    <div className="flex items-center gap-1.5">
                      {def.icon && <DynamicIcon name={def.icon as never} className="size-4 shrink-0 text-fg-subtle group-hover:text-accent-fg" />}
                      <p className="text-sm font-medium text-fg group-hover:text-accent-fg leading-tight">
                        {def.label}
                      </p>
                    </div>
                    {def.group && (
                      <p className="mt-0.5 text-[10px] text-fg-subtle font-medium uppercase tracking-wide">
                        {def.group}
                      </p>
                    )}
                    {def.description && (
                      <p className="mt-1 text-xs text-fg-muted leading-snug line-clamp-2">
                        {def.description}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
