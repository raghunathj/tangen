

import { memo, useState } from 'react'
import { DatePicker } from '@/components/ui/date-picker'
import { lazy, Suspense } from 'react'
import { clsx } from 'clsx'
import { Switch as UiSwitch } from '@tangen/ui'
import {
  IconImage, IconFilm, IconMusic, IconFileText, IconFile, IconExternalLink,
  IconGlobe, IconCloud,
} from '@tangen/icons'
import { Select, SelectItem } from '@/components/ui/select'
import { MediaPicker } from '@/components/fields/media-picker'
import { LocalizeAssetModal } from '@/components/media/localize-asset-modal'
import { useLocaleStore } from '@/lib/locale'
import { RelationPicker } from '@/components/fields/relation-picker'
import { MultiRelationPicker } from '@/components/fields/multi-relation-picker'
import { TaxonomyParentPicker } from '@/components/taxonomy/TaxonomyParentPicker'
import { TaxonomyPicker, type TaxonomyPickerConfig } from '@/components/taxonomy/TaxonomyPicker'
import { ObjectPicker } from '@/components/fields/object-picker'
import { LinkField } from '@/components/fields/link-field'
import { ComponentBlockEditor } from '@/components/fields/component-block-editor'
import { RepeaterEditor, type RepeaterItem } from '@/components/fields/repeater-editor'
import { buildThumbnailUrl, buildFileUrl, formatFileSize, getMediaCategory } from '@/lib/media'
import { coerceFieldValue, getDateInputType } from '@/lib/editor'
import { useEffect } from 'react'
import { adminFetch } from '@/lib/api'
import { FIELD_TYPE_UI } from '@/lib/field-type-ui-registry'
import { parseNumrange } from '@tangen/types'
import type { FieldDefinition } from '@tangen/types'
import type { ComponentBlock } from '@/lib/component-editor'

const RichTextEditor = lazy(() => import('@/components/fields/richtext'))

type Option = { label: string; value: string }

/**
 * Resolves a field's options: static config.options, or fetched from the
 * dynamic-options endpoint when config.optionsSource === 'dynamic' (the
 * resolver function itself lives in the site's schema code, server-side).
 */
function useFieldOptions(field: FieldDefinition, typeName?: string) {
  const isDynamic = field.config?.optionsSource === 'dynamic'
  const [dynamic, setDynamic] = useState<{ options: Option[]; loading: boolean; error: string | null }>(
    { options: [], loading: isDynamic, error: null },
  )

  useEffect(() => {
    if (!isDynamic || !typeName) return
    let alive = true
    adminFetch<{ data: Option[] }>(`/admin/field-options/${typeName}/${field.name}`)
      .then((res) => { if (alive) setDynamic({ options: res.data ?? [], loading: false, error: null }) })
      .catch((e) => { if (alive) setDynamic({ options: [], loading: false, error: e.message ?? 'Failed to load options' }) })
    return () => { alive = false }
  }, [isDynamic, typeName, field.name])

  if (!isDynamic) return { options: field.config?.options ?? [], loading: false, error: null }
  return dynamic
}

/** Free-form tag chips with an inline text entry (Enter or comma to add). */
function TagsInput({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('')

  function commit() {
    const tag = draft.trim()
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setDraft('')
  }

  return (
    <div className={clsx(fieldInput, 'flex flex-wrap items-center gap-1.5 min-h-[38px] cursor-text')}>
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-sm bg-accent-muted border border-accent/30 text-accent-fg">
          {tag}
          <button
            type="button"
            onClick={() => onChange(value.filter((t) => t !== tag))}
            className="hover:text-accent-fg font-bold leading-none"
            aria-label={`Remove ${tag}`}
          >
            ✕
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit() }
          if (e.key === 'Backspace' && draft === '' && value.length > 0) onChange(value.slice(0, -1))
        }}
        onBlur={commit}
        placeholder={value.length === 0 ? 'Type a tag, press Enter' : ''}
        className="min-w-[8rem] flex-1 border-none bg-transparent p-0 text-ui outline-none placeholder:text-fg-subtle"
      />
    </div>
  )
}

export const fieldInput =
  'block w-full appearance-none rounded-control border border-border bg-surface-raised px-2.5 py-[5px] text-ui leading-5 text-fg placeholder:text-fg-subtle shadow-raised outline-none transition-colors motion-fast hover:border-border-strong focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25 aria-invalid:border-danger aria-invalid:ring-[3px] aria-invalid:ring-danger/20'

