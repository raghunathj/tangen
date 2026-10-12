import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconPlus, IconTrash, IconSearch } from '@tangen/icons'
import { adminFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, SheetClose } from '@/kit'
import { toast } from '@/lib/toast'

interface SynonymGroup { id: string; label: string | null; terms: string[]; updatedAt: string }

function relativeTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime()
  const m = Math.floor(d / 60000), h = Math.floor(m / 60), days = Math.floor(h / 24)
  if (days > 0) return `${days}d ago`
  if (h > 0) return `${h}h ago`
  if (m > 0) return `${m}m ago`
  return 'just now'
}

export function SynonymsView() {
  const [groups, setGroups] = useState<SynonymGroup[]>([])
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<SynonymGroup | null>(null)
  const [label, setLabel] = useState('')
  const [terms, setTerms] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { const res = await adminFetch<{ data: SynonymGroup[] }>('/admin/search-synonyms'); setGroups(res.data ?? []) } catch { /* ignore */ }
  }, [])
  useEffect(() => { void load() }, [load])

  const openAdd = () => { setEditing(null); setLabel(''); setTerms(''); setOpen(true) }
  const openEdit = (g: SynonymGroup) => { setEditing(g); setLabel(g.label ?? ''); setTerms(g.terms.join(', ')); setOpen(true) }

  const save = async () => {
    const parsed = terms.split(',').map((t) => t.trim()).filter(Boolean)
    if (!label.trim()) { toast.error('Give the group a title'); return }
    if (parsed.length < 2) { toast.error('Enter at least 2 comma-separated terms'); return }
    setBusy(true)
    try {
      const opts = { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: label.trim(), terms: parsed }) }
      if (editing) await adminFetch(`/admin/search-synonyms/${editing.id}`, { method: 'PATCH', ...opts })
      else await adminFetch('/admin/search-synonyms', { method: 'POST', ...opts })
      setOpen(false); await load(); toast.success(editing ? 'Group updated' : 'Group added')
    } catch (e) { toast.error((e as Error).message ?? 'Failed to save') } finally { setBusy(false) }
  }
  const remove = async (id: string) => {
    setBusy(true)
    try { await adminFetch(`/admin/search-synonyms/${id}`, { method: 'DELETE' }); await load() }
    catch (e) { toast.error((e as Error).message ?? 'Failed to remove') } finally { setBusy(false) }
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return groups
    return groups.filter((g) => (g.label ?? '').toLowerCase().includes(q) || g.terms.some((t) => t.toLowerCase().includes(q)))
  }, [groups, filter])

  return (
    <div className="space-y-4" data-testid="synonyms-manager">
      <div className="flex items-center gap-2">
        {groups.length > 3 && (
          <div className="relative flex-1">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-fg-subtle" />
            <input value={filter} onChange={(e) => setFilter((e.target as HTMLInputElement).value)} placeholder="Filter groups…" className="w-full rounded-md border border-border bg-surface pl-8 pr-3 py-1.5 text-sm text-fg outline-none focus-visible:ring-[3px] focus-visible:ring-focus/25" />
          </div>
        )}
        <Button className="ml-auto" onClick={openAdd}><IconPlus className="size-4" /> Add group</Button>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-fg-subtle">{groups.length === 0 ? 'No synonym groups yet.' : 'No groups match your filter.'}</p>
      ) : (
        <ul className="rounded-lg border border-border bg-surface divide-y divide-border overflow-hidden">
          {visible.map((g) => (
            <li key={g.id} className="flex items-center gap-3 px-4 py-3">
              <button onClick={() => openEdit(g)} className="flex-1 min-w-0 space-y-1 text-left">
                <p className="text-sm font-medium text-fg">{g.label || 'Untitled'}</p>
                <span className="flex flex-wrap gap-1.5">
                  {g.terms.map((t) => <span key={t} className="rounded bg-surface-sunken px-2 py-0.5 text-xs text-fg">{t}</span>)}
                </span>
              </button>
              <span className="text-xs text-fg-subtle shrink-0">{relativeTime(g.updatedAt)}</span>
              <button onClick={() => remove(g.id)} disabled={busy} className="text-fg-subtle hover:text-danger-fg transition-colors shrink-0" aria-label="Remove group">
                <IconTrash className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit synonym group' : 'New synonym group'}</SheetTitle>
            <SheetDescription className="mt-1">A search for any term in the group also matches the others.</SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-fg">Title</span>
              <input value={label} onChange={(e) => setLabel((e.target as HTMLInputElement).value)} placeholder="Footwear" className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg outline-none focus-visible:ring-[3px] focus-visible:ring-focus/25" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-fg">Terms</span>
              <input value={terms} onChange={(e) => setTerms((e.target as HTMLInputElement).value)} placeholder="shoe, sneaker, trainer" className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg outline-none focus-visible:ring-[3px] focus-visible:ring-focus/25" />
              <span className="text-xs text-fg-subtle">Comma-separated; at least two.</span>
            </label>
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild><Button variant="secondary">Cancel</Button></SheetClose>
            <Button onClick={save} disabled={busy}>{editing ? 'Save changes' : 'Add group'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
