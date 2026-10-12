/**
 * File Name: label-input.tsx
 * Purpose: The Labels editor of any record: the labels it carries as chips,
 *          and one input that offers the workspace's existing labels of the
 *          same kind to choose from, or creates the one typed. Self-contained:
 *          talks to the labels API directly (GET/PUT + /labels/suggest). The
 *          content editor, the media library and the forms submissions share it.
 *
 * Author: Raghunath J
 * License: MIT
 */

import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Checkbox, Input, Label } from '@tangen/ui'
import { IconInfo, IconPlus, IconX } from '@tangen/icons'
import { AnchoredDropdown } from '@/components/ui/anchored-dropdown'
import { adminFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { clsx } from 'clsx'

const MAX_SUGGESTIONS = 8

export function LabelInput({ entityType, entityId, canWrite = true, title = 'Labels' }: {
  /** Full namespaced entity type: 'content:<type>' | 'member' | 'submission' | 'media'. */
  entityType: string
  entityId: string
  canWrite?: boolean
  /** Section title rendered above the chips (the component owns its header). */
  title?: string
}) {
  const [labels, setLabels] = useState<string[]>([])
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [highlight, setHighlight] = useState(0)
  const [busy, setBusy] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const qs = `entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`

  useEffect(() => {
    let alive = true
    adminFetch<{ data: { labels: string[] } }>(`/entity-labels?${qs}`)
      .then((r) => { if (alive) setLabels(r.data?.labels ?? []) })
      .catch(() => {})
    return () => { alive = false }
  }, [entityType, entityId])

  // Persist the full set (PUT replace): simple and idempotent.
  async function persist(next: string[]) {
    const prev = labels
    setLabels(next)
    setBusy(true)
    try {
      const r = await adminFetch<{ data: { labels: string[] } }>(`/entity-labels`, {
        method: 'PUT', body: JSON.stringify({ entityType, entityId, labels: next }),
      })
      setLabels(r.data?.labels ?? next)
    } catch (e: any) {
      setLabels(prev)
      toast.error('Could not save labels', e?.message)
    } finally {
      setBusy(false)
    }
  }

  function add(raw: string) {
    const t = raw.trim().replace(/\s+/g, ' ')
    setInput('')
    if (!t || labels.includes(t)) return
    persist([...labels, t])
    setSuggestions((prev) => (prev.includes(t) ? prev : [...prev, t].sort((a, b) => a.localeCompare(b))))
  }

  function remove(t: string) {
    persist(labels.filter((x) => x !== t))
  }

  // The workspace's existing labels of this kind, narrowed by what is typed;
  // an empty query lists them all, so focus alone offers the choice. The ones
  // on this record come back too: they show checked, and a click unchecks.
  function suggest(q: string) {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      adminFetch<{ data: { labels: string[] } }>(`/labels/suggest?entityType=${encodeURIComponent(entityType)}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`)
        .then((r) => { setSuggestions((r.data?.labels ?? []).slice(0, MAX_SUGGESTIONS)); setHighlight(0) })
        .catch(() => setSuggestions([]))
    }, q ? 150 : 0)
  }

  function onInput(v: string) {
    setInput(v)
    setOpen(true)
    suggest(v)
  }

  function toggle(t: string) {
    if (labels.includes(t)) remove(t)
    else persist([...labels, t])
    inputRef.current?.focus()
  }

  const typed = input.trim().replace(/\s+/g, ' ')
  const known = (t: string) => labels.some((l) => l.toLowerCase() === t.toLowerCase()) || suggestions.some((s) => s.toLowerCase() === t.toLowerCase())
  const canCreate = Boolean(typed) && !known(typed)
  // The rows of the list in order: every existing label (checked when on this
  // record), then "Create" for a new one.
  const rows: Array<{ kind: 'pick' | 'create'; value: string; checked: boolean }> = [
    ...suggestions.map((s) => ({ kind: 'pick' as const, value: s, checked: labels.includes(s) })),
    ...(canCreate ? [{ kind: 'create' as const, value: typed, checked: false }] : []),
  ]
  const menuOpen = open && rows.length > 0

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && menuOpen) { e.preventDefault(); setHighlight((h) => (h + 1) % rows.length); return }
    if (e.key === 'ArrowUp' && menuOpen) { e.preventDefault(); setHighlight((h) => (h - 1 + rows.length) % rows.length); return }
    if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const row = menuOpen ? rows[Math.min(highlight, rows.length - 1)] : undefined
      if (!row) { add(input); return }
      if (row.kind === 'create') add(row.value)
      else toggle(row.value)
    }
  }

  return (
    <div className="space-y-2">
      {/* Header: the title and the info toggle */}
      <div className="flex items-center gap-1">
        <Label>{title}</Label>
        <Button
          type="button" size="xs" variant="ghost" icon={<IconInfo className="size-3.5" />}
          aria-label="What are labels?" aria-expanded={showInfo} aria-pressed={showInfo}
          onClick={() => setShowInfo((v) => !v)}
        />
      </div>

      {showInfo && (
        <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2.5 text-ui-xs leading-relaxed text-fg-muted">
          <span className="font-medium text-fg">Labels</span> are free-form tags for
          organizing and filtering records, separate from your content fields. Use them
          for workflow or curation states like{' '}
          <span className="rounded bg-surface px-1 py-0.5 font-medium text-fg">reviewed</span> or{' '}
          <span className="rounded bg-surface px-1 py-0.5 font-medium text-fg">featured</span>.
          You, the API, and automations can all add them, and you can filter lists by label.
        </div>
      )}

      {/* The labels on the record */}
      {(labels.length > 0 || !canWrite) && (
        <div className="flex flex-wrap gap-1.5">
          {labels.map((t) => (
            <Badge key={t} variant="default" className={clsx('gap-0.5', canWrite && 'pr-0.5')}>
              {t}
              {canWrite && (
                <Button
                  type="button" size="xs" variant="ghost" className="size-4 min-w-0 rounded-sm p-0 text-accent-fg/70 hover:text-danger-fg"
                  icon={<IconX className="size-3" />} aria-label={`Remove ${t}`} disabled={busy} onClick={() => remove(t)}
                />
              )}
            </Badge>
          ))}
          {labels.length === 0 && <span className="text-ui-xs italic text-fg-subtle">No labels yet.</span>}
        </div>
      )}

      {/* Choose an existing label or create one */}
      {canWrite && (
        <div className="relative">
          <Input
            ref={inputRef}
            value={input}
            role="combobox"
            aria-expanded={menuOpen}
            aria-autocomplete="list"
            aria-label={`Add a ${title.toLowerCase().replace(/s$/, '')}`}
            onChange={(e) => onInput(e.currentTarget.value)}
            onFocus={() => { setOpen(true); suggest(input) }}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKeyDown}
            placeholder="Choose or create a label"
            disabled={busy}
          />
          <AnchoredDropdown anchorRef={inputRef} open={menuOpen} estHeight={220}
            className="overflow-hidden rounded-lg border border-border bg-surface shadow-md">
            <ul role="listbox" aria-multiselectable="true" className="max-h-52 overflow-y-auto py-1">
              {rows.map((row, i) => (
                <li key={`${row.kind}:${row.value}`} role="option" aria-selected={row.checked} data-highlighted={i === highlight || undefined}>
                  <Button
                    type="button" size="sm" variant="ghost"
                    className={clsx('w-full justify-start gap-2 rounded-none font-normal', i === highlight && 'bg-surface-sunken')}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => (row.kind === 'create' ? add(row.value) : toggle(row.value))}
                  >
                    {row.kind === 'create'
                      ? <><IconPlus className="size-3.5 text-fg-subtle" aria-hidden /><span>Create <span className="font-medium">{row.value}</span></span></>
                      : <><Checkbox checked={row.checked} tabIndex={-1} aria-hidden className="pointer-events-none" /><span className="truncate">{row.value}</span></>}
                  </Button>
                </li>
              ))}
            </ul>
          </AnchoredDropdown>
        </div>
      )}
    </div>
  )
}
