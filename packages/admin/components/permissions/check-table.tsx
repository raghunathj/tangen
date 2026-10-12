/**
 * File Name: check-table.tsx
 * Purpose: The benchmark's permission controls (2026-09-08), shared by roles
 *          and API keys: a caption row with a select-all, a row per item
 *          with an icon and a checkbox at the end, and the object-level tree
 *          - every content type as a row that inherits until it is opened
 *          and given its own actions.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useState } from 'react'
import { clsx } from 'clsx'
import { Checkbox } from '@tangen/ui'
import {
  IconEye, IconEdit, IconTrash, IconUpload, IconHistory, IconCheck, IconFileText, IconImage, IconSearch, IconGlobe,
  IconCodeBox, IconUsers, IconPuzzle, IconChevronRight, IconLock,
} from '@tangen/icons'
import { Badge } from '@/components/ui/badge'
import { ActionPill, humanizeAction } from '@/components/api-keys/primitives'

export function actionIcon(action: string) {
  if (action === 'read' || action === 'read_draft' || action === 'submissions') return <IconEye />
  if (action === 'write' || action === 'manage') return <IconEdit />
  if (action === 'delete') return <IconTrash />
  if (action === 'publish' || action === 'push' || action === 'submit') return <IconUpload />
  if (action === 'pull') return <IconHistory />
  if (action === 'enable') return <IconLock />
  return <IconCheck />
}

export function resourceIcon(id: string) {
  if (id === 'objects') return <IconFileText />
  if (id === 'media') return <IconImage />
  if (id === 'search') return <IconSearch />
  if (id === 'globals') return <IconGlobe />
  if (id === 'schema') return <IconCodeBox />
  return <IconPuzzle />
}

export const RESOURCE_HELP: Record<string, string> = {
  objects: 'Every content type, unless an object-level row below says otherwise.',
  media: 'The media library.',
  forms: 'Forms and what people submit through them.',
  search: 'The search index and its settings.',
  globals: 'Site-wide values every page shares.',
  schema: 'The content schema itself.',
  toolbar: 'Performance headers on delivery responses.',
}

/** A caption row with a select-all, then a row per item with a checkbox at the end. */
export function CheckTable({ caption, rows, checked, onToggle, onToggleAll, disabled, columns = 2 }: {
  caption: React.ReactNode
  rows: Array<{ id: string; icon?: React.ReactNode; label: React.ReactNode; description?: React.ReactNode }>
  checked: (id: string) => boolean
  onToggle: (id: string) => void
  onToggleAll: (on: boolean) => void
  disabled?: boolean
  columns?: 2 | 3
}) {
  const on = rows.filter((r) => checked(r.id)).length
  const all = rows.length > 0 && on === rows.length
  const some = on > 0 && !all
  return (
    <div data-testid="check-table">
      <div className="flex h-11 items-center gap-3 border-b border-border-subtle px-4 text-sm text-fg-muted">
        <span className="min-w-0 flex-1 truncate">{caption}</span>
        {columns === 3 && <span className="hidden w-[46%] sm:block">Description</span>}
        <Checkbox aria-label="Select all" checked={all ? true : some ? 'indeterminate' : false} onCheckedChange={(v) => onToggleAll(v === true)} disabled={disabled} />
      </div>
      <ul className="divide-y divide-border-subtle">
        {rows.map((r) => (
          <li key={r.id}>
            <label className={clsx('flex min-h-11 items-center gap-3 px-4 py-1.5 text-sm text-fg transition-colors motion-fast', disabled ? 'cursor-default' : 'cursor-pointer hover:bg-surface-hover')}>
              <span className="flex min-w-0 flex-1 items-center gap-2.5">
                {r.icon && <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent-muted text-accent-fg [&_svg]:size-3.5" aria-hidden>{r.icon}</span>}
                <span className="truncate">{r.label}</span>
              </span>
              {columns === 3 && <span className="hidden w-[46%] truncate text-fg-muted sm:block">{r.description}</span>}
              <Checkbox checked={checked(r.id)} onCheckedChange={() => onToggle(r.id)} disabled={disabled} aria-label={typeof r.label === 'string' ? r.label : r.id} />
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The object-level tree: one content type per row; opened, it takes its own actions in place of the global ones. */
export function ObjectLevelTree({ types, actions, globalActions, overrides, onChange, disabled }: {
  types: Array<{ name: string; label?: string }>
  actions: string[]
  globalActions: string[]
  overrides: Array<{ type: string; actions: string[] }>
  onChange: (next: Array<{ type: string; actions: string[] }>) => void
  disabled?: boolean
}) {
  const [openTypes, setOpenTypes] = useState<Set<string>>(() => new Set(overrides.map((o) => o.type)))
  return (
    <div data-testid="object-level">
      <div className="flex h-11 items-center justify-between gap-3 border-b border-border-subtle px-4 text-sm text-fg-muted">
        <span>Object-level</span>
        <span className="text-xs text-fg-subtle">{overrides.length === 0 ? 'Every type follows the rows above' : `${overrides.length} override${overrides.length === 1 ? '' : 's'}`}</span>
      </div>
      {types.length === 0 ? (
        <p className="px-4 py-3 text-sm text-fg-subtle">No content types yet.</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {types.map((t) => {
            const override = overrides.find((o) => o.type === t.name)
            const open = openTypes.has(t.name)
            const effective = override?.actions ?? globalActions
            return (
              <li key={t.name}>
                <button
                  type="button"
                  onClick={() => setOpenTypes((prev) => { const n = new Set(prev); if (n.has(t.name)) n.delete(t.name); else n.add(t.name); return n })}
                  aria-expanded={open}
                  className="flex min-h-11 w-full items-center gap-3 px-4 py-1.5 text-left text-sm transition-colors motion-fast hover:bg-surface-hover"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-subtle [&_svg]:size-3.5" aria-hidden><IconFileText /></span>
                  <span className="min-w-0 flex-1 truncate font-medium text-fg">{t.label ?? t.name}</span>
                  {override
                    ? <Badge variant="default">{override.actions.length === 0 ? 'No access' : override.actions.map(humanizeAction).join(', ')}</Badge>
                    : <span className="text-xs text-fg-subtle">Inherits</span>}
                  <span className={clsx('text-fg-subtle transition-transform motion-fast [&_svg]:size-4', open && 'rotate-90')} aria-hidden><IconChevronRight /></span>
                </button>
                {open && (
                  <div className="border-t border-border-subtle bg-surface-sunken/60 px-4 py-3">
                    <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
                      <Checkbox
                        checked={!!override}
                        disabled={disabled}
                        onCheckedChange={(on) => onChange(on === true
                          ? [...overrides.filter((o) => o.type !== t.name), { type: t.name, actions: [...globalActions] }]
                          : overrides.filter((o) => o.type !== t.name))}
                      />
                      Set this type's own actions (replaces the rows above for {t.label ?? t.name})
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {actions.map((a) => (
                        <ActionPill
                          key={a}
                          action={humanizeAction(a)}
                          checked={effective.includes(a)}
                          disabled={disabled || !override}
                          onChange={() => onChange(overrides.map((o) => o.type !== t.name ? o : ({ ...o, actions: o.actions.includes(a) ? o.actions.filter((x) => x !== a) : [...o.actions, a] })))}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
