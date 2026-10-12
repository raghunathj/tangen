/**
 * File Name: FieldRenderer.tsx
 * Purpose: One editor field's control block (R7 of the SRP refactor): the
 *          memoized FieldControl plus its per-field wiring (taxonomy picker
 *          config cache, source-value threading, hidden-default-locale stub,
 *          media asset-localization link, and inline per-locale inputs).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: FieldRenderer itself is intentionally NOT memoized — it
 * re-renders with the editor exactly like the inline render function it
 * replaced. What keeps typing cheap is the identity stability of the props it
 * FORWARDS to the memoized FieldControl: the editor owns and passes down the
 * onChangeFor closure cache, the sourceValueFnFor cache, the taxonomy config
 * cache ref, and the blockLocaleCtx map. Do not rebuild any of those here.
 */
import type { MutableRefObject } from 'react'
import { IconEye, IconGlobe } from '@tangen/icons'
import { isLocalizableFieldType } from '@tangen/types'
import type { FieldDefinition } from '@tangen/types'
import { FieldControl } from '@/components/fields/field-control'
import { LocalizedFieldInputs, type WorkingLocale, type LocaleColor } from '@/components/i18n/localized-field-inputs'
import type { TaxonomyPickerConfig } from '@/components/taxonomy/TaxonomyPicker'
import type { BlockLocaleCtx } from '@/lib/editor'
import type { VersionEntry } from '@/lib/use-object-versions'

/** Stable no-op for taxonomy configs without a primary sibling field. */
const noopPrimaryChange = () => {}

/** Entry-level field names referenced by a component field's block-visibility
 *  rules — the values getEntryValue can be asked for at render time. */
function componentCvFieldNames(field: FieldDefinition): string[] {
  const names: string[] = []
  const comps = (field.config as { components?: Array<{ conditionalVisibility?: unknown }> })?.components ?? []
  for (const c of comps) {
    const cv = c.conditionalVisibility as { rules?: Array<{ field?: string }>; field?: string } | undefined
    if (!cv) continue
    for (const r of cv.rules ?? [cv]) {
      if (r.field && !names.includes(r.field)) names.push(r.field)
    }
  }
  return names
}

/** The slice of a type definition the taxonomy wiring reads (matches the
 *  editor's AllTypeDef shape structurally). */
interface TargetTypeDef {
  name: string
  disabled?: boolean
  fields?: Array<{ name: string; fieldType: string; config?: { targetType?: string; many?: boolean } }>
  admin?: { taxonomy?: { hierarchical?: boolean; orderable?: boolean } }
}

export interface FieldRendererProps {
  field: FieldDefinition
  fieldValues: Record<string, unknown>
  validationErrors: Record<string, string>
  workspaceId: string
  typeName: string
  /** null on /new (no object id yet). */
  currentObjectId: string | null
  richTextKey: number
  relationReloadNonce: number
  taxonomyParentFieldName: string | null
  allTypeDefs: Map<string, TargetTypeDef>
  /** Current type's fields (primary-sibling lookup); undefined until loaded. */
  typeFields: FieldDefinition[] | undefined
  /** Editor-owned identity caches — pass through, never rebuild. */
  taxonomyCfgCache: MutableRefObject<Record<string, { deps: unknown[]; cfg: TaxonomyPickerConfig }>>
  onChangeFor: (name: string) => (v: unknown) => void
  sourceValueFnFor: (fieldName: string, deps: unknown[]) => (n: string) => unknown
  readEntryValue: (n: string) => unknown
  blockLocaleCtxByField: Record<string, BlockLocaleCtx>
  // Localization display state
  hideDefault: boolean
  visibleWorkingDefs: WorkingLocale[]
  viewingLive: boolean
  previewingVersion: VersionEntry | null
  localesInfo: { defaultLocale: string; locales: Array<{ code: string; label: string }> } | null
  toggleHiddenLocale: (code: string) => void
  setLocalizeAssetId: (id: string) => void
  localeColors: Record<string, LocaleColor>
  localeDrafts: Record<string, Record<string, unknown>>
  setLocaleField: (locale: string, name: string, value: unknown) => void
  canWriteLoc: (code: string, defaultLocale: string | undefined) => boolean
}

