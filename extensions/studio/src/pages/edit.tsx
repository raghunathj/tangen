/**
 * File Name: edit.tsx
 * Purpose: Studio - the visual page editor. Center: the object's draft on
 *          the EXISTING live-preview bridge (LivePreviewCanvas + minted
 *          preview token). Left rail: the blocks field as a drag-sortable
 *          tree (reorder, duplicate, hide/show, delete). Right rail: the
 *          selected block's props edited with the REAL FieldControl; for
 *          kit.* blocks, token-typed props render as visual token pickers
 *          over the workspace's effective slot lists (GET tokens).
 *          Selection stays in sync with the preview overlay (studio:select
 *          in, studio:highlight out); every edit autosaves the draft
 *          through the object editor's own PATCH path.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A VIEW over the same object state as the editor -
 *          same load endpoint, same save path (buildUpdateBody + PATCH with
 *          noRevision on autosave), zero forked state. Tree ops reuse
 *          '@/lib/component-editor' pure functions. Renders as a
 *          full-viewport takeover (fixed inset-0) escaping the admin shell,
 *          same pattern as the flows canvas - the builder needs the width.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import type { ComponentDef, FieldDefinition, SubField } from '@tangen/types'
import {
  STUDIO_HIGHLIGHT_TYPE, STUDIO_OVERLAY_TYPE, STUDIO_MEASURE_TYPE,
  isStudioSelectMessage, isStudioReadyMessage, isStudioGeometryMessage,
  isStudioMeasuredMessage, type StudioBlockRect, templateKeyOf,
  STUDIO_STYLES_TYPE, writeValue, type StyleState, type StoredValue,
} from '@tangen/studio'
import { Button, EmptyState, toast, useConfirm, useRealtime, type RealtimeEvent } from '@/kit'
import { adminFetch } from '@/lib/api'
import { publishPolicyOfActions } from '@/lib/lifecycle-actions'
import type { LifecycleActions } from '@tangen/types'
import { useAuthStore } from '@/lib/auth'
import { StudioPresence } from '../components/studio-presence'
import { BlockPresence, CanvasPresenceBadges } from '../components/block-presence'
import { ChangedElsewhereNotice } from '@/components/object-editor/ChangedElsewhereNotice'
import { presenceFieldFor, rowAddresses, presenceObjectFor } from '../lib/presence'
import {
  isDesignChangeElsewhere, noticeFromEvent, recordDesignChange, noticesForBlock, formatDesignNotice,
  type DesignNotice,
} from '../lib/design-notice'
import { cachedWorkspaceGet } from '@/lib/api-cache'
import { PANEL_REGISTRY, panelRegistryKey } from '@/lib/app-panel-registry'
import { useCan } from '@/lib/use-can'
import { roleMeta } from '@/lib/role-meta'
import { useCapabilities } from '@/lib/use-capabilities'
import { getPreviewConfig, mintPreviewToken, buildPreviewUrl, type PreviewConfig } from '@/lib/preview'
import { useLocaleStore } from '@/lib/locale'
import {
  isTranslating, localeEditability, isLocalizedField, localizedRowFields, boundTranslationLock, type LocaleContext,
} from '../lib/locale-edit'
import {
  keyChain, readOverlayValue, writeOverlayValue, overlayField, seedOverlay,
  translationDraft, translationWrite, isInheritedTranslation,
  localizedTopFields, localizedContainerNames, previewValues, pruneOverlayForSave,
  pageLocaleTarget, instanceLocaleTarget, overlayDraftsFor, overlaySavedKey, canSaveLocale,
  type LocaleOverlay, type LocaleTarget,
} from '../lib/locale-overlay'
import { TranslateRows } from '../components/translate-rows'
import {
  extractFieldValues, normalizeObjectData, buildCreateBody, buildUpdateBody, validateFields, buildLocaleSavePayload,
} from '@/lib/editor'
import { reorderBlocks, duplicateBlock, removeBlock, buildEmptyBlock, type ComponentBlock } from '@/lib/component-editor'
import { useReusableComponents } from '@/lib/use-reusable-components'
import {
  LivePreviewCanvas, PreviewBreakpoints, usePreviewBreakpoints, type PreviewSnapshot,
} from '@/components/object-editor/LivePreviewPane'
import { clsx } from 'clsx'
import {
  IconCopy, IconEye, IconEyeOff, IconGripDots, IconTrash, IconUndo, IconX, IconChevronRight,
  IconSparkles, IconEdit, IconBrush, IconArticle,
  IconPlus, IconMinus, IconSearch, IconGlobe,
} from '@tangen/icons'
import * as TangenIcons from '@tangen/icons'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  blockRows, defFor, discoverStudioTypes, findBlocksField,
  type BlockRow, type StudioType, type StudioTypeCandidate,
} from '../lib/model'
import { pageRegions, resolveRegion } from '../lib/regions'
import {
  PAGE_DOC, resolveDocRef, documentScope, sameDoc, documentDropped, type EditedDocRef,
} from '../lib/documents'
import {
  previewTarget, previewTargetKey, canvasSnapshot, docForClickedKey,
  PREVIEW_OPENING, PREVIEW_TOKEN_REFUSAL, PREVIEW_NO_FRONTEND,
} from '../lib/canvas-target'
import {
  discoverInstanceType, instanceTitle, findInstanceCycle, pageBoundProps, pageBindingRefusal,
  referencedInstanceIds, INSTANCES_ROOT, INSTANCE_BLOCK_TYPE, INSTANCE_REF_PROPS,
  instanceAvailability, instanceRefOf, makeInstanceBlock, detachedBlocks,
  composeInstances, borrowedKeyOwners, canvasInstanceNote, usageSentence, usageConsequence,
  instanceReferences, relabelReferences,
  type InstanceSummary, type InstanceType, type InstanceUsage,
} from '../lib/instances'
import { InstancesPanel } from '../components/instances-panel'
import { InstanceDialog, type InstanceDialogValue } from '../components/instance-dialog'
import {
  planNewInstance, planInstanceFromSection, sectionRefusal, sectionCssWarning,
  planDuplicateInstance, type InstancePlan,
} from '../lib/instance-lifecycle'
import {
  pinSurfaces, surfaceSaveBody, canEditSurfaces, surfaceForKey, surfaceLabel,
  resolveSurface, draftBlocks, dirtySurfaces, withSavedSurface,
  type LoadedSurface, type SkippedGlobal, type SurfaceDrafts, type SurfaceAccess,
} from '../lib/global-surfaces'
import { SurfaceBand, SurfacePin } from '../components/surface-band'
import { visibleRows, hasChildren, toggleCollapsed } from '../lib/tree-collapse'
import { searchRows } from '../lib/tree-search'
import { sessionCollapse, collapseScope } from '../lib/collapse-store'
import { DEFAULT_TOKENS, type StudioTokens, type TokenFamily, type FontToken } from '../tokens'
import type { FontSource } from '../lib/theme-panel'
import { isKitBlock, tokenFamilyForField } from '../lib/style-panel'
import { TokenPicker, SwatchStrip } from '../components/token-picker'
import {
  toggleBlockHidden, setPropAtPath, blockAtPath, moveAtPath, duplicateAtPath, removeAtPath, replaceAtPath,
  type BlockPath,
} from '../lib/ops'
import { applyStudioSkin } from '../lib/skin'
import { wrapperFieldsFor, readWrapper, writeWrapper, STUDIO_WRAPPER_PROP } from '../lib/wrapper'
import { wrapForInsert } from '../lib/autosection'
import { FALLBACK_ICON } from '../lib/block-icon'
import { normalizeLabel } from '../lib/rename'
import {
  emptyHistory, pushHistory, undo as undoHistory, redo as redoHistory,
  type History,
} from '../lib/history'
import { suggestSectionsFor, type SectionSuggestion } from '../lib/suggestions'
import { CanvasToolbar, type CanvasRect } from '../components/canvas-toolbar'
import { SelectParent } from '../components/select-parent'
import { parentPath } from '../lib/canvas-resize'
import { InlineEditor, type InlineEditTarget } from '../components/inline-editor'
import { DropOverlay, type DropIndicator } from '../components/drop-overlay'
import { resolveDropPoint, canDrop, allowedChildTypes, type DropPoint } from '../lib/drop'
import { frameOffsetOf, toCanvasRect, toFrameY, NO_OFFSET, type Offset } from '../lib/canvas-frame'
import { ZOOM_STEPS, zoomIn, zoomOut } from '../lib/zoom'
import { inlineEditableProp, isDoubleSelect, type LastSelect } from '../lib/inline-edit'
import { statusMeta } from '../lib/viewport'
import { patchDraft, patchLocaleDraft, studioSaveValues } from '../lib/save'
import { resolvePaletteComponents, insertBlockAt, splitPalette } from '../lib/palette'
import { cloneWithFreshKeys, mintBlockKey, type StudioPreset } from '../lib/presets'
import { PaletteBody, DescribeBox } from '../components/palette-panel'
import { ComponentsPanel } from '../components/components-panel'
import { DataPanel } from '../components/data-panel'
import { loopAvailability, bindLoopToCollection, LOOP_TYPE, type CollectionRef } from '../lib/data-panel'
import { IconRail } from '../components/icon-rail'
import {
  togglePanel, clampPanelWidth, clampInspectorWidth, DEFAULT_PANEL_WIDTH, DEFAULT_INSPECTOR_WIDTH,
  PANEL_WIDTH_KEY, INSPECTOR_WIDTH_KEY, studioPanels, resolvePanel, type PanelState,
} from '../lib/panels'
import { RailResizeHandle } from '../components/rail-resize-handle'
import { PresetNameDialog } from '../components/preset-name-dialog'
import { GenerateDialog } from '../components/generate-dialog'
import { BindControl } from '../components/bind-control'
import { QueryBuilderPanel } from '../components/query-builder-panel'
import { canUseCreativeStyles, type StyleMode } from '../lib/governance'
import { creativeToStyle, withoutCreativeStyle } from '../lib/creative-migration'
import { CREATIVE_STYLE_PROP } from '../lib/creative-style'
import { RAW_CSS_OVERRIDE, customCssError } from '../lib/custom-css'
import { findLoopContext, isBindableProp, bindableSourceFields, boundPath, type SourceField } from '../lib/binding'
import { rectFor } from '../lib/rects'
import { inspectorTabs, resolveActiveTab, type InspectorItem, type InspectorTab } from '../lib/inspector-tabs'
import { pageInspectorSections } from '../lib/page-inspector'
import { PageSwitcher } from '../components/page-switcher'
import { PagesPanel } from '../components/pages-panel'
import { MediaPanel, type StudioMediaAsset } from '../components/media-panel'
import { mediaTarget, imagePlacement, draggedBlockType } from '../lib/media-drop'
import { PublishMenu } from '../components/publish-menu'
import { LocaleMenu } from '../components/locale-menu'
import { ReviewChip } from '../components/review-chip'
import { SubmitReviewDialog } from '../components/submit-review-dialog'
import { ReviewActionDialog, type ReviewActionKind } from '../components/review-action-dialog'
import { reviewChipState } from '../lib/review-state'
import { pageStatus } from '../lib/page-status'
import { policyActionPath, type PublishActionId } from '../lib/publish-menu'
import { StylePanel } from '../components/style-panel'
import { classForEditing, classForPart, breakpointForWidth, statesFor, breakpointLabel } from '../lib/style-session'
import { forkClassName } from '../lib/provenance'
import { blockProtection, partTargets } from '../lib/style-protection'
import type { Refusal } from '@tangen/studio-compiler'
import { tagByName, type StudioTag } from '../lib/tag-defaults'
import { autoClassName, classUsage, classesOf, targetsPart, withClass, withoutClass, type StyleClass } from '../lib/classes'
import { mergeReferences } from '../lib/class-usage'
import { mergeSummary, deleteSummary, type UsageMap } from '../lib/housekeeping'
import type { ClassHousekeepingProps } from '../components/class-housekeeping'
import { tokenPropsToStyle } from '../lib/token-migration'
import { canonicalizeTokenValue, type AnyInteraction } from '@tangen/studio-schema'
import {
  emptyStyleHistory, pushStyleEdit, undoStyle, redoStyle, type StyleOp,
} from '../lib/style-history'
import { createStyleWriter, createStyleLedger } from '../lib/style-writes'
import {
  emptyLanes, recordLane, nextUndoLane, nextRedoLane, commitUndo, commitRedo, dropLane, type LaneOrder,
} from '../lib/undo-lanes'
import { VariablesPanel } from '../components/variables-panel'
import { SectionCssControl } from '../components/section-css-control'
import {
  readSectionCss, writeSectionCss, sectionCssState, pageStyles, pageCssState, protectionsFromDefs, SECTION_CSS_OVERRIDE,
} from '../lib/section-css'
import { tokenTarget } from '../lib/token-apply'
import { Breadcrumb } from '../components/breadcrumb'
import { breadcrumbFor } from '../lib/breadcrumb'
import { inspectorTrail } from '../lib/inspector-trail'
import { NewPageDialog } from '../components/new-page-dialog'
import { controlKind, rowLayout, tokenLayout, type ControlKind } from '../lib/control-kind'
import { InspectorRow, CompactText, CompactControl } from '../components/inspector-row'
import type { FieldGroup } from '../lib/field-group'

interface TypeDef {
  name: string
  label?: string
  fields: FieldDefinition[]
}

interface LoadedObject {
  id: string
  title: string | null
  slug: string | null
  status: string
  [key: string]: unknown
}

/** Trailing-slash-insensitive origin equality (mirrors the preview pane). */
function sameOrigin(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '')
}

const AUTOSAVE_MS = 800

/**
 * One frozen empty map for "this document has no overlay drafts". Shared so
 * the value is referentially stable: the locale save effect depends on it,
 * and a fresh `{}` per render would reschedule the debounce forever.
 */
const NO_OVERLAY_DRAFTS: Record<string, LocaleOverlay> = Object.freeze({})

/**
 * What is pushed when there is no document to push. The canvas is not
 * rendered in that state (it shows the reason instead), so this is a shape
 * the prop demands rather than anything a frame ever receives.
 */
const EMPTY_SNAPSHOT: PreviewSnapshot = Object.freeze({ id: '', type: '', values: Object.freeze({}) as Record<string, unknown> })

/** Every icon action in the top bar, so the row stays on one rhythm. */
const ICON_BTN = 'grid place-items-center size-7 shrink-0 rounded-md text-fg-subtle '
  + 'hover:text-fg hover:bg-surface-hover disabled:opacity-30 disabled:hover:bg-transparent '
  + 'transition-colors duration-(--tg-motion-fast)'

/** kit.loop props the Query Builder panel owns - the rail skips them. */
const QUERY_BUILDER_PROPS = new Set(['source', 'query', 'sortField', 'sortDirection'])

// ── One drag-sortable tree row ────────────────────────────────────────────────

interface TreeRowProps {
  row: BlockRow
  selected: boolean
  /** Something nests under this row, so it earns a chevron. */
  expandable: boolean
  collapsed: boolean
  /** Answers the navigator search - drawn so it stands out from its ancestors. */
  hit?: boolean
  onToggleCollapse: (key: string) => void
  onSelect: (row: BlockRow) => void
  onRename: (row: BlockRow, name: string | undefined) => void
  onDuplicate: (index: number) => void
  onToggleHidden: (index: number) => void
  onDelete: (index: number) => void
  /** Who else is editing this block right now (BlockPresence); null when nobody. */
  presence?: ReactNode
}

/** Resolve an icon NAME to its component; unknown names fall back safely. */
function iconFor(name: string) {
  const set = TangenIcons as unknown as Record<string, typeof IconGripDots | undefined>
  return set[name] ?? set[FALLBACK_ICON] ?? IconGripDots
}

function TreeRow({
  row, selected, expandable, collapsed, hit, onToggleCollapse,
  onSelect, onRename, onDuplicate, onToggleHidden, onDelete, presence,
}: TreeRowProps) {
  const Icon = iconFor(row.icon)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.key })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx('group', isDragging && 'opacity-60 z-10 relative')}
    >
      <div
        data-studio-row={row.key}
        // Indent is PADDING, not margin: the selected row's highlight then
        // spans the full rail like Webflow's, instead of starting at the
        // indent and leaving a notch down the left edge.
        style={{ paddingLeft: row.depth * 14 }}
        className={clsx(
          'relative flex items-center gap-0.5 pr-1 transition-colors duration-(--tg-motion-fast)',
          selected ? 'bg-accent text-white' : 'hover:bg-surface-hover',
        )}
      >
        {/* Guide lines, one per level, so a deep row's parentage is visible
            without counting pixels. */}
        {Array.from({ length: row.depth }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className="absolute top-0 bottom-0 w-px bg-border/60"
            style={{ left: 7 + i * 14 }}
          />
        ))}
        {expandable ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(row.key) }}
            title={collapsed ? 'Expand' : 'Collapse'}
            className={clsx(
              'grid place-items-center size-4 shrink-0 rounded',
              selected ? 'text-white/80 hover:text-white' : 'text-fg-subtle hover:text-fg',
            )}
          >
            <IconChevronRight className={clsx('size-3 transition-transform duration-(--tg-motion-fast)', !collapsed && 'rotate-90')} />
          </button>
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )}
        {/* Loop template widgets are positioned by the loop, not the tree:
            they carry no drag handle and no reorder/duplicate/delete. */}
        {row.depth > 0 ? (
          <span className="size-5 shrink-0" aria-hidden />
        ) : (
          <button
            type="button"
            {...attributes}
            {...listeners}
            title="Drag to reorder"
            className={clsx(
              'grid place-items-center size-5 shrink-0 rounded opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing',
              selected ? 'text-white/70' : 'text-fg-subtle',
            )}
          >
            <IconGripDots className="size-3" />
          </button>
        )}
        {renaming ? (
          <span className="flex-1 min-w-0 flex items-center gap-2 py-1">
            <Icon className="size-3.5 shrink-0 text-fg-subtle" />
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft((e.target as HTMLInputElement).value)}
              onBlur={() => { onRename(row, normalizeLabel(draft)); setRenaming(false) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { onRename(row, normalizeLabel(draft)); setRenaming(false) }
                // Escape abandons the edit without writing anything.
                if (e.key === 'Escape') { e.stopPropagation(); setRenaming(false) }
              }}
              className="flex-1 min-w-0 rounded border border-accent bg-surface px-1 py-0.5 text-sm text-fg outline-none"
            />
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onSelect(row)}
            onDoubleClick={() => { setDraft(row.label); setRenaming(true) }}
            title="Double-click to rename"
            className={clsx(
              'flex-1 min-w-0 flex items-center gap-1.5 py-1 text-left text-(length:--tg-text-label)',
              selected ? 'text-white' : 'text-fg',
              row.hidden && 'opacity-50',
            )}
          >
            <Icon className={clsx('size-3.5 shrink-0', selected ? 'text-white/90' : 'text-fg-subtle')} />
            <span className={clsx('flex-1 min-w-0 truncate', hit && !selected && 'font-semibold text-accent-fg')}>{row.label}</span>
            {presence}
          </button>
        )}
        {row.depth === 0 && (
          <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
            <button
              type="button"
              title={row.hidden ? 'Show section' : 'Hide section'}
              onClick={() => onToggleHidden(row.index)}
              className="grid place-items-center size-5 rounded text-fg-subtle hover:text-fg hover:bg-surface-sunken"
            >
              {row.hidden ? <IconEyeOff className="size-3.5" /> : <IconEye className="size-3.5" />}
            </button>
            <button
              type="button"
              title="Duplicate section"
              onClick={() => onDuplicate(row.index)}
              className="grid place-items-center size-5 rounded text-fg-subtle hover:text-fg hover:bg-surface-sunken"
            >
              <IconCopy className="size-3.5" />
            </button>
            <button
              type="button"
              title="Delete section"
              onClick={() => onDelete(row.index)}
              className="grid place-items-center size-6 rounded text-fg-subtle hover:text-danger hover:bg-danger-muted"
            >
              <IconTrash className="size-3.5" />
            </button>
          </span>
        )}
        {row.hidden && <IconEyeOff className="size-3.5 shrink-0 text-fg-subtle group-hover:hidden" />}
      </div>
    </li>
  )
}

// ── The page ──────────────────────────────────────────────────────────────────

