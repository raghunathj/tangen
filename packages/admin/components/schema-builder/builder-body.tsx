/**
 * File Name: builder-body.tsx
 * Purpose: The shared builder body for the new + edit schema pages. Header chrome is
 *   layout-owned (usePageHeader — a single crumb bar, no doubled header): crumbs +
 *   Save / Disable-Enable / Delete actions. Owns the reducer state, the save
 *   (write API → background push, with a full-screen overlay while it applies),
 *   and permanent deletion via the shared typed-confirmation dialog.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useReducer, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IconEye, IconEyeOff, IconTrash, IconPencil, IconChevronDown, IconX } from '@tangen/icons'
import { toast } from '@/lib/toast'
import { usePageHeader } from '@/lib/page-header'
import {
  Badge, Button, Callout, Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription,
  Input, Label, Menu, MenuTrigger, MenuContent, MenuItem, Select, SelectItem, Sheet, SheetContent, SheetHeader, SheetBody, SheetTitle, SheetDescription, Toggle,
} from '@/kit'
import { builderReducer, toObjectType, validateBuilderModel, referringRelationFields, type BuilderModel } from '@/lib/schema-builder-model'
import { useContentTypes, type ContentTypeItem } from '@/lib/use-content-types'
import { useReusableComponents } from '@/lib/use-reusable-components'
import { useLocaleStore } from '@/lib/locale'
import { saveSchemaType, deleteSchemaType, waitForPush, notifyTypesChanged, getPendingPlan } from '@/lib/schema-save'
import { SchemaBuilderCanvas } from './canvas'
import { NamedIcon, IconPicker } from './icon-picker'
import { PushOverlay } from './push-overlay'
import { DeleteTypeDialog } from './delete-type-dialog'

/** Type settings in a side Sheet: icon, label, name (locked when existing), description, singleton, taxonomy. */
function TypeSettingsSheet({ open, onClose, model, existing, allTypes, dispatch }: {
  open: boolean
  onClose: () => void
  model: BuilderModel
  existing: boolean
  allTypes: ContentTypeItem[]
  dispatch: (a: { type: 'SET_META'; patch: Partial<Pick<BuilderModel, 'name' | 'label' | 'plural' | 'description' | 'icon' | 'disabled' | 'singleton' | 'localized' | 'taxonomy'>> }) => void
}) {
  const localizationEnabled = useLocaleStore().enabled
  // Parent candidates for sidebar nesting — other, non-singleton, TOP-LEVEL types
  // (already-nested types are excluded to keep nesting to ≤2 levels).
  const parentCandidates = allTypes.filter((t) =>
    t.name !== model.name && t.singleton !== true && !t.admin?.taxonomy?.parentType,
  )
  const tax = model.taxonomy ?? {}
  const patchTax = (p: Partial<NonNullable<BuilderModel['taxonomy']>>) =>
    dispatch({ type: 'SET_META', patch: { taxonomy: { ...tax, ...p } } })
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent className="w-96">
        <SheetHeader>
          <SheetTitle>Type settings</SheetTitle>
          <SheetDescription>Label, appearance, and behavior - the name is the table identity.</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="ts-label">Label</Label>
            <Input id="ts-label" value={model.label} onChange={(e) => dispatch({ type: 'SET_META', patch: { label: e.currentTarget.value } })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ts-name">Name (code id)</Label>
            <Input id="ts-name" className="font-mono" value={model.name} disabled={existing}
              title={existing ? 'The name is the table identity - it cannot change after creation' : undefined}
              onChange={(e) => dispatch({ type: 'SET_META', patch: { name: e.currentTarget.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') } })} />
          </div>
          {model.singleton !== true && (
            <div className="space-y-1">
              <Label htmlFor="ts-plural">Plural</Label>
              <Input id="ts-plural" className="font-mono" value={model.plural ?? ''} disabled={existing}
                title={existing ? 'The plural drives the GraphQL list query - it cannot change after creation' : undefined}
                onChange={(e) => dispatch({ type: 'SET_META', patch: { plural: e.currentTarget.value } })} placeholder="inferred from name" />
              <p className="text-ui-xs text-fg-subtle">
                {existing ? 'Locked - changing it would rename the GraphQL list query (an API break).' : 'Drives the GraphQL list query. Correct it for irregulars (person → people).'}
              </p>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="ts-desc">Description</Label>
            <Input id="ts-desc" value={model.description} onChange={(e) => dispatch({ type: 'SET_META', patch: { description: e.currentTarget.value } })} placeholder="Shown in the type header" />
          </div>
          <div className="rounded-control border border-border px-3 py-2.5">
            <Toggle size="sm" label="Singleton - a single entry, not a list"
              description="Homepage, About, Site Settings. The menu opens the editor directly."
              checked={model.singleton === true} onCheckedChange={(v) => dispatch({ type: 'SET_META', patch: { singleton: v } })} />
          </div>
          {localizationEnabled && (
            <div className="rounded-control border border-border px-3 py-2.5">
              <Toggle size="sm" label="Translatable - content per language"
                description={`Creates a ${model.name || 'type'}_i18n side table on push. The title translates at minimum; mark individual fields localized to translate them too.`}
                checked={model.localized === true} onCheckedChange={(v) => dispatch({ type: 'SET_META', patch: { localized: v } })} />
            </div>
          )}
          {model.singleton !== true && (
            <div className="space-y-3 rounded-control border border-border px-3 py-3">
              <span className="block text-ui-xs font-medium text-fg">Taxonomy</span>
              <div className="space-y-1">
                <Label htmlFor="ts-parent">Nest under (sidebar)</Label>
                <Select id="ts-parent" value={tax.parentType ?? '__top'} onValueChange={(v: string) => patchTax({ parentType: v === '__top' ? undefined : v })}>
                  <SelectItem value="__top">Top level (no nesting)</SelectItem>
                  {parentCandidates.map((t) => <SelectItem key={t.name} value={t.name}>{t.label}</SelectItem>)}
                </Select>
                <p className="text-ui-xs text-fg-subtle">Show this type under another type's menu item (≤2 levels).</p>
              </div>
              <Toggle size="sm" label="Hierarchical - terms form a tree"
                description="Adds a self-referential parent relation + a tree editor. Auto-provided on save."
                checked={tax.hierarchical === true} onCheckedChange={(v) => patchTax({ hierarchical: v || undefined })} />
              <Toggle size="sm" label="Orderable - drag to reorder"
                description="Adds a hidden position field. Auto-provided on save."
                checked={tax.orderable === true} onCheckedChange={(v) => patchTax({ orderable: v || undefined })} />
            </div>
          )}
          <div className="space-y-1">
            <Label>Icon</Label>
            <IconPicker value={model.icon} onChange={(icon) => dispatch({ type: 'SET_META', patch: { icon } })} />
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

export function SchemaBuilderBody({ initial, existing = false }: { initial: BuilderModel; existing?: boolean }) {
  const params = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [model, dispatch] = useReducer(builderReducer, initial)
  // The Save/Delete actions live in the layout header (usePageHeader), whose closures
  // only refresh when the deps change — FIELD edits change none of them. Reading the
  // model through a ref keeps those actions current (a stale closure here silently
  // saved the model WITHOUT newly added fields).
  const modelRef = useRef(model)
  modelRef.current = model
  // Dirty vs the last APPLIED state — Apply stays grey until something changes.
  const appliedRef = useRef(existing ? JSON.stringify(toObjectType(initial)) : null)
  const dirty = appliedRef.current !== JSON.stringify(toObjectType(model))
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Field names as loaded — a save that no longer contains one of these DROPS its
  // column (+ data), so we ask before pushing with --confirm.
  const initialFieldNames = useRef(new Set([...initial.main, ...initial.sidebar].map((f) => f.name)))
  const [pendingRemovals, setPendingRemovals] = useState<{ fields: string[]; scope: 'scoped' | 'all' } | null>(null)
  // Pre-apply warning. In SCOPED mode ('deps') it lists out-of-sync dependency types this
  // type pulls in; in 'all' mode it lists every other type the full reconcile would push.
  const [pendingWarn, setPendingWarn] = useState<{ types: string[]; confirmDrops: boolean; scope: 'scoped' | 'all'; mode: 'deps' | 'all' } | null>(null)
  const [saving, setSaving] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const allTypes = useContentTypes()
  const reusableComponents = useReusableComponents(true)
  const backToSchema = () => navigate(`/${params.workspaceId}/schema`)
  const busy = saving || pushing || deleteBusy

  // Apply. `scope='scoped'` (default) applies ONLY this type + its out-of-sync relation
  // deps; `scope='all'` does the full whole-codebase reconcile. `ackWarn` skips the
  // pre-apply dependency/other-types dialog once the user has confirmed it.
  async function save(confirmDrops = false, ackWarn = false, scope: 'scoped' | 'all' = 'scoped') {
    const m = modelRef.current
    const problems = validateBuilderModel(m, { checkReserved: true })
    if (problems.length) { toast.error('Fix before saving', problems[0]); return }
    // Removed (or renamed) fields drop their columns — get explicit consent first,
    // then run the push with --confirm so the drop actually applies.
    const currentNames = new Set([...m.main, ...m.sidebar].map((f) => f.name))
    const removed = existing ? [...initialFieldNames.current].filter((n) => !currentNames.has(n)) : []
    if (removed.length > 0 && !confirmDrops) { setPendingRemovals({ fields: removed, scope }); return }
    // Pre-apply preview. SCOPED: warn only about out-of-sync DEPENDENCY types this type
    // pulls in (an in-sync codebase applies nothing extra). ALL: warn about every other
    // type the full reconcile would push (a teammate's WIP pulled from git).
    if (!ackWarn) {
      setSaving(true)
      const plan = scope === 'all' ? await getPendingPlan() : await getPendingPlan(m.name)
      setSaving(false)
      const warnTypes = scope === 'all' ? plan.affectedTypes.filter((t) => t !== m.name) : (plan.extraTypes ?? [])
      if (warnTypes.length > 0) { setPendingWarn({ types: warnTypes, confirmDrops, scope, mode: scope === 'all' ? 'all' : 'deps' }); return }
    }
    setSaving(true)
    setPushError(null)
    let started = false
    try {
      // The write returns immediately; the push runs in the background (avoids the dev
      // proxy 502 on a slow push). We then poll the push run to show its result.
      const res = await saveSchemaType(toObjectType(m), { confirm: confirmDrops, scope })
      toast.success(`Schema "${m.label || m.name}" saved`)
      started = true
      setPushing(true)
      const outcome = await waitForPush(res.pushId)
      if (outcome.status === 'ok') { initialFieldNames.current = new Set([...m.main, ...m.sidebar].map((f) => f.name)); appliedRef.current = JSON.stringify(toObjectType(m)); toast.success('Applied (pushed)'); notifyTypesChanged() }
      else if (outcome.status === 'failed') { setPushError(outcome.output || 'Push failed - check the schema and try again.'); toast.error('Saved to code, but push failed') }
      else { toast.error('Still pushing - check the schema list in a moment') }
    } catch (e) {
      toast.error('Save failed', e instanceof Error ? e.message : undefined)
    } finally {
      setSaving(false)
      if (started) setPushing(false)
    }
  }

  async function confirmDelete() {
    const m = modelRef.current
    setDeleteBusy(true)
    try {
      const res = await deleteSchemaType(m.name)
      setDeleting(false)
      toast.success(`"${m.label || m.name}" deleted - dropping its table…`)
      const outcome = await waitForPush(res.pushId)
      if (outcome.status === 'failed') toast.error('Removed from code, but the drop was refused', outcome.output?.slice(-300))
      else if (outcome.status === 'timeout') toast.error('Push is taking unusually long - check the schema list in a moment')
      notifyTypesChanged()
      backToSchema()
    } catch (e) {
      toast.error('Delete failed', e instanceof Error ? e.message : undefined)
    } finally {
      setDeleteBusy(false)
    }
  }

  // Layout-owned header: one crumb bar (Schema › type), actions on the right.
  usePageHeader({
    breadcrumbs: [
      { label: 'Schema', href: `/${params.workspaceId}/schema` },
      { label: model.label || model.name || 'New', icon: <NamedIcon name={model.icon} className="size-4 text-fg-subtle" /> },
    ],
    titleAdornment: (
      <Button size="xs" variant="ghost" className="size-6 p-0" onClick={() => setSettingsOpen(true)} title="Type settings - label, description, icon, singleton" aria-label="Type settings" icon={<IconPencil className="size-3.5" />} />
    ),
    actions: (
      <div className="flex items-center gap-2">
        {model.singleton && <Badge variant="neutral">Singleton</Badge>}
        {dirty && <Badge variant="warning">Unapplied changes</Badge>}
        {existing && (
          <>
            <Button size="sm" variant="secondary" disabled={busy}
              icon={model.disabled ? <IconEye className="size-3.5" /> : <IconEyeOff className="size-3.5" />}
              title={model.disabled ? 'Re-enables on save' : 'Soft delete on save - content APIs answer 404; data stays'}
              onClick={() => dispatch({ type: 'SET_META', patch: { disabled: !model.disabled } })}>
              {model.disabled ? 'Enable' : 'Disable'}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} className="text-danger-fg hover:bg-danger-muted"
              icon={<IconTrash className="size-3.5" />}
              title="Permanent - drops the table and ALL its content"
              onClick={() => setDeleting(true)}>
              Delete
            </Button>
          </>
        )}
        {/* Apply - split-button (mirrors the editor's Publish). Main = scoped apply of
            THIS type (destructive drops prompt a confirm); dropdown = Force + Apply all. */}
        <div className="flex shrink-0 items-stretch">
          <Button size="sm" className="rounded-r-none" disabled={busy || !dirty}
            title={dirty ? 'Apply only this type to the database (out-of-sync dependencies come along)' : 'No changes since the last apply'}
            onClick={() => save()}>
            {pushing ? 'Pushing…' : saving ? 'Saving…' : dirty ? 'Apply Schema' : 'Applied'}
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" className="rounded-l-none border-l border-accent-contrast/25 px-1.5" disabled={busy || !dirty} aria-label="More apply options" icon={<IconChevronDown className="size-4" />} />
            </MenuTrigger>
            <MenuContent align="end" className="w-64">
              <MenuItem onSelect={() => save(true)} className="h-auto items-start py-1.5">
                <span className="flex flex-col items-start gap-0.5">
                  <span className="font-medium">Apply with Force</span>
                  <span className="text-ui-2xs text-fg-subtle">This type, including destructive drops - data in removed columns is lost.</span>
                </span>
              </MenuItem>
              <MenuItem onSelect={() => save(false, false, 'all')} className="h-auto items-start py-1.5">
                <span className="flex flex-col items-start gap-0.5">
                  <span className="font-medium">Apply all types</span>
                  <span className="text-ui-2xs text-fg-subtle">Full reconcile - pushes every changed type, including others' pending edits.</span>
                </span>
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>
    ),
  }, [model.label, model.name, model.icon, model.disabled, model.singleton, saving, pushing, deleteBusy, existing, dirty])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PushOverlay
        show={pushing || deleteBusy}
        label={deleteBusy ? 'Deleting type and dropping its table…' : `Applying "${model.label || model.name}"…`}
      />
      {pendingRemovals && (
        <Dialog open onOpenChange={(o) => { if (!o) setPendingRemovals(null) }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Removing {pendingRemovals.fields.length === 1 ? 'a field' : `${pendingRemovals.fields.length} fields`} - drop stored data?</DialogTitle>
              <DialogDescription>
                Saving without {pendingRemovals.fields.length === 1 ? 'this field' : 'these fields'} <span className="font-medium text-danger-fg">drops the column{pendingRemovals.fields.length === 1 ? '' : 's'} and every stored value</span>. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-wrap gap-1.5">
              {pendingRemovals.fields.map((n) => (
                <Badge key={n} variant="error" className="font-mono">{n}</Badge>
              ))}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPendingRemovals(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => { const s = pendingRemovals.scope; setPendingRemovals(null); save(true, false, s) }}>Save and drop</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {pendingWarn && (
        <Dialog open onOpenChange={(o) => { if (!o) setPendingWarn(null) }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {pendingWarn.mode === 'deps'
                  ? `${pendingWarn.types.length === 1 ? 'A dependency' : 'Dependencies'} will be updated too`
                  : `Other ${pendingWarn.types.length === 1 ? 'type has' : 'types have'} unapplied changes`}
              </DialogTitle>
              <DialogDescription>
                {pendingWarn.mode === 'deps'
                  ? <><span className="font-mono">{model.name}</span> depends on {pendingWarn.types.length === 1 ? 'a type that is' : 'types that are'} also out of sync with the database. Applying this type will update {pendingWarn.types.length === 1 ? 'it' : 'them'} too, so the relation resolves.</>
                  : <>Apply all types reconciles the <span className="font-medium">whole codebase</span>. {pendingWarn.types.length === 1 ? 'This type' : 'These types'} also {pendingWarn.types.length === 1 ? 'differs' : 'differ'} from the database and will be pushed - including anything a teammate committed but left unfinished.</>}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-wrap gap-1.5">
              {pendingWarn.types.map((n) => (
                <Badge key={n} variant="warning" className="font-mono">{n}</Badge>
              ))}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPendingWarn(null)}>Cancel</Button>
              <Button onClick={() => { const { confirmDrops, scope } = pendingWarn; setPendingWarn(null); save(confirmDrops, true, scope) }}>
                {pendingWarn.mode === 'deps' ? 'Apply with dependencies' : 'Apply all'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <DeleteTypeDialog
        type={deleting ? { name: model.name, label: model.label || model.name } : null}
        cascade={deleting ? referringRelationFields(allTypes as never, model.name, reusableComponents as never) : []}
        busy={deleteBusy}
        onCancel={() => setDeleting(false)}
        onConfirm={confirmDelete}
      />
      <TypeSettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        model={model}
        existing={existing}
        allTypes={allTypes}
        dispatch={dispatch}
      />
      {model.disabled && (
        <Callout variant="warning" title="This type is disabled" className="mx-6 mt-3" actions={<Button size="xs" variant="secondary" onClick={() => dispatch({ type: 'SET_META', patch: { disabled: false } })}>Enable on save</Button>}>
          content APIs answer 404 (read and write); data and entry statuses are untouched.
        </Callout>
      )}
      {pushError && (
        <Callout variant="danger" title="Push failed - schema written to code but not applied" className="mx-6 mt-3" actions={<Button size="xs" variant="ghost" onClick={() => setPushError(null)} aria-label="Dismiss" icon={<IconX className="size-3.5" />} />}>
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-surface p-2 text-[11px] leading-snug whitespace-pre-wrap">{pushError}</pre>
        </Callout>
      )}
      <SchemaBuilderCanvas model={model} dispatch={dispatch} />
    </div>
  )
}