export function FieldRenderer(props: FieldRendererProps) {
  const {
    field, fieldValues, validationErrors, workspaceId, typeName, currentObjectId,
    richTextKey, relationReloadNonce, taxonomyParentFieldName, allTypeDefs, typeFields,
    taxonomyCfgCache, onChangeFor, sourceValueFnFor, readEntryValue, blockLocaleCtxByField,
    hideDefault, visibleWorkingDefs, viewingLive, previewingVersion, localesInfo,
    toggleHiddenLocale, setLocalizeAssetId, localeColors, localeDrafts, setLocaleField, canWriteLoc,
  } = props

  const isTaxonomyParent = !!(taxonomyParentFieldName && field.name === taxonomyParentFieldName)

  // Build TaxonomyPickerConfig for many:true relation fields targeting taxonomy types
  let taxonomyPickerConfig: TaxonomyPickerConfig | null = null
  if (field.fieldType === 'relation' && field.config?.many) {
    const tType = field.config.targetType
    const targetAdminDef = tType ? allTypeDefs.get(tType) : undefined
    if (targetAdminDef?.admin?.taxonomy) {
      const taxAdmin = targetAdminDef.admin.taxonomy
      // Self-referential parent field on the target type (for tree building)
      const parentField = targetAdminDef.fields?.find(
        f => f.fieldType === 'relation'
          && f.config?.targetType === tType
          && !f.config?.many,
      )?.name ?? null
      // Sibling many:false relation to the same type on THIS type (primary field)
      const primaryField = typeFields?.find(
        f => f.name !== field.name
          && f.fieldType === 'relation'
          && f.config?.targetType === tType
          && !f.config?.many,
      )
      const rawLabel = targetAdminDef.name.replace(/_/g, ' ')
      const typeLabel = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1)
      const primaryValue = primaryField ? (fieldValues[primaryField.name] as string | null) ?? null : null
      // Reuse the cached config while its inputs are unchanged - a fresh
      // object per render would defeat FieldControl's memo for this field.
      const cfgDeps = [!!taxAdmin.hierarchical, parentField, typeLabel, primaryField?.name ?? null, primaryValue]
      const hit = taxonomyCfgCache.current[field.name]
      if (hit && hit.deps.every((d, i) => d === cfgDeps[i])) {
        taxonomyPickerConfig = hit.cfg
      } else {
        taxonomyPickerConfig = {
          isHierarchical: !!taxAdmin.hierarchical,
          parentField,
          typeLabel,
          primaryValue,
          onPrimaryChange: primaryField ? onChangeFor(primaryField.name) : noopPrimaryChange,
        }
        taxonomyCfgCache.current[field.name] = { deps: cfgDeps, cfg: taxonomyPickerConfig }
      }
    }
  }

  // getSourceValue is passed only where FieldControl reads it (slug Generate,
  // component-section visibility) so every other control keeps a stable
  // undefined; see sourceValueFnFor for the identity contract.
  let getSourceValue: ((n: string) => unknown) | undefined
  if (field.fieldType === 'slug') {
    const source = (field.config as { source?: string })?.source
    if (source) getSourceValue = sourceValueFnFor(field.name, [readEntryValue(source)])
  } else if (field.fieldType === 'component') {
    const cvNames = componentCvFieldNames(field)
    getSourceValue = sourceValueFnFor(field.name, cvNames.map(readEntryValue))
  }

  const isLocalized = (field.config as any)?.localized === true && isLocalizableFieldType(field.fieldType)
  // Media values are id strings right after picking, expanded objects on load
  const rawMediaVal = field.fieldType === 'media' ? fieldValues[field.name] : null
  const mediaAssetId = typeof rawMediaVal === 'string' && rawMediaVal
    ? rawMediaVal
    : (rawMediaVal && typeof rawMediaVal === 'object' ? String((rawMediaVal as any).id ?? '') : '')
  const defaultHidden = hideDefault && isLocalized && visibleWorkingDefs.length > 0 && !viewingLive && !previewingVersion
  return (
    <>
      {defaultHidden ? (
        <button
          type="button"
          onClick={() => localesInfo && toggleHiddenLocale(localesInfo.defaultLocale)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-control border border-dashed border-border bg-surface-sunken px-3 py-2 text-ui-xs text-fg-subtle transition-colors motion-fast hover:border-border-strong hover:text-fg-muted"
          title="Show the default-locale value"
        >
          <IconEye className="size-3.5" />
          {localesInfo?.locales.find(l => l.code === localesInfo.defaultLocale)?.label ?? 'Default'} hidden
        </button>
      ) : (
        <FieldControl
          key={`${field.name}:${field.fieldType === 'relation' ? relationReloadNonce : 0}`}
          assetLocalization={false}
          field={field}
          value={fieldValues[field.name]}
          onChange={onChangeFor(field.name)}
          workspaceId={workspaceId}
          typeName={typeName}
          resetKey={richTextKey}
          isTaxonomyParent={isTaxonomyParent}
          currentObjectId={currentObjectId}
          taxonomyPickerConfig={taxonomyPickerConfig}
          getSourceValue={getSourceValue}
          serverError={validationErrors[field.name] ?? null}
          blockLocaleCtx={blockLocaleCtxByField[field.name]}
          targetTypeDisabled={
            field.fieldType === 'relation'
              ? allTypeDefs.get((field.config as { targetType?: string })?.targetType ?? '')?.disabled === true
              : false
          }
        />
      )}
      {/* Media fields: the asset itself carries per-language variants */}
      {mediaAssetId && localesInfo && !viewingLive && !previewingVersion && (
        <button
          type="button"
          onClick={() => setLocalizeAssetId(mediaAssetId)}
          className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 text-ui-xs text-accent-fg hover:underline"
          title="Serve a different asset per language - managed on the asset, applies everywhere it's used"
        >
          <IconGlobe className="size-3.5" />
          Manage localization
        </button>
      )}
      {/* Inline localization - one input per working locale under the default */}
      {isLocalized && !viewingLive && !previewingVersion && visibleWorkingDefs.length > 0 && (
        <LocalizedFieldInputs
          field={field}
          locales={visibleWorkingDefs.filter((l) => canWriteLoc(l.code, localesInfo?.defaultLocale))}
          colors={localeColors}
          drafts={localeDrafts}
          defaultValue={fieldValues[field.name]}
          defaultLabel={localesInfo?.locales.find(l => l.code === localesInfo.defaultLocale)?.label}
          onChange={(locale, v) => setLocaleField(locale, field.name, v)}
          workspaceId={workspaceId}
          typeName={typeName}
          resetKey={richTextKey}
        />
      )}
    </>
  )
}
