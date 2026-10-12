/**
 * File Name: field-palette.tsx
 * Purpose: "Add field": a popover with the field types grouped and
 *          searchable. One click adds the field and closes.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useState } from 'react'
import { IconPlus, IconSearch } from '@tangen/icons'
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '@/kit'
import type { FormFieldType } from '../../contract'
import { FIELD_GROUPS, FIELD_TYPE_CONFIGS } from '../field-types'

export function FieldPalette({ onAdd, disabled }: { onAdd: (type: FormFieldType) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const matches = (label: string, type: string) => !q || label.toLowerCase().includes(q) || type.includes(q)
  const any = FIELD_TYPE_CONFIGS.some((c) => matches(c.label, c.type))
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery('') }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="secondary" icon={<IconPlus className="size-3.5" />} disabled={disabled} className="w-full justify-center" data-testid="add-field">
          Add field
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-border-subtle p-2">
          <Input autoFocus value={query} onChange={(e) => setQuery(e.currentTarget.value)} placeholder="Search field types" icon={<IconSearch className="size-3.5" />} aria-label="Search field types" />
        </div>
        <div className="max-h-80 overflow-y-auto py-1.5">
          {FIELD_GROUPS.map((group) => {
            const items = FIELD_TYPE_CONFIGS.filter((c) => c.group === group && matches(c.label, c.type))
            if (items.length === 0) return null
            return (
              <div key={group}>
                <p className="px-3 pb-1 pt-2 text-ui-2xs font-semibold uppercase tracking-wider text-fg-subtle">{group}</p>
                {items.map((item) => (
                  <Button
                    key={item.type}
                    variant="ghost"
                    size="sm"
                    icon={<item.icon className="size-4 text-fg-muted" />}
                    className="w-full justify-start rounded-none px-3 font-normal"
                    onClick={() => { onAdd(item.type); setOpen(false) }}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            )
          })}
          {!any && <p className="px-3 py-6 text-center text-ui-xs text-fg-subtle">No field type matches.</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}
