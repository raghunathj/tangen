/**
 * File Name: add-field-modal.tsx
 * Purpose: The schema builder's "Add a field" modal — a searchable, grouped grid
 *   of field types (icon + label + description). Replaces the old add-field
 *   dropdown, which overflowed the viewport as the type list grew. Picking a type
 *   hands it back to the canvas, which appends a field to the target stage.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useMemo, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { IconSearch } from '@tangen/icons'
import { Button, Input } from '@/kit'
import { FIELD_TYPES, FIELD_TYPE_GROUPS } from './field-types'
import { NamedIcon } from './icon-picker'
import { filterInstalledFieldTypes } from './installed-field-types'
import { useInstalledFieldTypes } from '@/lib/use-installed-field-types'

export function AddFieldModal({ open, onOpenChange, onPick, title = 'Add a field', excludeTypes }: {
  /** Hide these field types (e.g. containers at the GUI nesting cap). */
  excludeTypes?: ReadonlySet<string>
  open: boolean
  onOpenChange: (o: boolean) => void
  onPick: (fieldType: string) => void
  title?: string
}) {
  const [q, setQ] = useState('')
  const installed = useInstalledFieldTypes(open)
  const customMatches = useMemo(() => filterInstalledFieldTypes(installed, q), [installed, q])

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const match = (f: (typeof FIELD_TYPES)[number]) =>
      (!excludeTypes || !excludeTypes.has(f.type))
      && (!needle || f.label.toLowerCase().includes(needle) || f.type.includes(needle) || f.description.toLowerCase().includes(needle))
    return FIELD_TYPE_GROUPS
      .map((g) => ({ group: g, items: FIELD_TYPES.filter((f) => f.group === g && match(f)) }))
      .filter((s) => s.items.length > 0)
  }, [q, excludeTypes])

  function pick(type: string) {
    onPick(type)
    setQ('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setQ(''); onOpenChange(o) }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Choose a field type to add. You can rename and configure it next.</DialogDescription>
        </DialogHeader>

        <div className="px-6 pt-4">
          <Input autoFocus value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder="Search field types…" icon={<IconSearch className="size-3.5" />} aria-label="Search field types" />
        </div>

        <div className="px-6 py-4 max-h-[26rem] overflow-y-auto space-y-5">
          {groups.length === 0 && customMatches.length === 0 && (
            <div className="text-sm text-fg-subtle text-center py-8">No field types match “{q}”.</div>
          )}
          {groups.map(({ group, items }) => (
            <div key={group}>
              <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wide mb-2">{group}</div>
              <div className="grid grid-cols-2 gap-2">
                {items.map(({ type, label, description, Icon }) => (
                  <Button key={type} variant="secondary" onClick={() => pick(type)} className="h-auto w-full items-start justify-start gap-3 whitespace-normal px-3 py-2.5 text-left font-normal hover:border-accent">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ui-sm text-fg">{label}</span>
                      <span className="block break-words text-ui-xs leading-snug text-fg-muted">{description}</span>
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          ))}

          {customMatches.length > 0 && (
            <div>
              <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wide mb-2">From Extensions</div>
              <div className="grid grid-cols-2 gap-2">
                {customMatches.map((ft) => (
                  <Button key={ft.name} variant="secondary" onClick={() => pick(ft.name)} className="h-auto w-full items-start justify-start gap-3 whitespace-normal px-3 py-2.5 text-left font-normal hover:border-accent">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted">
                      <NamedIcon name={ft.icon} className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm text-fg">{ft.label}</span>
                      <span className="block break-words text-ui-xs leading-snug text-fg-muted">
                        {ft.description ?? (ft.extensionName ? `From ${ft.extensionName}` : ft.name)}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
