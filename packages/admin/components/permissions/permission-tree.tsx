/**
 * File Name: permission-tree.tsx
 * Purpose: The shared permission tree (tasks/plan-permissions-tree.md P1) -
 *   sections of groups, each group a tri-state parent over action children,
 *   resource sub-groups nested, per-group X/Y counts, search, and a locked row
 *   state ("from role"). Roles editor and the member access page both render
 *   this against a catalog-derived `sections` plus a granted/locked set.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useMemo, useState } from 'react'
import { IconSearch, IconChevronRight, IconLock } from '@tangen/icons'
import { Checkbox, Input } from '@/kit'
import { DynamicIcon } from '@/components/dynamic-icon'
import {
  leavesOf, triStateOf, toggleableLeafIds, isLeaf,
  type PermItem, type PermLeaf, type PermNode, type PermSection,
} from '@/lib/permission-tree'

const ACTION_ICON: Record<string, string> = {
  read: 'IconEye', write: 'IconEdit', delete: 'IconTrash', manage: 'IconSettings',
  open: 'IconLayoutGrid', export: 'IconDownload', publish: 'IconCheck', run: 'IconPlayerPlay',
}
const actionTint: Record<string, string> = {
  read: 'bg-accent-muted text-accent-fg', write: 'bg-success-muted text-success-fg',
  delete: 'bg-danger-muted text-danger-fg', manage: 'bg-accent-muted text-accent-fg',
}

export interface PermissionTreeProps {
  sections: PermSection[]
  granted: ReadonlySet<string>
  locked?: ReadonlySet<string>
  /** Toggle the given leaf ids on/off. Omit to render read-only. */
  onToggle?: (leafIds: string[], on: boolean) => void
  /** Marks granted-but-not-locked leaves with a "granted" chip (member view). */
  markGrants?: boolean
}

export function PermissionTree({ sections, granted, locked, onToggle, markGrants }: PermissionTreeProps) {
  const [q, setQ] = useState('')
  const lock = locked ?? EMPTY
  const readOnly = !onToggle
  const needle = q.trim().toLowerCase()

  const filtered = useMemo(() => sections.map((s) => ({
    ...s,
    groups: s.groups.map((g) => filterNode(g, needle)).filter(Boolean) as PermNode[],
  })).filter((s) => s.groups.length), [sections, needle])

  return (
    <div className="space-y-4">
      <Input value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder="Search permissions…"
        aria-label="Search permissions" icon={<IconSearch className="size-3.5" />} />
      {filtered.map((section) => (
        <div key={section.title} className="space-y-2">
          <div className="px-1 text-ui-2xs font-bold uppercase tracking-wider text-fg-subtle">{section.title}</div>
          <div className="space-y-2.5">
            {section.groups.map((g) => (
              <Group key={g.id} node={g} granted={granted} locked={lock} onToggle={onToggle} readOnly={readOnly} markGrants={markGrants} defaultOpen={!!needle} />
            ))}
          </div>
        </div>
      ))}
      {filtered.length === 0 && <p className="py-8 text-center text-sm text-fg-subtle">No permissions match “{q}”.</p>}
    </div>
  )
}

const EMPTY = new Set<string>()

function TriCheckbox({ node, granted, locked, onToggle, readOnly, label }: {
  node: PermItem; granted: ReadonlySet<string>; locked: ReadonlySet<string>
  onToggle?: (ids: string[], on: boolean) => void; readOnly: boolean; label: string
}) {
  const tri = triStateOf(node, granted)
  const toggleable = toggleableLeafIds(node, locked)
  const disabled = readOnly || toggleable.length === 0
  return (
    <Checkbox aria-label={'All ' + label} disabled={disabled}
      checked={tri === 'all' ? true : tri === 'some' ? 'indeterminate' : false}
      onCheckedChange={() => onToggle?.(toggleable, tri !== 'all')} />
  )
}