/** Kebab-normalize for slug fields: lowercase, non-alphanumerics → dashes, trimmed. */
export function kebabSlug(v: string): string {
  return v.toLowerCase().replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export interface FieldControlProps {
  field: FieldDefinition
  value: unknown
  onChange: (value: unknown) => void
  workspaceId: string
  /** Parent content type name — required for dynamic select options fetching */
  typeName?: string
  /** Increment to force richtext editor to remount (e.g. after version restore) */
  resetKey?: number
  /** When true and field is a many:false relation targeting the same type, renders TaxonomyParentPicker */
  isTaxonomyParent?: boolean
  /** ID of the object currently being edited — used to exclude self + descendants in TaxonomyParentPicker */
  currentObjectId?: string | null
  /** Slug fields: read a sibling field's current value for the Generate button ('title' included). */
  getSourceValue?: (fieldName: string) => unknown
  /** Relation fields: the TARGET type is disabled — render "Temporarily unavailable". */
  targetTypeDisabled?: boolean
  /**
   * Media fields: offer the per-asset "Manage localization" action when
   * workspace localization is enabled. Default true — pages that wire their
   * own asset-localization flow (the object editor) pass false.
   */
  assetLocalization?: boolean
  /** When set on a many:true relation field, renders TaxonomyPicker instead of MultiRelationPicker */
  taxonomyPickerConfig?: TaxonomyPickerConfig | null
  /** The server's validation error for this field, if a save/publish failed —
   *  component fields use it to mark empty required sub-fields red. */
  serverError?: string | null
  /** BL-4: per-locale inputs for localized sub-fields inside blocks/repeater rows. */
  blockLocaleCtx?: import('@/lib/editor').BlockLocaleCtx
}

function FieldControlBase({ field, value: val, onChange, workspaceId, typeName, resetKey = 0, isTaxonomyParent, currentObjectId, taxonomyPickerConfig, assetLocalization = true, getSourceValue, targetTypeDisabled, serverError, blockLocaleCtx }: FieldControlProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [localizeOpen, setLocalizeOpen] = useState(false)
  const localesEnabled = useLocaleStore((s) => s.enabled)
  const fieldOptions = useFieldOptions(field, typeName)

  // A media field value is normally an EXPANDED object (the content GET expands
  // it). But version snapshots / restores carry only the raw id string, so the
  // control would show a file icon + the id. Resolve the id → asset so the
  // thumbnail and real filename render in preview/restore too.
  const [resolvedMedia, setResolvedMedia] = useState<Record<string, unknown> | null>(null)
  const rawMediaId = field.fieldType === 'media' && typeof val === 'string' && val ? val : null
  useEffect(() => {
    if (!rawMediaId) { setResolvedMedia(null); return }
    let alive = true
    adminFetch<{ data: Record<string, unknown> }>(`/media/asset/${rawMediaId}`)
      .then((r) => { if (alive) setResolvedMedia(r.data ?? null) })
      .catch(() => { if (alive) setResolvedMedia(null) })
    return () => { alive = false }
  }, [rawMediaId])

  switch (field.fieldType) {
    case 'richtext':
      return (
        <Suspense fallback={null}>
          <RichTextEditor
            key={`${field.name}-${resetKey}`}
            value={val ?? null}
            onChange={(json) => onChange(json)}
            workspaceId={workspaceId}
            toolbar={field.config?.toolbar ?? 'basic'}
            media={field.config?.media ?? false}
            placeholder={field.config?.admin?.placeholder}
          />
        </Suspense>
      )

    case 'relation':
      // TL-4: the target type is disabled — the stored id(s) stay, nothing loads
      if (targetTypeDisabled) {
        const ids = Array.isArray(val) ? (val as string[]) : typeof val === 'string' && val ? [val] : []
        return (
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm bg-surface-sunken border border-border text-fg-subtle cursor-not-allowed"
            title={ids.length ? `Stored reference${ids.length > 1 ? 's' : ''}: ${ids.join(', ')}` : 'The target content type is disabled'}
          >
            <span aria-hidden>⏸</span> Temporarily unavailable
            {ids.length > 0 && <span className="font-mono text-[11px]">({ids.length})</span>}
          </div>
        )
      }
      if (field.config.many) {
        if (taxonomyPickerConfig) {
          return (
            <TaxonomyPicker
              workspaceId={workspaceId}
              targetType={field.config.targetType ?? ''}
              value={(val as string[]) ?? []}
              onChange={(ids) => onChange(ids)}
              config={taxonomyPickerConfig}
            />
          )
        }
        return (
          <MultiRelationPicker
            filter={(field.config as { filter?: Record<string, unknown> }).filter}
            workspaceId={workspaceId}
            targetType={field.config.targetType ?? ''}
            label={field.label}
            value={(val as string[]) ?? []}
            onChange={onChange}
          />
        )
      }
      if (isTaxonomyParent) {
        return (
          <TaxonomyParentPicker
            workspaceId={workspaceId}
            targetType={field.config.targetType ?? ''}
            parentField={field.name}
            value={(val as string | null) ?? null}
            onChange={(id) => onChange(id)}
            currentObjectId={currentObjectId ?? null}
          />
        )
      }
      return (
        <RelationPicker
          filter={(field.config as { filter?: Record<string, unknown> }).filter}
          workspaceId={workspaceId}
          targetType={field.config.targetType ?? ''}
          label={field.label}
          value={(val as string | null) ?? null}
          onChange={onChange}
        />
      )

    case 'textarea':
      return (
        <textarea
          rows={4}
          value={(val as string) ?? ''}
          readOnly={field.config.admin?.readonly}
          placeholder={field.config.admin?.placeholder}
          onChange={(e) => onChange((e.target as HTMLTextAreaElement).value)}
          className={clsx(fieldInput + ' resize-none', field.config.admin?.readonly && 'bg-surface-sunken cursor-default')}
        />
      )

    case 'number': {
      const vr = field.config.validation
      // Slider variant — needs both bounds; falls back to the input otherwise
      if (field.config?.admin?.displayAs === 'slider' && vr?.min != null && vr?.max != null) {
        const current = typeof val === 'number' ? val : vr.min
        return (
          <div className="flex items-center gap-3">
            <input
              type="range"
              value={current}
              min={vr.min}
              max={vr.max}
              step={vr.integer ? 1 : (vr.step ?? 1)}
              onChange={(e) => onChange(coerceFieldValue('number', (e.target as HTMLInputElement).value))}
              className="flex-1 accent-accent-strong"
            />
            <span className="w-14 text-right text-sm font-mono text-fg-muted tabular-nums">{current}</span>
          </div>
        )
      }
      return (
        <input
          type="number"
          value={val == null ? '' : String(val)}
          min={vr?.min}
          max={vr?.max}
          step={vr?.integer ? 1 : (vr?.step ?? 'any')}
          onChange={(e) => onChange(coerceFieldValue('number', (e.target as HTMLInputElement).value))}
          className={fieldInput}
        />
      )
    }

    case 'range': {
      const r = parseNumrange(val) ?? { min: NaN, max: NaN }
      const emit = (min: number, max: number) =>
        onChange(Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null)
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={Number.isFinite(r.min) ? String(r.min) : ''}
            placeholder="min"
            onChange={(e) => emit(Number((e.target as HTMLInputElement).value), r.max)}
            className={fieldInput}
          />
          <span className="text-fg-subtle">–</span>
          <input
            type="number"
            value={Number.isFinite(r.max) ? String(r.max) : ''}
            placeholder="max"
            onChange={(e) => emit(r.min, Number((e.target as HTMLInputElement).value))}
            className={fieldInput}
          />
        </div>
      )
    }

    case 'boolean':
      return (
        <UiSwitch
          aria-label={field.label}
          checked={(val as boolean) ?? false}
          disabled={field.config.admin?.readonly}
          onCheckedChange={(checked) => onChange(checked)}
        />
      )

    case 'date':
      return (
        <DatePicker
          size="md"
          withTime={getDateInputType(field) === 'datetime-local'}
          value={(val as string) || undefined}
          onChange={(v) => onChange(coerceFieldValue('date', v ?? ''))}
        />
      )

    case 'time':
      return (
        <input
          type="time"
          step={1}
          value={(val as string) ?? ''}
          onChange={(e) => onChange((e.target as HTMLInputElement).value || null)}
          className={fieldInput}
        />
      )

    case 'slug': {
      const source = (field.config as { source?: string })?.source
      const sourceVal = source && getSourceValue ? getSourceValue(source) : undefined
      return (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={(val as string) ?? ''}
            placeholder={field.config?.admin?.placeholder ?? 'kebab-case-slug'}
            onChange={(e) => {
              // permissive while typing (trailing dash allowed); kebabSlug finalizes on blur
              const raw = (e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-')
              onChange(raw || null)
            }}
            onBlur={(e) => {
              const v = kebabSlug((e.target as HTMLInputElement).value)
              if (v !== (val ?? '')) onChange(v || null)
            }}
            className={`${fieldInput} font-mono`}
          />
          {source && (
            <button
              type="button"
              onClick={() => {
                if (typeof sourceVal === 'string' && sourceVal.trim()) onChange(kebabSlug(sourceVal))
              }}
              disabled={typeof sourceVal !== 'string' || !sourceVal.trim()}
              title={`Generate from ${source}`}
              className="shrink-0 px-2.5 py-2 text-xs rounded-md border border-border-strong text-fg-muted hover:text-fg hover:bg-surface-muted disabled:opacity-40"
            >
              Generate
            </button>
          )}
        </div>
      )
    }

    case 'color': {
      const current = (val as string) ?? ''
      const pickerValue = /^#[0-9a-fA-F]{6}$/.test(current) ? current : '#000000'
      return (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={pickerValue}
            onChange={(e) => onChange((e.target as HTMLInputElement).value)}
            className="h-(--tg-control-h) w-12 shrink-0 cursor-pointer rounded-control border border-border bg-surface-raised p-1"
            aria-label={`${field.label} color picker`}
          />
          <input
            type="text"
            value={current}
            placeholder="#4F46E5 or rgb(79, 70, 229)"
            onChange={(e) => onChange((e.target as HTMLInputElement).value || null)}
            className={fieldInput}
          />
        </div>
      )
    }

    case 'tags':
      return (
        <TagsInput
          value={Array.isArray(val) ? (val as string[]) : []}
          onChange={(next) => onChange(next.length > 0 ? next : null)}
        />
      )

    case 'geopoint': {
      const point = (val as { lat?: number; lng?: number } | null) ?? null
      function setPart(part: 'lat' | 'lng', raw: string) {
        const n = raw === '' ? undefined : Number(raw)
        const next = { lat: point?.lat, lng: point?.lng, [part]: n }
        onChange(next.lat === undefined && next.lng === undefined ? null : next)
      }
      return (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="mb-1 block text-xs text-fg-muted">Latitude</span>
            <input
              type="number" step="any" min={-90} max={90}
              value={point?.lat ?? ''}
              onChange={(e) => setPart('lat', (e.target as HTMLInputElement).value)}
              placeholder="12.9716"
              className={fieldInput}
            />
          </div>
          <div>
            <span className="mb-1 block text-xs text-fg-muted">Longitude</span>
            <input
              type="number" step="any" min={-180} max={180}
              value={point?.lng ?? ''}
              onChange={(e) => setPart('lng', (e.target as HTMLInputElement).value)}
              placeholder="77.5946"
              className={fieldInput}
            />
          </div>
        </div>
      )
    }

    case 'currency':
      return (
        <div className="relative">
          <input
            type="number" step="any"
            min={field.config.validation?.min}
            max={field.config.validation?.max}
            value={val == null ? '' : String(val)}
            onChange={(e) => {
              const raw = (e.target as HTMLInputElement).value
              onChange(raw === '' ? null : Number(raw))
            }}
            className={clsx(fieldInput, field.config.currencyCode && 'pr-14')}
          />
          {field.config.currencyCode && (
            <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs font-medium text-fg-subtle">
              {field.config.currencyCode}
            </span>
          )}
        </div>
      )

    case 'rating': {
      const scale = field.config.max ?? 5
      const current = typeof val === 'number' ? val : 0
      return (
        <div className="flex items-center gap-1">
          {Array.from({ length: scale }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n === current ? null : n)}
              aria-label={`${n} of ${scale}`}
              className={clsx(
                'text-xl leading-none transition-colors',
                n <= current ? 'text-warning hover:text-warning' : 'text-fg-faint hover:text-fg-subtle',
              )}
            >
              ★
            </button>
          ))}
          {current > 0 && (
            <span className="ml-2 text-xs text-fg-muted">{current}/{scale}</span>
          )}
        </div>
      )
    }

    case 'code':
      return (
        <div className="relative">
          {field.config.language && (
            <span className="absolute top-2 right-2 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
              {field.config.language}
            </span>
          )}
          <textarea
            rows={8}
            spellCheck={false}
            value={(val as string) ?? ''}
            onChange={(e) => onChange((e.target as HTMLTextAreaElement).value || null)}
            className={clsx(fieldInput, 'font-mono text-xs leading-relaxed resize-y')}
          />
        </div>
      )

    case 'select': {
      const opts = fieldOptions.options
      const currentVal = (val as string) ?? ''
      const isOrphaned = currentVal !== '' && !fieldOptions.loading && !opts.some((o) => o.value === currentVal)
      if (fieldOptions.loading) {
        return <div className={clsx(fieldInput, 'text-fg-subtle')}>Loading options…</div>
      }
      return (
        <div className="space-y-1">
          {fieldOptions.error && (
            <div className="text-ui-xs text-danger-fg">{fieldOptions.error}</div>
          )}
          {isOrphaned && (
            <span className="inline-flex items-center gap-1.5 text-xs text-warning-fg bg-warning-muted border border-warning/40 rounded-md px-2.5 py-1 w-fit">
              <span>⚠</span>
              <span>Saved value <strong>&quot;{currentVal}&quot;</strong> is no longer a valid option.</span>
            </span>
          )}
          {field.config?.admin?.displayAs === 'radio' ? (
            <div role="radiogroup" className="space-y-1.5">
              {opts.map((o) => (
                <label key={o.value} className="flex items-center gap-2 text-sm text-fg cursor-pointer">
                  <input
                    type="radio"
                    name={field.name}
                    checked={currentVal === o.value}
                    onChange={() => onChange(coerceFieldValue('select', o.value))}
                    className="accent-accent-strong"
                  />
                  {o.label}
                </label>
              ))}
            </div>
          ) : field.config?.admin?.displayAs === 'segmented' ? (
            <div className="inline-flex rounded-md border border-border-strong overflow-hidden">
              {opts.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onChange(coerceFieldValue('select', o.value))}
                  className={clsx(
                    'px-3 py-1.5 text-sm transition-colors',
                    i > 0 && 'border-l border-border-strong',
                    currentVal === o.value ? 'bg-accent-strong text-white' : 'bg-surface text-fg-muted hover:text-fg hover:bg-surface-muted',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ) : (
            <Select value={currentVal} onValueChange={(v) => onChange(coerceFieldValue('select', v))}>
              {isOrphaned && (
                <SelectItem value={currentVal} className="text-warning-fg">
                  ⚠ {currentVal} (removed option)
                </SelectItem>
              )}
              {opts.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </Select>
          )}
        </div>
      )
    }

    case 'multiselect': {
      if (fieldOptions.loading) {
        return <div className={clsx(fieldInput, 'text-fg-subtle')}>Loading options…</div>
      }
      const opts = fieldOptions.options
      const optValues = new Set(opts.map((o) => o.value))
      const current: string[] = Array.isArray(val) ? (val as string[]) : []
      const orphaned = current.filter((v) => !optValues.has(v))
      function toggleOption(value: string) {
        const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
        onChange(next)
      }
      return (
        <div className="space-y-2">
          {fieldOptions.error && (
            <div className="text-ui-xs text-danger-fg">{fieldOptions.error}</div>
          )}
          {orphaned.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {orphaned.map((v) => (
                <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-warning-muted border border-warning/40 text-warning-fg">
                  <span>⚠</span>
                  <span className="line-through">{v}</span>
                  <button type="button" onClick={() => onChange(current.filter((c) => c !== v))} className="ml-0.5 hover:text-warning-fg font-bold">✕</button>
                </span>
              ))}
            </div>
          )}
          {field.config?.admin?.displayAs === 'checkboxList' ? (
            <div className="space-y-1.5">
              {opts.map((o) => (
                <label key={o.value} className="flex items-center gap-2 text-sm text-fg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={current.includes(o.value)}
                    onChange={() => toggleOption(o.value)}
                    className="accent-accent-strong rounded"
                  />
                  {o.label}
                </label>
              ))}
            </div>
          ) : (
          <div className="flex flex-wrap gap-2">
            {opts.map((o) => {
              const active = current.includes(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggleOption(o.value)}
                  className={clsx(
                    'px-2.5 py-1 rounded-md text-sm border transition-colors',
                    active ? 'bg-accent-muted border-accent text-accent-fg font-medium' : 'bg-surface border-border text-fg-muted hover:border-border-strong',
                  )}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
          )}
        </div>
      )
    }

    case 'object':
      return (
        <ObjectPicker
          workspaceId={workspaceId}
          include={field.config.include ?? []}
          many={field.config.many}
          value={val as any}
          onChange={onChange}
        />
      )

    case 'link':
      return (
        <LinkField
          field={field}
          value={val}
          onChange={onChange}
          workspaceId={workspaceId}
        />
      )

    case 'json':
      return (
        <textarea
          rows={6}
          value={val == null ? '' : (typeof val === 'string' ? val : JSON.stringify(val, null, 2))}
          onChange={(e) => {
            const raw = (e.target as HTMLTextAreaElement).value
            try { onChange(JSON.parse(raw)) } catch { onChange(raw) }
          }}
          className={fieldInput + ' resize-y font-mono text-xs'}
          placeholder="{}"
          spellCheck={false}
        />
      )

    case 'media': {
      type MediaAssetObj = {
        id: string; originalName?: string; mimeType?: string; sizeBytes?: number
        thumbnailPath?: string | null
        localeAssets?: Record<string, string> | null
        storage?: string | null
      }
      // Expanded value (normal load) → use directly; raw id (version/restore) →
      // use the asset we resolved by id above so the thumbnail/name still render.
      const assetObj: MediaAssetObj | null = val && typeof val === 'object' && !Array.isArray(val)
        ? (val as MediaAssetObj)
        : (resolvedMedia as MediaAssetObj | null)
      const assetId = assetObj ? assetObj.id : (val as string | null) ?? null
      const cat = assetObj?.mimeType ? getMediaCategory(assetObj.mimeType) : null
      const thumbUrl = assetId && cat === 'image' && assetObj?.thumbnailPath ? buildThumbnailUrl(assetId) : null
      const fileUrl = assetId ? buildFileUrl(assetId) : null

      return (
        <>
          {assetId ? (
            <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-surface-sunken">
              <div className="size-14 rounded-md border border-border overflow-hidden shrink-0 bg-surface flex items-center justify-center">
                {thumbUrl
                  ? <img src={thumbUrl} alt={assetObj?.originalName ?? ''} className="w-full h-full object-cover" />
                  : (
                    <div className="w-full h-full flex items-center justify-center bg-surface-sunken">
                      {cat === 'video' && <IconFilm className="size-6 text-fg-subtle" />}
                      {cat === 'audio' && <IconMusic className="size-6 text-fg-subtle" />}
                      {cat === 'document' && <IconFileText className="size-6 text-fg-subtle" />}
                      {cat === 'image' && <IconImage className="size-6 text-fg-subtle" />}
                      {!cat && <IconFile className="size-6 text-fg-subtle" />}
                    </div>
                  )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-1">
                  <p className="text-xs font-medium text-fg truncate leading-tight">{assetObj?.originalName ?? assetId}</p>
                  {fileUrl && (
                    <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-fg-subtle hover:text-accent-fg transition-colors" title="Open file in new tab">
                      <IconExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {assetObj?.sizeBytes != null && (
                    <p className="text-[11px] text-fg-subtle">{formatFileSize(assetObj.sizeBytes)}</p>
                  )}
                  {assetObj?.storage && assetObj.storage !== 'local' && (
                    <span
                      title={`Cloud storage - ${assetObj.storage.toUpperCase()}`}
                      className="flex items-center justify-center size-4 rounded-full bg-sky-500/90 text-white"
                    >
                      <IconCloud className="size-2.5" />
                    </span>
                  )}
                  {assetObj?.localeAssets && Object.keys(assetObj.localeAssets).length > 0 && (
                    <span
                      title={`Localized - ${Object.keys(assetObj.localeAssets).join(', ')}`}
                      className="flex items-center justify-center size-4 rounded-full bg-surface border border-border text-fg-muted"
                    >
                      <IconGlobe className="size-2.5" />
                    </span>
                  )}
                </div>
                <div className="flex gap-2 mt-2">
                  <button type="button" onClick={() => setPickerOpen(true)} className="text-xs text-accent-fg hover:underline">Change</button>
                  <span className="text-fg-faint">·</span>
                  <button type="button" onClick={() => onChange(null)} className="text-ui-xs text-danger-fg hover:underline">Remove</button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-fg-muted border border-dashed border-border-strong hover:border-accent hover:text-accent-fg transition-colors w-full"
            >
              <IconImage className="size-4 shrink-0" />
              Choose file…
            </button>
          )}
          {/* Per-asset language variants - available wherever the field is used
              (globals, extension pages, custom admin pages), not just the editor */}
          {assetLocalization && assetId && localesEnabled && (
            <button
              type="button"
              onClick={() => setLocalizeOpen(true)}
              className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-fg cursor-pointer"
              title="Serve a different asset per language - managed on the asset, applies everywhere it's used"
            >
              <IconGlobe className="size-3.5" />
              Manage localization
            </button>
          )}
          <MediaPicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onSelect={(asset) => { onChange(asset); setPickerOpen(false) }}
            mimeTypes={field.config.mimeTypes}
            accept={(field.config as any).accept}
            currentId={assetId}
            uploadOptions={{
              variants: field.config.variants,
              skipPresets: field.config.skipPresets,
              imageOverrides: (field.config as any).imageOverrides,
            }}
            workspaceId={workspaceId}
          />
          {assetLocalization && localesEnabled && (
            <LocalizeAssetModal
              assetId={localizeOpen ? assetId : null}
              open={localizeOpen}
              onOpenChange={setLocalizeOpen}
            />
          )}
        </>
      )
    }

    case 'repeater': {
      const subFields = field.config.fields ?? []
      return (
        <RepeaterEditor
          fields={subFields}
          value={(val as RepeaterItem[]) ?? []}
          onChange={onChange}
          maxRows={field.config.validation?.maxRows}
          localeCtx={blockLocaleCtx}
        />
      )
    }

    case 'component': {
      const comps = field.config.components ?? []
      return (
        <ComponentBlockEditor
          components={comps}
          value={(val as ComponentBlock[]) ?? []}
          onChange={(blocks) => onChange(blocks)}
          getEntryValue={getSourceValue}
          showRequired={!!serverError}
          localeCtx={blockLocaleCtx}
        />
      )
    }

    case 'email':
      return (
        <input
          type="email"
          value={(val as string) ?? ''}
          readOnly={field.config.admin?.readonly}
          placeholder={field.config.admin?.placeholder ?? 'name@example.com'}
          onChange={(e) => onChange((e.target as HTMLInputElement).value)}
          className={clsx(fieldInput, field.config.admin?.readonly && 'bg-surface-sunken cursor-default')}
        />
      )

    case 'url':
      return (
        <input
          type="url"
          value={(val as string) ?? ''}
          readOnly={field.config.admin?.readonly}
          placeholder={field.config.admin?.placeholder ?? 'https://'}
          onChange={(e) => onChange((e.target as HTMLInputElement).value)}
          className={clsx(fieldInput, field.config.admin?.readonly && 'bg-surface-sunken cursor-default')}
        />
      )

    case 'phone':
      return (
        <input
          type="tel"
          value={(val as string) ?? ''}
          readOnly={field.config.admin?.readonly}
          placeholder={field.config.admin?.placeholder ?? '+1 (555) 000-0000'}
          onChange={(e) => onChange((e.target as HTMLInputElement).value)}
          className={clsx(fieldInput, field.config.admin?.readonly && 'bg-surface-sunken cursor-default')}
        />
      )

    default: {
      // Extension-contributed custom field type: render its registered input.
      // The client validator (if any) gives instant, non-authoritative feedback;
      // the server re-validates on save.
      const custom = FIELD_TYPE_UI[field.fieldType]
      if (custom) {
        const CustomInput = custom.Input
        const clientError = custom.validate?.(val, field) ?? null
        return (
          <CustomInput
            value={val}
            onChange={onChange}
            field={field}
            error={clientError}
            readOnly={field.config.admin?.readonly}
          />
        )
      }
      return (
        <input
          type="text"
          value={(val as string) ?? ''}
          readOnly={field.config.admin?.readonly}
          placeholder={field.config.admin?.placeholder}
          onChange={(e) => onChange((e.target as HTMLInputElement).value)}
          className={clsx(fieldInput, field.config.admin?.readonly && 'bg-surface-sunken cursor-default')}
        />
      )
    }
  }
}

// Memoized (default shallow compare): the object editor keeps every prop
// identity-stable across unrelated renders, so a keystroke in one field
// re-renders only that field's control instead of the whole form.
export const FieldControl = memo(FieldControlBase)