export function StudioEditPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [searchParams] = useSearchParams()
  const type = searchParams.get('type')
  const id = searchParams.get('id')

  /**
   * Class and tag WRITES name the page they came from (`?objectId=`), so the
   * change notice the server announces reaches the editors of THIS page on
   * `studio:<id>` and not only the class library topic. The routes stay
   * page-agnostic. Read through a ref so the callbacks below, which depend
   * on `id`, never send a page that is no longer open.
   */
  const designPageRef = useRef({ id })
  designPageRef.current = { id }
  /**
   * When a design write was last ISSUED from this page. A write carries this
   * tab's realtime origin and its echo is recognised by that alone - except in
   * the first moments after mount, before the socket said `ready` and there was
   * an origin to send. This covers that gap, the way the object editor's
   * saveIssuedAt does. See docs/realtime.md, "Was this my own write?".
   */
  const designIssuedAtRef = useRef<number | null>(null)
  const designFetch = useCallback(<T,>(path: string, init: RequestInit): Promise<T> => {
    const { id: objectId } = designPageRef.current
    if ((init.method ?? 'GET').toUpperCase() !== 'GET') designIssuedAtRef.current = Date.now()
    return adminFetch<T>(path, e ?? '', init, objectId ? { objectId } : undefined)
  }, [])

  const [typeDef, setTypeDef] = useState<TypeDef | null>(null)
  const [object, setObject] = useState<LoadedObject | null>(null)
  const [title, setTitle] = useState('')
  /** Editable here, but sent only when CHANGED - the object editor's rule, so
   *  an untouched autosave never trips the server's slug uniqueness check. */
  const [slug, setSlug] = useState('')
  const slugDirty = useRef(false)
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({})
  const [previewCfg, setPreviewCfg] = useState<PreviewConfig | null>(null)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  /**
   * The message listener is registered once per preview, so a closure over
   * `selectedKey` would go stale the first time selection changed. A ref
   * keeps it reading the live value.
   */
  const selectedKeyRef = useRef<string | null>(null)
  /** Same staleness problem as selection: the listener is registered once. */
  const rowsRef = useRef<BlockRow[]>([])
  const blocksRef = useRef<ComponentBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** Bumped by the changed-elsewhere notice's Reload: the load effect runs again, replacing unsaved edits with the server copy. */
  const [reloadTick, setReloadTick] = useState(0)
  /** Server `updated_at` of the copy held here, so an own save echoing back is not a conflict. */
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  /**
   * Epoch ms of the write this editor last issued; its echo on the socket is
   * never "changed elsewhere". The notice reads it as a prop at render time
   * and the echo can arrive before the HTTP response re-renders anything, so
   * a stamp forces one render of its own.
   */
  const saveIssuedAtRef = useRef<number | null>(null)
  const [, setIssuedTick] = useState(0)
  const stampIssued = useCallback(() => {
    saveIssuedAtRef.current = Date.now()
    setIssuedTick((t) => t + 1)
  }, [])
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  /**
   * Preview MODE: block selection stops, so the page reads as a visitor
   * sees it. Chrome hiding follows from that, not the other way round.
   * `restore` remembers the layout so leaving preview returns you to your
   * workspace instead of a collapsed one.
   */
  const [preview, setPreview] = useState(false)
  const restoreRef = useRef<{ panelOpen: boolean } | null>(null)
  /** Whether the site's overlay understands suspend (studio:ready handshake). */
  const [overlayCanSuspend, setOverlayCanSuspend] = useState<boolean | null>(null)
  /**
   * Where each block physically is, in the PREVIEW's viewport coordinates.
   * A ref, not state: this updates on every scroll frame and nothing renders
   * from it yet - the hover toolbar (E-T3), inline editing (E-T4) and drop
   * indicators (E-T5) are what will read it.
   */
  const geometryRef = useRef<Map<string, StudioBlockRect['rect']>>(new Map())
  // Which rendered occurrence of the selected block was clicked. A loop
  // renders one stored block once per record, so the block being EDITED
  // and the box being OUTLINED are two different identities.
  const selectedInstanceRef = useRef<string | null>(null)
  /**
   * Just the SELECTED block's box, in state so the toolbar can follow it.
   * The full map stays a ref: it changes every scroll frame, and rendering
   * the whole editor at that rate for one floating bar would be absurd.
   */
  const [selectedRect, setSelectedRect] = useState<CanvasRect | null>(null)
  /**
   * Undo history over the block tree. Every change funnels through
   * setBlocks, so this one stack covers the tree, the rail, the canvas
   * toolbar, inline typing and drops together.
   */
  const historyRef = useRef<History | null>(null)
  /**
   * Style edits live on the SERVER, so they need their own stack of inverse
   * PATCHes - a tree snapshot cannot express them. `lanesRef` is what keeps
   * the two unwinding in the order they were made, so Cmd+Z stays "undo the
   * last thing I did" rather than "undo the last BLOCK thing I did".
   */
  const styleHistoryRef = useRef(emptyStyleHistory())
  const lanesRef = useRef<LaneOrder>(emptyLanes())
  const [historyTick, setHistoryTick] = useState(0)
  /** Read through the tick so the buttons re-evaluate when history moves. */
  const undoable = useMemo(
    // Read through the lane order, not either stack: a style step is
    // undoable even when the block tree has not been touched at all.
    () => ({ back: !!nextUndoLane(lanesRef.current), fwd: !!nextRedoLane(lanesRef.current) }),
    [historyTick],
  )
  /**
   * Where the iframe sits inside the overlay container. The preview canvas
   * pads it, centres it, and puts it in a SCROLLING box, so this changes on
   * scroll, on resize and when the preview width changes - and every overlay
   * position has to be corrected by it.
   */
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [frameOffset, setFrameOffset] = useState<Offset>(NO_OFFSET)
  /** Canvas zoom. A CSS transform on the frame; every geometry read
   *  scales with it (see canvas-frame.ts) or overlays drift off the page. */
  const [zoom, setZoom] = useState(1)
  const navigate = useNavigate()
  // The SAME locale store the rest of the admin uses - Studio must not keep
  // its own idea of which language is being looked at.
  const localeStore = useLocaleStore()
  useEffect(() => {
    if (workspaceId) void localeStore.hydrate(workspaceId)
  }, [workspaceId])
  // `localeCtx` (what may be edited in this language) is built further
  // down, once the type and its component defs are known.

  // The canvas address is built in ONE place now (see "the canvas follows the
  // active document" below), from the document being edited and the locale
  // being read. A locale change moves it like any other change of target.
  const [newPageOpen, setNewPageOpen] = useState(false)
  /** The debounced save waiting to run, so navigation can flush it. */
  const pendingSaveRef = useRef<(() => Promise<void>) | null>(null)

  // Page switcher. The lists load on OPEN, not on mount: Studio already makes
  // several requests to boot, and most sessions never touch the switcher.
  const [switcherTypes, setSwitcherTypes] = useState<StudioType[]>([])
  const [switcherRows, setSwitcherRows] = useState<Record<string, unknown[]>>({})
  const [switcherLoading, setSwitcherLoading] = useState(false)
  const switcherLoaded = useRef(false)

  const loadSwitcher = useCallback(() => {
    if (switcherLoaded.current) return
    switcherLoaded.current = true
    setSwitcherLoading(true)
    ;(async () => {
      try {
        const res = await adminFetch<{ data: StudioTypeCandidate[] }>('/types')
        const types = discoverStudioTypes(res.data ?? [])
        const lists = await Promise.all(types.map(async (t) => {
          try {
            const r = await adminFetch<{ data: Array<Record<string, unknown>> }>(
              `/objects/${t.type}/query`,
              { method: 'POST', body: JSON.stringify({ page: 1, limit: 50 }) },
            )
            return [t.type, (r.data ?? []).map((d) => normalizeObjectData(d))] as const
          } catch {
            // One unreadable type must not blank the whole switcher.
            return [t.type, []] as const
          }
        }))
        setSwitcherTypes(types)
        setSwitcherRows(Object.fromEntries(lists))
      } catch {
        switcherLoaded.current = false   // let a retry happen on next open
      } finally {
        setSwitcherLoading(false)
      }
    })()
  }, [])
  /** The component being dragged from the palette, if any. */
  const [dragType, setDragType] = useState<string | null>(null)
  /** The asset being dragged from the Media panel, if any. */
  const [dragAsset, setDragAsset] = useState<StudioMediaAsset | null>(null)
  /** The collection being dragged from the Data panel - it lands as a bound loop. */
  const [dragCollection, setDragCollection] = useState<CollectionRef | null>(null)
  /** What would land on the canvas: a palette type, or the block a dragged asset becomes. */
  const draggingType = dragType ?? (dragAsset ? draggedBlockType(dragAsset.mimeType) : null)
  const [dropPoint, setDropPoint] = useState<DropPoint | null>(null)
  const [dropOk, setDropOk] = useState(true)
  /** The block being typed into on the canvas, if any. */
  /** `overlayChain` set = the typing lands in the locale overlay, not the draft. */
  const [inlineEdit, setInlineEdit] = useState<(InlineEditTarget & { overlayChain: string[] | null; source?: unknown }) | null>(null)
  /** Last select, so a second one on the same block reads as a double-click. */
  const lastSelectRef = useRef<LastSelect | null>(null)
  /** What a pending measure reply is for - a reply for anything else is stale. */
  const pendingEditRef = useRef<{ key: string; instance: string; prop: string; initial: string; overlayChain: string[] | null; source?: unknown } | null>(null)

  /**
   * Auto-wrap inserts in a section, so a bare widget arrives with a
   * background, padding and width instead of flush against the page edge.
   * On by default; the Add panel offers the escape.
   */
  const [autoSection, setAutoSection] = useState(true)
  /** Which left panel is showing. Blocks leads - it is what you came to edit. */
  const [panels, setPanels] = useState<PanelState>({ panel: 'blocks', open: true })
  // Both rails resize by their edge and remember the width per browser: the
  // canvas is the subject, so the layout should stay put between visits.
  // Saved on release, not on every move.
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    if (typeof localStorage === 'undefined') return DEFAULT_PANEL_WIDTH
    return clampPanelWidth(Number(localStorage.getItem(PANEL_WIDTH_KEY)))
  })
  const [inspectorWidth, setInspectorWidth] = useState<number>(() => {
    if (typeof localStorage === 'undefined') return DEFAULT_INSPECTOR_WIDTH
    return clampInspectorWidth(Number(localStorage.getItem(INSPECTOR_WIDTH_KEY)))
  })
  const rememberWidth = useCallback((key: string, width: number) => {
    try { localStorage.setItem(key, String(width)) } catch { /* private mode: the width lasts the session */ }
  }, [])
  const [generateOpen, setGenerateOpen] = useState(false)
  const [presets, setPresets] = useState<StudioPreset[]>([])
  /** Name dialog target: 'new' saves the selected block; a preset renames it. */
  const [nameDialog, setNameDialog] = useState<{ mode: 'new' } | { mode: 'rename'; preset: StudioPreset } | null>(null)
  const { can, hasCapability, canWriteLocale, me, ready } = useCan()
  /** The deployment role's colour language - shared with the admin shell. */
  const { flags: bootstrapFlags } = useCapabilities(workspaceId)
  const env0 = useMemo(() => roleMeta(bootstrapFlags.deploymentRole), [bootstrapFlags.deploymentRole])

  // The skin goes on the document root, not just this subtree: dialogs and
  // sheets portal to document.body, so a subtree scope would leave them
  // light on top of a dark builder.
  useEffect(() => applyStudioSkin(typeof document === 'undefined' ? null : document.documentElement), [])
  const canManagePresets = hasCapability('studio:manage' as never)
  /**
   * May this member DESIGN (decision 3, 2026-08-25)?
   *
   * `studio:edit` is the Studio session and the page's content; `studio:design`
   * is the class store, the workspace theme, tag defaults, interactions and
   * the stylesheet - things that reach every page of the workspace, not just
   * this one. A marketer holds the first, a designer holds both.
   *
   * Everything the capability governs is HIDDEN rather than shown disabled:
   * a Style panel that renders and refuses every save is a control that
   * appears to work, which is worse than not being there. The server enforces
   * the same capability on every one of those writes.
   */
  const canDesign = hasCapability('studio:design' as never)
  /** The icon rail this member gets - Variables is a design panel. */
  const railPanels = useMemo(() => studioPanels({ canDesign }), [canDesign])
  // The bundle arrives after the first render, so the rail can narrow under a
  // panel that is already open. Land on one that exists rather than on an
  // empty aside.
  useEffect(() => { setPanels((p) => resolvePanel(railPanels, p)) }, [railPanels])
  // Two DIFFERENT questions, and both must hold. `studio:edit` says you may
  // use Studio at all; the per-type object permissions say whether you may
  // change THIS content. Gating only on the first lets a member edit freely
  // and then collect a 403 from the server on save.
  const canPublish = type ? can('publish', 'objects', type) : false
  const canEditPage = type ? can('update', 'objects', type) : false

  // ── Shared surfaces (N-T7): the header and footer every page wears ────────
  // Globals with a blocks field. Pinned OUTSIDE the page's own sections
  // because they behave differently in the one way that matters: a global
  // has no draft, so a save is live on every page at once. The editor edits
  // one DOCUMENT at a time - the page's region, or one surface - through the
  // same blocks/rows/inspector/style machinery; `activeSurface` says which.
  const [surfaces, setSurfaces] = useState<LoadedSurface[]>([])
  const [skippedSurfaces, setSkippedSurfaces] = useState<SkippedGlobal[]>([])
  /** Unsaved blocks per surface. Absent means "what is stored". */
  const [surfaceDrafts, setSurfaceDrafts] = useState<SurfaceDrafts>({})
  /**
   * WHICH DOCUMENT is being edited: the page's region, a shared surface, or
   * an instance. One value rather than a flag per kind, because every seam
   * below - the blocks field, the tree, undo, the folds, presence, the save
   * path - has to agree about it, and three booleans agree by accident.
   */
  const [wantedDoc, setWantedDoc] = useState<EditedDocRef>(PAGE_DOC)
  /** The surface-shaped setter the bands and pinned rows already speak. */
  const setWantedSurface = useCallback((global: string | null) => {
    setWantedDoc(global ? { kind: 'surface', global } : PAGE_DOC)
  }, [])
  const [surfaceSaving, setSurfaceSaving] = useState<string | null>(null)
  /** For the frame's message listener, which is bound once. */
  const surfacesRef = useRef<LoadedSurface[]>([])
  /** Borrowed block key -> the reference row that brought it onto this page. */
  const borrowedOwnersRef = useRef<Map<string, string>>(new Map())
  const activeSurfaceRef = useRef<string | null>(null)
  /** The whole document, for the listener that is bound once. */
  const activeDocRef = useRef<EditedDocRef>(PAGE_DOC)
  /** A key to select once the document switch has reset selection. */
  const pendingSelectRef = useRef<string | null>(null)
  useEffect(() => {
    let alive = true
    adminFetch<{ data: { surfaces: LoadedSurface[]; skipped: SkippedGlobal[] } }>('/admin/ext/studio/surfaces')
      .then((r) => {
        if (!alive) return
        setSurfaces(r.data?.surfaces ?? [])
        setSkippedSurfaces(r.data?.skipped ?? [])
      })
      .catch(() => { if (alive) { setSurfaces([]); setSkippedSurfaces([]) } })
    return () => { alive = false }
  }, [])
  // ── Instances (I1): one shared authored tree, referenced from many pages ──
  // An Instance is a CONTENT OBJECT of a type the site declares, so opening
  // one opens a second document that has a draft of its own - which is why it
  // autosaves like the page and unlike a surface. Everything downstream reads
  // the ACTIVE DOCUMENT rather than asking "is a surface open?", which is
  // what lets a third kind exist without a ternary at every seam.
  const [instanceType, setInstanceType] = useState<InstanceType | null>(null)
  const [instanceReason, setInstanceReason] = useState<string | null>(null)
  const [instanceRows, setInstanceRows] = useState<InstanceSummary[]>([])
  const [instancesLoading, setInstancesLoading] = useState(true)
  const [instancesError, setInstancesError] = useState<string | null>(null)
  /**
   * The instance open on the canvas, as stored; its unsaved edits sit beside
   * it. Its slug and status travel with it because the CANVAS needs them: an
   * instance is previewed as itself, so a preview URL addressed by slug has
   * to have the instance's, never the page's.
   */
  const [openInstance, setOpenInstance] = useState<
    { id: string; title: string; slug?: string; status?: string; updatedAt?: string; blocks: ComponentBlock[] } | null
  >(null)
  /** Bumped by the changed-elsewhere notice's Reload while an INSTANCE is open. */
  const [instanceReloadTick, setInstanceReloadTick] = useState(0)
  /** The instance type's own blocks field - the palette and protection read it. */
  const [instanceField, setInstanceField] = useState<FieldDefinition | null>(null)
  /** The instance type's whole definition - the locale overlay reads its fields. */
  const [instanceTypeDef, setInstanceTypeDef] = useState<TypeDef | null>(null)
  /** The OPEN instance's own translations, keyed by locale: its side row, never the page's. */
  const [instanceI18n, setInstanceI18n] = useState<Record<string, Record<string, unknown>>>({})
  /** Unsaved blocks of the open instance. Null means "what is stored". */
  const [instanceDraft, setInstanceDraft] = useState<ComponentBlock[] | null>(null)

  const loadInstances = useCallback(async () => {
    setInstancesLoading(true)
    try {
      const r = await adminFetch<{ data: { type: InstanceType | null; reason: string | null; instances: InstanceSummary[] } }>(
        '/admin/ext/studio/instances',
      )
      setInstanceType(r.data?.type ?? null)
      setInstanceReason(r.data?.reason ?? null)
      setInstanceRows(r.data?.instances ?? [])
      setInstancesError(null)
    } catch (err) {
      setInstanceType(null)
      setInstanceRows([])
      setInstancesError(err instanceof Error ? err.message : 'Could not read the instances')
    } finally {
      setInstancesLoading(false)
    }
  }, [])
  useEffect(() => { void loadInstances() }, [loadInstances])

  /**
   * Usage across the whole environment, by instance id. Null until it has
   * been counted: "nobody uses this" and "nobody has counted yet" are
   * different facts, and only one of them is safe to delete on.
   *
   * A scan of every page, so it is loaded once per editor session and again
   * after a delete, never on a keystroke.
   */
  const [instanceUsage, setInstanceUsage] = useState<Record<string, InstanceUsage> | null>(null)
  const loadInstanceUsage = useCallback(async () => {
    try {
      const r = await adminFetch<{ data: { usage: Record<string, InstanceUsage> } }>(
        '/admin/ext/studio/instances/usage',
      )
      setInstanceUsage(r.data?.usage ?? {})
    } catch {
      // A failed count leaves the panel saying nothing about usage, which is
      // the honest state - never "0 usages", which invites a delete.
      setInstanceUsage(null)
    }
  }, [])
  useEffect(() => { void loadInstanceUsage() }, [loadInstanceUsage])

  /**
   * The PUBLISHED tree of every instance, so the canvas can fill a reference
   * instead of showing a gap where one sits.
   *
   * Published, not draft, on purpose: a page is laid out against what a
   * visitor gets. The one exception is the instance being EDITED, whose
   * draft the editor already holds - see `previewBlocks`.
   */
  const [instanceTrees, setInstanceTrees] = useState<Record<string, unknown> | null>(null)
  const loadInstanceTrees = useCallback(async () => {
    try {
      const r = await adminFetch<{ data: { published: Record<string, unknown> } }>(
        '/admin/ext/studio/instances/trees',
      )
      setInstanceTrees(r.data?.published ?? {})
    } catch {
      // Unresolved references then render as they did before: nothing, and
      // the reference row still says which instance it points at.
      setInstanceTrees(null)
    }
  }, [])
  useEffect(() => { void loadInstanceTrees() }, [loadInstanceTrees])

  /**
   * The document actually being edited. A wish outlives what it points at -
   * an instance a colleague deleted, a surface list that has not arrived -
   * so it resolves against what EXISTS and falls back to the page.
   */
  const activeDoc = useMemo(() => resolveDocRef(wantedDoc, {
    surfaces: surfaces.map((s) => s.surface.global),
    instances: instanceRows.map((i) => i.id),
  }), [wantedDoc, surfaces, instanceRows])
  /**
   * ...and when that fallback happens to an INSTANCE, it is said out loud.
   * Edit instance on a reference whose instance was deleted, or which this
   * role cannot read, would otherwise be a control that appears to work and
   * does nothing: the tree, the canvas and the inspector all stay on the page
   * with no reason given.
   */
  useEffect(() => {
    const dropped = documentDropped({ wanted: wantedDoc, active: activeDoc, ready: !instancesLoading })
    if (!dropped) return
    setWantedDoc(PAGE_DOC)
    toast.error(dropped.title, dropped.detail)
  }, [wantedDoc, activeDoc, instancesLoading])
  const activeSurface = activeDoc.kind === 'surface' ? resolveSurface(surfaces, activeDoc.global) : null
  const activeSurfaceName = activeSurface?.surface.global ?? null
  const activeInstanceId = activeDoc.kind === 'instance' ? activeDoc.id : null
  const activeInstance = useMemo(
    () => (activeInstanceId ? instanceRows.find((i) => i.id === activeInstanceId) ?? null : null),
    [activeInstanceId, instanceRows],
  )
  /** "Instance: Latest Articles" - what the panel header, the band and the inspector say. */
  const activeInstanceLabel = activeInstance
    ? `Instance: ${instanceTitle(activeInstance)}`
    : openInstance ? `Instance: ${instanceTitle(openInstance)}` : 'Instance'

  // The instance type's blocks field, fetched once the type is known rather
  // than when one is opened: a palette that arrives after the tree would show
  // an editor with nothing insertable for a beat.
  useEffect(() => {
    if (!instanceType) { setInstanceField(null); setInstanceTypeDef(null); return }
    let alive = true
    adminFetch<{ data: TypeDef }>(`/types/${instanceType.type}`)
      .then((r) => {
        if (!alive) return
        // The WHOLE definition is kept, not only the blocks field: the
        // locale overlay needs the type's localized fields and its localized
        // containers to know what an instance even has to translate.
        setInstanceTypeDef(r.data ?? null)
        setInstanceField(findBlocksField(r.data?.fields, instanceType.blocksField))
      })
      .catch(() => { if (alive) { setInstanceField(null); setInstanceTypeDef(null) } })
    return () => { alive = false }
  }, [instanceType])

  // The open instance's stored blocks. Read through the platform's own object
  // route, so RBAC, drafts and localization behave exactly as they do in the
  // editor - an instance is content, not a Studio-private record.
  useEffect(() => {
    setInstanceDraft(null)
    setInstanceI18n({})
    if (!instanceType || !activeInstanceId) { setOpenInstance(null); return }
    let alive = true
    // `locale=all` rides this one read, exactly as it does for the page: the
    // response carries the instance's OWN translations map beside its data,
    // which is what lets an instance be translated here without a second
    // fetch and without ever touching the page's side row.
    adminFetch<{ data: Record<string, unknown>; i18n?: Record<string, Record<string, unknown>> }>(
      `/objects/${instanceType.type}/${activeInstanceId}`, undefined, { locale: 'all' },
    )
      .then((r) => {
        if (!alive) return
        const data = normalizeObjectData(r.data) as unknown as Record<string, unknown>
        const raw = data[instanceType.blocksField]
        setInstanceI18n(r.i18n ?? {})
        setOpenInstance({
          id: activeInstanceId,
          title: typeof data.title === 'string' ? data.title : '',
          slug: typeof data.slug === 'string' ? data.slug : undefined,
          status: typeof data.status === 'string' ? data.status : undefined,
          // The server copy's stamp, so the changed-elsewhere notice can tell
          // a colleague's write to THIS instance from this editor's own echo.
          updatedAt: typeof data.updated_at === 'string' ? data.updated_at : undefined,
          blocks: Array.isArray(raw) ? (raw as ComponentBlock[]) : [],
        })
      })
      .catch((err) => {
        if (!alive) return
        setOpenInstance(null)
        setWantedDoc(PAGE_DOC)
        toast.error('Could not open that instance', err instanceof Error ? err.message : undefined)
      })
    return () => { alive = false }
  }, [instanceType, activeInstanceId, instanceReloadTick])

  /** May this member change instances? The type's own update permission, like any content. */
  const canEditInstance = instanceType ? can('update', 'objects', instanceType.type) : false
  /** Publishing an instance is the instance type's own permission, like any content. */
  const canPublishInstance = instanceType ? can('publish', 'objects', instanceType.type) : false

  /**
   * Whether this member may SAVE a surface, and through which route - the
   * server's rules restated from the member's own bundle, so a refusal shows
   * before a 403 rather than after. Fail-open while the bundle loads, as
   * useCan does for every other check: the server enforces either way, and
   * the fallback takes the platform route this always used.
   */
  const surfaceAccess = useCallback(
    (global: string): SurfaceAccess => (ready ? canEditSurfaces(me, global) : { ok: true, via: 'admin' }),
    [ready, me],
  )
  const activeSurfaceAccess = activeSurfaceName ? surfaceAccess(activeSurfaceName) : null
  // Two DIFFERENT gates for two different documents: the page's per-type
  // object permission, or the global's scope. `canEdit` is whichever the
  // active document needs, so every edit seam below asks one question.
  const canEdit = activeSurfaceAccess
    ? activeSurfaceAccess.ok
    : activeInstanceId ? canEditInstance : canEditPage
  const readOnlyReason = activeSurfaceAccess && !activeSurfaceAccess.ok
    ? activeSurfaceAccess.reason
    : activeInstanceId
      ? 'Your role can view instances but not change them'
      : 'Your role can view this content type but not change it'
  const unsavedSurfaces = useMemo(() => new Set(dirtySurfaces(surfaces, surfaceDrafts)), [surfaces, surfaceDrafts])
  const pinnedSurfaces = useMemo(() => pinSurfaces(surfaces), [surfaces])

  /** Studio types this member may actually create - the dialog offers only these. */
  const creatableTypes = useMemo(
    () => switcherTypes.filter((t) => can('create', 'objects', t.type)),
    [switcherTypes, can],
  )

  /**
   * Preview widths come from the admin's own control: device presets, the
   * site's configured breakpoints (frontend.previewBreakpoints) and each
   * person's saved custom widths. Studio used to fork a three-preset subset.
   */
  const bp = usePreviewBreakpoints(previewCfg?.breakpoints ?? [])
  const [publishing, setPublishing] = useState(false)
  // An installed extension (e.g. review) may stand between this type and
  // publishing - advisory only; the server's gate stays the real refusal.
  const [publishPolicy, setPublishPolicy] = useState<{
    blocked: boolean
    reason?: string
    extensionId?: string
    action?: { label: string; path: string; method?: string; body?: Record<string, unknown> }
  } | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  /** JSON of { title, fieldValues } at last load/save - '' until loaded. */
  const lastSavedRef = useRef('')
  const { confirm, confirmDialog } = useConfirm()

  // ── Load: type definition + object draft + preview config/token ───────────
  useEffect(() => {
    if (!type || !id) { setLoading(false); setLoadError('Missing type or id.'); return }
    let alive = true
    setLoading(true)
    setLoadError(null)
    lastSavedRef.current = ''
    ;(async () => {
      try {
        const [typeRes, objRes, cfg] = await Promise.all([
          adminFetch<{ data: TypeDef }>(`/types/${type}`),
          // `locale=all` rides the ONE load the editor already makes: the
          // response carries the translations map beside the data, so
          // translating needs no second fetch. Ignored when localization
          // is off.
          adminFetch<{ data: Record<string, unknown>; i18n?: Record<string, Record<string, unknown>> }>(
            `/objects/${type}/${id}`, undefined, { locale: 'all' },
          ),
          getPreviewConfig(type),
        ])
        if (!alive) return
        const obj = normalizeObjectData(objRes.data) as unknown as LoadedObject
        setPageI18n(objRes.i18n ?? {})
        setOverlayState({ doc: 'page', drafts: {} })
        overlaySavedRef.current = {}
        const values = extractFieldValues(obj, typeRes.data.fields ?? [])
        setTypeDef(typeRes.data)
        setObject(obj)
        setLastSavedAt(typeof obj.updated_at === 'string' ? obj.updated_at : null)
        setTitle(obj.title ?? '')
        setSlug(obj.slug ?? '')
        slugDirty.current = false
        setFieldValues(values)
        setPreviewCfg(cfg)
        lastSavedRef.current = JSON.stringify({ title: obj.title ?? '', fieldValues: values })
        // The canvas address is NOT built here: it follows the active
        // document, which this effect knows nothing about.
      } catch (err) {
        if (alive) setLoadError(err instanceof Error ? err.message : 'Failed to load the object.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [type, id, reloadTick])

  // ── The canvas follows the ACTIVE DOCUMENT ────────────────────────────────
  // Everything else already did: the tree, the inspector, undo, presence, the
  // save path and Publish all read `activeDoc`. The canvas did not - its URL
  // was minted once from the PAGE and never rebuilt - so opening an instance
  // switched every panel to the instance while the frame kept rendering the
  // page, and the live snapshot kept pushing the page's own values into it. A
  // fresh instance therefore showed the post it was created from, untouched.
  //
  // An instance is a content object with an id, a draft and a preview of its
  // own, so it is previewed as itself. A surface is a global with no id and
  // genuinely renders inside the page, so it stays composed there. The rules
  // live in lib/canvas-target.ts; this is only the wiring.

  /** The instance TYPE's preview config, so a `previewUrls` override is honoured. */
  const [instancePreviewCfg, setInstancePreviewCfg] = useState<PreviewConfig | null>(null)
  useEffect(() => {
    if (!instanceType) { setInstancePreviewCfg(null); return }
    let alive = true
    void getPreviewConfig(instanceType.type).then((cfg) => { if (alive) setInstancePreviewCfg(cfg) })
    return () => { alive = false }
  }, [instanceType])

  const canvasTarget = useMemo(() => previewTarget({
    doc: activeDoc,
    page: { id, type, slug: object?.slug ?? null, loaded: !!object },
    instance: instanceType && activeInstanceId
      ? {
        id: activeInstanceId,
        type: instanceType.type,
        slug: openInstance?.id === activeInstanceId ? openInstance.slug ?? null : null,
        loaded: openInstance?.id === activeInstanceId,
      }
      : null,
    // `null` is "configured as unavailable", `undefined` is "not read yet".
    // Collapsing the two would make a booting editor say the site has no
    // preview URL, which is a different and wrong thing to tell somebody.
    pageTemplate: previewCfg ? (previewCfg.enabled ? previewCfg.previewUrl : null) : undefined,
    instanceTemplate: instancePreviewCfg
      ? (instancePreviewCfg.enabled ? instancePreviewCfg.previewUrl : null)
      : undefined,
  }), [activeDoc, id, type, object, instanceType, activeInstanceId, openInstance, previewCfg, instancePreviewCfg])
  const canvasTargetRef = useRef(canvasTarget)
  canvasTargetRef.current = canvasTarget
  /** One string per distinct address: the frame reloads exactly when it moves. */
  const canvasTargetKey = previewTargetKey(canvasTarget)
  /** Why the canvas is showing nothing, when it is. Never a silent blank. */
  const [previewRefusal, setPreviewRefusal] = useState<{ title: string; detail: string } | null>(null)
  /**
   * Minted preview tokens by object, so going back to a document rebuilds the
   * ADDRESS IT HAD rather than a second one for the same thing. A token lasts
   * an hour; this re-mints well inside that, so a long session never lands on
   * an expired one.
   */
  const previewTokensRef = useRef<Map<string, { token: string; at: number }>>(new Map())
  const previewTokenFor = useCallback(async (objectId: string): Promise<string | null> => {
    const key = objectId
    const held = previewTokensRef.current.get(key)
    if (held && Date.now() - held.at < 45 * 60 * 1000) return held.token
    const token = await mintPreviewToken(objectId)
    if (token) previewTokensRef.current.set(key, { token, at: Date.now() })
    return token
  }, [])

  useEffect(() => {
    const target = canvasTargetRef.current
    if (target.kind !== 'object') {
      // Nothing to show is shown as nothing, with the reason beside it. The
      // frame is never left on the document that WAS open: that is the bug.
      setPreviewSrc(null)
      setPreviewRefusal(target.kind === 'none' ? { title: target.title, detail: target.detail } : null)
      return
    }
    let alive = true
    ;(async () => {
      const token = await previewTokenFor(target.id)
      if (!alive) return
      if (!token) {
        setPreviewSrc(null)
        setPreviewRefusal({ ...PREVIEW_TOKEN_REFUSAL })
        return
      }
      setPreviewRefusal(null)
      setPreviewSrc(buildPreviewUrl(target.template, {
        id: target.id, type: target.type, slug: target.slug,
        token, locale: localeStore.activeLocale ?? undefined,
      }))
    })()
    return () => { alive = false }
  }, [canvasTargetKey, localeStore.activeLocale, previewTokenFor])

  /** What the canvas says when it has no frame to show. */
  const canvasNotice = useMemo(() => {
    if (previewRefusal) return previewRefusal
    if (canvasTarget.kind !== 'object') return { title: canvasTarget.title, detail: canvasTarget.detail }
    if (!previewCfg?.frontendUrl) return { ...PREVIEW_NO_FRONTEND }
    return { ...PREVIEW_OPENING }
  }, [previewRefusal, canvasTarget, previewCfg])

  // ── Regions + component defs ──────────────────────────────────────────────
  // A page has one region per component field. Studio edits ONE at a time:
  // the site's template decides whether two regions render adjacently, so
  // showing both on the canvas at once would be a guess.
  const regions = useMemo(() => pageRegions(typeDef?.fields), [typeDef])
  const [wantedRegion, setWantedRegion] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const activeRegion = resolveRegion(regions, wantedRegion)
  // The active DOCUMENT's blocks field: the surface's when one is open, the
  // page's region otherwise. Everything downstream - the vocabulary, the
  // tree, the inspector, the style panel, drops - reads this one field.
  const blocksField = useMemo(() => {
    if (activeSurface) return activeSurface.surface.field
    // An instance NEVER falls back to the page's region: the tree, the drops
    // and the autosave all read this field, so a fallback would write one
    // document's blocks into another's.
    if (activeInstanceId) return instanceField
    return regions.find((r) => r.name === activeRegion)?.field ?? null
  }, [activeSurface, activeInstanceId, instanceField, regions, activeRegion])
  const componentEntries = useMemo(
    () => (blocksField?.config as { components?: Array<string | ComponentDef> } | undefined)?.components ?? [],
    [blocksField],
  )
  // GET /types resolves reusable-component names server-side; any entry still
  // a bare string resolves against the workspace registry (fetched only then).
  const hasStringEntries = componentEntries.some((c) => typeof c === 'string')
  const registry = useReusableComponents(hasStringEntries)
  const componentDefs = useMemo<ComponentDef[]>(
    () => resolvePaletteComponents(componentEntries, registry),
    [componentEntries, registry],
  )
  const blocks = useMemo<ComponentBlock[]>(() => {
    if (activeSurfaceName) return draftBlocks(surfaces, surfaceDrafts, activeSurfaceName) as ComponentBlock[]
    if (activeInstanceId) return instanceDraft ?? openInstance?.blocks ?? []
    const raw = blocksField ? fieldValues[blocksField.name] : null
    return Array.isArray(raw) ? (raw as ComponentBlock[]) : []
  }, [blocksField, fieldValues, activeSurfaceName, surfaces, surfaceDrafts, activeInstanceId, instanceDraft, openInstance])
  const rows = useMemo(() => {
    const base = blockRows(blocks, componentDefs)
    // A reference caches the instance's title so the tree still reads when the
    // instance cannot be read at all. When it CAN be read, the live title
    // wins: otherwise a rename would leave every page saying the old name
    // until somebody happened to re-save it.
    return relabelReferences(base, instanceReferences(blocks), (iid) => {
      const found = instanceRows.find((i) => i.id === iid)
      return found ? instanceTitle(found) : null
    })
  }, [blocks, componentDefs, instanceRows])

  // ── Translating: the locale overlay (WF-T11b) ─────────────────────────────
  // The block tree is shared by every language. A non-default locale edits
  // an OVERLAY beside it - the page's localized fields and, per container,
  // the localized sub-values keyed by block - and saves it through the
  // locale route. The shared draft is never touched while translating.
  /**
   * WHICH document the overlay is being edited for. Both a page and an
   * instance are content objects with a side row of their own, so the
   * overlay follows the open DOCUMENT rather than the page it was opened
   * from - and every draft carries the identity of the document it was typed
   * against, so a save can never write one document's Tamil into another's
   * row. A surface has no row at all and stays locked with its reason.
   */
  const localeTarget = useMemo<LocaleTarget>(() => (
    activeInstanceId && instanceType
      ? instanceLocaleTarget(instanceType.type, activeInstanceId)
      : pageLocaleTarget(type, id)
  ), [activeInstanceId, instanceType, type, id])

  /** The PAGE's translations map: `{ [locale]: { __title, field, container } }`. */
  const [pageI18n, setPageI18n] = useState<Record<string, Record<string, unknown>>>({})
  /** The open document's translations - the page's, or the instance's own. */
  const i18nMap = activeInstanceId ? instanceI18n : pageI18n
  const setI18nMap = activeInstanceId ? setInstanceI18n : setPageI18n
  /**
   * Unsaved overlay per locale, STAMPED with the document it belongs to. A
   * locale absent here is read from the map; a whole state belonging to
   * another document reads as nothing at all.
   */
  const [overlayState, setOverlayState] = useState<{ doc: string; drafts: Record<string, LocaleOverlay> }>(
    () => ({ doc: 'page', drafts: {} }),
  )
  const overlayDrafts = overlayDraftsFor(overlayState, localeTarget, NO_OVERLAY_DRAFTS)
  /** The overlay payload JSON at last load or save, per document and locale. */
  const overlaySavedRef = useRef<Record<string, string>>({})
  const overlayHistoryRef = useRef<History<LocaleOverlay> | null>(null)
  /** Debounced locale save waiting to run, flushed before navigation like the draft's. */
  const pendingLocaleSaveRef = useRef<(() => Promise<void>) | null>(null)
  /** Debounced instance save, flushed the same way. */
  const pendingInstanceSaveRef = useRef<(() => Promise<void>) | null>(null)
  /** Why the open instance's last edit was NOT written, when it was refused. */
  const [instanceRefusal, setInstanceRefusal] = useState<string | null>(null)

  // The type of the DOCUMENT being translated: the instance's own when one
  // is open, the page's otherwise. Everything below reads this, so an
  // instance's localized fields and containers are the instance type's.
  const localeTypeDef = activeInstanceId ? instanceTypeDef : typeDef
  const localizedFieldNames = useMemo(() => localizedTopFields(localeTypeDef?.fields), [localeTypeDef])
  // Nested slots resolve against the region's defs and the registry both: a
  // section's `children` names components by string.
  const localizedContainers = useMemo(
    () => localizedContainerNames(localeTypeDef?.fields, [...componentDefs, ...(registry as ComponentDef[])]),
    [localeTypeDef, componentDefs, registry],
  )
  // The same condition under which push generates the <type>_i18n table.
  const typeLocalizable = (localeTypeDef as { localized?: boolean } | null)?.localized === true
    || localizedFieldNames.length > 0 || localizedContainers.length > 0
  const activeLocale = localeStore.activeLocale
  const localeWritable = typeLocalizable && canWriteLocale(activeLocale, localeStore.defaultLocale)
  const localeCtx: LocaleContext = {
    enabled: localeStore.enabled,
    defaultLocale: localeStore.defaultLocale,
    activeLocale,
    // A surface is edited in the default language here: its translations
    // live in the global's own locale map, which no object overlay route can
    // reach. Locked with the reason rather than silently written to the
    // wrong place. An INSTANCE is a content object, so it translates into
    // its OWN side row like anything else - see localeTarget.
    canWriteOverlay: localeWritable && !activeSurface && canSaveLocale(localeTarget),
    writeRefusal: activeSurface
      ? `Shared surfaces are edited in ${localeStore.defaultLocale} here. Translate "${activeSurface.surface.label}" in Settings > Globals.`
      : !typeLocalizable
        ? activeInstanceId
          ? `Nothing on this instance is marked localized, so ${activeLocale} has nothing to translate. Switch to ${localeStore.defaultLocale} to edit.`
          : `Nothing on this page is marked localized, so ${activeLocale} has nothing to translate. Switch to ${localeStore.defaultLocale} to edit.`
        : `Your role cannot edit ${activeLocale} content. Switch to ${localeStore.defaultLocale} to edit.`,
  }
  const translating = isTranslating(localeCtx)

  /** The overlay being edited: the unsaved draft, else what the load returned. */
  const activeOverlay = useMemo<LocaleOverlay>(() => {
    if (!translating || !activeLocale) return {}
    return overlayDrafts[activeLocale] ?? seedOverlay(i18nMap[activeLocale], localizedFieldNames, localizedContainers)
  }, [translating, activeLocale, overlayDrafts, i18nMap, localizedFieldNames, localizedContainers])
  /** For the frame's message listener, which is bound once. */
  const activeOverlayRef = useRef<LocaleOverlay>(activeOverlay)
  useEffect(() => { activeOverlayRef.current = activeOverlay }, [activeOverlay])
  // ── Style classes ─────────────────────────────────────────────────────────
  const [styleClasses, setStyleClasses] = useState<StyleClass[]>([])
  const [styleState, setStyleState] = useState<StyleState>('normal')
  const [styleBusy, setStyleBusy] = useState(false)
  /** Held in a ref: the message listener is bound once and must not close
   *  over the first render's callback. */
  const pushDraftStylesRef = useRef<(() => Promise<void>) | null>(null)

  const loadClasses = useCallback(async () => {
    try {
      const r = await adminFetch<{ data: StyleClass[] }>('/admin/ext/studio/classes')
      setStyleClasses(r.data ?? [])
    } catch { setStyleClasses([]) }
  }, [])
  useEffect(() => { void loadClasses() }, [loadClasses])

  // ── Design changes heard live (Realtime R3) ───────────────────────────────
  // A class is shared: a colleague's save lands in the store while this
  // panel still holds the old row, and the NEXT save here is refused as
  // stale. The bus says so first. Both topics are read - the page's own
  // (`studio:<id>`, writes made from this page) and the class library
  // (`studio:classes`, writes made from any page) - and a notice is kept
  // per class or tag, newest first. Nothing reloads on its own: the panel
  // offers Reload beside the notice, and the guard stands either way.
  //
  // Whether a change is somebody else's is NOT decided here or in
  // design-notice.ts: it is the one shared rule in @tangen/realtime
  // (own-write.ts), which recognises this tab's own writes by the connection
  // origin they carry rather than by comparing actors or clocks.
  const currentMemberId = useAuthStore((s) => s.member?.memberId ?? null)
  const [designNotices, setDesignNotices] = useState<DesignNotice[]>([])
  /**
   * Style writes go out one at a time, and only the newest step of a gesture:
   * a colour picker fires on every drag step and the hex field on every
   * keystroke, and each of those used to be its own PATCH carrying the class
   * version the panel had RENDERED with - so every write after the first was
   * refused as stale and the designer, alone in the workspace, was told a
   * stack of times that somebody else had changed their class. The ledger
   * carries the version each accepted write produced into the next one. The
   * server's guard is untouched: a version this editor did not produce goes
   * to it exactly as it is. See lib/style-writes.ts.
   */
  const styleWriterRef = useRef(createStyleWriter())
  const styleLedgerRef = useRef(createStyleLedger())
  /** Outstanding style writes, so a superseded one does not clear "Saving...". */
  const styleBusyRef = useRef(0)
  /** Member id -> name for everyone on the page, from presence, so a notice can name its actor. */
  const [memberNameMap, setMemberNameMap] = useState<Map<string, string>>(() => new Map())
  const onDesignEvent = useCallback((event: RealtimeEvent) => {
    if (!isDesignChangeElsewhere(event, { currentMemberId, saveIssuedAt: designIssuedAtRef.current })) return
    setDesignNotices((list) => recordDesignChange(list, noticeFromEvent(event)))
  }, [currentMemberId])
  const realtimeOn = !!id && !loading
  useRealtime(`studio:${id ?? ''}`, onDesignEvent, { enabled: realtimeOn })
  useRealtime('studio:classes', onDesignEvent, { enabled: realtimeOn })
  // A different page starts clean - including the record of which class
  // versions this editor's own writes produced.
  useEffect(() => { setDesignNotices([]); styleLedgerRef.current.forget() }, [id])


  /** The navigator search. Searching shows matches WITH their ancestors, folds aside. */
  const [treeQuery, setTreeQuery] = useState('')
  const treeSearch = useMemo(() => searchRows(
    rows, treeQuery,
    (row) => classesOf((blockAtPath(blocks as never, row.path) ?? {}) as never),
  ), [rows, treeQuery, blocks])
  /** The rows actually drawn - a search result, else the tree with its folds. */
  const shownRows = useMemo(
    () => (treeQuery.trim() ? treeSearch.rows : visibleRows(rows, collapsed)),
    [rows, collapsed, treeQuery, treeSearch],
  )

  // Switching region resets BOTH the selection and the undo stack. A block key
  // belongs to one region, so a carried-over selection points at a block the
  // tree no longer lists - and, far worse, `applyHistory` writes the
  // remembered tree into whichever field is active, so an undo after a switch
  // would overwrite this region with the other one's blocks.
  // Collapse is RECALLED rather than reset: the folds belong to the region
  // too, and the session remembers them per page and region (N-T5c).
  // A surface is a document of its own, so opening one is a switch like a
  // region switch: its folds are remembered under its own scope.
  const docScope = documentScope(activeDoc, activeRegion)
  useEffect(() => {
    // A click on a header block in the preview switches the document AND
    // selects the block; the reset here would otherwise undo the selection
    // it just made, so the listener parks the key and this honours it.
    setSelectedKey(pendingSelectRef.current)
    pendingSelectRef.current = null
    setCollapsed(sessionCollapse.recall(collapseScope(id ?? '', docScope)))
    setTreeQuery('')
    setInstanceRefusal(null)
    historyRef.current = null
    setHistoryTick((n) => n + 1)
  }, [docScope, id])
  const onToggleCollapse = useCallback((key: string) => {
    setCollapsed((c) => {
      const next = toggleCollapsed(c, key)
      sessionCollapse.remember(collapseScope(id ?? '', docScope), next)
      return next
    })
  }, [id, docScope])
  const selectedRow = rows.find((r) => r.key === selectedKey) ?? null

  // ── Presence: where this session is, and where the others are ────────────
  // The selected block's address, published as the session's `field` so the
  // object editor places it on the owning top-level field; the open surface
  // alone when nothing in it is selected, so the band can say who is there.
  // An instance publishes NO shared root: this session is inside the
  // instance's own object scope, where its blocks field is simply the
  // document's field, exactly as a page's region is on a page.
  const presenceField = useMemo(() => presenceFieldFor({
    blocksField: blocksField?.name ?? null,
    chain: selectedRow ? keyChain(blocks, selectedRow.path) : null,
    surface: activeSurfaceName,
  }), [blocksField, selectedRow, blocks, activeSurfaceName])
  /** Every navigator row to its address, once per tree, so a row's selector is a string compare. */
  const presenceAddresses = useMemo(
    () => rowAddresses(rows, blocks, {
      blocksField: blocksField?.name ?? null,
      surface: activeSurfaceName,
    }),
    [rows, blocks, blocksField, activeSurfaceName],
  )
  /** The navigator's label for a block key, so a colleague's avatar can say "editing Hero heading". */
  const presenceLabelFor = useCallback((key: string) => rows.find((r) => r.key === key)?.label ?? null, [rows])
  /** A bare field (the object editor's) or a surface root, as a person would say it. */
  const presenceFieldLabel = useCallback((field: string): string | null => {
    const surface = surfaces.find((s) => `_surfaces.${s.surface.global}` === field)
    if (surface) return `the ${surface.surface.position}`
    const instance = instanceRows.find((i) => `${INSTANCES_ROOT}.${i.id}` === field)
    if (instance) return `the "${instanceTitle(instance)}" instance`
    if (field === 'title') return 'the title'
    return typeDef?.fields?.find((f) => f.name === field)?.label ?? null
  }, [surfaces, instanceRows, typeDef])
  /**
   * The object whose presence scope this session joins: the INSTANCE when one
   * is open, the page otherwise.
   *
   * An instance is a content object, so it already has an `object:<id>`
   * scope of its own - the one the content editor joins for the same row.
   * Joining it is what makes two people editing one instance see each other
   * the way they do on a page, and what makes a colleague editing the
   * instance in the content editor visible from Studio. Publishing under a
   * reserved `_instances.<id>` root on the PAGE's scope, as I1 did, could
   * only ever show the people who happened to be on the same page.
   *
   * The address becomes native too: inside the instance's own scope its
   * blocks are `<blocksField>.<chain>`, exactly like a page's. A surface
   * keeps its `_surfaces.<global>` root, because a surface is a global with
   * no scope of its own and is genuinely edited from the page's.
   */
  const presenceObjectId = presenceObjectFor(activeDoc, id)
  const presenceType = activeInstanceId ? instanceType?.type ?? null : type
  const presenceScope = presenceObjectId ? { objectId: presenceObjectId, currentMemberId } : null

  /**
   * The row holding the selection, for the select-parent affordance. Matched
   * by PATH rather than by scanning the tree again, so a loop's repeated rows
   * cannot resolve to the wrong container.
   */
  const parentRow = useMemo(() => {
    const target = selectedRow ? parentPath(selectedRow.path) : null
    if (!target) return null
    const key = JSON.stringify(target)
    return rows.find((r) => JSON.stringify(r.path) === key) ?? null
  }, [rows, selectedRow])
  const selectedBlock = useMemo(() => (
    selectedRow ? (blockAtPath(blocks, selectedRow.path) as Record<string, unknown> | null) : null
  ), [blocks, selectedRow])
  const selectedDef = selectedRow ? defFor(componentDefs, selectedRow.type) : null
  /** Kit blocks get the token style panel; everything else keeps the plain rail. */
  const kitSelected = isKitBlock(selectedRow?.type)
  /**
   * The loop a selected template widget renders inside, if any - the gate for
   * the "Connect data" control (props may bind only where a record exists).
   */
  const loopContext = useMemo(() => (
    selectedRow ? findLoopContext(blocks as never, selectedRow.key) : null
  ), [blocks, selectedRow])

  // ── Design tokens (kit style panel) - fetched once per page, cached ───────
  const [tokens, setTokens] = useState<StudioTokens>(DEFAULT_TOKENS as StudioTokens)
  /** The workspace's font token NAMES - the only faces the stylesheet loads,
   *  and therefore the only ones font-family may reference. */
  const [fontNames, setFontNames] = useState<string[]>([])
  /** Declared token values, so the panel shows the real thing. */
  const [tokenValueMap, setTokenValueMap] = useState<Record<string, string>>({})
  /** The effective fonts, for the Theme panel's font rows (T-T4). */
  const [themeFonts, setThemeFonts] = useState<FontToken[]>([])
  /** What the workspace theme holds (T-T1), and the version token per entry. */
  const [themeOverridden, setThemeOverridden] = useState<string[]>([])
  const themeRevsRef = useRef<Record<string, string>>({})
  /** Governed until the workspace says otherwise - the fetch can only widen. */
  const [styleMode, setStyleMode] = useState<StyleMode>('governed')
  /**
   * Raw CSS per class is offered only when the workspace opted in AND this
   * member holds studio:creative. One gate, evaluated here - the panel never
   * checks permissions itself, so the two can never disagree.
   *
   * W-3 retired Creative Mode INTO this box, and the gate came with it
   * deliberately: raw CSS says strictly more than the freeform bag could, so
   * folding it into studio:edit would have widened the grant while calling
   * it a cleanup. The server enforces the same capability on the write.
   */
  const rawCssAllowed = canUseCreativeStyles(styleMode, hasCapability('studio:creative')) && canDesign

  // ── Inspector tabs ────────────────────────────────────────────────────────
  // The tab the user last picked is remembered as a WISH, not as truth:
  // blocks carry different tab sets, so it is re-resolved against whatever
  // the current selection actually has (see resolveActiveTab).
  const [wantedTab, setWantedTab] = useState<FieldGroup | null>(null)
  const inspectorTabList = useMemo<InspectorTab[]>(() => {
    if (!selectedRow || !selectedDef) return []
    const isLoop = selectedRow.type === 'kit.loop'
    const isReference = selectedRow.type === INSTANCE_BLOCK_TYPE
    return inspectorTabs({
      fields: (selectedDef.fields ?? []) as SubField[],
      // The block's own props are passed so Studio never adds a second
      // control for something the developer already declared.
      wrapperFields: wrapperFieldsFor(selectedRow.type, ((selectedDef.fields ?? []) as SubField[]).map((f) => f.name)),
      // A reference's props are STUDIO's: the id it points at and a cached
      // title. Drawn as text boxes they would invite an edit that means
      // nothing (an id typed by hand) or one that lies (a label that
      // disagrees with the instance). The actions above them are the edit.
      ownedProps: isLoop ? QUERY_BUILDER_PROPS : isReference ? INSTANCE_REF_PROPS : undefined,
      panels: isLoop ? ['query' as const] : [],
      // The class panel is the design surface; a marketer gets the block's
      // own props and no offer to restyle the workspace.
      canDesign,
    })
  }, [selectedRow, selectedDef, canDesign])
  const activeInspectorTab = resolveActiveTab(inspectorTabList, wantedTab)
  const activeTab = inspectorTabList.find((t) => t.id === activeInspectorTab) ?? null

  /** The page's own settings, shown when no block is selected. */
  /** Where the selected block sits in the page - the trail above the canvas. */
  const crumbs = useMemo(() => breadcrumbFor(rows, selectedKey), [rows, selectedKey])
  /** The same location, stated in the inspector header (N-T9). */
  const inspectorCrumbs = useMemo(() => inspectorTrail(rows, selectedKey), [rows, selectedKey])

  const pageSections = useMemo(() => (
    pageInspectorSections(typeDef?.fields, { blocksField: blocksField?.name ?? null, regionNames: regions.map((r) => r.name) })
  ), [typeDef, blocksField, regions])

  type TokensResponse = StudioTokens & {
    styleMode?: StyleMode
    values?: Record<string, string>
    fonts?: FontToken[]
    overridden?: string[]
    revs?: Record<string, string>
  }
  /** Reads the effective tokens - once per page, and again after every theme write. */
  const loadTokens = useCallback(async (): Promise<void> => {
    try {
      const r = await adminFetch<{ data: TokensResponse }>('/admin/ext/studio/tokens')
      if (!r.data) return
      setTokens(r.data)
      setTokenValueMap(r.data.values ?? {})
      const fonts = (r.data.fonts ?? []).filter((f): f is FontToken => typeof f?.name === 'string' && f.name !== '')
      setThemeFonts(fonts)
      setFontNames(fonts.map((f) => f.name))
      setThemeOverridden(r.data.overridden ?? [])
      themeRevsRef.current = r.data.revs ?? {}
      setStyleMode(r.data.styleMode ?? 'governed')
    } catch { /* defaults already in place - extended slots just do not appear */ }
  }, [])
  useEffect(() => { void loadTokens() }, [loadTokens])

  /**
   * The Theme panel's writers (T-T4): one token value or one font, through
   * the workspace theme (T-T1). After a write the tokens are RELOADED and
   * the draft stylesheet re-pushed, so the row the designer sees and the
   * `:root` the canvas paints are what the store holds - never a guess the
   * stale-write guard might refuse a moment later.
   */
  const onSetThemeToken = useCallback(async (varName: string, value: string | null) => {
    try {
      await adminFetch(`/admin/ext/studio/theme/${encodeURIComponent(varName)}`, {
        method: 'PATCH',
        body: JSON.stringify({ value, expectedVersion: themeRevsRef.current[varName] }),
      })
      await loadTokens()
      await pushDraftStylesRef.current?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the token')
    }
  }, [loadTokens])
  const onSetThemeFont = useCallback(async (name: string, font: FontSource | null) => {
    try {
      await adminFetch(`/admin/ext/studio/theme/fonts/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        body: JSON.stringify({ font, expectedVersion: themeRevsRef.current[`font:${name}`] }),
      })
      await loadTokens()
      await pushDraftStylesRef.current?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the font')
    }
  }, [loadTokens])

  // ── Collections a loop may query - fetched once for the picker ───────────
  const [allTypes, setAllTypes] = useState<Array<{ name: string; label?: string }>>([])
  useEffect(() => {
    let alive = true
    adminFetch<{ data: Array<{ name: string; label?: string; disabled?: boolean }> }>('/types')
      .then((r) => { if (alive) setAllTypes((r.data ?? []).filter((t) => !t.disabled)) })
      .catch(() => { /* the picker just stays empty - no loop can be misconfigured silently */ })
    return () => { alive = false }
  }, [])

  // ── Loop source schemas: fetched per collection a loop points at, cached ──
  // Only the fields are needed (the binding picker's option list), and only
  // for collections actually referenced by a loop on this page.
  const [typeFields, setTypeFields] = useState<Record<string, SourceField[]>>({})
  /**
   * The collection whose fields we need: a selected kit.loop configures its
   * OWN source (query builder); any other block reads the enclosing loop's
   * (binding picker).
   */
  const loopSource = (
    selectedRow?.type === 'kit.loop' && typeof selectedBlock?.source === 'string'
      ? selectedBlock.source
      : loopContext?.source
  ) ?? ''
  useEffect(() => {
    if (!loopSource || typeFields[loopSource]) return
    let alive = true
    adminFetch<{ data: TypeDef }>(`/types/${loopSource}`)
      .then((r) => {
        if (!alive) return
        const fields = (r.data?.fields ?? []) as SourceField[]
        setTypeFields((prev) => ({ ...prev, [loopSource]: fields }))
      })
      .catch(() => {
        // An unresolvable collection just yields no options - the author sees
        // "No fields available" rather than a broken rail.
        if (alive) setTypeFields((prev) => ({ ...prev, [loopSource]: [] }))
      })
    return () => { alive = false }
  }, [loopSource, typeFields])

  /** Fields of the relevant collection, offered as sources / filter targets. */
  const loopSourceFields = useMemo(() => (
    loopSource ? bindableSourceFields(typeFields[loopSource]) : []
  ), [loopSource, typeFields])

  // ── Draft writes (all tree + prop edits funnel through here) ──────────────
  const setBlocks = useCallback((next: ComponentBlock[], coalesceKey?: string) => {
    if (!blocksField) return
    // Refused HERE rather than at the save: every tree and prop edit funnels
    // through this seam, so one check covers all of them.
    if (!canEdit) { toast.error('You do not have permission to change this content'); return }
    const h = historyRef.current ?? emptyHistory((blocksRef.current ?? []) as never)
    const pushed = pushHistory(h, next as never, { at: Date.now(), coalesceKey })
    // A push that merged (or changed nothing) is not a new STEP, so it must
    // not cost an extra Cmd+Z - recordLane is told which happened.
    if (pushed !== h) {
      lanesRef.current = recordLane(lanesRef.current, 'block', pushed.past.length > h.past.length)
    }
    historyRef.current = pushed
    setHistoryTick((n) => n + 1)
    // Each document's edits land in its OWN draft. A surface's are held (a
    // global has no draft to autosave to); an instance's and the page's are
    // autosaved, but to different objects, so they may never share a slot.
    if (activeSurfaceName) setSurfaceDrafts((prev) => ({ ...prev, [activeSurfaceName]: next }))
    else if (activeInstanceId) setInstanceDraft(next)
    else setFieldValues((prev) => ({ ...prev, [blocksField.name]: next }))
  }, [blocksField, canEdit, activeSurfaceName, activeInstanceId])

  /** Restore a remembered tree. Writes through the SAME field values, so the
   *  ordinary autosave persists it - undo must survive a reload. */
  const applyHistory = useCallback((h: History | null) => {
    if (!h || !blocksField) return
    historyRef.current = h
    setHistoryTick((n) => n + 1)
    if (activeSurfaceName) setSurfaceDrafts((prev) => ({ ...prev, [activeSurfaceName]: h.present as never }))
    else if (activeInstanceId) setInstanceDraft(h.present as never)
    else setFieldValues((prev) => ({ ...prev, [blocksField.name]: h.present as never }))
  }, [blocksField, activeSurfaceName, activeInstanceId])

  /**
   * Undo runs from the keyboard handler, which is declared long before the
   * class and tag loaders it needs. A ref bridges that ordering rather than
   * moving hooks around the keybinding that depends on them.
   */
  const applyStyleOpRef = useRef<(op: StyleOp) => void>(() => {})

  /**
   * One Cmd+Z, two stacks. The lane record says which one this step came
   * from, so a style change and a block change unwind in the order they were
   * actually made.
   */
  /**
   * Translation edits: the overlay draft of the ACTIVE locale, with a stack
   * of its own (`locale` lane). Kept apart from setBlocks so a French edit
   * never enters the shared tree's history, and an undo while translating
   * never rewinds English.
   */
  /**
   * One locale's draft, stamped with the document it was typed against.
   *
   * The stamp is what makes "an instance's Tamil cannot reach the page's row"
   * a property of the data rather than of the order effects happen to run
   * in: a state belonging to another document reads as no drafts at all, so
   * the save finds nothing to write.
   */
  const writeOverlayDraft = useCallback((next: LocaleOverlay) => {
    if (!activeLocale) return
    setOverlayState((prev) => (
      prev.doc === localeTarget.key
        ? { doc: prev.doc, drafts: { ...prev.drafts, [activeLocale]: next } }
        : { doc: localeTarget.key, drafts: { [activeLocale]: next } }
    ))
  }, [activeLocale, localeTarget.key])

  const setOverlay = useCallback((next: LocaleOverlay, coalesceKey?: string) => {
    if (!activeLocale || !localeWritable) return
    const h = overlayHistoryRef.current ?? emptyHistory<LocaleOverlay>(activeOverlay)
    const pushed = pushHistory(h, next, { at: Date.now(), coalesceKey })
    if (pushed !== h) {
      lanesRef.current = recordLane(lanesRef.current, 'locale', pushed.past.length > h.past.length)
    }
    overlayHistoryRef.current = pushed
    setHistoryTick((n) => n + 1)
    writeOverlayDraft(next)
  }, [activeLocale, localeWritable, activeOverlay, writeOverlayDraft])

  const applyOverlayHistory = useCallback((h: History<LocaleOverlay> | null) => {
    if (!h || !activeLocale) return
    overlayHistoryRef.current = h
    setHistoryTick((n) => n + 1)
    writeOverlayDraft(h.present)
  }, [activeLocale, writeOverlayDraft])

  // The overlay stack belongs to ONE locale of ONE document: switching
  // either empties it, and the lane record forgets those steps so Cmd+Z never
  // spends a press on an empty stack. The DOCUMENT half matters as much as
  // the locale half - a remembered overlay from the page, restored while an
  // instance is open, would be written into the instance's drafts, which is
  // the one thing the stamp on those drafts exists to prevent. The drafts
  // themselves survive both switches (they are keyed by locale and stamped
  // by document) and save on their own debounce.
  useEffect(() => {
    overlayHistoryRef.current = null
    lanesRef.current = dropLane(lanesRef.current, 'locale')
    setHistoryTick((n) => n + 1)
  }, [activeLocale, localeTarget.key])

  const onUndo = useCallback(() => {
    const lane = nextUndoLane(lanesRef.current)
    if (lane === 'style') {
      const step = undoStyle(styleHistoryRef.current)
      if (!step) return
      styleHistoryRef.current = step.history
      lanesRef.current = commitUndo(lanesRef.current)
      setHistoryTick((n) => n + 1)
      applyStyleOpRef.current(step.op)
      return
    }
    if (lane === 'locale') {
      lanesRef.current = commitUndo(lanesRef.current)
      applyOverlayHistory(undoHistory(overlayHistoryRef.current ?? emptyHistory<LocaleOverlay>({})))
      return
    }
    if (lane === 'block') lanesRef.current = commitUndo(lanesRef.current)
    applyHistory(undoHistory(historyRef.current ?? emptyHistory([])))
  }, [applyHistory, applyOverlayHistory])

  const onRedo = useCallback(() => {
    const lane = nextRedoLane(lanesRef.current)
    if (lane === 'style') {
      const step = redoStyle(styleHistoryRef.current)
      if (!step) return
      styleHistoryRef.current = step.history
      lanesRef.current = commitRedo(lanesRef.current)
      setHistoryTick((n) => n + 1)
      applyStyleOpRef.current(step.op)
      return
    }
    if (lane === 'locale') {
      lanesRef.current = commitRedo(lanesRef.current)
      applyOverlayHistory(redoHistory(overlayHistoryRef.current ?? emptyHistory<LocaleOverlay>({})))
      return
    }
    if (lane === 'block') lanesRef.current = commitRedo(lanesRef.current)
    applyHistory(redoHistory(historyRef.current ?? emptyHistory([])))
  }, [applyHistory, applyOverlayHistory])

  /**
   * The history lives in a ref (it must not be stale inside callbacks), so
   * `historyTick` is what tells React the buttons' enabled state changed.
   * Reading it here makes that dependency explicit rather than incidental.
   */
  const historyState = useMemo(() => {
    void historyTick
    return { undo: !!nextUndoLane(lanesRef.current), redo: !!nextRedoLane(lanesRef.current) }
  }, [historyTick])

  /**
   * Records that this block stepped outside its design tokens. Best-effort
   * and debounced: the audit must never block or fail an edit, but stepping
   * outside the token line must never be silent either.
   */
  const auditTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const auditRawCss = useCallback((blockType: string, blockKey: string, overrides: string[]) => {
    if (auditTimer.current) clearTimeout(auditTimer.current)
    // The trail names the DOCUMENT the block belongs to. An instance is a
    // content object of its own, so attributing its blocks to the page they
    // happened to be opened from would file the record against the wrong
    // thing - and the whole point of the audit is knowing where to look.
    const objectType = activeInstanceId ? instanceType?.type ?? null : type ?? null
    const objectId = activeInstanceId ?? id ?? null
    auditTimer.current = setTimeout(() => {
      void adminFetch('/admin/ext/studio/creative-audit', {
        method: 'POST',
        body: JSON.stringify({ blockType, blockKey, objectType, objectId, overrides }),
      }).catch(() => { /* audit is best-effort - never surface it as an edit failure */ })
    }, 1200)
  }, [type, id, activeInstanceId, instanceType])

  const updateBlockProp = useCallback((path: BlockPath, name: string, value: unknown, coalesceKey?: string) => {
    setBlocks(setPropAtPath(blocks as never, path, name, value) as never, coalesceKey)
  }, [blocks, setBlocks])

  /**
   * One control, wherever it came from. Fields the developer declared and
   * Studio's own `_studio` chrome differ ONLY in where the value is read and
   * written, so they share this renderer rather than the two near-identical
   * blocks the flat rail used to carry.
   */
  const renderInspectorItem = useCallback((item: InspectorItem) => {
    if (!selectedRow || !selectedBlock) return null
    const f = item.field
    const wrapper = item.source === 'wrapper'
    const family = wrapper || kitSelected ? tokenFamilyForField(f) : null

    // While translating, a prop that is NOT localized is one value shared by
    // every language - editing it here would silently change the source too.
    // Locked with a reason beats a control that quietly does the wrong thing.
    // A localized prop reads and writes the locale's OVERLAY instead, keyed
    // by the block; the shared draft is never touched.
    let lock = localeEditability(f, localeCtx)
    let value = wrapper ? readWrapper(selectedBlock, f.name) : selectedBlock[f.name]
    let onChange = wrapper
      ? (v: unknown) => {
          const next = writeWrapper(selectedBlock, f.name, v)
          updateBlockProp(selectedRow.path, STUDIO_WRAPPER_PROP, next[STUDIO_WRAPPER_PROP])
        }
      : (v: unknown) => updateBlockProp(selectedRow.path, f.name, v, `${selectedRow.key}.${f.name}`)
    let field = f
    // Set while a translation control is showing the DEFAULT language's text
    // rather than a translation, so the row can say so under the control.
    let inheritedFrom: string | null = null
    // A repeater whose rows carry localized text is translated row by row,
    // through a panel of its own rather than the array control.
    let rowsControl: ReactNode = null
    // A bound prop holds the binding, not words; a translation typed over it
    // would be one row's text for every row.
    if (translating && lock.editable && !wrapper) {
      lock = boundTranslationLock(selectedBlock[f.name], localeCtx.defaultLocale) ?? lock
    }
    if (translating && lock.editable && blocksField) {
      const chain = keyChain(blocks, selectedRow.path)
      if (!chain) {
        lock = { editable: false, reason: `This block has no key yet. Save it once in ${localeCtx.defaultLocale}, then translate it.` }
      } else if (lock.via === 'rows') {
        const container = blocksField.name
        rowsControl = (
          <TranslateRows
            rows={selectedBlock[f.name]}
            localized={localizedRowFields(f)}
            read={(rowKey, sub) => readOverlayValue(activeOverlay, container, [...chain, f.name, rowKey], sub)}
            write={(rowKey, sub, v) => setOverlay(
              writeOverlayValue(activeOverlay, container, [...chain, f.name, rowKey], sub, v),
              `${activeLocale}.${selectedRow.key}.${f.name}.${rowKey}.${sub}`,
            )}
            defaultLocale={localeCtx.defaultLocale}
            workspaceId={workspaceId!}
            typeName={type ?? undefined}
          />
        )
      } else {
        const container = blocksField.name
        const translated = readOverlayValue(activeOverlay, container, chain, f.name)
        const source = selectedBlock[f.name]
        // The control starts from the source text, so translating is
        // rewriting a sentence rather than retyping it beside a grey
        // placeholder. Left untouched it still stores nothing: a value equal
        // to the source is written blank and pruned on save, so the server's
        // fallback keeps following the original.
        value = translationDraft(translated, source)
        inheritedFrom = isInheritedTranslation(translated, source) ? localeCtx.defaultLocale : null
        onChange = (v: unknown) => setOverlay(
          writeOverlayValue(activeOverlay, container, chain, f.name, translationWrite(v, source)),
          `${activeLocale}.${selectedRow.key}.${f.name}`,
        )
      }
    }

    // A token-bound prop keeps its picker; everything else takes the
    // compact control its shape earns, falling back to the admin's real
    // control for anything that needs the width.
    const kind = family ? 'wide' : rowsControl ? 'wide' : controlKind(f)
    const slots = family ? tokens[family] : []
    const tokenRow = family ? tokenLayout(family, slots.length) : null
    const control = family ? (
      tokenRow === 'inline'
        ? <SwatchStrip slots={slots} value={value} onChange={onChange} />
        : <TokenPicker family={family} slots={slots} value={value} onChange={onChange} />
    ) : rowsControl ?? (
      <CompactControl
        field={field}
        kind={kind}
        value={value}
        onChange={onChange}
        workspaceId={workspaceId!}
        typeName={type ?? undefined}
      />
    )

    // Only a block's OWN content props can read from a loop record; Studio's
    // chrome is the page's, not the record's. A translation is literal text
    // for one language, so binding is a base-locale act.
    const bindable = !wrapper && !translating && !!loopContext && isBindableProp(selectedRow.type, f.name)

    return (
      <InspectorRow
        key={`${selectedRow.key}:${item.source}:${f.name}`}
        label={f.label}
        required={f.required}
        layout={tokenRow ?? rowLayout(kind)}
        lockedReason={lock.editable ? undefined : lock.reason}
        below={inheritedFrom ? (
          <p className="text-[10px] text-fg-subtle">Showing the {inheritedFrom} text. Edit it to translate.</p>
        ) : undefined}
      >
        {bindable ? (
          <BindControl
            value={value}
            sourceFields={loopSourceFields}
            source={loopContext!.source}
            onChange={onChange}
          >
            {control}
          </BindControl>
        ) : control}
      </InspectorRow>
    )
  }, [selectedRow, selectedBlock, kitSelected, tokens, workspaceId, type, loopContext, loopSourceFields, updateBlockProp, localeCtx.activeLocale, localeCtx.enabled, localeWritable, typeLocalizable, translating, blocks, blocksField, activeOverlay, setOverlay, activeLocale])

  // ── Autosave: the object editor's PATCH path, debounced ───────────────────
  useEffect(() => {
    // Cleared first: every early return below means there is nothing worth
    // saving, and a stale closure left here would re-save old state.
    pendingSaveRef.current = null
    if (!object || !typeDef || !type || !id) return
    if (!canEdit) return
    if (lastSavedRef.current === '') return   // not loaded yet
    const snap = JSON.stringify({ title, slug, fieldValues })
    if (snap === lastSavedRef.current) return
    const save = async () => {
      setSaveStatus('saving')
      try {
        const body = buildUpdateBody(title, studioSaveValues(fieldValues, slugDirty.current ? { slug } : undefined), typeDef.fields ?? []) as unknown as Record<string, unknown>
        stampIssued()
        const res = await patchDraft(adminFetch as never, { type, id, body, auto: true }) as { data?: Record<string, unknown> }
        lastSavedRef.current = snap
        if (res?.data) {
          const saved = normalizeObjectData(res.data) as unknown as LoadedObject
          setObject((cur) => (cur ? { ...cur, status: saved.status ?? cur.status } : cur))
          if (typeof saved.updated_at === 'string') setLastSavedAt(saved.updated_at)
        }
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 2000)
      } catch {
        setSaveStatus('error')
      }
    }
    // Held so leaving the page can FLUSH it. The timer below is cleared on
    // cleanup, so without this an edit made within AUTOSAVE_MS of navigating
    // away was silently discarded.
    pendingSaveRef.current = save
    const t = setTimeout(() => { pendingSaveRef.current = null; void save() }, AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [title, slug, fieldValues, object, typeDef, type, id, canEdit])

  // ── Autosave for translations: the LOCALE route, one PATCH per dirty locale ──
  // The overlay never rides the draft PATCH above. Dirty is decided on the
  // PAYLOAD, not the draft: buildLocaleSavePayload drops blanks and empty
  // rows, so comparing drafts would call a cleared-then-untouched field
  // dirty forever and save it on every tick.
  //
  // The target is the open DOCUMENT's, not the page's: an instance is a
  // content object and translates into its own `<type>_i18n` row. The drafts
  // carry the document they were typed against and `overlayDraftsFor` hands
  // back nothing when it does not match, so there is no ordering of state
  // updates in which one document's translation reaches another's row.
  useEffect(() => {
    pendingLocaleSaveRef.current = null
    if (!canSaveLocale(localeTarget)) return
    // The document has to have LOADED: seeding a payload from a map that has
    // not arrived would read every translation as cleared and save the
    // clearing.
    const loaded = activeInstanceId ? openInstance?.id === activeInstanceId : !!object && lastSavedRef.current !== ''
    if (!loaded || !localeTypeDef || !typeLocalizable) return
    const { type: docType, id: docId } = localeTarget
    const fields = localizedFieldNames.map((name) => ({ name }))
    const dirty: Array<{ locale: string; payload: Record<string, unknown>; snap: string }> = []
    // Containers are pruned at every depth first: the editor's builder drops
    // blanks one level down, and Studio's blocks nest.
    const toPayload = (draft: LocaleOverlay) =>
      buildLocaleSavePayload(pruneOverlayForSave(draft, localizedContainers), fields, localizedContainers)
    for (const [locale, draft] of Object.entries(overlayDrafts)) {
      const payload = toPayload(draft)
      const snap = JSON.stringify(payload)
      const saved = overlaySavedRef.current[overlaySavedKey(localeTarget, locale)]
        ?? JSON.stringify(toPayload(seedOverlay(i18nMap[locale], localizedFieldNames, localizedContainers)))
      if (snap !== saved) dirty.push({ locale, payload, snap })
    }
    if (dirty.length === 0) return
    const save = async () => {
      setSaveStatus('saving')
      stampIssued()
      const results = await Promise.allSettled(dirty.map(async ({ locale, payload, snap }) => {
        await patchLocaleDraft(adminFetch as never, { type: docType, id: docId, locale, body: payload })
        overlaySavedRef.current[overlaySavedKey(localeTarget, locale)] = snap
        // The map is what a fresh draft seeds from, so it follows the save -
        // the same refresh the object editor's locale drafts do.
        const entry: Record<string, unknown> = {}
        if (typeof payload.title === 'string' && payload.title) entry.__title = payload.title
        for (const [k, v] of Object.entries(payload)) {
          if (k !== 'title' && v !== null && v !== undefined) entry[k] = v
        }
        setI18nMap((m) => ({ ...m, [locale]: entry }))
      }))
      const failed = results.some((r) => r.status === 'rejected')
      setSaveStatus(failed ? 'error' : 'saved')
      if (failed) {
        const first = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
        toast.error('Could not save the translation', first?.reason instanceof Error ? first.reason.message : undefined)
      } else {
        setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 2000)
      }
    }
    pendingLocaleSaveRef.current = save
    const t = setTimeout(() => { pendingLocaleSaveRef.current = null; void save() }, AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [overlayDrafts, i18nMap, setI18nMap, object, localeTypeDef, localeTarget, activeInstanceId, openInstance, typeLocalizable, localizedFieldNames, localizedContainers])

  // Leaving a document FLUSHES its pending translation save, with the target
  // it was scheduled against still captured in the closure. Without this a
  // translation typed within the debounce of switching documents would be
  // silently dropped: the drafts survive the switch (they are stamped, not
  // cleared) but the save effect correctly refuses to write them anywhere
  // but their own row, so nothing would ever pick them up again.
  useEffect(() => () => {
    const pending = pendingLocaleSaveRef.current
    pendingLocaleSaveRef.current = null
    void pending?.()
  }, [localeTarget.key])

  /**
   * Why this tree may NOT be written to the open instance, or null.
   *
   * Two refusals, both because the tree is SHARED. A prop bound to the host
   * page's record has nothing to read on the next page that uses the
   * instance; and an instance that would contain itself, directly or through
   * another instance, renders forever. Both are checked in the editor before
   * the write, with the chain or the paths named, because a save that is
   * refused by the server arrives as a generic failure long after the point
   * where a person could see what caused it.
   */
  const instanceWriteRefusal = useCallback((next: ComponentBlock[]): string | null => {
    const bound = pageBindingRefusal(pageBoundProps(next))
    if (bound) return bound
    if (!activeInstanceId) return null
    const cycle = findInstanceCycle({
      rootId: activeInstanceId,
      tree: next,
      referencesOf: (id) => instanceRows.find((i) => i.id === id)?.references,
      labelOf: (id) => {
        const found = instanceRows.find((i) => i.id === id)
        return found ? instanceTitle(found) : id
      },
    })
    return cycle?.reason ?? null
  }, [activeInstanceId, instanceRows])

  // ── Autosave for the open INSTANCE: the same object route, its own object ──
  // An instance is a content object with a draft, so it saves the way the
  // page does. The body is the blocks field ALONE: everything else about the
  // instance (its title, its placement, its description) belongs to whoever
  // is editing it in the content editor, and Studio must not send back a
  // stale copy of it.
  useEffect(() => {
    pendingInstanceSaveRef.current = null
    if (!instanceType || !openInstance || instanceDraft === null) return
    if (!canEditInstance) return
    const snap = JSON.stringify(instanceDraft)
    if (snap === JSON.stringify(openInstance.blocks)) return
    const refusal = instanceWriteRefusal(instanceDraft)
    if (refusal) {
      // Refused BEFORE the write, and left refused: an autosave that silently
      // dropped the edit would look saved and be gone on the next load.
      setSaveStatus('error')
      setInstanceRefusal(refusal)
      return
    }
    setInstanceRefusal(null)
    const target = openInstance
    const save = async () => {
      setSaveStatus('saving')
      try {
        stampIssued()
        await patchDraft(adminFetch as never, { type: instanceType.type, id: target.id,
          body: { [instanceType.blocksField]: instanceDraft }, auto: true,
        })
        setOpenInstance((cur) => (cur && cur.id === target.id ? { ...cur, blocks: instanceDraft } : cur))
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus((st) => (st === 'saved' ? 'idle' : st)), 2000)
      } catch (err) {
        setSaveStatus('error')
        toast.error('Could not save the instance', err instanceof Error ? err.message : undefined)
      }
    }
    pendingInstanceSaveRef.current = save
    const t = setTimeout(() => { pendingInstanceSaveRef.current = null; void save() }, AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [instanceType, openInstance, instanceDraft, canEditInstance, instanceWriteRefusal])

  /** Run any debounced save immediately. Awaited before leaving the page. */
  const flushSave = useCallback(async () => {
    const pending = pendingSaveRef.current
    const pendingLocale = pendingLocaleSaveRef.current
    const pendingInstance = pendingInstanceSaveRef.current
    pendingSaveRef.current = null
    pendingLocaleSaveRef.current = null
    pendingInstanceSaveRef.current = null
    await Promise.all([pending?.(), pendingLocale?.(), pendingInstance?.()])
  }, [])

  // ── Shared surfaces: the explicit save a global needs ─────────────────────
  /**
   * Saves one surface, then publishes the shared delivery artifact so the
   * site and the API say the same thing. Confirmed first, because a global
   * has no draft: this goes live on every page the moment it lands.
   *
   * TWO doors, and the member's own bundle picks which (see
   * `canEditSurfaces`). A member holding `studio:globals` goes through
   * Studio's narrow route, which may write only an approved surface's own
   * field. A member holding the platform's `globals` scope goes through the
   * platform's route exactly as before, so nothing regresses for a role that
   * was already set up that way. Either body is the surface field alone, so
   * the rest of the global survives.
   */
  const saveSurface = useCallback(async (global: string) => {
    const loaded = resolveSurface(surfaces, global)
    const draft = surfaceDrafts[global]
    if (!loaded || !draft) return
    const access = surfaceAccess(global)
    if (!access.ok) { toast.error(access.reason); return }
    const ok = await confirm({
      title: `Save ${loaded.surface.label} to every page?`,
      message: 'A shared surface has no draft: this change goes live on every page of the site at once, in this environment.',
      confirmLabel: `Save ${loaded.surface.position}`,
    })
    if (!ok) return
    setSurfaceSaving(global)
    try {
      const body = JSON.stringify(surfaceSaveBody(loaded.surface, draft))
      await adminFetch(
        access.via === 'capability'
          ? `/admin/ext/studio/surfaces/${encodeURIComponent(global)}`
          : `/globals/${encodeURIComponent(global)}`, { method: 'PATCH', body },
      )
      // The artifact follows the store; a failure here leaves the global
      // saved and says so, rather than pretending the save did not happen.
      try {
        await adminFetch('/admin/ext/studio/surfaces/publish', { method: 'POST', body: '{}' })
      } catch (err) {
        toast.error('Saved, but the delivery artifact was not published', err instanceof Error ? err.message : undefined)
      }
      setSurfaces((prev) => withSavedSurface(prev, global, draft))
      setSurfaceDrafts((prev) => { const next = { ...prev }; delete next[global]; return next })
      toast.success(`${loaded.surface.label} saved to every page`)
      // The preview renders the surface from the saved global, so it is
      // reloaded to show what just went live. Setting src to itself is the
      // one reload that works across origins.
      const frame = frameRef.current
      if (frame) frame.src = frame.src
    } catch (err) {
      toast.error(`Could not save ${loaded.surface.label}`, err instanceof Error ? err.message : undefined)
    } finally {
      setSurfaceSaving(null)
    }
  }, [surfaces, surfaceDrafts, surfaceAccess, confirm])

  /** Drops a surface's unsaved changes - back to what is stored. */
  const discardSurface = useCallback((global: string) => {
    setSurfaceDrafts((prev) => { const next = { ...prev }; delete next[global]; return next })
    if (activeSurfaceRef.current === global) {
      historyRef.current = null
      setHistoryTick((n) => n + 1)
    }
  }, [])

  /**
   * The page autosaves, so leaving flushes it; a surface does not, so
   * leaving with one unsaved asks. Returns whether to go.
   */
  const leaveSurfaces = useCallback(async (): Promise<boolean> => {
    const dirty = dirtySurfaces(surfaces, surfaceDrafts)
    if (dirty.length === 0) return true
    const names = dirty.map((g) => resolveSurface(surfaces, g)?.surface.label ?? g).join(', ')
    return confirm({
      title: 'Leave without saving the shared surfaces?',
      message: `${names} ${dirty.length === 1 ? 'has' : 'have'} unsaved changes. Shared surfaces do not autosave; leaving discards them.`,
      confirmLabel: 'Discard and leave',
      variant: 'destructive',
    })
  }, [surfaces, surfaceDrafts, confirm])

  // ── Publish: the NORMAL flow (same endpoint as the editor, review gate intact) ──
  useEffect(() => {
    if (!type || !id) return
    let alive = true
    adminFetch<{ data: LifecycleActions }>(
      `/objects/${type}/actions`, undefined, { objectId: id },
    )
      .then((r) => { if (alive) setPublishPolicy(publishPolicyOfActions(r.data)) })
      .catch(() => { if (alive) setPublishPolicy(null) })   // a broken hint never takes the button away
    return () => { alive = false }
  }, [type, id, object?.status])

  /**
   * The same required-field check the editor runs before publishing or
   * submitting. Without it Studio hands the server a page it will refuse -
   * and the refusal arrives as a generic failure, well after the point where
   * a person could see WHICH field was empty.
   */
  const validateRequired = useCallback((): boolean => {
    const fields = typeDef?.fields
    if (!fields) return true
    const errors = validateFields(title, fieldValues, fields)
    const keys = Object.keys(errors)
    if (keys.length === 0) return true

    // Named, not counted: "2 required fields are missing" in a builder whose
    // fields live behind a tab and a selection is not findable.
    const named = keys
      .map((k) => (k === '__title' ? 'Title' : fields.find((f) => f.name === k)?.label || k))
      .slice(0, 3)
      .join(', ')
    toast.error(
      keys.length === 1 ? `${named} is required` : `Required: ${named}${keys.length > 3 ? '…' : ''}`,
    )
    // Nothing selected shows the PAGE inspector, which is where these fields
    // live - so the person is looking at them when the message lands.
    setSelectedKey(null)
    return false
  }, [typeDef, title, slug, fieldValues])

  /**
   * Publishing the INSTANCE that is open, rather than the page behind it.
   *
   * Two calls, in this order and for the same reason a page publish takes
   * two: the platform owns publishing a content object, and the shared
   * artifact must only ever carry what the platform actually published. The
   * artifact republish is what makes the change reach pages - no page is
   * republished, which is the entire point of the concept.
   */
  const onPublishInstance = useCallback(async () => {
    if (!instanceType || !openInstance) return
    const name = instanceTitle(openInstance)
    const ok = await confirm({
      title: `Publish "${name}"?`,
      // The whole MAP, not one entry: an absent entry means both "nothing
      // uses it" and "nobody has counted yet", and a confirmation that says
      // the reassuring one when the scan has not answered is the single wrong
      // answer that leads to a publish nobody meant.
      message: `${usageConsequence(name, instanceUsage, openInstance.id)} `
        + 'Publishing updates every page that uses it at once, and republishes no page.',
      confirmLabel: 'Publish',
    })
    if (!ok) return
    setPublishing(true)
    try {
      // Anything still on the debounce would otherwise be published as the
      // version before it.
      await pendingInstanceSaveRef.current?.()
      pendingInstanceSaveRef.current = null
      stampIssued()
      await adminFetch(`/objects/${instanceType.type}/${openInstance.id}/publish`, { method: 'POST' })
      // The delivery layer follows. A failure here leaves the instance
      // published and says so, rather than a success toast over a live site
      // that will not change.
      try {
        stampIssued()
        await adminFetch('/admin/ext/studio/surfaces/publish', { method: 'POST', body: '{}' })
        toast.success(`Published "${name}"`)
      } catch (err) {
        toast.error('Published, but the live site was not updated', err instanceof Error ? err.message : undefined)
      }
      await loadInstances()
      await loadInstanceTrees()
    } catch (err) {
      toast.error('Publish failed', err instanceof Error ? err.message : undefined)
    } finally {
      setPublishing(false)
    }
  }, [instanceType, openInstance, instanceUsage, confirm, loadInstances, loadInstanceTrees])

  const onPublish = useCallback(async () => {
    if (!type || !id || !typeDef || !object) return
    if (!validateRequired()) return
    const ok = await confirm({
      title: 'Publish this page?',
      message: 'The current draft goes live through the normal publish flow. Sections marked hidden stay unpublished.',
      confirmLabel: 'Publish',
    })
    if (!ok) return
    setPublishing(true)
    try {
      // Flush any pending edits first so the publish snapshot includes them.
      const snap = JSON.stringify({ title, slug, fieldValues })
      if (snap !== lastSavedRef.current) {
        const body = buildUpdateBody(title, studioSaveValues(fieldValues, slugDirty.current ? { slug } : undefined), typeDef.fields ?? []) as unknown as Record<string, unknown>
        stampIssued()
        await patchDraft(adminFetch as never, { type, id, body, auto: true })
        lastSavedRef.current = snap
      }
      // The publish and the delivery artifact each echo back on the socket
      // (object.published, then publish.completed); stamped as issued here
      // so the notice does not report this page's own publish as elsewhere.
      stampIssued()
      const res = await adminFetch<{ data: Record<string, unknown> }>(
        `/objects/${type}/${id}/publish`, { method: 'POST' },
      )
      const pub = normalizeObjectData(res.data) as unknown as LoadedObject
      setObject((cur) => (cur ? { ...cur, status: pub.status ?? 'published' } : cur))
      if (typeof pub.updated_at === 'string') setLastSavedAt(pub.updated_at)

      // Carry the published page into the DELIVERY layer. Page publishing is
      // platform-owned, so this is a second call rather than a hook inside
      // the first - and it runs AFTER, because an artifact for something the
      // platform refused to publish would put a draft on a public route.
      //
      // A failure here cannot fail the publish: the page is already live and
      // the client cannot un-publish it. Saying so plainly beats a success
      // toast that hides a site which will not update.
      try {
        stampIssued()
        await adminFetch('/admin/ext/studio/pages/publish', {
          method: 'POST', body: JSON.stringify({ type, id }),
        })
        toast.success('Published')
      } catch (err) {
        toast.error(
          'Published, but the live site was not updated',
          err instanceof Error ? err.message : undefined,
        )
      }
    } catch (err) {
      // Failure honesty: review-gate refusals, validation, cascades - the
      // server's message lands in the toast, never a silent no-op.
      toast.error('Publish failed', err instanceof Error ? err.message : undefined)
    } finally {
      setPublishing(false)
    }
  }, [type, id, typeDef, object, title, slug, fieldValues, confirm, validateRequired])

  /**
   * Re-read the publish gate. Anything that can change whether publishing is
   * allowed - a review action, an extension panel - has to call this, or the
   * Publish control keeps showing the previous verdict.
   */
  const reloadPublishPolicy = useCallback(async () => {
    if (!type || !id) return
    try {
      const r = await adminFetch<{ data: LifecycleActions }>(
        `/objects/${type}/actions`, undefined, { objectId: id },
      )
      setPublishPolicy(publishPolicyOfActions(r.data))
    } catch { /* a broken hint never takes the button away */ }
  }, [type, id])

  // ── Extension panels ──────────────────────────────────────────────────────
  // Studio HOSTS the same sidebar panels the object editor does, rather than
  // rebuilding each extension's flow. Review is the case that forced it:
  // assigning a reviewer, approving with a note, reassigning - all of it
  // already exists in that extension's own panel, and a second Studio-flavour
  // implementation would be a second thing to keep correct.
  const [extPanels, setExtPanels] = useState<Array<{ id: string; extensionId: string; label: string }>>([])

  useEffect(() => {
    if (!workspaceId || !type) return
    let alive = true
    cachedWorkspaceGet<{ data: Array<{ id: string; extensionId: string; label: string; placement?: string }> }>(
      `/admin/workspaces/${workspaceId}/sidebar-panels?type=${encodeURIComponent(type)}`,
    )
      .then((r) => {
        if (!alive) return
        setExtPanels((r.data ?? [])
          // Only panels that actually resolved to a component - a manifest
          // entry whose extension is not in this build would render nothing.
          .filter((p) => panelRegistryKey(p.extensionId, p.id) in PANEL_REGISTRY)
          .map((p) => ({ id: p.id, extensionId: p.extensionId, label: p.label })))
      })
      .catch(() => { if (alive) setExtPanels([]) })
    return () => { alive = false }
  }, [workspaceId, type])

  // ── Review ────────────────────────────────────────────────────────────────
  // Studio showed only "Submit for review", which said what to do but never
  // what HAPPENED. Once submitted the page could not be published and nothing
  // explained why - the state lived in the other editor's panel.
  const [reviewRaw, setReviewRaw] = useState<Record<string, unknown> | null>(null)
  const [submitOpen, setSubmitOpen] = useState(false)
  const [reviewAction, setReviewAction] = useState<ReviewActionKind | null>(null)

  /** The review picture for this page, or null when review does not govern it. */
  const reviewChip = useMemo(
    () => reviewChipState(reviewRaw as never, publishPolicy?.blocked !== false),
    [reviewRaw, publishPolicy],
  )

  /**
   * True when REVIEW is what stands between this page and publishing. A
   * Publish button is then a lie - it cannot publish, and offering it invites
   * someone to click it and collect a refusal - so the review control carries
   * the only action that exists here.
   *
   * Narrower than "blocked" on purpose: another extension might block
   * publishing without offering review, and that case keeps its Publish
   * button plus the generic way-forward action.
   */
  const reviewGatesPublish = !!reviewChip && publishPolicy?.blocked === true


  const loadReview = useCallback(async () => {
    if (!id || !type) return
    try {
      const r = await adminFetch<{ data: Record<string, unknown> }>(
        `/admin/ext/review/state/${id}`, undefined, { type },
      )
      setReviewRaw(r.data ?? null)
    } catch {
      // Review is optional - an uninstalled extension is not an error, it
      // just means this workspace does not review anything.
      setReviewRaw(null)
    }
  }, [id, type])
  useEffect(() => { void loadReview() }, [loadReview])

  /** One review action, then re-read both review state and the publish gate. */
  const runReviewAction = useCallback(async (path: string, body?: Record<string, unknown>) => {
    if (!id) return
    // Submitting is a publish-shaped act: it hands the page to someone else
    // to approve, so it gets the same required-field check.
    if (path === 'submit' && !validateRequired()) return
    setPublishing(true)
    try {
      await flushSave()
      await adminFetch(`/admin/ext/review/${path}/${id}`, {
        method: 'POST', body: JSON.stringify({ typeName: type, ...(body ?? {}) }),
      })
      await loadReview()
      // The gate's answer just changed, so the Publish control must be
      // re-read rather than left showing the previous verdict.
      await reloadPublishPolicy()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That review action failed')
    } finally {
      setPublishing(false)
    }
  }, [id, type, flushSave, loadReview, reloadPublishPolicy, validateRequired])

  /**
   * Run whatever the blocking extension offers instead of publishing. The
   * path is validated (policyActionPath) rather than trusted: it comes from
   * the extension, and must only ever reach that extension's own mount.
   */
  const onPolicyAction = useCallback(async () => {
    const action = publishPolicy?.action
    const extensionId = publishPolicy?.extensionId
    if (!action || !extensionId) return
    if (!validateRequired()) return
    const path = policyActionPath(extensionId, action.path)
    if (!path) { toast.error('That action could not be run'); return }
    setPublishing(true)
    try {
      await flushSave()
      await adminFetch(path, {
        method: (action.method ?? 'POST') as 'POST',
        body: JSON.stringify(action.body ?? {}),
      })
      // Re-read the policy: the action just changed what is possible.
      const r = await adminFetch<{ data: LifecycleActions }>(
        `/objects/${type}/actions`, undefined, { objectId: id! },
      )
      setPublishPolicy(publishPolicyOfActions(r.data))
      toast.success(`${action.label} - done`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That action failed')
    } finally {
      setPublishing(false)
    }
  }, [type, id, publishPolicy, flushSave, validateRequired])

  /**
   * Lifecycle actions beyond publish. Studio calls the same endpoints the
   * object editor does rather than adopting its lifecycle hook, which takes
   * thirty-odd options wired to editor state Studio has no equivalent of.
   */
  const onPublishAction = useCallback(async (action: PublishActionId) => {
    if (!type || !id || !object) return
    if (action === 'publish') { await onPublish(); return }

    const destructive = action === 'archive' || action === 'unpublish'
    if (destructive) {
      const ok = await confirm({
        title: action === 'archive' ? 'Archive this page?' : 'Unpublish this page?',
        message: action === 'archive'
          ? 'It stops appearing in listings and on the site. You can restore it later.'
          : 'It is removed from the live site. The draft is kept.',
        confirmLabel: action === 'archive' ? 'Archive' : 'Unpublish',
        variant: 'destructive',
      })
      if (!ok) return
    }

    try {
      // Any pending edit must land BEFORE a lifecycle change, or publishing
      // would ship the version from a second ago.
      await flushSave()
      stampIssued()
      if (action === 'schedule') {
        const when = window.prompt('Publish at (YYYY-MM-DD HH:MM)')
        if (!when) return
        const at = new Date(when)
        if (Number.isNaN(at.getTime())) { toast.error('That date could not be read'); return }
        await adminFetch(`/objects/${id}/schedule`, {
          method: 'POST', body: JSON.stringify({ scheduledAt: at.toISOString() }),
        })
      } else if (action === 'unschedule') {
        await adminFetch(`/objects/${id}/schedule`, { method: 'DELETE' })
      } else if (action === 'unpublish') {
        await adminFetch(`/objects/${type}/${id}/unpublish`, { method: 'POST' })
      } else if (action === 'archive') {
        await adminFetch(`/objects/${type}/${id}`, { method: 'DELETE' })
      } else if (action === 'restore') {
        await adminFetch(`/objects/${type}/${id}`, {
          method: 'PATCH', body: JSON.stringify({ status: 'draft' }),
        })
      }
      const fresh = await adminFetch<{ data: Record<string, unknown> }>(`/objects/${type}/${id}`)
      const refreshed = normalizeObjectData(fresh.data) as unknown as LoadedObject
      setObject(refreshed)
      if (typeof refreshed.updated_at === 'string') setLastSavedAt(refreshed.updated_at)
      toast.success('Updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That action failed')
    }
  }, [type, id, object, onPublish, confirm, flushSave])


  // ── Selection sync: overlay → tree ────────────────────────────────────────
  const frontendUrl = previewCfg?.frontendUrl ?? null

  /**
   * Push the DRAFT stylesheet into the preview. The live site loads published
   * CSS from the public route; the canvas has to show unpublished work, and
   * postMessage is the channel that already exists.
   */
  const [draftRefused, setDraftRefused] = useState<Refusal[]>([])
  /**
   * The two halves of what the canvas reads: the workspace stylesheet the
   * server renders, and the page's OWN CSS (X-T1, its sections' raw CSS),
   * compiled here from the blocks in hand because they may be unsaved.
   * Publish appends the same page CSS after the same stylesheet through the
   * same function (`pageStyles`), so the designer decides with the bytes
   * the visitor gets.
   */
  const serverCssRef = useRef('')
  const pageCssRef = useRef('')
  const postStyles = useCallback(() => {
    if (!frontendUrl) return
    // Joined the way the artifact composes them, so the canvas reads the
    // bytes the visitor will.
    const css = [serverCssRef.current, pageCssRef.current].filter(Boolean).join('\n')
    frameRef.current?.contentWindow?.postMessage({ type: STUDIO_STYLES_TYPE, css }, frontendUrl)
  }, [frontendUrl])
  /**
   * The page's OWN raw CSS (X-T2), from Studio's store (`page:<id>`), with
   * the version token the stale-write guard compares. Scoped by the compiler
   * to the page's top-level blocks - see page-css.ts for why there is no
   * page root to scope it by.
   */
  const [pageCss, setPageCss] = useState('')
  const pageCssRevRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!id) return
    let alive = true
    adminFetch<{ data: { css?: string; rev?: string } }>(`/admin/ext/studio/pages/${encodeURIComponent(id)}/css`)
      .then((r) => {
        if (!alive) return
        setPageCss(typeof r.data?.css === 'string' ? r.data.css : '')
        pageCssRevRef.current = r.data?.rev
      })
      .catch(() => { /* a page with none reads as none */ })
    return () => { alive = false }
  }, [id])
  const onPageCss = useCallback(async (css: string) => {
    if (!id) return
    try {
      const r = await adminFetch<{ data: { css: string; rev?: string } }>(`/admin/ext/studio/pages/${encodeURIComponent(id)}/css`, {
        method: 'PATCH',
        body: JSON.stringify({ css, expectedVersion: pageCssRevRef.current }),
      })
      setPageCss(r.data?.css ?? '')
      pageCssRevRef.current = r.data?.rev
      // The same trail a class's raw CSS leaves, keyed to the page itself.
      auditRawCss('page', id, [SECTION_CSS_OVERRIDE])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the page\'s custom CSS')
    }
  }, [id, auditRawCss])
  const pushDraftStyles = useCallback(async () => {
    if (!frontendUrl) return
    try {
      const r = await adminFetch<{ data: { css: string; refused?: Refusal[] } }>('/admin/ext/studio/styles/draft')
      serverCssRef.current = r.data?.css ?? ''
      postStyles()
      // What protection kept out of the canvas, for the Style panel to say
      // once - the alternative is a value that is in the store and moves
      // nothing, with the explanation only in the server log.
      setDraftRefused(r.data?.refused ?? [])
    } catch { /* the canvas keeps the last styles it had */ }
  }, [frontendUrl, postStyles])
  useEffect(() => { pushDraftStylesRef.current = pushDraftStyles }, [pushDraftStyles])
  /** The protection map for the page's CSS - the defs the editor holds, read once per def change. */
  const sectionProtections = useMemo(() => protectionsFromDefs(componentDefs), [componentDefs])
  // The page CSS follows the blocks, not the class store: an edit to a
  // section's raw CSS lands in the draft tree, so it is recompiled from there
  // and re-pushed on its own, without a round trip to the server.
  useEffect(() => {
    // The page's OWN raw CSS is scoped to the top-level blocks it is compiled
    // against, so while an INSTANCE is on the canvas it would be scoped to
    // the instance's blocks instead: one page's rules styling a tree that
    // renders on every page. Section CSS still travels, because it lives on
    // the block and belongs to whichever document holds it.
    const next = pageStyles({
      blocks, protections: sectionProtections, page: activeInstanceId ? undefined : pageCss,
    }).css
    if (next === pageCssRef.current) return
    pageCssRef.current = next
    postStyles()
  }, [blocks, sectionProtections, pageCss, postStyles, activeInstanceId])
  useEffect(() => {
    if (!frontendUrl) return
    const onMsg = (e: MessageEvent) => {
      if (!sameOrigin(e.origin, frontendUrl)) return
      // The overlay announces itself on activation. Before this handshake
      // Studio had no way to know the overlay was even installed, so a site
      // that never called enableStudioOverlay just felt broken.
      if (isStudioGeometryMessage(e.data)) {
        const next = new Map<string, StudioBlockRect['rect']>()
        for (const b of e.data.blocks) next.set(b.key, b.rect)
        geometryRef.current = next
        setSelectedRect((prev) => {
          const r = selectedKeyRef.current
            ? rectFor(next, selectedKeyRef.current, selectedInstanceRef.current)
            : null
          // Same numbers, same object - React skips the render.
          if (prev && r && prev.top === r.top && prev.left === r.left
              && prev.width === r.width && prev.height === r.height) return prev
          return r
        })
        return
      }
      if (isStudioReadyMessage(e.data)) {
        setOverlayCanSuspend(e.data.capabilities.includes('suspend'))
        // The frame just (re)loaded, so it carries only PUBLISHED css. Push
        // the draft now or the canvas shows stale styling until the next
        // edit - and a reload would silently revert what you were looking at.
        void pushDraftStylesRef.current?.()
        return
      }
      if (isStudioMeasuredMessage(e.data)) {
        const want = pendingEditRef.current
        if (!want || want.instance !== e.data.key) return   // a stale reply
        pendingEditRef.current = null
        setInlineEdit({ key: want.key, prop: want.prop, rect: e.data.rect, style: e.data.style, initial: want.initial, overlayChain: want.overlayChain, source: want.source })
        return
      }
      if (!isStudioSelectMessage(e.data)) return
      // What was clicked is a rendered row; what gets EDITED is the stored
      // block behind it. Outside a loop these are the same string.
      const clicked = templateKeyOf(e.data.key)
      // A key from inside a composed instance belongs to the INSTANCE's tree,
      // not to this document's, so it is mapped back to the reference row -
      // the only block this page owns there, and the one carrying Edit
      // instance and Detach. Anything else round-trips untouched.
      const borrowed = borrowedOwnersRef.current.get(clicked) ?? null
      const instance = borrowed ?? e.data.key
      const key = borrowed ?? clicked
      selectedInstanceRef.current = instance
      const now = Date.now()
      // Two selects on one block IS a double-click - the overlay already
      // posts one per click, so this needs no protocol of its own.
      // Double-click is per ROW: clicking two different rows of a loop in
      // quick succession is two selections, not an edit gesture.
      // Never on a borrowed block: its text belongs to the instance, which
      // renders on many pages, and the reference is Locked precisely so it
      // cannot be edited from a page that merely uses it.
      if (!borrowed && isDoubleSelect(lastSelectRef.current, instance, now)) {
        lastSelectRef.current = null
        requestInlineEdit(key, instance)
      } else {
        lastSelectRef.current = { key: instance, at: now }
      }
      // The overlay does not know documents, only keys. A key a surface
      // holds opens that surface; everything else belongs to whatever the
      // frame is rendering, which is the INSTANCE when one is open (the
      // canvas follows the document). The document switch resets selection,
      // so the key is parked for the switch effect to apply.
      const owner = surfaceForKey(surfacesRef.current, key)?.global ?? null
      const wanted = docForClickedKey({ active: activeDocRef.current, surfaceOwner: owner })
      if (!sameDoc(wanted, activeDocRef.current)) {
        pendingSelectRef.current = key
        setWantedDoc(wanted)
      }
      setSelectedKey(key)
      document.querySelector(`[data-studio-row="${key.replace(/"/g, '\\"')}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [frontendUrl])

  // ── Selection sync: tree → overlay ────────────────────────────────────────
  const selectRow = useCallback((row: BlockRow) => {
    setSelectedKey(row.key)
    if (frontendUrl) {
      try {
        frameRef.current?.contentWindow?.postMessage({ type: STUDIO_HIGHLIGHT_TYPE, key: row.key }, frontendUrl)
      } catch { /* frame not ready - selection still lands in the rail */ }
    }
  }, [frontendUrl])

  /** Ask the site's overlay to stand down (or come back). */
  useEffect(() => {
    if (!frontendUrl) return
    try {
      frameRef.current?.contentWindow?.postMessage({ type: STUDIO_OVERLAY_TYPE, active: !preview }, frontendUrl)
    } catch { /* frame not ready - it activates un-suspended anyway */ }
  }, [preview, frontendUrl])

  const togglePreview = useCallback(() => {
    setPreview((on) => {
      if (!on) {
        restoreRef.current = { panelOpen: panels.open }
        setPanels((p) => ({ ...p, open: false }))
        return true
      }
      setPanels((p) => ({ ...p, open: restoreRef.current?.panelOpen ?? true }))
      restoreRef.current = null
      return false
    })
  }, [panels.open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && preview) togglePreview()
      // Not while typing: the field's own undo should win inside an input.
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) onRedo(); else onUndo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview, togglePreview, onUndo, onRedo])

  /**
   * Ask the site to measure a block so an editor can be laid over its text
   * wearing the same typography. Silently does nothing when the block has no
   * inline-editable copy - a double-click on a divider should feel inert,
   * not error.
   */
  const requestInlineEdit = useCallback((key: string, instance?: string) => {
    const row = rowsRef.current.find((r) => r.key === key)
    if (!row) return
    const def = defFor(componentDefs, row.type)
    const prop = inlineEditableProp(row.type, def as never)
    if (!prop) return
    const block = blockAtPath(blocksRef.current as never, row.path)
    // A bound prop reads from the record, not from stored copy. Typing over
    // it would replace the connection with one row's literal text - for
    // EVERY row - so inline editing declines and the bind control stays the
    // only way to change it.
    if (boundPath(block?.[prop]) !== null) return
    let initial = typeof block?.[prop] === 'string' ? (block[prop] as string) : ''
    let overlayChain: string[] | null = null
    let inlineSource: unknown = undefined
    // Canvas typing goes through the same lock as the rail: a localized prop
    // types into the locale's overlay, a shared one is refused with the
    // reason, so a French edit can never land on English.
    if (translating) {
      const field = ((def?.fields ?? []) as SubField[]).find((sf) => sf.name === prop)
      const lock = localeEditability(field as SubField, localeCtx)
      if (!lock.editable) { toast.error(lock.reason ?? `Switch to ${localeCtx.defaultLocale} to edit text.`); return }
      overlayChain = keyChain(blocksRef.current, row.path)
      if (!overlayChain || !blocksField) {
        toast.error(`This block has no key yet. Save it once in ${localeCtx.defaultLocale}, then translate it.`)
        return
      }
      // Start from what is on the canvas: the translation when there is one,
      // else the source text the translator is reading.
      const translated = readOverlayValue(activeOverlayRef.current, blocksField.name, overlayChain, prop)
      if (typeof translated === 'string' && translated) initial = translated
      // The source is carried to the commit: text left equal to it is not a
      // translation, and storing it would freeze this string in the default
      // language forever.
      inlineSource = block?.[prop]
    }
    const target = instance ?? key
    pendingEditRef.current = { key, instance: target, prop, initial, overlayChain, source: inlineSource }
    if (!frontendUrl) return
    try {
      // Measured at the CLICKED row so the editor lands on the text the user
      // double-clicked, not on the first row of the loop.
      frameRef.current?.contentWindow?.postMessage({ type: STUDIO_MEASURE_TYPE, key: target }, frontendUrl)
    } catch { /* frame not ready - the double-click simply does nothing */ }
  }, [componentDefs, frontendUrl, localeCtx.activeLocale, localeCtx.enabled, localeCtx.defaultLocale, translating, localeWritable, typeLocalizable, blocksField])

  /**
   * Commit inline copy through the SAME save path as the rail: the draft on
   * the default locale, the overlay while translating.
   */
  const commitInlineEdit = useCallback((value: string) => {
    const target = inlineEdit
    setInlineEdit(null)
    if (!target) return
    const row = rowsRef.current.find((r) => r.key === target.key)
    if (!row || value === target.initial) return
    if (target.overlayChain && blocksField && activeLocale) {
      setOverlay(
        writeOverlayValue(activeOverlay, blocksField.name, target.overlayChain, target.prop, translationWrite(value, target.source)),
        `${activeLocale}.${target.key}.${target.prop}`,
      )
      return
    }
    updateBlockProp(row.path, target.prop, value, `${target.key}.${target.prop}`)
  }, [inlineEdit, updateBlockProp, blocksField, activeLocale, activeOverlay, setOverlay])

  // Keep the listener's view of selection current, and re-anchor the
  // toolbar the moment selection changes rather than waiting for a scroll.
  useEffect(() => { rowsRef.current = rows; blocksRef.current = blocks }, [rows, blocks])
  useEffect(() => {
    // What the listener resolves a clicked key against: every surface with
    // its CURRENT blocks (a draft's keys are the stored keys, plus new ones).
    surfacesRef.current = surfaces.map((s) => ({ ...s, blocks: draftBlocks(surfaces, surfaceDrafts, s.surface.global) }))
    activeSurfaceRef.current = activeSurfaceName
    activeDocRef.current = activeDoc
  }, [surfaces, surfaceDrafts, activeSurfaceName, activeDoc])

  // Which reference each BORROWED key came from. A click inside a composed
  // instance sends a key this document's tree does not contain, and without
  // this the editor would select nothing at all, which reads as broken. The
  // reference row is the block the page actually owns, and the one offering
  // Edit instance and Detach.
  useEffect(() => {
    borrowedOwnersRef.current = borrowedKeyOwners(blocks, instanceTrees)
  }, [blocks, instanceTrees])

  useEffect(() => {
    selectedKeyRef.current = selectedKey
    setSelectedRect(selectedKey ? rectFor(geometryRef.current, selectedKey, selectedInstanceRef.current) : null)
  }, [selectedKey])

  // ── Tree operations ───────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const onDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = rows.findIndex((r) => r.key === active.id)
    const to = rows.findIndex((r) => r.key === over.id)
    if (from < 0 || to < 0) return
    // Only top-level sections reorder; a nested row's `index` addresses its
    // own array, so treating it as a top-level position would corrupt the tree.
    if (rows[from].depth !== 0 || rows[to].depth !== 0) return
    setBlocks(reorderBlocks(blocks, rows[from].index, rows[to].index))
  }, [rows, blocks, setBlocks])

  const onDuplicate = useCallback((index: number) => {
    const next = duplicateBlock(blocks, index)
    setBlocks(next)
    const copy = next[index + 1]
    if (copy?._key) setSelectedKey(copy._key)
  }, [blocks, setBlocks])

  const onToggleHidden = useCallback((index: number) => {
    setBlocks(toggleBlockHidden(blocks as never, index) as never)
  }, [blocks, setBlocks])

  // ── Presets (extension store via /admin/ext/studio) ───────────────────────
  const loadPresets = useCallback(() => {
    adminFetch<{ data: StudioPreset[] }>('/admin/ext/studio/presets')
      .then((r) => setPresets(r.data ?? []))
      .catch(() => setPresets([]))
  }, [])
  useEffect(() => { loadPresets() }, [loadPresets])

  const onSavePreset = useCallback(async (name: string) => {
    if (!selectedBlock) return
    try {
      await adminFetch('/admin/ext/studio/presets', {
        method: 'POST',
        // Serialize the subtree AS IS - a preset is a template with content.
        body: JSON.stringify({ name, block: JSON.parse(JSON.stringify(selectedBlock)) }),
      })
      toast.success('Preset saved')
      loadPresets()
    } catch (err) {
      toast.error('Could not save the preset', err instanceof Error ? err.message : undefined)
    }
  }, [selectedBlock, loadPresets])

  const onRenamePreset = useCallback(async (preset: StudioPreset, name: string) => {
    try {
      await adminFetch(`/admin/ext/studio/presets/${preset.id}`, {
        method: 'PATCH', body: JSON.stringify({ name }),
      })
      loadPresets()
    } catch (err) {
      toast.error('Could not rename the preset', err instanceof Error ? err.message : undefined)
    }
  }, [loadPresets])

  const onDeletePreset = useCallback(async (preset: StudioPreset) => {
    const ok = await confirm({
      title: 'Delete this preset?',
      message: `"${preset.name}" will be removed for the whole workspace.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await adminFetch(`/admin/ext/studio/presets/${preset.id}`, { method: 'DELETE' })
      loadPresets()
    } catch (err) {
      toast.error('Could not delete the preset', err instanceof Error ? err.message : undefined)
    }
  }, [confirm, loadPresets])

  /** Palette pick: insert after the selected block (else append), select it. */
  /**
   * Insert a sibling right after the selection. Cheaper than a drag when you
   * already know what comes next, and it resolves the SAME way a drop does -
   * the container is the selection's own parent, and that slot decides what
   * may land there.
   */
  /**
   * Land a built block at a point. Top level auto-wraps, exactly as the
   * palette does; a typed slot is already inside a section, so never again.
   * ONE seam for the palette, the canvas drop and the Media panel, so the
   * three cannot disagree about where "here" is.
   */
  const insertAt = useCallback((block: Record<string, unknown>, point: DropPoint) => {
    if (point.containerPath.length === 0) {
      const insert = wrapForInsert(block as never, {
        allowed: componentDefs.map((d) => d.name), mintKey: mintBlockKey, wrap: autoSection,
      })
      setBlocks(insertBlockAt(blocks, insert as never, point.index))
    } else {
      const parent = blockAtPath(blocks as never, point.containerPath.slice(0, -1))
      const prop = point.containerPath[point.containerPath.length - 1]
      if (!parent || typeof prop !== 'string') return
      const list = Array.isArray((parent as Record<string, unknown>)[prop])
        ? [...((parent as Record<string, unknown>)[prop] as unknown[])]
        : []
      list.splice(point.index, 0, block)
      setBlocks(setPropAtPath(blocks as never, point.containerPath.slice(0, -1), prop, list) as never)
    }
    setSelectedKey(block._key as string)
  }, [blocks, setBlocks, componentDefs, autoSection])

  const insertAfterSelected = useCallback((def: ComponentDef) => {
    if (!selectedRow) return
    insertAt(buildEmptyBlock(def) as never, {
      containerPath: selectedRow.path.slice(0, -1), index: selectedRow.index + 1, containerType: null,
    })
  }, [selectedRow, insertAt])

  /** What the "+" may offer here - the slot decides, exactly as a drop does. */
  const insertableHere = useMemo(() => {
    if (!selectedRow) return componentDefs
    const containerPath = selectedRow.path.slice(0, -1)
    const containerType = containerPath.length === 0
      ? null
      : rows.find((r) => r.path.length === containerPath.length - 1
          && r.path.every((v, i) => v === containerPath[i]))?.type ?? null
    const allowed = allowedChildTypes(containerType, componentDefs as never, componentDefs.map((d) => d.name))
    return componentDefs.filter((d) => allowed.includes(d.name))
  }, [selectedRow, rows, componentDefs])

  /** Studio's primitives vs what this site declared - two panels, two origins. */
  const palette = useMemo(() => splitPalette(insertableHere), [insertableHere])

  /** Rename a block. Clearing the name restores the derived one. */
  const onRenameRow = useCallback((row: BlockRow, name: string | undefined) => {
    updateBlockProp(row.path, '_label', name)
  }, [updateBlockProp])

  const onPickComponent = useCallback((def: ComponentDef) => {
    // With a selection, land it as that block's NEXT SIBLING - which also
    // fixes a nested pick, where the row's index addresses its own array and
    // appending to the top level was the only safe fallback.
    if (selectedRow) { insertAfterSelected(def); return }
    const block = buildEmptyBlock(def)
    // Land it in a section, unless the field forbids one or the author opted
    // out. Selection stays on what they PICKED, not the section around it.
    const insert = wrapForInsert(block as never, {
      allowed: componentDefs.map((d) => d.name),
      mintKey: mintBlockKey,
      wrap: autoSection,
    })
    setBlocks(insertBlockAt(blocks, insert as never, blocks.length))
    setSelectedKey(block._key)
  }, [blocks, selectedRow, setBlocks, componentDefs, autoSection, insertAfterSelected])

  /** Whether a loop may be placed here - the slot decides, as for a drop. */
  const loopHere = useMemo(() => loopAvailability(insertableHere as never), [insertableHere])

  /** Whether a REFERENCE to an instance may be placed here, same rule. */
  const instanceHere = useMemo(() => instanceAvailability(insertableHere as never), [insertableHere])

  /**
   * Placing a reference from the Instances panel. Lands where a picked
   * component would - after the selection, else at the end - and is refused
   * BEFORE the insert when it would make an instance contain itself, so the
   * block never appears in a tree that cannot be saved.
   */
  const onPickInstance = useCallback((instance: InstanceSummary) => {
    if (!instanceHere.ok) { toast.error(instanceHere.reason); return }
    const block = makeInstanceBlock(instance, mintBlockKey) as ComponentBlock
    const refusal = activeInstanceId ? instanceWriteRefusal([...blocks, block]) : null
    if (refusal) { toast.error('That would make an Instance contain itself', refusal); return }
    if (selectedRow) {
      insertAt(block as never, { containerPath: selectedRow.path.slice(0, -1), index: selectedRow.index + 1, containerType: null })
    } else {
      insertAt(block as never, { containerPath: [], index: blocks.length, containerType: null })
    }
  }, [instanceHere, selectedRow, blocks, insertAt, activeInstanceId, instanceWriteRefusal])

  /** The reference the selection IS, when it is one. */
  const selectedReference = useMemo(() => instanceRefOf(selectedBlock), [selectedBlock])
  /** The instance a selected reference points at, when this environment has it. */
  const referencedInstance = useMemo(
    () => (selectedReference ? instanceRows.find((i) => i.id === selectedReference.instanceId) ?? null : null),
    [selectedReference, instanceRows],
  )

  /**
   * DETACH: this page takes its own copy of the instance's blocks, in place.
   *
   * The one escape hatch V1 offers, because it needs no override machinery.
   * It is ONE WAY on purpose: re-linking would need equality or merge
   * semantics, which is the override system this boundary exists to avoid.
   * The confirmation says all of that before it happens, because a person
   * cannot undo it by pressing the same button again.
   *
   * The source is read fresh rather than from the panel's summary: the copy
   * must be the instance as it is NOW, not as it was when the page loaded.
   */
  const onDetachInstance = useCallback(async () => {
    if (!instanceType || !selectedRow || !selectedReference) return
    const name = selectedReference.label || referencedInstance?.title || 'this instance'
    const ok = await confirm({
      title: `Detach "${name}" on this page?`,
      message: 'This page takes its own copy of the blocks and stops following the instance: later changes to the instance will not reach it, and it will not count as a usage. There is no way back to the link - to get it, delete the copy and place the instance again.',
      confirmLabel: 'Detach',
    })
    if (!ok) return
    try {
      const r = await adminFetch<{ data: Record<string, unknown> }>(
        `/objects/${instanceType.type}/${selectedReference.instanceId}`,
      )
      const data = normalizeObjectData(r.data) as unknown as Record<string, unknown>
      const copy = detachedBlocks(data[instanceType.blocksField], mintBlockKey)
      if (copy.length === 0) {
        toast.error('That instance has no blocks, so there is nothing to copy')
        return
      }
      setBlocks(replaceAtPath(blocks as never, selectedRow.path, copy as never) as never)
      const first = copy[0]?._key
      setSelectedKey(typeof first === 'string' ? first : null)
      toast.success(`Detached - this page now owns its copy of "${name}"`)
    } catch (err) {
      toast.error('Could not detach', err instanceof Error ? err.message : undefined)
    }
  }, [instanceType, selectedRow, selectedReference, referencedInstance, blocks, setBlocks, confirm])

  /**
   * Deleting an instance. Refused by the SERVER while anything still
   * references it, with the list of pages - the check that matters is the
   * one taken against every page of the environment, not against the count
   * this panel happens to be holding.
   *
   * The confirmation still says what the count says, so a person is not
   * surprised by the refusal; and the panel offers Delete whatever the count
   * says, because a refusal that names where is more useful than a control
   * that is quietly missing.
   */
  const onDeleteInstance = useCallback(async (instance: InstanceSummary) => {
    if (!instanceType) return
    const name = instanceTitle(instance)
    const usage = instanceUsage?.[instance.id]
    const ok = await confirm({
      title: `Delete "${name}"?`,
      message: usage && usage.placements > 0
        ? `${usageSentence(name, usage)} An instance that is still used cannot be deleted: detach those placements to keep what was authored, or remove them first.`
        : instanceUsage
          ? 'The instance and its blocks are removed. Pages that referenced it would show nothing where it sat.'
          // Not counted is not the same as not used, and only one of them is
          // safe to delete on. The server refuses either way, with the list.
          : `${usageConsequence(name, instanceUsage, instance.id)} A delete is refused while anything still uses it.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await adminFetch(`/admin/ext/studio/instances/${encodeURIComponent(instance.id)}`, { method: 'DELETE' })
      // The editor cannot stay pointed at a document that no longer exists.
      if (activeInstanceId === instance.id) setWantedDoc(PAGE_DOC)
      toast.success(`Deleted "${name}"`)
      await loadInstances()
      await loadInstanceUsage()
    } catch (err) {
      toast.error('Could not delete that instance', err instanceof Error ? err.message : undefined)
    }
  }, [instanceType, instanceUsage, activeInstanceId, confirm, loadInstances, loadInstanceUsage])

  // ── Making an instance, from inside Studio (I4) ───────────────────────────
  // The rule (user, 2026-08-26): an Instance is a DESIGN resource, so a
  // designer must be able to make one, compose it from Builder Kit blocks and
  // reuse it without ever meeting the content editor. Storage is unchanged -
  // it is still a content object, created through the PLATFORM's own object
  // create path, so drafts, RBAC, revisions and the activity log all apply
  // exactly as they do for a page made from the New page dialog.

  /** Which naming prompt is open, and what it will make when it is answered. */
  const [instanceDialog, setInstanceDialog] = useState<
    | { mode: 'new' }
    /** A section becoming a shared tree: where it sits, and what it costs. */
    | { mode: 'section'; path: BlockPath; block: ComponentBlock; suggested: string; warning: string | null }
    | { mode: 'rename'; instance: InstanceSummary }
    | null
  >(null)
  const [instanceDialogBusy, setInstanceDialogBusy] = useState(false)
  const [instanceDialogError, setInstanceDialogError] = useState<string | null>(null)
  /** May this member make one? The type's own create permission, like any content. */
  const canCreateInstance = instanceType ? can('create', 'objects', instanceType.type) : false
  /** The names already used, so a duplicate is refused before anything is written. */
  const instanceTitles = useMemo(() => instanceRows.map((i) => instanceTitle(i)), [instanceRows])

  /**
   * Writes one instance and answers with its id.
   *
   * Two calls, in the order the New page flow uses: create the object with its
   * own fields, then write the tree through the ordinary draft save. No new
   * create path exists for instances, deliberately - a second one would be a
   * second set of rules about drafts and permissions to keep in step.
   */
  const createInstanceObject = useCallback(async (plan: InstancePlan): Promise<string> => {
    if (!instanceType) throw new Error('This deployment has no Instance type to create one in')
    const fields = instanceTypeDef?.fields ?? []
    const values: Record<string, unknown> = {}
    if (instanceType.placementField) values[instanceType.placementField] = plan.placement
    const created = await adminFetch<{ data: { id: string } }>(`/objects/${instanceType.type}`, {
      method: 'POST',
      body: JSON.stringify(buildCreateBody(instanceType.type, plan.title, values, fields)),
    })
    const newId = created.data?.id
    if (!newId) throw new Error('The instance was created but no id came back')
    if (plan.blocks.length > 0) {
      const body = buildUpdateBody(
        plan.title, { [instanceType.blocksField]: plan.blocks }, fields,
      ) as unknown as Record<string, unknown>
      await patchDraft(adminFetch as never, { type: instanceType.type, id: newId, body })
    }
    return newId
  }, [instanceType, instanceTypeDef])

  /**
   * New instance from the panel: named, empty, and open on the canvas ready to
   * compose. It is a DRAFT, like any new content object, so no page changes
   * until it is published - which the toast says rather than leaving to be
   * discovered.
   */
  const onCreateInstance = useCallback(async (value: InstanceDialogValue) => {
    const planned = planNewInstance(
      { title: value.title, placement: value.placement }, { taken: instanceTitles },
    )
    if (!planned.ok) { setInstanceDialogError(planned.error); return }
    setInstanceDialogBusy(true)
    setInstanceDialogError(null)
    try {
      const newId = await createInstanceObject(planned.plan)
      // The page's own pending edits land before the document switches, so
      // nothing on the debounce is written against the instance instead.
      await flushSave()
      await loadInstances()
      await loadInstanceUsage()
      setInstanceDialog(null)
      setWantedDoc({ kind: 'instance', id: newId })
      toast.success(
        `Created "${planned.plan.title}"`,
        'Compose it here, then publish it to put it on every page that uses it.',
      )
    } catch (err) {
      setInstanceDialogError(err instanceof Error ? err.message : 'Could not create the instance')
    } finally {
      setInstanceDialogBusy(false)
    }
  }, [instanceTitles, createInstanceObject, flushSave, loadInstances, loadInstanceUsage])

  /**
   * "Create instance from this section": the refusals FIRST, then the name.
   *
   * Asking someone to name a thing and then refusing to make it is the shape
   * of a control that appears to work, so a section that cannot be shared -
   * one that is already a reference, or one bound to this page's own record -
   * says so before the prompt opens.
   */
  const onCreateFromSection = useCallback(() => {
    if (!selectedBlock || !selectedRow) return
    const refused = sectionRefusal(selectedBlock)
    if (refused) { toast.error('This section cannot become an instance', refused); return }
    // A section holding a reference back to the instance being edited would
    // make that instance contain itself once this one references the new tree.
    // The new instance is transparent for that question - it holds exactly
    // this section - so the existing check answers it unchanged.
    // `selectedBlock` is read out of `blocks` (a ComponentBlock[]) and only
    // widened to a record on the way through `blockAtPath`, so the narrowing
    // here restates what the tree already guarantees.
    const section = selectedBlock as unknown as ComponentBlock
    const cycle = activeInstanceId ? instanceWriteRefusal([section]) : null
    if (cycle) { toast.error('That would make an Instance contain itself', cycle); return }
    setInstanceDialogError(null)
    setInstanceDialog({
      mode: 'section',
      path: selectedRow.path,
      block: section,
      suggested: selectedRow.label,
      warning: sectionCssWarning(selectedBlock),
    })
  }, [selectedBlock, selectedRow, activeInstanceId, instanceWriteRefusal])

  /**
   * The write behind it: the section's blocks become the instance, and this
   * document keeps a REFERENCE where the section stood, so the tree collapses
   * to one row rather than growing a copy beside the original.
   *
   * The section's keys travel with it (lib/instance-lifecycle explains why: a
   * key is style identity, not a serial number), and the reference is swapped
   * in through `replaceAtPath`, the same seam Detach uses in the other
   * direction.
   */
  const onCreateInstanceFromSection = useCallback(async (
    dialog: { path: BlockPath; block: ComponentBlock }, value: InstanceDialogValue,
  ) => {
    const planned = planInstanceFromSection(
      { title: value.title, placement: value.placement, block: dialog.block },
      { taken: instanceTitles },
    )
    if (!planned.ok) { setInstanceDialogError(planned.error); return }
    setInstanceDialogBusy(true)
    setInstanceDialogError(null)
    try {
      const newId = await createInstanceObject(planned.plan)
      const reference = makeInstanceBlock({ id: newId, title: planned.plan.title }, mintBlockKey) as ComponentBlock
      setBlocks(replaceAtPath(blocks as never, dialog.path, [reference] as never) as never)
      setSelectedKey(reference._key as string)
      setInstanceDialog(null)
      await loadInstances()
      await loadInstanceUsage()
      toast.success(
        `"${planned.plan.title}" is now an instance`,
        'This page keeps a reference to it. Publish the instance to show it on the live site.',
      )
    } catch (err) {
      setInstanceDialogError(err instanceof Error ? err.message : 'Could not create the instance')
    } finally {
      setInstanceDialogBusy(false)
    }
  }, [instanceTitles, createInstanceObject, blocks, setBlocks, loadInstances, loadInstanceUsage])

  /**
   * Renaming one. Safe whatever the usage count says, and that is worth
   * saying out loud beside a delete that is not: a placement points at an
   * INSTANCE ID, so every page using it follows the new name at once and
   * nothing has to be republished. The same prompt carries placement, because
   * where the system puts an instance has to be changeable somewhere and the
   * content editor is not somewhere a designer should be sent.
   */
  const onRenameInstance = useCallback(async (
    instance: InstanceSummary, value: InstanceDialogValue,
  ) => {
    if (!instanceType) return
    setInstanceDialogBusy(true)
    setInstanceDialogError(null)
    try {
      const body: Record<string, unknown> = { title: value.title }
      if (instanceType.placementField) body[instanceType.placementField] = value.placement
      // A real revision, not an autosave: a rename is a deliberate act on a
      // shared resource and belongs in the object's history.
      await patchDraft(adminFetch as never, { type: instanceType.type, id: instance.id, body })
      setInstanceDialog(null)
      await loadInstances()
      toast.success(`Renamed to "${value.title}"`)
    } catch (err) {
      setInstanceDialogError(err instanceof Error ? err.message : 'Could not rename the instance')
    } finally {
      setInstanceDialogBusy(false)
    }
  }, [instanceType, loadInstances])

  /**
   * Duplicating one: a NEW instance from this one's blocks, with fresh keys
   * at every depth, nothing linked to the original.
   *
   * The source is read fresh rather than taken from the panel row, because
   * the row carries a title and a reference list, not a tree - and a copy of
   * a stale tree is the kind of wrong nobody notices until it is on a page.
   */
  const onDuplicateInstance = useCallback(async (instance: InstanceSummary) => {
    if (!instanceType) return
    try {
      const { data } = await adminFetch<{ data: Record<string, unknown> }>(
        `/objects/${instanceType.type}/${instance.id}`,
      )
      const planned = planDuplicateInstance(
        { title: instanceTitle(instance), blocks: data?.[instanceType.blocksField] },
        { taken: instanceTitles },
      )
      if (!planned.ok) { toast.error('Could not duplicate that instance', planned.error); return }
      const newId = await createInstanceObject(planned.plan)
      await flushSave()
      await loadInstances()
      await loadInstanceUsage()
      setWantedDoc({ kind: 'instance', id: newId })
      toast.success(
        `Created "${planned.plan.title}"`,
        'A copy with no link to the original. Publish it when it is ready.',
      )
    } catch (err) {
      toast.error('Could not duplicate that instance', err instanceof Error ? err.message : undefined)
    }
  }, [instanceType, instanceTitles, createInstanceObject, flushSave, loadInstances, loadInstanceUsage])

  /**
   * Placing a collection from the Data panel: a fresh loop, bound to it and
   * named after it, landing where a picked component would - after the
   * selection, else at the end of the page. Same insertAt seam, same
   * auto-section rule.
   */
  const onPickCollection = useCallback((collection: CollectionRef) => {
    if (!loopHere.ok) { toast.error(loopHere.reason); return }
    const block = bindLoopToCollection(
      buildEmptyBlock(loopHere.def as never) as Record<string, unknown>,
      collection,
      { defs: componentDefs as never, mintKey: mintBlockKey },
    )
    if (selectedRow) {
      insertAt(block, { containerPath: selectedRow.path.slice(0, -1), index: selectedRow.index + 1, containerType: null })
    } else {
      insertAt(block, { containerPath: [], index: blocks.length, containerType: null })
    }
  }, [loopHere, componentDefs, selectedRow, blocks, insertAt])

  /**
   * Placing a media asset. Where it lands is decided from the SCHEMA (see
   * mediaTarget): the selected block wins when one of its media fields
   * accepts the asset, otherwise a new image block carries it - and a kind
   * nothing can hold says so rather than doing nothing.
   */
  const onPickMedia = useCallback((asset: StudioMediaAsset) => {
    const target = mediaTarget(asset.mimeType, selectedDef)
    if (target.action === 'none') { toast.error(target.reason); return }
    if (target.action === 'set') {
      if (selectedRow) updateBlockProp(selectedRow.path, target.prop, asset.id)
      return
    }
    const def = componentDefs.find((d) => d.name === target.blockType)
    if (!def) { toast.error('This page has no image block available.'); return }
    const block = buildEmptyBlock(def) as Record<string, unknown>
    block[target.prop] = asset.id
    // A new block lands where the selection says (imagePlacement): inside a
    // selected container that takes it, after any other selection, at the
    // end of the page with none - the Elements panel's own rule.
    const where = imagePlacement(selectedDef, componentDefs, componentDefs.map((d) => d.name))
    if (where.action === 'into' && selectedRow) {
      const held = selectedBlock?.[where.slot]
      insertAt(block, {
        containerPath: [...selectedRow.path, where.slot],
        index: Array.isArray(held) ? held.length : 0,
        containerType: selectedRow.type,
      })
    } else if (where.action === 'after' && selectedRow) {
      insertAt(block, { containerPath: selectedRow.path.slice(0, -1), index: selectedRow.index + 1, containerType: null })
    } else {
      insertAt(block, { containerPath: [], index: blocks.length, containerType: null })
    }
  }, [selectedRow, selectedDef, selectedBlock, componentDefs, updateBlockProp, blocks, insertAt])

  /**
   * Applying a design token to the selected block. Same shape as media: the
   * SCHEMA decides which prop takes it, and a block with nothing of that
   * family says so rather than absorbing the click.
   */
  const onApplyToken = useCallback((family: TokenFamily, slot: string) => {
    if (!selectedRow) return
    const def = defFor(componentDefs, selectedRow.type)
    const target = tokenTarget(family, def, wrapperFieldsFor(selectedRow.type, ((def?.fields ?? []) as SubField[]).map((f) => f.name)))
    if (target.action === 'none') { toast.error(target.reason); return }
    if (target.source === 'wrapper') {
      const next = writeWrapper(selectedBlock ?? ({} as never), target.prop, slot)
      updateBlockProp(selectedRow.path, STUDIO_WRAPPER_PROP, next[STUDIO_WRAPPER_PROP])
      return
    }
    updateBlockProp(selectedRow.path, target.prop, slot)
  }, [selectedRow, selectedBlock, componentDefs, updateBlockProp])

  /**
   * Saves a block's own raw CSS (X-T1) into its `_studio` bag, and records
   * the step outside the tokens - the same trail a class's raw CSS leaves,
   * under its own name.
   */
  const onSectionCss = useCallback((css: string) => {
    if (!selectedRow || !selectedBlock) return
    const next = writeSectionCss(selectedBlock as never, css)
    updateBlockProp(selectedRow.path, STUDIO_WRAPPER_PROP, next[STUDIO_WRAPPER_PROP])
    auditRawCss(selectedRow.type, selectedRow.key, [SECTION_CSS_OVERRIDE])
  }, [selectedRow, selectedBlock, updateBlockProp, auditRawCss])

  /** Which class the Style panel is editing, and how much it affects. */
  const rootStyleTarget = useMemo(
    () => classForEditing(selectedBlock as never, styleClasses, { blocks }),
    [selectedBlock, styleClasses, blocks],
  )
  // The Style Part the panel is aimed at, when the block's author exposed
  // one. Null is the root. A part's class is a SECOND class the block wears,
  // resolved by the same rules as the root's (edit worn, reuse, mint).
  const [partTarget, setPartTarget] = useState<string | null>(null)
  const selectedProtection = useMemo(() => blockProtection(selectedDef), [selectedDef])
  const partOptions = useMemo(() => partTargets(selectedProtection), [selectedProtection])
  // A part this block does not declare must not survive the selection
  // changing, or you would be editing "the button" while looking at an image.
  useEffect(() => {
    if (partTarget && !partOptions.some((p) => p.part === partTarget)) setPartTarget(null)
  }, [partOptions, partTarget])
  const styleTarget = useMemo(() => {
    if (!partTarget || !selectedRow) return rootStyleTarget
    return classForPart(selectedBlock as never, styleClasses, {
      blockType: selectedRow.type,
      part: partTarget,
      baseName: rootStyleTarget?.name ?? autoClassName(selectedRow.type, []),
      blocks,
    })
  }, [partTarget, selectedRow, selectedBlock, styleClasses, rootStyleTarget, blocks])
  const activeStyleClass = styleTarget?.action === 'edit'
    ? styleClasses.find((c) => c.name === styleTarget.name) ?? null
    : null
  const styleUsage = useMemo(
    () => (activeStyleClass ? classUsage(blocks as never, activeStyleClass.name) : 0),
    [blocks, activeStyleClass],
  )
  const styleBreakpoint = breakpointForWidth(bp.width)

  // ── Tag defaults ──────────────────────────────────────────────────────────
  const [tagDefaults, setTagDefaults] = useState<Record<string, Record<string, unknown>>>({})
  /** The version of each tag row, sent back on write so a colleague's save is
   *  refused rather than silently overwritten. */
  const [tagVersions, setTagVersions] = useState<Record<string, string | undefined>>({})
  const [tagTarget, setTagTarget] = useState<string | null>(null)

  const loadTagDefaults = useCallback(async () => {
    try {
      const r = await adminFetch<{ data: Array<{ tag: string; props: Record<string, unknown>; rev?: string }> }>(
        '/admin/ext/studio/tags',
      )
      setTagDefaults(Object.fromEntries((r.data ?? []).map((t) => [t.tag, t.props ?? {}])))
      setTagVersions(Object.fromEntries((r.data ?? []).map((t) => [t.tag, t.rev])))
    } catch { setTagDefaults({}); setTagVersions({}) }
  }, [])
  useEffect(() => { void loadTagDefaults() }, [loadTagDefaults])

  /** The element kinds THIS block renders - nothing else is offerable. */
  const offerableTags = useMemo(() => {
    if (!selectedRow) return []
    const type = selectedRow.type
    if (type === 'kit.heading') {
      const level = String((selectedBlock as Record<string, unknown> | null)?.level ?? 'h2')
      const tag = tagByName(level)
      return tag ? [tag] : []
    }
    if (type === 'kit.text') return [tagByName('p'), tagByName('li')].filter(Boolean) as StudioTag[]
    if (type === 'kit.buttons' || type === 'kit.link') return [tagByName('a')].filter(Boolean) as StudioTag[]
    if (type === 'kit.list') return [tagByName('li')].filter(Boolean) as StudioTag[]
    // A rich text body renders paragraphs, list items and links; its
    // headings are reached through the `heading` part rather than a tag,
    // since the body decides the level.
    if (type === 'kit.richText') return [tagByName('p'), tagByName('li'), tagByName('a')].filter(Boolean) as StudioTag[]
    return []
  }, [selectedRow, selectedBlock])

  // A target that this block cannot offer must not survive the selection
  // changing, or you would be editing "all H2" while looking at an image.
  useEffect(() => {
    if (tagTarget && !offerableTags.some((t) => t.tag === tagTarget)) setTagTarget(null)
  }, [offerableTags, tagTarget])

  /**
   * "Priya changed .card a moment ago", for the classes THIS block wears (or
   * is about to be given) and the tag defaults it can set. A notice whose
   * rev the editor already holds was reloaded past and is not repeated.
   */
  const designLines = useMemo(() => {
    if (!selectedRow || designNotices.length === 0) return []
    const heldRevs: Record<string, string | undefined> = {}
    for (const c of styleClasses) heldRevs[c.name] = c.rev
    for (const [tag, rev] of Object.entries(tagVersions)) heldRevs[tag] = rev
    const relevant = noticesForBlock(designNotices, {
      worn: classesOf(selectedBlock as never),
      pending: styleTarget && styleTarget.action !== 'edit' ? styleTarget.name : null,
      tags: offerableTags.map((t) => t.tag),
      heldRevs,
    })
    const now = Date.now()
    return relevant.map((n) => formatDesignNotice(n, { names: memberNameMap, now }))
  }, [selectedRow, selectedBlock, designNotices, styleClasses, tagVersions, styleTarget, offerableTags, memberNameMap])

  /** Reload replaces the panel's copy of every class and tag with the server's. */
  const onReloadStyles = useCallback(async () => {
    await loadClasses()
    await loadTagDefaults()
    await pushDraftStylesRef.current?.()
  }, [loadClasses, loadTagDefaults])

  /** Classes already used on blocks of this TYPE - the reuse candidates. */
  const reusableClasses = useMemo(() => {
    if (!selectedRow) return []
    const onType = new Set<string>()
    const walk = (list: unknown) => {
      if (!Array.isArray(list)) return
      for (const b of list) {
        if (!b || typeof b !== 'object') continue
        const block = b as Record<string, unknown>
        if (block._type === selectedRow.type) for (const c of classesOf(block)) onType.add(c)
        for (const slot of ['children', 'col1', 'col2', 'col3', 'itemTemplate']) walk(block[slot])
      }
    }
    walk(blocks)
    // One lane at a time: a root edit is offered root classes, a part edit
    // the classes aimed at that part. A part class in the root picker would
    // be wearable and style nothing on the root.
    return styleClasses.filter((c) => onType.has(c.name)
      && (partTarget ? targetsPart(c, selectedRow.type, partTarget) : !c.target))
  }, [blocks, styleClasses, selectedRow, partTarget])

  // ── Class housekeeping (WF-S7b) ───────────────────────────────────────────
  // Usage across EVERY page, loaded when the surface opens: the open page's
  // count is the right blast radius for an edit and the wrong one for a
  // delete, so nothing below may act until this has answered.
  const [classUsageMap, setClassUsageMap] = useState<UsageMap | null>(null)
  const [classUsageLoading, setClassUsageLoading] = useState(false)
  const loadClassUsage = useCallback(async () => {
    setClassUsageLoading(true)
    try {
      const r = await adminFetch<{ data: { usage: UsageMap } }>('/admin/ext/studio/classes/usage')
      setClassUsageMap(r.data?.usage ?? {})
    } catch (err) {
      toast.error('Could not check where classes are used', err instanceof Error ? err.message : undefined)
    } finally {
      setClassUsageLoading(false)
    }
  }, [])

  const onMergeClasses = useCallback(async (keeperId: string, removeIds: string[]) => {
    if (!classUsageMap) return
    const group = styleClasses.filter((c) => c.id === keeperId || removeIds.includes(c.id))
    const ok = await confirm({
      title: 'Merge these classes?',
      message: mergeSummary(group, keeperId, classUsageMap),
      confirmLabel: 'Merge',
      variant: 'destructive',
    })
    if (!ok) return
    setStyleBusy(true)
    try {
      await designFetch('/admin/ext/studio/classes/merge', {
        method: 'POST', body: JSON.stringify({ keep: keeperId, remove: removeIds }),
      })
      // The server rewrote every page's draft, this one included. The open
      // tree is mirrored rather than reloaded so the next autosave does not
      // resurrect the old names from stale local state.
      const keeper = styleClasses.find((c) => c.id === keeperId)
      const removedNames = styleClasses.filter((c) => removeIds.includes(c.id)).map((c) => c.name)
      if (keeper) {
        const out = mergeReferences(blocks, removedNames, keeper.name)
        if (out.changed) setBlocks(out.blocks as ComponentBlock[])
      }
      await loadClasses()
      await loadClassUsage()
      toast.success(`Merged into .${keeper?.name ?? ''}`)
    } catch (err) {
      toast.error('Could not merge the classes', err instanceof Error ? err.message : undefined)
    } finally {
      setStyleBusy(false)
    }
  }, [classUsageMap, styleClasses, blocks, confirm, setBlocks, loadClasses, loadClassUsage])

  const onDeleteClasses = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    const list = styleClasses.filter((c) => ids.includes(c.id))
    const ok = await confirm({
      title: list.length === 1 ? 'Delete this class?' : 'Delete these classes?',
      message: deleteSummary(list),
      confirmLabel: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return
    setStyleBusy(true)
    try {
      for (const c of list) {
        await designFetch(`/admin/ext/studio/classes/${c.id}`, { method: 'DELETE' })
      }
      await loadClasses()
      await loadClassUsage()
    } catch (err) {
      toast.error('Could not delete the classes', err instanceof Error ? err.message : undefined)
    } finally {
      setStyleBusy(false)
    }
  }, [styleClasses, confirm, loadClasses, loadClassUsage])

  const housekeeping = useMemo<ClassHousekeepingProps | undefined>(() => {
    if (styleClasses.length === 0) return undefined
    return {
      classes: styleClasses,
      usage: classUsageMap,
      onOpen: loadClassUsage,
      loading: classUsageLoading,
      // Merging and deleting a class needs the manage grant AND the design
      // grant - the server asks for both (requireDesign), so the panel must
      // not offer an action that would come back a 403.
      canManage: canManagePresets && canDesign,
      onMerge: (keeperId, removeIds) => { void onMergeClasses(keeperId, removeIds) },
      onDelete: (ids) => { void onDeleteClasses(ids) },
      busy: styleBusy,
    }
  }, [styleClasses, classUsageMap, loadClassUsage, classUsageLoading, canManagePresets, canDesign, onMergeClasses, onDeleteClasses, styleBusy])

  /** Apply an existing class to this block instead of minting another. */
  const onPickClass = useCallback((name: string | null) => {
    if (!selectedRow || !selectedBlock || !name) return
    // Replace rather than append: this picker chooses THE class for the
    // element. Composing several is a deliberate act the full panel offers,
    // not something a dropdown should do behind your back. Within its lane
    // only: picking a root class leaves the part classes the block wears,
    // and picking a part class replaces that part's class alone.
    const byName = new Map(styleClasses.map((c) => [c.name, c]))
    const sameLane = (worn: string) => {
      const cls = byName.get(worn)
      if (!cls) return !partTarget
      return partTarget ? targetsPart(cls, selectedRow.type, partTarget) : !cls.target
    }
    const cleared = classesOf(selectedBlock as never).filter(sameLane).reduce<Record<string, unknown>>(
      (block, existing) => withoutClass(block, existing),
      selectedBlock as never,
    )
    const next = withClass(cleared, name)
    updateBlockProp(selectedRow.path, STUDIO_WRAPPER_PROP, next[STUDIO_WRAPPER_PROP])
    void pushDraftStyles()
  }, [selectedRow, selectedBlock, styleClasses, partTarget, updateBlockProp, pushDraftStyles])

  /**
   * Raw CSS on the selected class - the escape hatch Creative Mode retired
   * into. A whole-class edit, not a per-block one, which is the point: raw
   * CSS used to be scattered per block and impossible to review.
   */
  const onCustomCss = useCallback(async (value: string) => {
    if (!activeStyleClass || !selectedRow) return
    setStyleBusy(true)
    try {
      await styleWriterRef.current.run(`class:${activeStyleClass.id}.custom`, async () => {
        const held = styleLedgerRef.current.resolve(activeStyleClass.id, activeStyleClass.rev, activeStyleClass.props as Record<string, unknown>)
        const saved = await designFetch<{ data?: { rev?: string } }>(`/admin/ext/studio/classes/${activeStyleClass.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: activeStyleClass.name, props: held.props,
            custom: value, expectedVersion: held.rev,
          }),
        })
        styleLedgerRef.current.note(activeStyleClass.id, held.rev, saved?.data?.rev, held.props)
      })
      // Stepping outside the design tokens is exactly what the audit exists
      // to record; it followed Creative Mode here rather than retiring with
      // it. Only the FACT is reported, never the CSS.
      auditRawCss(selectedRow.type, selectedRow.key, value.trim() ? [RAW_CSS_OVERRIDE] : [])
      await loadClasses()
      await pushDraftStyles()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that CSS')
    } finally {
      setStyleBusy(false)
    }
  }, [activeStyleClass, selectedRow, auditRawCss, loadClasses, pushDraftStyles])

  /**
   * Fork the shared class for this element only. The alternative to offering
   * this is people forking pre-emptively out of fear, which is exactly where
   * class explosion comes from.
   */
  const onMakeUnique = useCallback(async () => {
    if (!selectedRow || !selectedBlock || !activeStyleClass) return
    setStyleBusy(true)
    try {
      const name = forkClassName(activeStyleClass.name, styleClasses.map((c) => c.name))
      const created = await designFetch<{ data: StyleClass }>('/admin/ext/studio/classes', {
        method: 'POST',
        // A copy, so the fork starts where the original left off rather than
        // blank - "make unique" means "stop sharing", not "start over".
        // `copyOf` names the source so raw CSS survives the fork even for a
        // member who may not WRITE raw CSS: copying what the workspace
        // already has is not authoring it.
        body: JSON.stringify({
          name, props: activeStyleClass.props,
          custom: activeStyleClass.custom, copyOf: activeStyleClass.id,
        }),
      })
      const swapped = withClass(
        withoutClass(selectedBlock as never, activeStyleClass.name),
        created.data.name,
      )
      updateBlockProp(selectedRow.path, STUDIO_WRAPPER_PROP, swapped[STUDIO_WRAPPER_PROP])
      await loadClasses()
      await pushDraftStyles()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not make that unique')
    } finally {
      setStyleBusy(false)
    }
  }, [selectedRow, selectedBlock, activeStyleClass, styleClasses, updateBlockProp, loadClasses, pushDraftStyles])

  /**
   * Replays one style step against the server. Undo and redo are the SAME
   * PATCH aimed in different directions, so there is one applier for both.
   *
   * The version guard is deliberately not sent here: the op already carries
   * the exact props to restore, and refusing an undo because a colleague
   * touched the class would leave the designer with no way back at all.
   */
  const applyStyleOp = useCallback(async (op: StyleOp) => {
    try {
      if (op.kind === 'tag') {
        await designFetch(`/admin/ext/studio/tags/${encodeURIComponent(op.tag)}`, {
          method: 'PATCH', body: JSON.stringify({ props: op.props }),
        })
        await loadTagDefaults()
      } else if (op.kind === 'interaction') {
        await designFetch(`/admin/ext/studio/classes/${op.id}`, {
          method: 'PATCH', body: JSON.stringify({ ...(op.name ? { name: op.name } : {}), interaction: op.interaction }),
        })
        await loadClasses()
      } else {
        await designFetch(`/admin/ext/studio/classes/${op.id}`, {
          method: 'PATCH', body: JSON.stringify({ ...(op.name ? { name: op.name } : {}), props: op.props }),
        })
        await loadClasses()
      }
      await pushDraftStyles()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not undo that style change')
    }
  }, [loadClasses, loadTagDefaults, pushDraftStyles])

  useEffect(() => { applyStyleOpRef.current = applyStyleOp }, [applyStyleOp])

  /**
   * Remembers one style edit so Cmd+Z can walk it back.
   *
   * The coalesce key is the class and the property together: dragging a
   * slider fires per frame, and without merging a single drag would cost
   * fifty undos - but two different properties must never merge into one.
   */
  const recordStyleEdit = useCallback((edit: Parameters<typeof pushStyleEdit>[1], coalesceKey: string) => {
    const before = styleHistoryRef.current
    const next = pushStyleEdit(before, edit, { at: Date.now(), coalesceKey })
    if (next === before) return
    styleHistoryRef.current = next
    lanesRef.current = recordLane(lanesRef.current, 'style', next.past.length > before.past.length)
    setHistoryTick((n) => n + 1)
  }, [])

  /**
   * One style edit. Mints the class on the FIRST change rather than up front,
   * so selecting a block never litters the stylesheet with empty classes -
   * which is where Webflow's class explosion begins.
   */
  const onStyleChangeMany = useCallback(async (changes: Record<string, string>) => {
    if (!selectedRow) return
    if (Object.keys(changes).length === 0) return
    const changeKey = Object.keys(changes).sort().join('+')
    // What this write is ABOUT. A second write on the same row and the same
    // properties while one is in flight replaces the one waiting, so a drag
    // across a colour picker sends its first and last step, not every step.
    const writeKey = tagTarget
      ? `tag:${tagTarget}.${changeKey}`
      : `class:${styleTarget?.name ?? ''}.${changeKey}`
    styleBusyRef.current += 1
    setStyleBusy(true)
    try {
      await styleWriterRef.current.run(writeKey, async () => {
      const at = { state: styleState, breakpoint: styleBreakpoint }
      // Every changed property applied to one base, so a drag that touched
      // two sides lands in ONE write. Two writes would carry the same class
      // version and the second would be refused as stale - by our own guard.
      const applyAll = (base: Record<string, StoredValue> | undefined): Record<string, StoredValue> => {
        const out: Record<string, StoredValue> = { ...(base ?? {}) }
        for (const [id, v] of Object.entries(changes)) {
          // A legacy var() string typed or pasted becomes the reference it
          // means - the reference is canonical, the var is only ever derived.
          const w = writeValue(base?.[id], at, canonicalizeTokenValue(v))
          if (w === undefined) delete out[id]; else out[id] = w
        }
        return out
      }
      const key = changeKey
      if (tagTarget) {
        // The version and props of the last write this editor made to the tag,
        // when it made one; otherwise what the panel loaded.
        const held = styleLedgerRef.current.resolve(
          `tag:${tagTarget}`, tagVersions[tagTarget], (tagDefaults[tagTarget] ?? {}) as Record<string, StoredValue>,
        )
        const current = held.props as Record<string, StoredValue>
        const props = applyAll(current)
        const saved = await designFetch<{ data?: { rev?: string } }>(`/admin/ext/studio/tags/${encodeURIComponent(tagTarget)}`, {
          method: 'PATCH',
          body: JSON.stringify({ props, expectedVersion: held.rev }),
        })
        styleLedgerRef.current.note(`tag:${tagTarget}`, held.rev, saved?.data?.rev, props)
        recordStyleEdit(
          { kind: 'tag', tag: tagTarget, before: current, after: props },
          `tag:${tagTarget}.${key}`,
        )
        await loadTagDefaults()
        await pushDraftStyles()
        return
      }
      if (!styleTarget) return
      if (styleTarget.action === 'reuse') {
        // The class already exists and this block simply had not been given
        // it. Applying it is the whole edit - minting a near-identical
        // sibling instead is how class explosion starts.
        const existing = styleClasses.find((c) => c.name === styleTarget.name)
        if (!existing) return
        const held = styleLedgerRef.current.resolve(existing.id, existing.rev, existing.props as Record<string, StoredValue>)
        const props = applyAll(held.props as Record<string, StoredValue>)
        const saved = await designFetch<{ data?: { rev?: string } }>(`/admin/ext/studio/classes/${existing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: existing.name, props, expectedVersion: held.rev }),
        })
        styleLedgerRef.current.note(existing.id, held.rev, saved?.data?.rev, props)
        recordStyleEdit(
          { kind: 'class', id: existing.id, name: existing.name, before: held.props, after: props },
          `class:${existing.id}.${key}`,
        )
        const next = withClass(selectedBlock as never, existing.name)
        updateBlockProp(selectedRow.path, STUDIO_WRAPPER_PROP, next[STUDIO_WRAPPER_PROP])
        await loadClasses()
        await pushDraftStyles()
        return
      }
      if (styleTarget.action === 'mint') {
        // Everything the block was styled with under the OLD systems comes
        // with it into its first class, so it keeps looking the same the
        // moment it gains one: the token slots (W-1) and the Creative
        // freeform bag (W-3), layered in the order they rendered. Migrating
        // lazily - here, not in a bulk rewrite - means a mistake touches one
        // block and undo covers it.
        // A part class carries nothing over: the old systems styled the
        // root, and a button is not the root.
        const carried = partTarget ? {} : creativeToStyle(
          selectedBlock as never,
          tokenPropsToStyle(selectedBlock as never, selectedDef as never),
        )
        const props = applyAll(carried as Record<string, StoredValue>)
        // The target is written ONCE, here: the class is aimed at this part
        // of this Block type for life, and the server refuses a later change.
        const target = partTarget && selectedRow
          ? { blockType: selectedRow.type, kind: 'part' as const, part: partTarget }
          : undefined
        // Minting can lose a race with itself: a second edit that arrives
        // before the class list refreshes still believes no class exists. The
        // server rightly refuses the duplicate name; the honest recovery is to
        // treat it as the reuse it is, not to show the designer a toast about
        // a collision they did not cause.
        let created: { data: StyleClass }
        try {
          created = await designFetch<{ data: StyleClass }>('/admin/ext/studio/classes', {
            method: 'POST',
            body: JSON.stringify({ name: styleTarget.name, props, ...(target ? { target } : {}) }),
          })
          // The next edit of this class builds on what the server just stored,
          // not on the list the panel is still holding.
          styleLedgerRef.current.note(created.data.id, undefined, created.data.rev, props)
        } catch (err) {
          if (!(err instanceof Error && /already exists/i.test(err.message))) throw err
          const list = await adminFetch<{ data: StyleClass[] }>('/admin/ext/studio/classes')
          const existing = (list.data ?? []).find((c) => c.name === styleTarget.name)
          if (!existing) throw err
          const held = styleLedgerRef.current.resolve(existing.id, existing.rev, existing.props as Record<string, StoredValue>)
          const merged = { ...(held.props as Record<string, StoredValue>), ...props }
          const saved = await designFetch<{ data?: { rev?: string } }>(`/admin/ext/studio/classes/${existing.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: existing.name, props: merged, expectedVersion: held.rev }),
          })
          styleLedgerRef.current.note(existing.id, held.rev, saved?.data?.rev, merged)
          created = { data: { ...existing, props: merged } }
        }
        // The block references the class by NAME, through the same draft save
        // path as every other edit, so it autosaves and undoes normally.
        const next = withClass(selectedBlock as never, created.data.name)
        updateBlockProp(selectedRow.path, STUDIO_WRAPPER_PROP, next[STUDIO_WRAPPER_PROP])
        // The Creative bag GOES once its values are on the class. Unlike the
        // token slots it renders as an inline style, which outranks every
        // class - left behind, it would swallow each later edit to the class
        // it just became: the save would succeed and the page would not move.
        if (!partTarget && withoutCreativeStyle(selectedBlock as never) !== selectedBlock) {
          updateBlockProp(selectedRow.path, CREATIVE_STYLE_PROP, undefined)
        }
      } else {
        const existing = styleClasses.find((c) => c.name === styleTarget.name)
        if (!existing) return
        // The version this editor's own last write to the class produced, when
        // there was one - the panel's copy can be several steps of the same
        // gesture behind. A version from anywhere else is passed through and
        // the server's guard decides, exactly as before.
        const held = styleLedgerRef.current.resolve(existing.id, existing.rev, existing.props as Record<string, StoredValue>)
        const props = applyAll(held.props as Record<string, StoredValue>)
        const saved = await designFetch<{ data?: { rev?: string } }>(`/admin/ext/studio/classes/${existing.id}`, {
          method: 'PATCH',
          // The version says which row this edit was built on, so a colleague
          // saving the same class first is refused rather than overwritten.
          body: JSON.stringify({ name: existing.name, props, expectedVersion: held.rev }),
        })
        styleLedgerRef.current.note(existing.id, held.rev, saved?.data?.rev, props)
        recordStyleEdit(
          { kind: 'class', id: existing.id, name: existing.name, before: held.props, after: props },
          `class:${existing.id}.${key}`,
        )
      }
      await loadClasses()
      await pushDraftStyles()
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that style')
    } finally {
      styleBusyRef.current -= 1
      if (styleBusyRef.current <= 0) { styleBusyRef.current = 0; setStyleBusy(false) }
    }
  }, [selectedRow, selectedBlock, selectedDef, styleTarget, partTarget, styleClasses, styleState, styleBreakpoint, updateBlockProp, loadClasses, pushDraftStyles, tagTarget, tagDefaults, tagVersions, loadTagDefaults, recordStyleEdit])

  /**
   * Sets or removes the active class's Interaction. One PATCH, version-guarded
   * like any other class write, and one undo step - never coalesced, because
   * a select has no drag to merge.
   */
  const onInteractionChange = useCallback(async (next: AnyInteraction | null) => {
    if (!activeStyleClass) return
    setStyleBusy(true)
    try {
      await styleWriterRef.current.run(`class:${activeStyleClass.id}.interaction`, async () => {
        const held = styleLedgerRef.current.resolve(activeStyleClass.id, activeStyleClass.rev, activeStyleClass.props as Record<string, unknown>)
        const saved = await designFetch<{ data?: { rev?: string } }>(`/admin/ext/studio/classes/${activeStyleClass.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: activeStyleClass.name, props: held.props, interaction: next, expectedVersion: held.rev }),
        })
        styleLedgerRef.current.note(activeStyleClass.id, held.rev, saved?.data?.rev, held.props)
      })
      recordStyleEdit(
        { kind: 'interaction', id: activeStyleClass.id, name: activeStyleClass.name, before: activeStyleClass.interaction ?? null, after: next },
        `interaction:${activeStyleClass.id}:${Date.now()}`,
      )
      await loadClasses()
      await pushDraftStyles()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that interaction')
    } finally {
      setStyleBusy(false)
    }
  }, [activeStyleClass, loadClasses, pushDraftStyles, recordStyleEdit])

  /** One property - the common case, routed through the batch form. */
  const onStyleChange = useCallback(
    (propertyId: string, value: string) => onStyleChangeMany({ [propertyId]: value }),
    [onStyleChangeMany],
  )

  /** Generated sections land in the draft after the marketer's explicit choice. */
  const onApplyGenerated = useCallback((newBlocks: Array<Record<string, unknown>>, how: 'replace' | 'append') => {
    const incoming = newBlocks as ComponentBlock[]
    setBlocks(how === 'replace' ? incoming : [...blocks, ...incoming])
    const first = incoming[0]
    if (first && typeof first._key === 'string') setSelectedKey(first._key)
    toast.success(how === 'replace' ? 'Sections replaced in the draft' : 'Sections added to the draft')
  }, [blocks, setBlocks])

  /** "Describe it": ONE generated section, inserted at the palette position. */
  const onDescribe = useCallback(async (brief: string) => {
    if (!type) return
    const res = await adminFetch<{ data: { blocks: Array<Record<string, unknown>> } }>(
      '/admin/ext/studio/generate',
      { method: 'POST', body: JSON.stringify({ typeName: type, brief, single: true }) },
    )
    const block = res.data.blocks?.[0] as ComponentBlock | undefined
    if (!block) throw new Error('No section came back - try rephrasing the brief')
    const at = selectedRow && selectedRow.depth === 0 ? selectedRow.index + 1 : blocks.length
    setBlocks(insertBlockAt(blocks, block, at))
    if (typeof block._key === 'string') setSelectedKey(block._key)
  }, [type, selectedRow, blocks, setBlocks])

  /** Preset pick: clone with fresh _keys throughout, insert, select. */
  const onPickPreset = useCallback((preset: StudioPreset) => {
    const block = cloneWithFreshKeys(preset.block) as ComponentBlock
    const at = selectedRow && selectedRow.depth === 0 ? selectedRow.index + 1 : blocks.length
    // Most presets ARE sections, which wrapForInsert leaves untouched; a
    // preset of a bare widget gets the same treatment as picking one.
    const insert = wrapForInsert(block as never, {
      allowed: componentDefs.map((d) => d.name),
      mintKey: mintBlockKey,
      wrap: autoSection,
    })
    setBlocks(insertBlockAt(blocks, insert as never, at))
    if (typeof block._key === 'string') setSelectedKey(block._key)
  }, [blocks, selectedRow, setBlocks, componentDefs, autoSection])

  /**
   * How many siblings the selection has, so Move down can be DISABLED on
   * the last one. An enabled button that does nothing is worse than a
   * greyed-out one.
   */
  const siblingCount = useMemo(() => {
    if (!selectedRow) return 0
    const parentPath = selectedRow.path.slice(0, -1)
    if (parentPath.length === 0) return blocks.length
    const parent = blockAtPath(blocks as never, parentPath.slice(0, -1))
    const prop = parentPath[parentPath.length - 1]
    const arr = parent && typeof prop === 'string' ? (parent as Record<string, unknown>)[prop] : null
    return Array.isArray(arr) ? arr.length : 0
  }, [blocks, selectedRow])

  /** Re-measure the frame against its container whenever either can move. */
  const measureFrame = useCallback(() => {
    const box = canvasRef.current?.getBoundingClientRect()
    const frame = frameRef.current?.getBoundingClientRect()
    const next = frameOffsetOf(box as never, frame as never)
    setFrameOffset((prev) => (prev.top === next.top && prev.left === next.left ? prev : next))
  }, [])

  useEffect(() => {
    measureFrame()
    const el = canvasRef.current
    // The preview canvas is the thing that scrolls, so listen in CAPTURE -
    // the scroll happens on a descendant, not on this node.
    el?.addEventListener('scroll', measureFrame, true)
    window.addEventListener('resize', measureFrame)
    return () => {
      el?.removeEventListener('scroll', measureFrame, true)
      window.removeEventListener('resize', measureFrame)
    }
  }, [measureFrame, previewSrc])

  // Preview width animates, so re-measure until it settles.
  useEffect(() => {
    measureFrame()
    const t = setInterval(measureFrame, 60)
    const stop = setTimeout(() => clearInterval(t), 400)
    return () => { clearInterval(t); clearTimeout(stop) }
  }, [bp.width, measureFrame])

  /** Track the pointer over the canvas and resolve where a drop would land. */
  const onDragOverCanvas = useCallback((y: number) => {
    if (!draggingType) return
    const point = resolveDropPoint(toFrameY(y, frameOffset, zoom), rows, geometryRef.current)
    setDropPoint(point)
    setDropOk(canDrop(draggingType, point, componentDefs as never, componentDefs.map((d) => d.name)))
  }, [draggingType, rows, componentDefs, frameOffset, zoom])

  /**
   * Commit a drop. The slot decides: a refused drop does nothing rather
   * than landing somewhere the schema forbids. A dragged asset becomes
   * exactly the block a click in the Media panel would have made, carrying
   * the asset; a kind no block can hold says so.
   */
  const onDropOnCanvas = useCallback(() => {
    const type = draggingType
    const asset = dragAsset
    const collection = dragCollection
    const point = dropPoint
    setDragType(null); setDragAsset(null); setDragCollection(null); setDropPoint(null)
    if (asset && !type) {
      const why = mediaTarget(asset.mimeType, null)
      if (why.action === 'none') toast.error(why.reason)
      return
    }
    if (!type || !point) return
    if (!canDrop(type, point, componentDefs as never, componentDefs.map((d) => d.name))) return
    const def = componentDefs.find((d) => d.name === type)
    if (!def) return

    let block = buildEmptyBlock(def) as Record<string, unknown>
    if (asset) {
      const carry = mediaTarget(asset.mimeType, def)
      if (carry.action === 'set') block[carry.prop] = asset.id
    }
    // A collection from the Data panel lands as a loop already bound to it.
    if (collection && type === LOOP_TYPE) {
      block = bindLoopToCollection(block, collection, { defs: componentDefs as never, mintKey: mintBlockKey })
    }
    insertAt(block, point)
  }, [draggingType, dragAsset, dragCollection, dropPoint, componentDefs, insertAt])

  /** The line showing where it will land, drawn from the same geometry. */
  const dropIndicator = useMemo<DropIndicator | null>(() => {
    if (!draggingType || !dropPoint) return null
    const siblings = rows.filter((r) =>
      r.path.length === dropPoint.containerPath.length + 1
      && dropPoint.containerPath.every((v, i) => v === r.path[i]))
    const before = siblings[dropPoint.index]
    const after = siblings[dropPoint.index - 1]
    const anchorRect = before
      ? rectFor(geometryRef.current, before.key)
      : after ? rectFor(geometryRef.current, after.key) : null
    if (!anchorRect) return null
    const drawn = toCanvasRect(anchorRect, frameOffset, zoom)
    return {
      top: before ? drawn.top : drawn.top + drawn.height,
      left: drawn.left,
      width: drawn.width,
      invalid: !dropOk,
    }
  }, [draggingType, dropPoint, dropOk, rows, frameOffset, zoom])

  /**
   * Canvas toolbar actions. They act on the selected block's PATH, so they
   * work at any depth - which matters because auto-wrapping (W-T3) means a
   * selection is usually nested inside a section.
   */
  const onCanvasMove = useCallback((delta: number) => {
    if (!selectedRow) return
    setBlocks(moveAtPath(blocks as never, selectedRow.path, delta) as never)
  }, [blocks, selectedRow, setBlocks])

  const onCanvasDuplicate = useCallback(() => {
    if (!selectedRow) return
    setBlocks(duplicateAtPath(blocks as never, selectedRow.path, mintBlockKey) as never)
  }, [blocks, selectedRow, setBlocks])

  const onCanvasDelete = useCallback(async () => {
    if (!selectedRow) return
    const ok = await confirm({
      title: 'Delete this block?',
      message: `"${selectedRow.label}" and its content will be removed from the draft.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return
    setBlocks(removeAtPath(blocks as never, selectedRow.path) as never)
    setSelectedKey(null)
  }, [blocks, selectedRow, setBlocks, confirm])

  /** A suggested section is an ordinary insert - it is already a section. */
  const onPickSuggestion = useCallback((s: SectionSuggestion) => {
    const block = cloneWithFreshKeys(s.block) as ComponentBlock
    const at = selectedRow && selectedRow.depth === 0 ? selectedRow.index + 1 : blocks.length
    setBlocks(insertBlockAt(blocks, block, at))
    if (typeof block._key === 'string') setSelectedKey(block._key)
  }, [blocks, selectedRow, setBlocks])

  /**
   * Sections Studio builds OVER the site's own components, derived from each
   * component's schema. Offered beside saved presets - a developer authors
   * nothing to get them.
   */
  const suggestionItems = useMemo(() => {
    const allowed = componentDefs.map((d) => d.name)
    return componentDefs
      .flatMap((d) => suggestSectionsFor(d as never, allowed, mintBlockKey))
      .map((s) => ({ id: s.id, label: s.name, onPick: () => onPickSuggestion(s) }))
  }, [componentDefs, onPickSuggestion])

  const onDelete = useCallback(async (index: number) => {
    const row = rows.find((r) => r.index === index)
    const ok = await confirm({
      title: 'Delete this section?',
      message: `"${row?.label ?? 'Section'}" and its content will be removed from the draft.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return
    const removedKey = (blocks[index] as { _key?: string } | undefined)?._key
    setBlocks(removeBlock(blocks, index))
    if (removedKey && removedKey === selectedKey) setSelectedKey(null)
  }, [rows, blocks, setBlocks, confirm, selectedKey])

  // ── Live snapshot the canvas pushes into the frame ────────────────────────
  // While translating, the frame gets the locale laid over the draft - the
  // same merge the server does for a locale read - so the canvas shows the
  // language being edited, translated where it is and the source where not.
  const snapshot: PreviewSnapshot = useMemo(() => {
    // While an INSTANCE is open the overlay is the instance's, so it must not
    // be laid over the page's values: the two documents can name a field the
    // same and the canvas would show one document's translation on the
    // other's field. It is applied to the instance's own blocks below.
    const shown = translating && !activeInstanceId
      ? previewValues({ title, values: fieldValues, overlay: activeOverlay, localizedFields: localizedFieldNames, containers: localizedContainers })
      : { title, values: fieldValues }
    // INSTANCES on the canvas. A reference is a leaf in the stored tree, so
    // without this the preview shows a gap exactly where a section will be.
    // The composition is the CONTRACT package's, the same function the site's
    // renderer calls, so the canvas cannot disagree with the live page.
    //
    // The draft rule (see canvasInstanceNote, which says it on screen):
    // editing a PAGE fills references with the instance's PUBLISHED tree,
    // because that is what a visitor gets; editing an INSTANCE puts its own
    // draft on the canvas, because that is the document being edited and a
    // canvas showing the published version would ignore every keystroke.
    // Nested references inside it stay published, for the same reason.
    //
    // So: the blocks the canvas must render for the OPEN document. The page's
    // region, or the instance's own tree in the language being edited (its
    // overlay laid over its OWN blocks, the same merge the server does for a
    // locale read).
    const pageField = regions.find((r) => r.name === activeRegion)?.field?.name ?? null
    const instanceFieldName = blocksField?.name ?? null
    const base = activeInstanceId
      ? (translating && instanceFieldName
          ? previewValues({
              title: '', values: { [instanceFieldName]: blocks },
              overlay: activeOverlay, localizedFields: [], containers: localizedContainers,
            }).values[instanceFieldName]
          : blocks)
      : pageField ? shown.values[pageField] : null
    const composed = instanceTrees ? composeInstances(base, instanceTrees) : base
    // The snapshot describes the document the FRAME was sent to fetch. The
    // site's preview client merges it over the draft it loaded, so a snapshot
    // describing the page while the frame holds the instance would paint the
    // page's title and fields straight onto the instance.
    return canvasSnapshot({
      target: canvasTarget,
      page: {
        title: shown.title,
        slug: (slug || object?.slug) ?? undefined,
        status: object?.status,
        field: pageField,
        values: shown.values,
      },
      instance: activeInstanceId
        ? { title: openInstance?.title, slug: openInstance?.slug, status: openInstance?.status, field: instanceFieldName }
        : null,
      composed,
      locale: translating ? activeLocale ?? undefined : undefined,
    }) ?? EMPTY_SNAPSHOT
  }, [canvasTarget, object, title, slug, fieldValues, translating, activeOverlay, localizedFieldNames, localizedContainers, activeLocale, instanceTrees, regions, activeRegion, activeInstanceId, openInstance, blocks, blocksField])

  const editorHref = `/${workspaceId}/objects/${type}/${id}`
  const studioHref = `/${workspaceId}/extensions/studio`
  const previewReady = !!(previewSrc && previewCfg?.frontendUrl)

  return (
    // Full-viewport takeover - escapes the admin shell chrome (sidebar/top
    // bar/page header) so the builder gets the whole width, same pattern as
    // the flows canvas. The route stays access-gated by the manifest page
    // declaration (studio:edit via ExtensionPageGate); the slim top bar
    // owns Exit / title / save status / actions.
    // The skin itself is applied to the document root (see applyStudioSkin)
    // so portalled dialogs inherit it too; every control inside follows the
    // semantic tokens, so nothing is forked for this.
    <div className="fixed inset-0 z-50 bg-surface-sunken flex flex-col">
      {env0.isProduction && (
        <div aria-hidden className="absolute top-0 inset-x-0 h-0.5 bg-emerald-500 z-10" />
      )}
      {/* TOP BAR - who you are and what you can do with this page. Webflow
          splits these across two rows for a reason: mixing "what am I looking
          at" with "what can I do" is what made one bar feel crammed. Editing
          controls live in the second bar below. */}
      <div className="relative z-20 flex items-center gap-2 px-3 h-11 border-b border-border bg-surface shrink-0">

        {/* ── Left: where you are, and the way out ── */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Button
            size="sm"
            variant="ghost"
            // Not a bare Link: leaving unmounts the autosave timer, so an
            // edit made in the last AUTOSAVE_MS would be discarded.
            onClick={async () => { if (!(await leaveSurfaces())) return; await flushSave(); navigate(studioHref) }}
            className="h-7"
          >
            ← Exit
          </Button>
          {/* The two ways to work on a page, named as MODES so switching
              reads as changing tools rather than navigating away. */}
          <span className="flex items-center gap-1.5 h-7 px-2 rounded-md bg-accent-muted text-accent-fg text-[11px] font-medium shrink-0">
            <IconBrush className="size-3.5" />
            Studio mode
          </span>
          <Button
            size="sm"
            variant="ghost"
            // Same reason as Exit: leaving cancels the debounced save.
            onClick={async () => { if (!(await leaveSurfaces())) return; await flushSave(); navigate(editorHref) }}
            className="h-7 gap-1.5 text-fg-muted"
            title="Open this page in the content editor"
          >
            <IconEdit className="size-3.5" />
            Editor mode
          </Button>
        </div>

        {/* ── Centre: which page ── */}
        <div className="flex items-center gap-1.5 shrink-0">
          <IconArticle className="size-4 text-fg-subtle shrink-0" />
          {object && (
            <span
              className={clsx('size-1.5 rounded-full shrink-0', pageStatus(object).dot)}
              title={pageStatus(object).label}
            />
          )}
          <PageSwitcher
            title={title}
            types={switcherTypes}
            rowsByType={switcherRows}
            currentType={type ?? undefined}
            currentId={id ?? undefined}
            loading={switcherLoading}
            onOpen={loadSwitcher}
            onPick={async (t, pid) => {
              if (!(await leaveSurfaces())) return
              await flushSave()
              navigate(`${studioHref}/edit?type=${encodeURIComponent(t)}&id=${encodeURIComponent(pid)}`)
            }}
            // The type list loads on open; until then the loaded type def
            // names the kind of page. Creating needs both rights, as in the
            // Pages panel: studio:edit and CREATE on some Studio type.
            typeLabel={typeDef?.label ?? null}
            onNew={hasCapability('studio:edit') && creatableTypes.length > 0
              ? () => { loadSwitcher(); setNewPageOpen(true) }
              : undefined}
          />
        </div>

        {/* ── Right: environment, then what you can do ── */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
          {/* Who else is on this page, with the block they have selected,
              "you, in another tab", and Take over inline - the object
              editor's own strip over the SAME object:<id> scope, so the two
              tools see each other. This is where the session joins; every
              other presence view on the page only reads. */}
          {presenceObjectId && (
            <StudioPresence
              key={presenceObjectId}
              objectId={presenceObjectId}
              typeSlug={presenceType}
              enabled={realtimeOn}
              currentMemberId={currentMemberId}
              canEdit={canEdit}
              selectedKey={selectedKey}
              field={presenceField}
              dirty={saveStatus === 'saving' || unsavedSurfaces.size > 0}
              breakpoint={styleBreakpoint}
              labelFor={presenceLabelFor}
              fieldLabel={presenceFieldLabel}
              onNames={setMemberNameMap}
            />
          )}
          {!canEdit && (
            <span
              className="flex items-center gap-1 h-7 px-2 rounded-md bg-warning-muted text-warning text-[11px] font-medium shrink-0"
              title={readOnlyReason}
            >
              Read only
            </span>
          )}
          {/* The real state, not just the status column: a page can be live
              AND have newer edits that are not, which "Published" alone
              misreports while you are looking at the newer ones. */}
          {object && (
            <span
              className={clsx(
                'flex items-center gap-1.5 text-[11px] shrink-0',
                pageStatus(object).unpublished ? 'text-warning' : 'text-fg-muted',
              )}
            >
              <span className={clsx('size-1.5 rounded-full', pageStatus(object).dot)} />
              {pageStatus(object).label}
            </span>
          )}
          {/* The takeover escapes the admin shell, so without this a Publish
              on production looks exactly like one on development. */}
          <span
            className={clsx('flex items-center gap-1.5 text-[11px] font-medium shrink-0 capitalize', env0.text)}
            title={`Editing the ${env0.label} deployment`}
          >
            <span className={clsx('size-1.5 rounded-full', env0.dot)} />
            {env0.label}
          </span>
          {localeStore.enabled && (
            <LocaleMenu
              locales={localeStore.locales}
              active={localeStore.activeLocale ?? localeStore.defaultLocale}
              defaultLocale={localeStore.defaultLocale}
              onPick={(code) => localeStore.setLocale(code)}
            />
          )}
          <button
            type="button"
            onClick={togglePreview}
            title={preview ? 'Exit preview' : 'Preview - hides the editing chrome'}
            className={clsx(ICON_BTN, preview && 'bg-accent-muted text-accent-fg')}
          >
            {preview ? <IconEyeOff className="size-4" /> : <IconEye className="size-4" />}
          </button>
          <button
            type="button"
            onClick={() => setGenerateOpen(true)}
            title="Generate with AI"
            className={ICON_BTN}
          >
            <IconSparkles className="size-4" />
          </button>
          <ReviewChip
            state={reviewChip}
            // Promoted to the primary action when review is the only way
            // forward - it is then the button someone came here to press.
            primary={reviewGatesPublish}
            busy={publishing}
            // Asking WHO should review is the point of handing it over; firing
            // blind put pages in a queue nobody owned.
            onSubmit={() => { if (validateRequired()) setSubmitOpen(true) }}
            onWithdraw={() => { void runReviewAction('withdraw') }}
            // Both open a dialog: reject REQUIRES a note (the server refuses
            // without one) and approve takes an optional one. The hardcoded
            // note this replaced wrote something meaningless into history.
            onAdvance={() => setReviewAction('advance')}
            onReject={() => setReviewAction('reject')}
          />
          {/* The open document is what Publish means. An instance has its own
              draft and its own status, so publishing while one is open
              publishes IT - and it gets a control of its own rather than the
              page's menu, which would show the PAGE's status beside an action
              that did something else. */}
          {activeInstanceId && canPublishInstance && openInstance && (
            <button
              type="button"
              disabled={publishing}
              onClick={() => { void onPublishInstance() }}
              className="h-7 px-3 rounded-md text-xs font-medium bg-accent text-white shadow-sm hover:bg-accent-strong disabled:opacity-60 transition-colors duration-(--tg-motion-fast)"
              title={`${env0.publishLabel} this instance: every page that uses it updates at once, and no page is republished`}
            >
              {publishing ? 'Publishing…' : `${env0.publishLabel} instance`}
            </button>
          )}
          {!activeInstanceId && canPublish && object && !reviewGatesPublish && (
            <PublishMenu
              status={object.status}
              label={env0.publishLabel}
              busy={publishing}
              blockedReason={publishPolicy?.blocked ? publishPolicy.reason || 'Publishing is currently unavailable for this page' : null}
              // Offered only when NOTHING else already shows the way forward.
              // With the review chip beside it, a second "Submit for review"
              // was two controls for one act - and the chip is where the
              // state lives, so it is the one that keeps it.
              policyAction={publishPolicy?.blocked && publishPolicy.action && !reviewChip
                ? { label: publishPolicy.action.label, run: () => { void onPolicyAction() } }
                : null}
              onAction={(action) => { void onPublishAction(action) }}
            />
          )}
        </div>
      </div>
      {loading ? (
        <div className="flex-1 grid place-items-center text-sm text-fg-subtle">Loading…</div>
      ) : loadError ? (
        <EmptyState title="Could not open this page" description={loadError} />
      ) : activeInstanceId && !blocksField ? (
        /* The instance type is there but its blocks field could not be read.
           Said as itself: "this content type has no component field" would
           be about the PAGE, which is not the document that failed. */
        <EmptyState
          title="Could not open that instance"
          description={`The "${instanceType?.label ?? 'Instance'}" type's blocks field could not be read, so there is no tree to edit. Open the page again, or check the type in the schema.`}
        />
      ) : !blocksField ? (
        <EmptyState
          title="No blocks field"
          description="This content type has no component field, so there is nothing for Studio to compose. Open it in the editor instead."
        />
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* ── Icon rail + the panel it swaps ── */}
          {!preview && (
            <IconRail
              state={panels}
              panels={railPanels}
              onPick={(pid) => {
                if (pid === 'pages') loadSwitcher()
                setPanels((p) => togglePanel(p, pid))
              }}
            />
          )}
          {!preview && panels.open && (
            <aside
              className="relative shrink-0 border-r border-border bg-surface flex flex-col min-h-0"
              style={{ width: panelWidth }}
            >
              <RailResizeHandle
                side="left"
                width={panelWidth}
                label="Resize the panel"
                onResize={setPanelWidth}
                onCommit={(w) => rememberWidth(PANEL_WIDTH_KEY, w)}
                onReset={() => { setPanelWidth(DEFAULT_PANEL_WIDTH); rememberWidth(PANEL_WIDTH_KEY, DEFAULT_PANEL_WIDTH) }}
              />
              {/* One height for every header in this row - the left panel,
                  the second bar and the right rail all start at the same y,
                  so a different height reads as misalignment. */}
              <div className="px-3 h-(--tg-header-h) flex items-center gap-2 border-b border-border shrink-0">
                <span className="flex-1 text-xs font-semibold text-fg-muted uppercase tracking-wide truncate">
                  {panels.panel === 'pages' ? 'Pages'
                    : panels.panel === 'elements' ? 'Elements'
                    : panels.panel === 'components' ? 'Components'
                    : panels.panel === 'instances' ? 'Instances'
                    : panels.panel === 'media' ? 'Media'
                    : panels.panel === 'data' ? 'Data'
                    : panels.panel === 'variables' ? 'Variables' : null}
                  {panels.panel === 'blocks' && activeSurface && surfaceLabel(activeSurface.surface)}
                  {panels.panel === 'blocks' && activeInstanceId && activeInstanceLabel}
                  {panels.panel === 'blocks' && activeDoc.kind === 'page' && regions.length <= 1 && (blocksField.label || 'Sections')}
                </span>
                {panels.panel === 'blocks' && activeDoc.kind === 'page' && regions.length > 1 && (
                  // More than one component field means more than one editable
                  // region. Chosen here rather than on the canvas, because the
                  // canvas only ever shows the one being edited.
                  <select
                    value={activeRegion ?? ''}
                    onChange={(e) => setWantedRegion(e.target.value)}
                    title="Which part of the page to edit"
                    className="flex-1 min-w-0 h-6 rounded border border-border bg-surface text-[11px] text-fg px-1 focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    {regions.map((r) => (
                      <option key={r.name} value={r.name}>{r.label}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  title="Hide panel"
                  onClick={() => setPanels((p) => ({ ...p, open: false }))}
                  className="grid place-items-center size-6 rounded text-fg-subtle hover:text-fg hover:bg-surface-hover"
                >
                  <IconX className="size-3.5" />
                </button>
              </div>

              {/* One explicit test per panel, never a ternary: an else-branch
                  silently becomes "every other panel", so adding a third one
                  rendered the Add palette underneath it. */}
              {panels.panel === 'blocks' && (
                <div className="flex-1 overflow-y-auto p-2">
                  {/* The header every page shares sits ABOVE the page's own
                      sections, pinned rather than listed among them; while a
                      surface is open, the page takes the pinned row instead,
                      so the way back is where the page was. */}
                  {pinnedSurfaces.header.filter((s) => s.surface.global !== activeSurfaceName).map((s) => (
                    <SurfacePin
                      key={s.surface.global}
                      label={surfaceLabel(s.surface)}
                      count={draftBlocks(surfaces, surfaceDrafts, s.surface.global).length}
                      shared
                      unsaved={unsavedSurfaces.has(s.surface.global)}
                      onOpen={() => setWantedSurface(s.surface.global)}
                    />
                  ))}
                  {activeSurface && activeSurface.surface.position === 'header' && (
                    <SurfacePin
                      label={`Page: ${regions.find((r) => r.name === activeRegion)?.label ?? 'Sections'}`}
                      count={Array.isArray(fieldValues[activeRegion ?? '']) ? (fieldValues[activeRegion ?? ''] as unknown[]).length : 0}
                      onOpen={() => setWantedSurface(null)}
                    />
                  )}
                  {/* An instance open: the way back to the page is the pinned
                      row where the page was, exactly as it is for a surface. */}
                  {activeInstanceId && (
                    <>
                      {/* A plain row, not a button: the instance is already
                          open, and a control that does nothing is worse than
                          no control. The pin below it IS the way back. */}
                      <div className="w-full flex items-center gap-2 px-2 h-7 rounded-md text-xs text-fg">
                        <IconGlobe className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                        <span className="flex-1 min-w-0 truncate font-medium">{activeInstanceLabel}</span>
                        <span className="text-[10px] text-fg-subtle shrink-0">shared</span>
                        <span className="text-[10px] text-fg-subtle tabular-nums shrink-0">{blocks.length}</span>
                      </div>
                      <SurfacePin
                        label={`Page: ${regions.find((r) => r.name === activeRegion)?.label ?? 'Sections'}`}
                        count={Array.isArray(fieldValues[activeRegion ?? '']) ? (fieldValues[activeRegion ?? ''] as unknown[]).length : 0}
                        onOpen={() => setWantedDoc(PAGE_DOC)}
                      />
                    </>
                  )}
                  {/* The size of every edit made here, said where the
                      document is named rather than only in the inspector: V1
                      has no overrides, so an instance is identical everywhere
                      it is used and the usage count IS the blast radius. */}
                  {activeInstanceId && (
                    <p className="px-2 pb-1 text-[11px] text-fg-subtle" data-instance-consequence>
                      {usageConsequence(
                        activeInstance ? instanceTitle(activeInstance) : activeInstanceLabel,
                        instanceUsage,
                        activeInstanceId,
                      )}
                    </p>
                  )}
                  {instanceRefusal && (
                    <p className="mb-1 rounded-md border border-danger/40 bg-danger/5 px-2 py-1.5 text-[11px] text-danger" role="alert">
                      {instanceRefusal}
                    </p>
                  )}
                  {rows.length > 0 && (
                    /* Search by label, type or class - a page of any depth
                       runs past the panel, and scrolling is not finding. */
                    <div className="flex items-center gap-2 px-2 h-7 mb-1 rounded-md border border-border bg-surface-sunken">
                      <IconSearch className="size-3.5 text-fg-subtle shrink-0" />
                      <input
                        value={treeQuery}
                        onChange={(e) => setTreeQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setTreeQuery('') } }}
                        placeholder="Search blocks"
                        aria-label="Search blocks"
                        className="flex-1 min-w-0 bg-transparent text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
                      />
                    </div>
                  )}
                  {rows.length === 0 ? (
                    <p className="px-2 py-4 text-xs text-fg-subtle">
                      No sections yet. Add your first one from the Add panel.
                    </p>
                  ) : treeQuery.trim() && shownRows.length === 0 ? (
                    <p className="px-2 py-4 text-xs text-fg-subtle">Nothing matches.</p>
                  ) : (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                      <SortableContext items={rows.filter((r) => r.depth === 0).map((r) => r.key)} strategy={verticalListSortingStrategy}>
                        <ul>
                          {shownRows.map((row) => (
                            <TreeRow
                              key={row.key}
                              row={row}
                              selected={row.key === selectedKey}
                              expandable={hasChildren(rows, row)}
                              collapsed={collapsed.has(row.key)}
                              hit={treeSearch.matched.has(row.key)}
                              onToggleCollapse={onToggleCollapse}
                              onSelect={selectRow}
                              onRename={onRenameRow}
                              onDuplicate={onDuplicate}
                              onToggleHidden={onToggleHidden}
                              onDelete={onDelete}
                              presence={presenceScope ? (
                                <BlockPresence {...presenceScope} address={presenceAddresses.get(row.key) ?? null} />
                              ) : null}
                            />
                          ))}
                        </ul>
                      </SortableContext>
                    </DndContext>
                  )}
                  {activeSurface && activeSurface.surface.position === 'footer' && (
                    <SurfacePin
                      label={`Page: ${regions.find((r) => r.name === activeRegion)?.label ?? 'Sections'}`}
                      count={Array.isArray(fieldValues[activeRegion ?? '']) ? (fieldValues[activeRegion ?? ''] as unknown[]).length : 0}
                      onOpen={() => setWantedSurface(null)}
                    />
                  )}
                  {pinnedSurfaces.footer.filter((s) => s.surface.global !== activeSurfaceName).map((s) => (
                    <SurfacePin
                      key={s.surface.global}
                      label={surfaceLabel(s.surface)}
                      count={draftBlocks(surfaces, surfaceDrafts, s.surface.global).length}
                      shared
                      unsaved={unsavedSurfaces.has(s.surface.global)}
                      onOpen={() => setWantedSurface(s.surface.global)}
                    />
                  ))}
                  {/* A global with a blocks field Studio could not place is
                      said, not hidden: the label is what tells a developer
                      why their header is not on the canvas. */}
                  {skippedSurfaces.map((s) => (
                    <p key={s.global} className="px-2 py-1 text-[10px] text-fg-subtle">{s.reason}</p>
                  ))}
                </div>
              )}
              {(panels.panel === 'elements' || panels.panel === 'components') && (
                <div className="flex-1 overflow-y-auto p-3">
                  {/* Auto-structure, offered rather than imposed - the
                      section it makes is a real block in the tree. */}
                  <label className="flex items-center gap-2 mb-3 text-[11px] text-fg-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoSection}
                      onChange={(e) => setAutoSection((e.target as HTMLInputElement).checked)}
                      className="size-3.5 accent-current"
                    />
                    Place in a section
                  </label>
                  {/* Elements are Studio's primitives, plain. Components is
                      the full vocabulary filed by ORIGIN - Developer, Saved,
                      Pre-built - each entry labelled, so a marketer can see
                      why something is or is not here. Both insert through
                      the same pick and drag handlers. */}
                  {panels.panel === 'elements' ? (
                    <PaletteBody
                      defs={palette.elements}
                      onPick={onPickComponent}
                      onDragType={setDragType}
                    />
                  ) : (
                    <ComponentsPanel
                      defs={insertableHere}
                      presets={presets}
                      suggestions={suggestionItems}
                      onPick={onPickComponent}
                      onDragType={setDragType}
                      onPickPreset={onPickPreset}
                      onRenamePreset={canManagePresets ? (p) => setNameDialog({ mode: 'rename', preset: p }) : undefined}
                      onDeletePreset={canManagePresets ? (p) => { void onDeletePreset(p) } : undefined}
                    >
                      {onDescribe && <DescribeBox onDescribe={onDescribe} />}
                    </ComponentsPanel>
                  )}
                </div>
              )}
              {panels.panel === 'media' && (
                <MediaPanel
                  onDragAsset={setDragAsset}
                  onPick={onPickMedia}
                />
              )}
              {panels.panel === 'instances' && (
                <InstancesPanel
                  instances={instanceRows}
                  loading={instancesLoading}
                  reason={instanceReason}
                  error={instancesError}
                  activeId={activeInstanceId}
                  usage={instanceUsage}
                  onDelete={canManagePresets ? onDeleteInstance : undefined}
                  onNew={canCreateInstance && instanceType ? () => {
                    setInstanceDialogError(null)
                    setInstanceDialog({ mode: 'new' })
                  } : undefined}
                  onRename={canEditInstance && instanceType ? (i) => {
                    setInstanceDialogError(null)
                    setInstanceDialog({ mode: 'rename', instance: i })
                  } : undefined}
                  onDuplicate={canCreateInstance && instanceType
                    ? (i) => { void onDuplicateInstance(i) }
                    : undefined}
                  onOpen={(i) => { setWantedDoc({ kind: 'instance', id: i.id }) }}
                  onInsert={onPickInstance}
                  insertUnavailable={
                    !canEdit ? readOnlyReason
                      : instanceHere.ok ? null : instanceHere.reason
                  }
                />
              )}
              {panels.panel === 'data' && (
                <DataPanel
                  unavailable={loopHere.ok ? null : loopHere.reason}
                  onPick={onPickCollection}
                  onDragCollection={(c) => {
                    // The canvas sees a kit.loop drag; the collection rides
                    // beside it and is bound on drop.
                    setDragCollection(c)
                    setDragType(c ? LOOP_TYPE : null)
                  }}
                />
              )}
              {panels.panel === 'variables' && (
                <VariablesPanel
                  tokens={tokens}
                  values={tokenValueMap}
                  fonts={themeFonts}
                  overridden={themeOverridden}
                  canApply={!!selectedRow}
                  onApply={onApplyToken}
                  // Editing the theme changes every page of the workspace, so
                  // it follows the DESIGN right, like tag defaults and the
                  // class store - not the page's content right. That is the
                  // designer who may not publish this page but owns how the
                  // site looks.
                  onSetToken={canDesign ? onSetThemeToken : undefined}
                  onSetFont={canDesign ? onSetThemeFont : undefined}
                  // A colleague's token write is announced on studio:classes;
                  // the panel shows it and Reload re-reads the tokens.
                  currentMemberId={currentMemberId}
                  onReload={loadTokens}
                />
              )}
              {panels.panel === 'pages' && (
                <PagesPanel
                  types={switcherTypes}
                  rowsByType={switcherRows}
                  currentType={type ?? undefined}
                  currentId={id ?? undefined}
                  loading={switcherLoading}
                  // `studio:edit` says you may use Studio; CREATE on the type
                  // says you may make one of these. Both are required.
                  canCreate={hasCapability('studio:edit') && creatableTypes.length > 0}
                  onPick={async (t, pid) => {
                    await flushSave()
                    navigate(`${studioHref}/edit?type=${encodeURIComponent(t)}&id=${encodeURIComponent(pid)}`)
                  }}
                  onNew={() => setNewPageOpen(true)}
                  presence={{ currentMemberId }}
                />
              )}
            </aside>
          )}

          {/* ── Center: the live preview ── */}
          <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-surface-sunken">
            {previewReady && !preview && (
              /* SECOND BAR - what you are looking at and what you just did.
                 Webflow splits it this way, and it is what stops the top bar
                 mixing "which page" with "which breakpoint". */
              <div className="h-(--tg-header-h) shrink-0 flex items-center gap-1.5 px-2 border-b border-border bg-surface">
                <button
                  type="button"
                  title="Undo (Cmd/Ctrl+Z)"
                  onClick={onUndo}
                  disabled={!historyState.undo}
                  className={ICON_BTN}
                >
                  <IconUndo className="size-4" />
                </button>
                <button
                  type="button"
                  title="Redo (Cmd/Ctrl+Shift+Z)"
                  onClick={onRedo}
                  disabled={!historyState.redo}
                  className={ICON_BTN}
                >
                  <IconUndo className="size-4 -scale-x-100" />
                </button>
                {/* Rendered only when it has something to say. `invisible`
                    with a min-width reserved 56px of dead space in the bar
                    permanently - the gap that was visible between redo and
                    the breadcrumb. The breadcrumb is flexible, so it absorbs
                    this appearing without moving anything on the right. */}
                {saveStatus !== 'idle' && (
                  <span
                    className={clsx(
                      'text-[11px] shrink-0',
                      saveStatus === 'error' ? 'text-danger' : 'text-fg-subtle',
                    )}
                  >
                    {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : 'Save failed'}
                  </span>
                )}
                <span className="w-px h-4 bg-border" />

                <div className="flex-1 min-w-0">
                  <Breadcrumb
                    crumbs={crumbs}
                    iconFor={iconFor}
                    onSelect={(key) => {
                      if (key === null) { setSelectedKey(null); return }
                      const row = rowsRef.current.find((r) => r.key === key)
                      if (row) selectRow(row)
                    }}
                    onHover={(key) => {
                      if (!frontendUrl || !key) return
                      try {
                        frameRef.current?.contentWindow?.postMessage(
                          { type: STUDIO_HIGHLIGHT_TYPE, key }, frontendUrl,
                        )
                      } catch { /* frame not ready - the trail still reads */ }
                    }}
                  />
                </div>

                {/* Breakpoints, then zoom, both hard right: they are what you
                    are looking THROUGH, and the eye should find them in the
                    same place whatever the breadcrumb's length.
                    PreviewBreakpoints renders the current width itself - a
                    second label here said "Fluid" twice. */}
                <span title="Preview width - a CSS width on the frame, not a real device">
                  <PreviewBreakpoints bp={bp} bare collapseCustom />
                </span>
                <span className="w-px h-4 bg-border" />
                <div className="flex items-center gap-0.5 shrink-0" title="Canvas zoom">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => zoomOut(z))}
                    disabled={zoom <= ZOOM_STEPS[0]}
                    className={ICON_BTN}
                  >
                    <IconMinus className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom(1)}
                    title="Reset to 100%"
                    className="min-w-10 text-[11px] tabular-nums text-fg-muted hover:text-fg rounded px-1 py-0.5 hover:bg-surface-hover"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => zoomIn(z))}
                    disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                    className={ICON_BTN}
                  >
                    <IconPlus className="size-3" />
                  </button>
                </div>
              </div>
            )}
            {/* Another actor changed this page (a save from the object editor,
                a publish from another tab): say so, offer Reload, never block.
                The object editor's own notice and decision; this page's own
                writes are stamped as issued so their echo is not "elsewhere". */}
            {/* The notice watches the DOCUMENT being edited, not the page
                Studio opened with: an instance is a content object with a
                scope of its own, and a colleague changing the tree on screen
                is exactly the thing this exists to say. Reload refetches
                whichever document is open. */}
            {!preview && (activeInstanceId ? !!openInstance : !!object && !!id) && (
              <div className="px-3 pt-2 shrink-0 [&>*]:mb-0">
                <ChangedElsewhereNotice
                  objectId={activeInstanceId ?? id!}
                  enabled={realtimeOn}
                  currentMemberId={currentMemberId}
                  lastSavedAt={activeInstanceId ? openInstance?.updatedAt ?? null : lastSavedAt}
                  saveIssuedAt={saveIssuedAtRef.current}
                  onReload={() => {
                    if (activeInstanceId) setInstanceReloadTick((t) => t + 1)
                    else setReloadTick((t) => t + 1)
                  }}
                />
              </div>
            )}
            {previewReady ? (
              <>
              {/* The shared header, pinned above the page body - OUTSIDE the
                  overlay container, so the geometry maths stays offset-free.
                  The band names and governs the surface; the site's preview
                  renders it, from the SAVED global. */}
              {!preview && (
                <SurfaceBand
                  position="header"
                  surfaces={pinnedSurfaces.header}
                  active={activeSurfaceName}
                  dirty={unsavedSurfaces}
                  access={surfaceAccess}
                  saving={surfaceSaving}
                  onEnter={setWantedSurface}
                  onLeave={() => setWantedSurface(null)}
                  onSave={(g) => { void saveSurface(g) }}
                  onDiscard={discardSurface}
                  presence={presenceScope ? { ...presenceScope, labelFor: presenceLabelFor } : undefined}
                />
              )}
              {/* The toolbar is drawn by the ADMIN over the iframe, in a
                  container that exactly overlays it - so geometry's
                  viewport-relative rects are used with no offset maths. */}
              <div ref={canvasRef} className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
              <LivePreviewCanvas
                src={previewSrc!}
                targetOrigin={previewCfg!.frontendUrl!}
                snapshot={snapshot}
                width={bp.width}
                reloadKey={0}
                onFrame={(el) => { frameRef.current = el }}
                zoom={zoom}
                flush
              />
              <DropOverlay
                active={(!!dragType || !!dragAsset) && !preview}
                indicator={dropIndicator}
                onOver={onDragOverCanvas}
                onDrop={onDropOnCanvas}
                onLeave={() => setDropPoint(null)}
              />
              {!preview && inlineEdit && (
                <InlineEditor
                  target={{ ...inlineEdit, rect: toCanvasRect(inlineEdit.rect, frameOffset, zoom) }}
                  onCommit={commitInlineEdit}
                  onCancel={() => setInlineEdit(null)}
                />
              )}
              {/* Where the others are on the canvas: one badge per person on a
                  block, drawn by the admin over the iframe like the toolbar. */}
              {!preview && presenceScope && (
                <CanvasPresenceBadges {...presenceScope} frontendUrl={frontendUrl} frameOffset={frameOffset} zoom={zoom} />
              )}
              {!preview && selectedRow && !inlineEdit && selectedRect && (
                <SelectParent
                  rect={toCanvasRect(selectedRect, frameOffset, zoom)}
                  onSelect={parentRow ? () => setSelectedKey(parentRow.key) : undefined}
                  label={parentRow?.label}
                />
              )}
              {!preview && selectedRow && !inlineEdit && (
                <CanvasToolbar
                  rect={selectedRect ? toCanvasRect(selectedRect, frameOffset, zoom) : null}
                  label={selectedRow.label}
                  canMoveUp={selectedRow.index > 0}
                  canMoveDown={selectedRow.index < siblingCount - 1}
                  onMove={onCanvasMove}
                  onDuplicate={onCanvasDuplicate}
                  onDelete={() => { void onCanvasDelete() }}
                  onInsert={insertableHere.length > 0 ? () => {
                    // Open the palette filtered to what this slot accepts.
                    setPanels((p) => ({ panel: 'elements', open: true }))
                  } : undefined}
                />
              )}
              </div>
              {!preview && (
                <SurfaceBand
                  position="footer"
                  surfaces={pinnedSurfaces.footer}
                  active={activeSurfaceName}
                  dirty={unsavedSurfaces}
                  access={surfaceAccess}
                  saving={surfaceSaving}
                  onEnter={setWantedSurface}
                  onLeave={() => setWantedSurface(null)}
                  onSave={(g) => { void saveSurface(g) }}
                  onDiscard={discardSurface}
                  presence={presenceScope ? { ...presenceScope, labelFor: presenceLabelFor } : undefined}
                />
              )}
              </>
            ) : (
              <div className="flex-1 grid place-items-center bg-surface-sunken">
                {/* WHY there is no canvas, in words. Never the last document
                    left on screen: a canvas showing something other than the
                    document being edited is indistinguishable from a broken
                    editor, and gives the person no reason at all. */}
                <EmptyState title={canvasNotice.title} description={canvasNotice.detail} />
              </div>
            )}
          </div>

          {/* ── Right rail: selected block props (the REAL field controls) ── */}
          <aside
            className={clsx('relative shrink-0 border-l border-border bg-surface flex-col min-h-0', preview ? 'hidden' : 'flex')}
            style={{ width: inspectorWidth }}
          >
            <RailResizeHandle
              side="right"
              width={inspectorWidth}
              label="Resize the inspector"
              onResize={setInspectorWidth}
              onCommit={(w) => rememberWidth(INSPECTOR_WIDTH_KEY, w)}
              onReset={() => { setInspectorWidth(DEFAULT_INSPECTOR_WIDTH); rememberWidth(INSPECTOR_WIDTH_KEY, DEFAULT_INSPECTOR_WIDTH) }}
            />
            <div className="px-4 h-(--tg-header-h) flex items-center gap-2 border-b border-border shrink-0">
              {/* WHERE the block sits, not only what it is: Section > Row >
                  Heading, each crumb selecting its block. The rail is fixed
                  rather than drilled into, so location has to be stated. */}
              {selectedRow && inspectorCrumbs.length > 0 ? (
                <div className="flex-1 min-w-0">
                  <Breadcrumb
                    crumbs={inspectorCrumbs}
                    iconFor={iconFor}
                    onSelect={(key) => {
                      const row = key ? rowsRef.current.find((r) => r.key === key) : null
                      if (row) selectRow(row)
                    }}
                    onHover={(key) => {
                      if (!frontendUrl || !key) return
                      try {
                        frameRef.current?.contentWindow?.postMessage(
                          { type: STUDIO_HIGHLIGHT_TYPE, key }, frontendUrl,
                        )
                      } catch { /* frame not ready - the trail still reads */ }
                    }}
                  />
                </div>
              ) : (
                <span className="flex-1 min-w-0 text-xs font-semibold text-fg-muted uppercase tracking-wide truncate">
                  {activeSurface ? surfaceLabel(activeSurface.surface) : activeInstanceId ? activeInstanceLabel : 'Page'}
                </span>
              )}
              {selectedBlock && (
                <button
                  type="button"
                  onClick={() => setNameDialog({ mode: 'new' })}
                  className="shrink-0 text-[11px] font-medium text-accent-fg hover:underline"
                  title="Save this section (content included) as a reusable preset"
                >
                  Save as preset
                </button>
              )}
              {/* The other way to reuse this section, and the opposite of a
                  preset: a preset is COPIED and never updates again, an
                  instance stays one tree that every placement follows. Offered
                  beside it so the choice is made where the section is, and
                  only where a reference could actually stand. */}
              {selectedBlock && canCreateInstance && instanceType && canEdit
                && !selectedReference && instanceHere.ok && (
                <button
                  type="button"
                  onClick={onCreateFromSection}
                  className="shrink-0 text-[11px] font-medium text-accent-fg hover:underline"
                  title="Move this section into a shared instance and leave a reference here"
                >
                  Create instance
                </button>
              )}
            </div>
            {inspectorTabList.length > 1 && selectedBlock && (
              <div role="tablist" className="flex items-stretch border-b border-border shrink-0 px-2 gap-1">
                {inspectorTabList.map((t) => {
                  const on = t.id === activeInspectorTab
                  return (
                    <button
                      key={t.id}
                      role="tab"
                      aria-selected={on}
                      type="button"
                      onClick={() => setWantedTab(t.id)}
                      className={clsx(
                        'relative px-2 py-2 text-xs font-medium -mb-px border-b-2 transition-colors',
                        on ? 'border-accent text-fg' : 'border-transparent text-fg-subtle hover:text-fg-muted',
                      )}
                    >
                      {t.label}
                      <span className="ml-1 text-[10px] text-fg-subtle tabular-nums">{t.count}</span>
                    </button>
                  )
                })}
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-4">
              {activeInstanceId && (!selectedBlock || !selectedDef || !selectedRow) ? (
                /* An instance open with nothing selected: the page's own
                   fields are not what is being edited, and the instance's
                   own (its title, its placement) belong to the content
                   editor - Studio edits its TREE. */
                <div className="space-y-3 text-xs text-fg-muted">
                  <p className="font-medium text-fg">{activeInstanceLabel}</p>
                  <p>
                    One shared tree. Every page that uses this instance shows exactly this,
                    so a change here reaches all of them.
                  </p>
                  {/* The count, not the promise: V1 has no overrides, so how
                      many places use this IS the size of every edit made
                      here. Said while editing, not only before opening. */}
                  {instanceUsage && activeInstance && (
                    <p className="text-fg">{usageSentence(instanceTitle(activeInstance), instanceUsage[activeInstance.id])}</p>
                  )}
                  {/* Which content the canvas is showing, said rather than
                      assumed: a page fills references with the PUBLISHED
                      instance, and this document is the one exception. */}
                  <p>{canvasInstanceNote(true)}</p>
                  <p>Select a block in the tree to edit it. Edits save to the instance's own draft.</p>
                  {instanceRefusal && <p className="text-danger" role="alert">{instanceRefusal}</p>}
                  {!canEditInstance && <p className="text-warning">{readOnlyReason}</p>}
                </div>
              ) : activeSurface && (!selectedBlock || !selectedDef || !selectedRow) ? (
                /* A surface open with nothing selected: the page's own fields
                   (title, slug, its settings) are not what is being edited,
                   so saying so beats offering them. */
                <div className="space-y-3 text-xs text-fg-muted">
                  <p className="font-medium text-fg">{surfaceLabel(activeSurface.surface)}</p>
                  <p>Shared across every page. Select a block in the tree or the preview to edit it.</p>
                  <p>
                    A shared surface has no draft: edits are held here until you press
                    {' '}<span className="font-medium text-fg">Save {activeSurface.surface.position}</span> on the band,
                    and then go live on every page at once.
                  </p>
                  {activeSurfaceAccess && !activeSurfaceAccess.ok && (
                    <p className="text-warning">{activeSurfaceAccess.reason}</p>
                  )}
                </div>
              ) : !selectedBlock || !selectedDef || !selectedRow ? (
                /* Nothing selected is not an empty state - it means the PAGE
                   is what you are editing. The rail used to spend 288px
                   telling you to click something. */
                <div className="space-y-4">
                  {/* While translating, the title is the locale's own (always
                      translatable) and the slug is single across languages. */}
                  <InspectorRow
                    label="Title"
                    layout="inline"
                    lockedReason={translating && !localeWritable ? localeCtx.writeRefusal : undefined}
                  >
                    {translating ? (
                      <CompactText
                        value={(translationDraft(activeOverlay.title, title) as string | null) ?? ''}
                        placeholder="Untitled"
                        onChange={(v) => setOverlay(overlayField(activeOverlay, 'title', translationWrite(v, title)), `${activeLocale}.title`)}
                      />
                    ) : (
                      <CompactText value={title} placeholder="Untitled" onChange={setTitle} />
                    )}
                  </InspectorRow>
                  <InspectorRow
                    label="Slug"
                    layout="inline"
                    lockedReason={translating ? `The URL is shared by every language. Switch to ${localeCtx.defaultLocale} to change it.` : undefined}
                  >
                    <CompactText
                      value={slug}
                      placeholder="page-url"
                      onChange={(v) => { slugDirty.current = true; setSlug(v) }}
                    />
                  </InspectorRow>
                  {object && (
                    <InspectorRow label="Status" layout="inline">
                      <span className="flex items-center gap-1.5 text-(length:--tg-text-control) text-fg h-(--tg-control-h)">
                        <span className={clsx('size-2 rounded-full', statusMeta(object.status).dot)} />
                        {statusMeta(object.status).label}
                      </span>
                    </InspectorRow>
                  )}
                  {/* X-T2: the page's own raw CSS, under the same gate as a
                      block's; shown read-only with the reason to a member
                      who may not write it when the page already carries some. */}
                  {(rawCssAllowed || pageCss !== '') && (
                    <SectionCssControl
                      key={`page-css:${id ?? ''}`}
                      scope="page"
                      value={pageCss}
                      state={pageCssState({ css: pageCss, blocks, protections: sectionProtections })}
                      check={(css) => pageCssState({ css, blocks, protections: sectionProtections })}
                      onSave={rawCssAllowed ? (css) => { void onPageCss(css) } : undefined}
                      lockedReason={rawCssAllowed ? undefined : 'Raw CSS needs the "Use Creative (freeform) styling" capability'}
                      // The page's own CSS lives in Studio's store, not on the
                      // page document, so it follows the design right: a
                      // designer who may not change this page's CONTENT can
                      // still style it.
                      disabled={!canDesign}
                    />
                  )}
                  {pageSections.map((section) => (
                    <div key={section.id} className={section.label ? 'border-t border-border pt-3 space-y-4' : 'space-y-4'}>
                      {section.label && (
                        <p className="text-[11px] font-semibold text-fg-muted uppercase tracking-wide">
                          {section.label}
                        </p>
                      )}
                      {section.fields.map((f) => {
                        // Page fields follow the same rule as block props: a
                        // localized one edits the overlay, a shared one locks.
                        const lock = localeEditability(f as never, localeCtx)
                        const toOverlay = translating && lock.editable
                        // A page-level repeater with localized row fields
                        // (an FAQ list) translates row by row too; its
                        // overlay map sits directly under the field name.
                        const byRows = toOverlay && lock.via === 'rows'
                        return (
                          <InspectorRow
                            key={`page:${f.name}`}
                            label={f.label}
                            required={f.required}
                            layout={byRows ? 'stacked' : rowLayout(controlKind(f as never))}
                            lockedReason={lock.editable ? undefined : lock.reason}
                          >
                            {byRows ? (
                              <TranslateRows
                                rows={fieldValues[f.name]}
                                localized={localizedRowFields(f as never)}
                                read={(rowKey, sub) => readOverlayValue(activeOverlay, f.name, [rowKey], sub)}
                                write={(rowKey, sub, v) => setOverlay(
                                  writeOverlayValue(activeOverlay, f.name, [rowKey], sub, v),
                                  `${activeLocale}.${f.name}.${rowKey}.${sub}`,
                                )}
                                defaultLocale={localeCtx.defaultLocale}
                                workspaceId={workspaceId!}
                                typeName={type ?? undefined}
                              />
                            ) : (
                            <CompactControl
                              field={f as never}
                              kind={controlKind(f as never)}
                              value={toOverlay
                                ? translationDraft(activeOverlay[f.name], fieldValues[f.name]) ?? ''
                                : fieldValues[f.name]}
                              onChange={toOverlay
                                ? (v) => setOverlay(
                                    overlayField(activeOverlay, f.name, translationWrite(v, fieldValues[f.name])),
                                    `${activeLocale}.${f.name}`,
                                  )
                                : (v) => setFieldValues((prev) => ({ ...prev, [f.name]: v }))}
                              workspaceId={workspaceId!}
                              typeName={type ?? undefined}
                            />
                            )}
                          </InspectorRow>
                        )
                      })}
                    </div>
                  ))}
                  {/* Extension panels, exactly where they belong: this rail
                      IS the page surface, and these are page-level - the same
                      place the object editor puts them. */}
                  {extPanels.map((panel) => {
                    const PanelComponent = PANEL_REGISTRY[panelRegistryKey(panel.extensionId, panel.id)]
                    if (!PanelComponent) return null
                    return (
                      <div key={`${panel.extensionId}:${panel.id}`} className="border-t border-border pt-3">
                        <p className="text-[11px] font-semibold text-fg-muted uppercase tracking-wide mb-2">
                          {panel.label}
                        </p>
                        <PanelComponent
                          title={title}
                          objectId={id ?? ''}
                          status={object?.status ?? 'draft'}
                          fieldValues={fieldValues}
                          // The panel can change what publishing is allowed
                          // to do, so a refresh has to re-read the gate too.
                          refresh={() => { void loadReview(); void reloadPublishPolicy() }}
                        />
                      </div>
                    )
                  })}

                  <p className="text-[11px] text-fg-subtle pt-1">
                    Select a section in the tree or click one in the preview to edit it.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* A reference is a leaf here: the borrowed tree is not in
                      this document, so there is nothing to select or restyle.
                      What the inspector offers instead is the two things a
                      person actually wants - go and edit the source, or stop
                      following it on this page. */}
                  {selectedRow.type === INSTANCE_BLOCK_TYPE && (
                    <div className="space-y-2 rounded-md border border-border bg-surface-sunken p-3">
                      <p className="text-xs font-medium text-fg">
                        {/* The LIVE title first: the cached label is the
                            fallback for an instance that cannot be read, and
                            after a rename it is the stale one. */}
                        {(referencedInstance ? instanceTitle(referencedInstance) : '')
                          || selectedReference?.label || 'Instance'}
                      </p>
                      <p className="text-[11px] text-fg-muted">
                        One shared tree. Editing it changes every page that uses it, and its blocks
                        are not editable or stylable from here.
                      </p>
                      {selectedReference && !referencedInstance && (
                        <p className="text-[11px] text-warning" role="alert">
                          This environment has no instance with that id, so nothing will render here.
                          Place another instance, or detach to keep what was authored.
                        </p>
                      )}
                      {/* The draft rule, where the person is looking at it.
                          A canvas that quietly disagrees with the live site
                          is the one failure a visual editor cannot recover
                          from, so it is stated rather than assumed. */}
                      <p className="text-[11px] text-fg-subtle">{canvasInstanceNote(false)}</p>
                      {selectedReference && referencedInstance && !instanceTrees?.[selectedReference.instanceId] && (
                        <p className="text-[11px] text-warning" role="alert">
                          It has never been published in this environment, so the canvas and the live
                          site both show nothing here. Open it and publish it.
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        <button
                          type="button"
                          disabled={!selectedReference || !referencedInstance}
                          onClick={() => {
                            if (selectedReference) setWantedDoc({ kind: 'instance', id: selectedReference.instanceId })
                          }}
                          className="text-[11px] font-medium text-accent-fg hover:underline disabled:text-fg-subtle disabled:no-underline disabled:cursor-not-allowed"
                        >
                          Edit instance
                        </button>
                        <button
                          type="button"
                          disabled={!canEdit || !selectedReference}
                          title={canEdit ? 'Take an independent copy of these blocks on this page only' : readOnlyReason}
                          onClick={() => { void onDetachInstance() }}
                          className="text-[11px] font-medium text-fg-muted hover:text-fg hover:underline disabled:text-fg-subtle disabled:no-underline disabled:cursor-not-allowed"
                        >
                          Detach
                        </button>
                      </div>
                    </div>
                  )}
                  {activeTab?.panels.includes('query') && (
                    <QueryBuilderPanel
                      types={allTypes}
                      sourceFields={loopSourceFields}
                      block={selectedBlock}
                      onChange={(prop, v) => updateBlockProp(selectedRow.path, prop, v)}
                    />
                  )}

                  {activeTab?.items.map((item) => renderInspectorItem(item))}

                  {/* X-T1: the block's own raw CSS, scoped by the compiler to
                      this block alone. Offered under the same gate as a
                      class's raw CSS; a block that already carries some is
                      shown read-only to a member who may not write it,
                      because invisible styling is the worse surprise. */}
                  {activeTab?.id === 'advanced' && selectedRow && selectedBlock
                    && (rawCssAllowed || readSectionCss(selectedBlock as never) !== '') && (
                    <SectionCssControl
                      key={selectedRow.key}
                      value={readSectionCss(selectedBlock as never)}
                      state={sectionCssState({
                        key: selectedRow.key, blockType: selectedRow.type,
                        css: readSectionCss(selectedBlock as never), protection: selectedProtection,
                      })}
                      check={(css) => sectionCssState({
                        key: selectedRow.key, blockType: selectedRow.type, css, protection: selectedProtection,
                      })}
                      onSave={rawCssAllowed ? onSectionCss : undefined}
                      lockedReason={rawCssAllowed ? undefined : 'Raw CSS needs the "Use Creative (freeform) styling" capability'}
                      disabled={!canEdit}
                    />
                  )}

                  {activeTab?.panels.includes('style') && (
                    <div className="pb-2 mb-2 border-b border-border">
                      <StylePanel
                        onChangeMany={onStyleChangeMany}
                        onInteractionChange={onInteractionChange}
                        tokens={tokens}
                        fonts={fontNames}
                        protection={selectedProtection}
                        parts={partOptions}
                        partTarget={partTarget}
                        onPartTarget={setPartTarget}
                        refused={draftRefused}
                        changedElsewhere={designLines}
                        onReloadStyles={() => { void onReloadStyles() }}
                        blockType={selectedRow?.type}
                        styleClass={activeStyleClass}
                        pendingName={
                          styleTarget && styleTarget.action !== 'edit' ? styleTarget.name : null
                        }
                        pendingUsage={styleTarget?.action === 'reuse' ? styleTarget.usage : undefined}
                        usage={styleUsage}
                        tags={offerableTags}
                        tagTarget={tagTarget}
                        tagProps={(tagDefaults[tagTarget ?? ''] ?? {}) as never}
                        onTarget={setTagTarget}
                        available={reusableClasses}
                        allClasses={styleClasses}
                        applied={classesOf(selectedBlock as never)}
                        onPickClass={onPickClass}
                        onMakeUnique={() => { void onMakeUnique() }}
                        states={statesFor(selectedRow?.type ?? '', activeStyleClass?.props)}
                        state={styleState}
                        onState={setStyleState}
                        breakpoint={styleBreakpoint}
                        breakpointLabel={breakpointLabel(styleBreakpoint, bp.width)}
                        onChange={(id, v) => { void onStyleChange(id, v) }}
                        onCustomCss={
                          rawCssAllowed ? (v) => { void onCustomCss(v) } : undefined
                        }
                        busy={styleBusy}
                        housekeeping={housekeeping}
                      />
                    </div>
                  )}
                  {inspectorTabList.length === 0 && (
                    <p className="text-xs text-fg-subtle">This block has nothing to configure.</p>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
      <ReviewActionDialog
        kind={reviewAction}
        stageName={reviewChip?.record?.stageName}
        busy={publishing}
        onCancel={() => setReviewAction(null)}
        onConfirm={(note) => {
          const kind = reviewAction
          setReviewAction(null)
          if (kind) void runReviewAction(kind, note ? { note } : {})
        }}
      />
      <SubmitReviewDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        busy={publishing}
        onSubmit={(assigneeId) => {
          setSubmitOpen(false)
          void runReviewAction('submit', assigneeId ? { assigneeId } : {})
        }}
      />
      <NewPageDialog
        open={newPageOpen}
        onOpenChange={setNewPageOpen}
        types={creatableTypes}
        onCreated={async (t, pid) => {
          setNewPageOpen(false)
          await flushSave()
          navigate(`${studioHref}/edit?type=${encodeURIComponent(t)}&id=${encodeURIComponent(pid)}`)
        }}
      />
      <InstanceDialog
        open={instanceDialog !== null}
        onOpenChange={(o) => { if (!o) setInstanceDialog(null) }}
        heading={instanceDialog?.mode === 'section'
          ? 'Create instance from this section'
          : instanceDialog?.mode === 'rename' ? 'Rename instance' : 'New instance'}
        submitLabel={instanceDialog?.mode === 'rename' ? 'Save' : 'Create instance'}
        initial={instanceDialog?.mode === 'section'
          ? instanceDialog.suggested
          : instanceDialog?.mode === 'rename' ? instanceTitle(instanceDialog.instance) : ''}
        initialPlacement={instanceDialog?.mode === 'rename' ? instanceDialog.instance.placement : 'manual'}
        withPlacement
        taken={instanceTitles}
        busy={instanceDialogBusy}
        error={instanceDialogError}
        note={instanceDialog?.mode === 'section' ? (
          <>
            <p>
              The section moves into the instance and this page keeps a reference to it,
              so the tree here collapses to one row. It starts as a draft: the page shows
              nothing where it sat until you publish the instance.
            </p>
            {instanceDialog.warning && <p className="pt-1 text-warning">{instanceDialog.warning}</p>}
          </>
        ) : instanceDialog?.mode === 'rename' ? (
          'Renaming is safe: every placement points at this instance by id, so they all follow at once and no page is republished. Placement is here too, because where the system puts an instance has to be changeable without leaving Studio.'
        ) : (
          'One shared tree, composed here from Builder Kit blocks. It starts empty and as a draft: no page shows it until you publish it.'
        )}
        onSubmit={(v) => {
          if (instanceDialog?.mode === 'section') void onCreateInstanceFromSection(instanceDialog, v)
          else if (instanceDialog?.mode === 'rename') void onRenameInstance(instanceDialog.instance, v)
          else void onCreateInstance(v)
        }}
      />
      <GenerateDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        mode="current"
        typeName={type ?? undefined}
        field={activeRegion}
        hasSections={blocks.length > 0}
        onApply={onApplyGenerated}
      />
      <PresetNameDialog
        open={nameDialog !== null}
        title={nameDialog?.mode === 'rename' ? 'Rename preset' : 'Save as preset'}
        initial={nameDialog?.mode === 'rename' ? nameDialog.preset.name : ''}
        submitLabel={nameDialog?.mode === 'rename' ? 'Rename' : 'Save preset'}
        onOpenChange={(o) => { if (!o) setNameDialog(null) }}
        onSubmit={(name) => {
          if (nameDialog?.mode === 'rename') void onRenamePreset(nameDialog.preset, name)
          else void onSavePreset(name)
        }}
      />
      {confirmDialog}
    </div>
  )
}