function Group({ node, granted, locked, onToggle, readOnly, markGrants, defaultOpen }: {
  node: PermNode; granted: ReadonlySet<string>; locked: ReadonlySet<string>
  onToggle?: (ids: string[], on: boolean) => void; readOnly: boolean; markGrants?: boolean; defaultOpen: boolean
}) {
  const leaves = leavesOf(node)
  const on = leaves.filter((l) => granted.has(l.id)).length
  const [open, setOpen] = useState(defaultOpen || (on > 0 && on < leaves.length))
  const cnt = on === leaves.length ? 'text-success-fg' : on > 0 ? 'text-accent-fg bg-accent-muted' : ''
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-raised shadow-xs">
      <div role="button" tabIndex={0} aria-expanded={open}
        onClick={() => setOpen((v) => !v)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v) } }}
        className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left hover:bg-surface-hover">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-fg-muted">
          {node.icon ? <DynamicIcon name={node.icon} className="size-4" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-fg">{node.label}</span>
          {node.desc && <span className="block truncate text-ui-xs text-fg-subtle">{node.desc}</span>}
        </span>
        <span className={'shrink-0 rounded-md px-1.5 py-0.5 font-mono text-ui-xs tabular-nums text-fg-subtle ' + cnt}>{on}/{leaves.length}</span>
        <span onClick={(e) => e.stopPropagation()} className="shrink-0">
          <TriCheckbox node={node} granted={granted} locked={locked} onToggle={onToggle} readOnly={readOnly} label={node.label} />
        </span>
        <IconChevronRight className={'size-4 shrink-0 text-fg-faint transition-transform ' + (open ? 'rotate-90' : '')} />
      </div>
      {open && (
        <div className="border-t border-border bg-surface-sunken/40 px-2 pb-2 pt-1">
          {node.children.map((c) => isLeaf(c)
            ? <Leaf key={c.id} leaf={c} granted={granted} locked={locked} onToggle={onToggle} readOnly={readOnly} markGrants={markGrants} indent={false} />
            : <SubGroup key={c.id} node={c} granted={granted} locked={locked} onToggle={onToggle} readOnly={readOnly} markGrants={markGrants} />)}
        </div>
      )}
    </div>
  )
}

function SubGroup({ node, granted, locked, onToggle, readOnly, markGrants }: {
  node: PermNode; granted: ReadonlySet<string>; locked: ReadonlySet<string>
  onToggle?: (ids: string[], on: boolean) => void; readOnly: boolean; markGrants?: boolean
}) {
  const leaves = leavesOf(node)
  const on = leaves.filter((l) => granted.has(l.id)).length
  return (
    <div className="mt-1">
      <div className="flex items-center gap-2.5 border-t border-dashed border-border px-2 pb-1.5 pt-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-subtle"><DynamicIcon name="IconFolder" className="size-3.5" /></span>
        <span className="flex-1 text-ui-sm font-semibold text-fg">{node.label}<span className="ml-2 font-mono text-ui-2xs uppercase tracking-wide text-fg-faint">resource</span></span>
        <span className="shrink-0 font-mono text-ui-xs tabular-nums text-fg-subtle">{on}/{leaves.length}</span>
        <TriCheckbox node={node} granted={granted} locked={locked} onToggle={onToggle} readOnly={readOnly} label={node.label} />
      </div>
      {node.children.map((c) => isLeaf(c)
        ? <Leaf key={c.id} leaf={c} granted={granted} locked={locked} onToggle={onToggle} readOnly={readOnly} markGrants={markGrants} indent />
        : null)}
    </div>
  )
}

function Leaf({ leaf, granted, locked, onToggle, readOnly, markGrants, indent }: {
  leaf: PermLeaf; granted: ReadonlySet<string>; locked: ReadonlySet<string>
  onToggle?: (ids: string[], on: boolean) => void; readOnly: boolean; markGrants?: boolean; indent: boolean
}) {
  const isLocked = locked.has(leaf.id)
  const on = granted.has(leaf.id)
  const tint = actionTint[leaf.action] ?? 'bg-surface-sunken text-fg-muted'
  return (
    <div className={'flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-hover ' + (indent ? 'ml-6' : '')}>
      <span className={'flex size-6 shrink-0 items-center justify-center rounded-md ' + tint}>
        <DynamicIcon name={ACTION_ICON[leaf.action] ?? 'IconCheckbox'} className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 text-sm text-fg">{leaf.label}
        {leaf.slug && <span className="ml-2 font-mono text-ui-2xs text-fg-faint">{leaf.slug}</span>}
        {leaf.sensitive && <span className="ml-2 rounded px-1 py-0.5 text-ui-2xs font-semibold uppercase text-warning-fg">sensitive</span>}
      </span>
      {isLocked
        ? <span className="flex shrink-0 items-center gap-1 rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-ui-2xs font-semibold uppercase tracking-wide text-fg-subtle"><IconLock className="size-3" /> from role</span>
        : (markGrants && on) ? <span className="shrink-0 rounded bg-accent-muted px-1.5 py-0.5 text-ui-2xs font-semibold uppercase tracking-wide text-accent-fg">granted</span> : null}
      <Checkbox aria-label={leaf.label} disabled={readOnly || isLocked} checked={on || isLocked}
        onCheckedChange={() => onToggle?.([leaf.id], !on)} />
    </div>
  )
}

// ── search filter (keeps a group when a descendant matches) ──────────────────
function filterNode(node: PermNode, needle: string): PermNode | null {
  if (!needle) return node
  const kids = node.children.map((c) => isLeaf(c)
    ? (matches(c, needle) ? c : null)
    : filterNode(c, needle)).filter(Boolean) as PermItem[]
  if (kids.length || node.label.toLowerCase().includes(needle)) return { ...node, children: kids.length ? kids : node.children }
  return null
}
function matches(l: PermLeaf, needle: string): boolean {
  return (l.label + ' ' + (l.slug ?? '')).toLowerCase().includes(needle)
}
