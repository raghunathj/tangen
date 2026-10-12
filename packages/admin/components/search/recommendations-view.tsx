import { useCallback, useEffect, useMemo, useState } from 'react'
import {IconPlus, IconTrash, IconSearch, IconPin, IconEyeOff} from '@tangen/icons'
import { adminFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { TabBar, Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, SheetClose } from '@/kit'
import { ObjectPicker, type ObjectValues } from '@/components/fields/object-picker'
import { toast } from '@/lib/toast'

interface Ref { type?: string; id: string; title?: string }
interface CurationRule { id: string; query: string; pins: Ref[]; hides: Ref[]; audience: string | null }
interface PickableSource { name: string; label: string; kind: 'content' | 'table' }
type Aud = 'internal' | 'public' | 'all'

function toRef(x: unknown): Ref { return typeof x === 'string' ? { id: x } : (x as Ref) }
function refLabel(x: unknown) { const r = toRef(x); return r.title || (r.type ? `${r.type}·${r.id.slice(0, 6)}` : (r.id ?? '').slice(0, 8)) }
function toValues(refs: Ref[]): ObjectValues { return refs.map(toRef).filter((r) => r.type && r.id).map((r) => ({ id: r.id, type: r.type! })) }

export function RecommendationsView({ workspaceId }: { workspaceId: string }) {
  const [rules, setRules] = useState<CurationRule[]>([])
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CurationRule | null>(null)
  const [query, setQuery] = useState('')
  const [audience, setAudience] = useState<Aud>('all')
  const [pins, setPins] = useState<ObjectValues>([])
  const [hides, setHides] = useState<ObjectValues>([])
  const [include, setInclude] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { const res = await adminFetch<{ data: CurationRule[] }>('/admin/search-recommendations'); setRules(res.data ?? []) } catch { /* ignore */ }
  }, [])
  useEffect(() => { void load() }, [load])

  // Pickable content types for the sheet's audience.
  useEffect(() => {
    if (!open) return
    let live = true
    void (async () => {
      try {
        const res = await adminFetch<{ data: PickableSource[] }>('/admin/search/pickable-sources', undefined, { audience: audience === 'all' ? 'internal' : audience })
        if (live) setInclude((res.data ?? []).filter((s) => s.kind === 'content').map((s) => s.name))
      } catch { /* ignore */ }
    })()
    return () => { live = false }
  }, [audience, open])

  const openAdd = () => { setEditing(null); setQuery(''); setAudience('all'); setPins([]); setHides([]); setOpen(true) }
  const openEdit = (r: CurationRule) => {
    setEditing(r); setQuery(r.query); setAudience((r.audience as Aud) || 'all')
    setPins(toValues(r.pins)); setHides(toValues(r.hides)); setOpen(true)
  }

  const save = async () => {
    if (!query.trim()) { toast.error('Enter the query this rule applies to'); return }
    if (pins.length === 0 && hides.length === 0) { toast.error('Pick at least one result to pin or hide'); return }
    setBusy(true)
    try {
      const opts = { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: query.trim(), pins, hides, audience: audience === 'all' ? null : audience }) }
      if (editing) await adminFetch(`/admin/search-recommendations/${editing.id}`, { method: 'PATCH', ...opts })
      else await adminFetch('/admin/search-recommendations', { method: 'POST', ...opts })
      setOpen(false); await load(); toast.success(editing ? 'Rule updated' : 'Rule added')
    } catch (e) { toast.error((e as Error).message ?? 'Failed to save') } finally { setBusy(false) }
  }
  const remove = async (id: string) => {
    setBusy(true)
    try { await adminFetch(`/admin/search-recommendations/${id}`, { method: 'DELETE' }); await load() }
    catch (e) { toast.error((e as Error).message ?? 'Failed') } finally { setBusy(false) }
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? rules.filter((r) => r.query.toLowerCase().includes(q)) : rules
  }, [rules, filter])

  return (
    <div className="space-y-4" data-testid="recommendations-manager">
      <div className="flex items-center gap-2">
        {rules.length > 3 && (
          <div className="relative flex-1">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-fg-subtle" />
            <input value={filter} onChange={(e) => setFilter((e.target as HTMLInputElement).value)} placeholder="Filter by query…" className="w-full rounded-md border border-border bg-surface pl-8 pr-3 py-1.5 text-sm text-fg outline-none focus-visible:ring-[3px] focus-visible:ring-focus/25" />
          </div>
        )}
        <Button className="ml-auto" onClick={openAdd}><IconPlus className="size-4" /> Add rule</Button>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-fg-subtle">{rules.length === 0 ? 'No curation rules yet.' : 'No rules match your filter.'}</p>
      ) : (
        <ul className="rounded-lg border border-border bg-surface divide-y divide-border overflow-hidden">
          {visible.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <button onClick={() => openEdit(r)} className="flex-1 flex items-center gap-3 text-left">
                <span className="font-medium text-fg min-w-20">{r.query}</span>
                <span className="flex-1 flex flex-wrap gap-1 text-xs text-fg-muted">
                  {r.pins.map((p, i) => <span key={`p${i}`} className="rounded bg-accent-muted text-accent-fg px-1.5 py-0.5"><IconPin className="size-3 inline -mt-0.5 mr-0.5" /> {refLabel(p)}</span>)}
                  {r.hides.map((h, i) => <span key={`h${i}`} className="rounded bg-surface-sunken px-1.5 py-0.5"><IconEyeOff className="size-3 inline -mt-0.5 mr-0.5" /> {refLabel(h)}</span>)}
                  {r.audience && <span className="rounded bg-surface-sunken px-1.5 py-0.5">{r.audience}</span>}
                </span>
              </button>
              <button onClick={() => remove(r.id)} disabled={busy} className="text-fg-subtle hover:text-danger-fg transition-colors shrink-0" aria-label="Remove rule"><IconTrash className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit rule' : 'New rule'}</SheetTitle>
            <SheetDescription className="mt-1">Pin results to the top, or hide them, for a query.</SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-fg">Query</span>
              <input value={query} onChange={(e) => setQuery((e.target as HTMLInputElement).value)} placeholder="sale" className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg outline-none focus-visible:ring-[3px] focus-visible:ring-focus/25" />
            </label>
            <div className="space-y-1">
              <span className="text-sm font-medium text-fg">Audience</span>
              <TabBar variant="pills" active={audience} onChange={(v) => setAudience(v as Aud)} tabs={[{ id: 'all', label: 'Everywhere' }, { id: 'public', label: 'Site Search' }, { id: 'internal', label: 'Admin Search' }]} />
            </div>
            <div className="space-y-1">
              <span className="text-sm font-medium text-fg">Pin to top</span>
              <ObjectPicker workspaceId={workspaceId} include={include} many value={pins} onChange={(v) => setPins(v as ObjectValues)} />
            </div>
            <div className="space-y-1">
              <span className="text-sm font-medium text-fg">Hide</span>
              <ObjectPicker workspaceId={workspaceId} include={include} many value={hides} onChange={(v) => setHides(v as ObjectValues)} />
            </div>
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild><Button variant="secondary">Cancel</Button></SheetClose>
            <Button onClick={save} disabled={busy}>{editing ? 'Save changes' : 'Add rule'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
