

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { IconGlobe, IconSave, IconLoader } from '@tangen/icons'
import { DynamicIcon } from '@/components/dynamic-icon'
import { adminFetch } from '@/lib/api'
import { usePageHeader } from '@/lib/page-header'
import { useLocaleStore } from '@/lib/locale'
import { LocaleSwitcher } from '@/components/i18n/locale-switcher'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription } from '@/kit'
import { IconChevronRight } from '@tangen/icons'
import { FieldControl } from '@/components/fields/field-control'
import type { GlobalDefinition, GlobalField } from '@tangen/types'
import type { FieldDefinition } from '@tangen/types'

const toFieldDef = (f: GlobalField): FieldDefinition => ({
  ...f, previousName: f.previousName ?? [], required: f.required ?? false,
})

// ── Dynamic icon ──────────────────────────────────────────────────────────────

function GlobalIcon({ name, className }: { name?: string | { src: string }; className?: string }) {
  if (!name) return null
  return <DynamicIcon name={name} className={className} />
}

// ── Global edit sheet ─────────────────────────────────────────────────────────

function GlobalEditSheet({ def, workspaceId, open, onOpenChange }: {
  def: GlobalDefinition; workspaceId: string; open: boolean; onOpenChange: (o: boolean) => void
}) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [baseline, setBaseline] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Ambient locale — driven by the shared LocaleSwitcher (footer + TopBar); null = default
  const locale = useLocaleStore((st) => (st.enabled ? st.activeLocale : null))

  useEffect(() => {
    setLoading(true)
    const qs = locale ? `?locale=${encodeURIComponent(locale)}` : ''
    adminFetch<{ data: Record<string, unknown> }>(`/globals/${def.name}${qs}`)
      .then((res) => { setValues(res.data ?? {}); setBaseline(res.data ?? {}) })
      .catch(() => { setValues({}); setBaseline({}) })
      .finally(() => setLoading(false))
  }, [def.name, locale])

  async function handleSave() {
    setSaving(true)
    try {
      // Translation mode sends only what changed — untouched values keep
      // falling back to the default locale instead of being copied.
      const body = locale
        ? Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== baseline[k]))
        : values
      if (locale && Object.keys(body).length === 0) {
        toast.success('Nothing to save')
        return
      }
      const qs = locale ? `?locale=${encodeURIComponent(locale)}` : ''
      await adminFetch(`/globals/${def.name}${qs}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setBaseline(values)
      toast.success(locale ? `Saved ${locale} translation` : 'Saved')
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <div className="flex items-start gap-3">
            {def.icon && (
              <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken border border-border">
                <GlobalIcon name={def.icon} className="size-4.5 text-fg-muted" />
              </div>
            )}
            <div className="min-w-0">
              <SheetTitle>{def.label}</SheetTitle>
              {def.description && <SheetDescription className="mt-0.5">{def.description}</SheetDescription>}
              <p className="mt-0.5 text-[11px] text-fg-subtle font-mono">{def.name}</p>
            </div>
          </div>
        </SheetHeader>

        <SheetBody>
          {loading ? (
            <div className="space-y-5">
              {def.fields.map((f) => (
                <div key={f.name} className="space-y-1.5">
                  <div className="h-3.5 w-24 rounded bg-surface-hover animate-pulse" />
                  <div className="h-9 rounded-md bg-surface-hover animate-pulse" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {def.fields.map((f) => {
                const adminWidth = f.config?.admin?.width
                const isNaturallyWide = f.fieldType === 'textarea' || f.fieldType === 'richtext' || f.fieldType === 'json'
                const spanFull = adminWidth === 'full' || (!adminWidth && isNaturallyWide)
                return (
                  <div key={f.name} className={spanFull ? 'sm:col-span-2' : ''}>
                    <label className="block text-sm font-medium text-fg mb-1.5">
                      {f.label}
                      {f.required && <span className="text-danger-fg ml-0.5">*</span>}
                    </label>
                    <FieldControl
                      field={toFieldDef(f)}
                      value={values[f.name]}
                      onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))}
                      workspaceId={workspaceId}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </SheetBody>

        <SheetFooter>
          <LocaleSwitcher label="Editing" className="mr-auto" />

          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || loading}>
            {saving
              ? <IconLoader className="size-3.5 animate-spin mr-1.5" />
              : <IconSave className="size-3.5 mr-1.5" />}
            Save{locale ? ` ${locale}` : ''}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GlobalsPage() {
  // Title comes from the Settings breadcrumb; the short info moves to the header
  usePageHeader({ description: 'Site-wide content every page shares: footers, contact details, social links' })

  const params = useParams<{ workspaceId: string }>()
  const { workspaceId} = params

  const [defs, setDefs] = useState<GlobalDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<GlobalDefinition | null>(null)

  useEffect(() => {
    adminFetch<{ data: GlobalDefinition[] }>('/globals')
      .then((res) => setDefs(res.data ?? []))
      .catch(() => setDefs([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-6">
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-surface p-6 space-y-3">
              <div className="h-4 w-32 rounded bg-surface-hover animate-pulse" />
              <div className="h-9 rounded-md bg-surface-hover animate-pulse" />
              <div className="h-9 rounded-md bg-surface-hover animate-pulse" />
            </div>
          ))}
        </div>
      ) : defs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-sunken px-6 py-10 text-center">
          <IconGlobe className="size-8 text-fg-faint mx-auto mb-3" />
          <p className="text-sm font-medium text-fg-muted">No globals defined</p>
          <p className="text-xs text-fg-subtle mt-1">
            Add globals in <code className="font-mono bg-surface-hover px-1 rounded">config/globals.ts</code> to manage workspace-wide settings here.
          </p>
        </div>
      ) : (
        // A data list of globals; clicking a row opens its form in a side Sheet, so
        // only the opened global fetches its values (no long scroll of stacked forms).
        <div className="divide-y divide-border rounded-xl border border-border bg-surface overflow-hidden">
          {defs.map((def) => (
            <button
              key={def.name}
              type="button"
              onClick={() => setEditing(def)}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-sunken transition-colors"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken border border-border">
                <GlobalIcon name={def.icon} className="size-4.5 text-fg-muted" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg truncate">{def.label}</span>
                {def.description && <span className="block text-xs text-fg-muted truncate">{def.description}</span>}
              </span>
              <span className="shrink-0 text-xs text-fg-subtle hidden sm:inline">
                {def.fields.length} {def.fields.length === 1 ? 'field' : 'fields'}
              </span>
              <IconChevronRight className="size-4 text-fg-subtle shrink-0" />
            </button>
          ))}
        </div>
      )}

      {editing && (
        <GlobalEditSheet
          key={editing.name}
          def={editing}
          workspaceId={workspaceId}
          open
          onOpenChange={(o) => { if (!o) setEditing(null) }}
        />
      )}
    </div>
  )
}
