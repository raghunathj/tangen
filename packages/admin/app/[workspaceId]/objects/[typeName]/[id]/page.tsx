

import { useEffect, useRef, useState, useCallback, useMemo, Suspense } from 'react'
import { DatePicker } from '@/components/ui/date-picker'
import { createPortal } from 'react-dom'
import { useCan } from '@/lib/use-can'
import { fieldValueChanged, i18nDiverges } from '@/lib/draft-changes'
import { NoPermission } from '@/components/require-permission'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import {
  IconClock, IconExternalLink, IconRefresh,
  IconPencil, IconCheck, IconX, IconLoader,
  IconHistory, IconUndo, IconWarning, IconEye, IconEyeOff,
  IconChevronDown,
  IconSparkles,
  IconLayoutLeft, IconCodeBox,
} from '@tangen/icons'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { useAuthStore } from '@/lib/auth'
import { isDynamicDefault, resolveDynamicDefault, evalFieldWarning, type FieldWarningRules, isLocalizableFieldType } from '@tangen/types'
import { etagOf, adminFetch, workspaceFetch } from '@/lib/api'
import { useLifecycleActions, actionOf, isAvailable, publishPolicyOfActions } from '@/lib/lifecycle-actions'
import type { LifecycleActionId } from '@tangen/types'
import { cachedAdminGet, cachedWorkspaceGet } from '@/lib/api-cache'
import { AnchoredDropdown } from '@/components/ui/anchored-dropdown'
import { usePanelRegistry, panelRegistryKey } from '@/lib/app-panel-registry'
import { LabelInput } from '@/components/labels/label-input'
import { Callout, Metabox, PropertyRow } from '@tangen/ui'
import { toast } from '@/lib/toast'
import {
  extractFieldValues, normalizeObjectData,
  formatSidebarDate, formatScheduledDateTime, relativeTime, fullDateTime,
  slugify, evalVisibility, containerIsLocalized, type BlockLocaleCtx,
} from '@/lib/editor'
import { ObjectVersionDiff } from '@/components/object-editor/ObjectVersionDiff'
import { useSlugEditing } from '@/lib/use-slug-editing'
import { useResizableWidth, INSPECTOR_WIDTH } from '@/lib/use-sidebar-width'
import { useObjectVersions, type VersionEntry } from '@/lib/use-object-versions'
import { useLocaleDrafts } from '@/lib/use-locale-drafts'
import { useObjectLifecycle } from '@/lib/use-object-lifecycle'
import { useObjectLoad, type AuditActor, type AuditInfo } from '@/lib/use-object-load'
import { useObjectEditor } from '@/lib/object-editor/use-object-editor'
import { snapshotOf } from '@/lib/object-editor/editor-model'
import { buildSaveRequest, classifySaveFailure, panelDataHasDraftChanges } from '@/lib/object-editor/save-request'
import { ChangedElsewhereNotice, changedAnchors } from '@/components/object-editor/ChangedElsewhereNotice'
import { EditorBar } from '@/components/object-editor/EditorBar'
import { useEditingClaim } from '@/kit'
import { EditingPresence } from '@/components/object-editor/EditingPresence'
import { FieldPresence } from '@/components/object-editor/FieldPresence'
import { fieldOfFocusTarget } from '@/components/object-editor/field-focus'
import { FieldRenderer } from '@/components/object-editor/FieldRenderer'
import { AIFillButton, AI_FILLABLE_TYPES } from '@/components/fields/ai-fill-button'
import { GenAIButton } from '@/components/gen-ai-button'
import { LocaleBadge, localeColor, type WorkingLocale, type LocaleColor } from '@/components/i18n/localized-field-inputs'
import { useReusableComponents } from '@/lib/use-reusable-components'
import { LocalizeAssetModal } from '@/components/media/localize-asset-modal'
import { useLocaleStore } from '@/lib/locale'
import { useDevMode } from '@/lib/use-dev-mode'
import { useUIStore } from '@/lib/ui-store'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { FieldJumpMenu, JUMP_MENU_THRESHOLD } from '@/components/object-editor/FieldJumpMenu'
import { inspectorLayout } from '@/lib/field-presentation'
import { AIAssistantPanel, type TaggedField } from '@/components/fields/ai-assistant-panel'
import {
  usePreviewBreakpoints, PreviewBreakpoints, useLivePreviewConnection, ConnectionBadge,
  PreviewConsole, LivePreviewCanvas, PREVIEW_NAVIGATE_TYPE, type PreviewSnapshot,
} from '@/components/object-editor/LivePreviewPane'
import { getPreviewConfig, mintPreviewToken, buildPreviewUrl, type PreviewConfig, stripPreviewParam } from '@/lib/preview'
import type { ApplyPatch } from '@/lib/ai-apply'
import type { TaxonomyPickerConfig } from '@/components/taxonomy/TaxonomyPicker'
import type { FieldDefinition } from '@tangen/types'
import { activeFields } from '@tangen/types'

interface AllTypeDef {
  name: string
  disabled?: boolean
  fields?: Array<{ name: string; fieldType: string; config?: { targetType?: string; many?: boolean } }>
  admin?: { taxonomy?: { hierarchical?: boolean; orderable?: boolean } }
}

interface TypeDef {
  name: string
  label: string
  localized?: boolean
  fields: FieldDefinition[]
  admin?: {
    taxonomy?: { hierarchical?: boolean; orderable?: boolean; parentType?: string }
    editorView?: { main?: string[]; sidebar?: string[] }
    versioning?: { enabled?: boolean; maxVersions?: number }
  }
}

interface ObjectData {
  id: string
  title: string | null
  slug: string | null
  status: string
  created_at: string
  updated_at: string
  published_at: string | null
  scheduled_at: string | null
  published_values: Record<string, unknown> | null
  [key: string]: unknown
}


const fieldInput = 'block w-full appearance-none rounded-control border border-border bg-surface-raised px-2.5 py-[5px] text-ui leading-5 text-fg placeholder:text-fg-subtle shadow-raised outline-none transition-colors motion-fast hover:border-border-strong focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25'
const fieldLabel = 'mb-1.5 flex items-center gap-1.5 text-ui-xs font-medium text-fg-muted'
/** The pill tab look of spec §13 (neutral selection). */
const editorTabPill = 'inline-flex h-7 cursor-pointer items-center rounded-[calc(var(--tg-radius-control)-2px)] px-2.5 text-ui-sm font-medium transition-colors motion-fast outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus'

/** The origin of a configured URL, or null if unset/malformed — used to pin the
 *  preview-navigation message listener to the env's front-end origin. */
function safeOrigin(url?: string | null): string | null {
  if (!url) return null
  try { return new URL(url).origin } catch { return null }
}

/** "by Jane" / "by CI key · via API" under a sidebar date; nothing when unknown. */
function Byline({ actor }: { actor: AuditActor | null | undefined }) {
  if (!actor) return null
  return (
    <p className="text-[11px] text-fg-subtle mt-0.5">
      by {actor.label ?? actor.id}{actor.kind === 'api_key' ? ' · via API' : ''}
    </p>
  )
}

export default function ObjectEditorPage() {
  const params = useParams() as { workspaceId: string; typeName: string; id: string }
  // K7.3: build-time editor panels plus the ones installed extensions loaded at runtime.
  const panelRegistry = usePanelRegistry(params.workspaceId)
  const { can, me, ready: canReady, canWriteLocale: canWriteLoc, hasCapability } = useCan()
  // The inspector's width (tasks/ui-v2-calibration.md, "Inspector"): 300 by
  // default, 280 to 480 by drag or arrow keys from the handle, persisted.
  const inspector = useResizableWidth(INSPECTOR_WIDTH)
  const canUseAI = hasCapability('use:ai')
  const canWrite = can('write', 'objects', params.typeName)
  const navigate = useNavigate()
  const { accessToken, member: currentMember } = useAuthStore()
  const isNew = params.id === 'new'

  const [typeDef, setTypeDef] = useState<TypeDef | null>(null)
  const [allTypeDefs, setAllTypeDefs] = useState<Map<string, AllTypeDef>>(new Map())
  // The headless editor model (UI V2 stage V6, lib/object-editor): the
  // document's values, the saved baseline, validation errors, save status and
  // the conflict flag (a save refused because someone else saved first - Phase
  // 6B STALE_OBJECT - PERSISTENT, not a toast: the unsaved work stays on
  // screen and nothing more saves until the reader reloads, Phase 8B finding
  // 8B-6) live in one store. The setters keep the signatures the load,
  // versions, lifecycle and slug hooks take.
  const { model: editor, state: editorState } = useObjectEditor()
  const { title, slug, fieldValues, saveStatus, validationErrors, conflict } = editorState
  const { setTitle, setSlug, setFieldValues, setSaveStatus, setValidationErrors, setConflict, lastSavedRef } = editor
  const [showTimestamps, setShowTimestamps] = useState(false)
  const [viewingLive, setViewingLive] = useState(false)
  // Realtime R3 as a soft lock (the user, 2026-09-13): while someone else
  // holds the editing claim this copy is read-only and never saves; Take
  // over moves the claim here and the other tab locks in turn. A stale copy
  // (changed elsewhere, or a save refused as stale) locks the same way until
  // the reload. The server's stale-write guard stays the integrity mechanism.
  const claim = useEditingClaim(`object:${params.id}`, { enabled: params.id !== 'new' && !!params.id })
  const lockedBy = claim.holder && !claim.mine && claim.holder.memberId !== (currentMember?.memberId ?? null) ? claim.holder : null
  const heldRef = useRef(false)
  useEffect(() => {
    if (claim.mine) heldRef.current = true
    else if (!claim.holder) heldRef.current = false
  }, [claim.mine, claim.holder])
  const takenOver = !!lockedBy && heldRef.current
  // Take over unlocks at once, before the moved claim comes back over the
  // socket; the claim confirms it (or four seconds pass and the lock returns).
  const [takingOver, setTakingOver] = useState(false)
  useEffect(() => {
    if (!takingOver) return
    if (claim.mine) { setTakingOver(false); return }
    const t = setTimeout(() => setTakingOver(false), 4_000)
    return () => clearTimeout(t)
  }, [takingOver, claim.mine])
  const takeOver = () => { setTakingOver(true); claim.takeOver() }
  const [staleElsewhere, setStaleElsewhere] = useState(false)
  const editLocked = (!!lockedBy && !takingOver) || staleElsewhere || conflict
  // Following live (the middle step, 2026-09-13): a locked viewer with no
  // unsaved edits watches the holder's saves land in place; the fields that
  // changed flash for a moment and the bar says when the last one arrived.
  const [followedAt, setFollowedAt] = useState<number | null>(null)
  useEffect(() => { setFollowedAt(null) }, [params.id, lockedBy?.session])
  const onFollow = useCallback((changed: string[], panels: string[]) => {
    setFollowedAt(Date.now())
    for (const name of changedAnchors(changed, panels)) {
      const el = document.querySelector<HTMLElement>(`[data-field="${name}"]`)
      if (!el) continue
      el.classList.add('ring-2', 'ring-accent/40', 'rounded-control', 'transition-shadow', 'motion')
      setTimeout(() => el.classList.remove('ring-2', 'ring-accent/40', 'rounded-control', 'transition-shadow', 'motion'), 1_800)
    }
  }, [])
  const [richTextKey, setRichTextKey] = useState(0)
  // Bumped after a cascade publish so relation fields re-fetch their linked
  // items' (now-published) status instead of showing a stale draft badge.
  const [relationReloadNonce, setRelationReloadNonce] = useState(0)
  const [collapsedFields, setCollapsedFields] = useState<Set<string>>(new Set())

  // App-defined center-stage panels installed for this workspace
  const [appPanels, setAppPanels] = useState<Array<{ id: string; extensionId: string; label: string; renderMode: 'inline' | 'modal'; placement?: 'main' | 'sidebar'; buttonLabel: string; ai?: { enabled?: boolean; instructions?: string; fields?: { name: string; label: string; fieldType: string; config?: Record<string, unknown> }[] } }>>([])
  const [openModalPanel, setOpenModalPanel] = useState<string | null>(null)
  // Accumulated panel data mutations to send on next save — keyed by panelId
  const pendingPanelDataRef = useRef<Record<string, Record<string, unknown>>>({})
  // When this editor last issued a save: the realtime echo of it arrives before
  // the response, and must not read as a change from elsewhere.
  const saveIssuedAtRef = useRef<number | null>(null)
  // Bumped whenever a panel emits onChange — lets the auto-save effect react to panel edits
  const [panelDataSeq, setPanelDataSeq] = useState(0)
  // Tracks whether panel data has changed since the last save — drives the draft indicator
  const [hasPendingPanelChanges, setHasPendingPanelChanges] = useState(false)
  // Realtime field presence: the field that has focus, published as presence `field`.
  // One capture-phase pair on the editor root; the nearest data-field wrapper names it.
  const [focusedField, setFocusedField] = useState<string | null>(null)
  // Per-object reset fan-out for the load hook: re-populated every render AFTER
  // the version/lifecycle hooks run, so the load effect (post-render) always
  // calls the current resets. See the assignment below the lifecycle hook.
  const resetPerObjectStateRef = useRef<() => void>(() => {})
  // Object loading: the merged single GET (?locale=all → data + audit + i18n +
  // extension data), /new → /<id> handoff, per-object resets, extraction (R8).
  const {
    object, setObject, audit, setAudit, loading, refresh: refreshObject, etagRef,
    i18nMap, setI18nMap, i18nLoaded,
    panelDataMap, setPanelDataMap, publishedPanelDataMap, setPublishedPanelDataMap,
    extractedForObjectId, createdHandoffRef,
  } = useObjectLoad<ObjectData>({
    accessToken, isNew,
    id: params.id,
    typeName: params.typeName,
    fields: typeDef?.fields ?? null,
    setTitle, setSlug, setFieldValues, setSaveStatus,
    lastSavedRef, pendingPanelDataRef, setHasPendingPanelChanges, resetPerObjectStateRef,
  })

  // Secondary-bar portal target (layout's #page-actions). Re-resolve whenever
  // preview focus mode toggles: entering preview UNMOUNTS the layout header (and
  // #page-actions); leaving it mounts a NEW one, so a mount-only lookup would
  // leave the Preview/Publish buttons portaling into a stale, detached node.
  const previewModeActive = useUIStore((s) => s.previewMode)
  const [pageActionsSlot, setPageActionsSlot] = useState<HTMLElement | null>(null)
  useEffect(() => { setPageActionsSlot(document.getElementById('page-actions')) }, [previewModeActive])
  // Content AI: whether any provider is available for this workspace/env
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiImageEnabled, setAiImageEnabled] = useState(false)
  // ── Localization — Hygraph-style inline duplication
  const localeStore = useLocaleStore()
  const devMode = useDevMode()
  const localesInfo = localeStore.enabled
    ? { enabled: true, defaultLocale: localeStore.defaultLocale, locales: localeStore.locales, engines: localeStore.engines }
    : null
  const activeLocale = localeStore.enabled ? localeStore.activeLocale : null
  // Locale-scoped roles: base language locked → translate-only mode
  const baseLocked = !canWriteLoc(null, localesInfo?.defaultLocale)
  // Locales the writer is currently working in (Localizations panel toggles);
  // seeded from the ambient selector so list → editor flows keep the language.
  const [workingLocales, setWorkingLocales] = useState<string[]>([])
  // Per-locale visibility — hide any language's inputs (drafts + saving unaffected)
  const [hiddenLocales, setHiddenLocales] = useState<Set<string>>(new Set())
  function toggleHiddenLocale(code: string) {
    setHiddenLocales((prev) => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })
  }
  /** Switch the preview language AND turn that language on in the editor (add it
   *  as a working locale + unhide it) so the fields are ready to edit, not buried. */
  function switchPreviewLocale(code: string) {
    if (!localesInfo) return
    const isDefault = code === localesInfo.defaultLocale
    localeStore.setLocale(isDefault ? null : code)   // always switch the preview display locale
    // Only engage locale EDITING (working locale + inputs) when the type can actually
    // hold translations. A non-localizable type just previews in that locale (default fallback).
    if (isDefault || !typeIsLocalizable) return
    setWorkingLocales((prev) => (prev.includes(code) || prev.length >= 5 ? prev : [...prev, code]))
    setHiddenLocales((prev) => { if (!prev.has(code)) return prev; const n = new Set(prev); n.delete(code); return n })
  }
  const localeSeeded = useRef(false)
  // Locale whose untranslated-fields list is expanded in the panel
  const [missingOpenFor, setMissingOpenFor] = useState<string | null>(null)
  const [localizeAssetId, setLocalizeAssetId] = useState<string | null>(null)
  const [showAIGenerate, setShowAIGenerate] = useState(false)
  // ── Live preview ────────────────────────────────────────────────────────────
  const [previewCfg, setPreviewCfg] = useState<PreviewConfig | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  // In preview focus mode the editor's stage + settings become tabs (30% is narrow).
  const [editorTab, setEditorTab] = useState<'content' | 'settings'>('content')
  // Under 700px the inspector cannot sit beside the document (it left a 60px
  // column at 390); the two STACK behind a Content | Details switch instead.
  const narrow = useNarrowViewport()
  const stacked = narrow && !previewOpen
  const [editorHidden, setEditorHidden] = useState(false)   // "full preview" - collapse the editor
  useEffect(() => { if (!previewOpen) setEditorHidden(false) }, [previewOpen])
  // Preview-toolbar state, lifted so the SINGLE top bar spans both panes.
  const [previewReloadKey, setPreviewReloadKey] = useState(0)
  const [showConsole, setShowConsole] = useState(false)
  // The iframe's CURRENT in-pane location (pathname+search), reported by the site
  // on every navigation — drives the toolbar URL, open-in-new-tab, and reload so
  // they track where the user browsed, not the initial preview URL.
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const previewFrontendOrigin = safeOrigin(previewCfg?.frontendUrl)
  const previewFullUrl = previewPath && previewFrontendOrigin
    ? `${previewFrontendOrigin}${previewPath}`
    : previewSrc
  /**
   * Reload the CURRENT in-pane page with a hard iframe remount (not a soft
   * router.refresh): pointing src at the current URL and bumping the key toggles
   * the canvas `ready` state, which re-pushes the active-locale snapshot.
   *
   * The object's own /preview route ALSO fetches its Tier-1 content using the
   * locale in its URL — and that fetch resolves after the push, so a stale locale
   * param would clobber the pushed one and revert the frame to another language.
   * Rewrite the locale param to the CURRENT locale so the fetched content and the
   * push agree. Real-page URLs carry no locale param (their locale comes only
   * from the push), so they reload untouched.
   */
  function reloadPreview() {
    let target = previewFullUrl ?? previewSrc ?? ''
    try {
      const u = new URL(target, previewFrontendOrigin ?? undefined)
      const loc = (activeLocale ?? localesInfo?.defaultLocale) ?? ''
      let touched = false
      if (u.searchParams.has('preview_locale')) { u.searchParams.set('preview_locale', loc); touched = true }
      if (u.searchParams.has('locale')) { u.searchParams.set('locale', loc); touched = true }
      if (touched) target = u.toString()
    } catch { /* keep target as-is */ }
    if (target && target !== previewSrc) setPreviewSrc(target)
    setPreviewReloadKey((k) => k + 1)
  }
  // Floating autosave indicator: on while saving, lingers ~1.8s after "saved" then fades.
  const [savePulse, setSavePulse] = useState(false)
  useEffect(() => {
    if (saveStatus === 'saving' || saveStatus === 'autosaving') { setSavePulse(true); return }
    if (saveStatus === 'saved') { setSavePulse(true); const t = setTimeout(() => setSavePulse(false), 1800); return () => clearTimeout(t) }
    setSavePulse(false)
  }, [saveStatus])
  const previewBp = usePreviewBreakpoints(previewCfg?.breakpoints)
  const previewConn = useLivePreviewConnection(previewCfg?.frontendUrl ?? '', previewReloadKey, previewSrc ?? '')
  const consoleErrors = previewConn.logs.filter((l) => l.level === 'error').length
  // Editor width % in preview mode — default 30 (preview 70), draggable, editor capped 25–40.
  const [editorPct, setEditorPct] = useState(30)
  const splitRef = useRef<HTMLDivElement | null>(null)
  function startResize(e: { preventDefault(): void }) {
    e.preventDefault()
    const move = (ev: PointerEvent) => {
      const rect = splitRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return
      setEditorPct(Math.min(40, Math.max(25, ((ev.clientX - rect.left) / rect.width) * 100)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    // Pointer events cover mouse + touch + pen.
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const setPreviewMode = useUIStore((s) => s.setPreviewMode)
  // Preview focus mode → the layout hides the nav sidebar. Reset on unmount.
  useEffect(() => { setPreviewMode(previewOpen); return () => setPreviewMode(false) }, [previewOpen, setPreviewMode])
  // Is live preview available? (a frontend.previewUrl is configured for this env)
  useEffect(() => { getPreviewConfig(params.typeName as string).then(setPreviewCfg).catch(() => setPreviewCfg(null)) }, [params.typeName])

  /** Mint a scoped preview token, build the URL, then either open a tab (Tier 1) or the
   *  side-by-side live pane (Tier 2). Only meaningful once the object exists (has an id). */
  async function openPreview(mode: 'tab' | 'pane') {
    const id = object?.id as string | undefined
    if (!previewCfg?.previewUrl || !id || previewBusy) return
    setPreviewBusy(true)
    try {
      const token = await mintPreviewToken(id)
      const url = buildPreviewUrl(previewCfg.previewUrl, { id, type: params.typeName as string, slug, locale: activeLocale ?? localesInfo?.defaultLocale, token: token ?? undefined })
      if (mode === 'tab') { window.open(url, '_blank', 'noopener') }
      else {
        setPreviewSrc(url); setPreviewOpen(true)
        try { const u = new URL(url); setPreviewPath(u.pathname + u.search) } catch { setPreviewPath(null) }
      }
    } finally {
      setPreviewBusy(false)
    }
  }
  /** Close the live-preview PANE. Named closePreview (not exitPreview!) — there
   *  is a separate, unrelated exitPreview() below for leaving "view live version"
   *  mode; a name collision silently routed the pane's X to the wrong one. */
  function closePreview() { setPreviewOpen(false) }
  // K2: the server's lifecycle action policy decides what the publish
  // controls offer (grants, base-language rights, the status machine, a
  // validation dry run, the cascade, every extension's publish policy).
  // Re-asked when the object reloads (the review panel calls refresh() after
  // every transition). While it loads, or if the request fails, the bundle's
  // grant is the fallback - a broken request must never take a button away.
  const { actions: lifecycleActions } = useLifecycleActions(params.typeName, isNew ? null : params.id, [object?.updatedAt])
  const publishAction = actionOf(lifecycleActions, 'publish')
  const canPublish = publishAction ? !publishAction.blockers.some((b) => b.code === 'FORBIDDEN') : can('publish', 'objects', params.typeName)
  const publishPolicy = publishPolicyOfActions(lifecycleActions)
  const lifecycleAllows = (id: LifecycleActionId) => (lifecycleActions ? isAvailable(lifecycleActions, id, { forType: isNew }) : true)

  const canPreview = !isNew && !!object?.id && previewCfg?.enabled === true
  // Deep link: ?preview=1 (the toolbar's "Edit this page") opens the pane
  // once the object + preview config are ready, then strips the param so
  // refreshes and copied URLs stay clean. Consumed at most once per mount.
  const previewParamDone = useRef(false)
  useEffect(() => {
    if (previewParamDone.current) return
    const stripped = stripPreviewParam(window.location.href)
    if (stripped === null) { previewParamDone.current = true; return }
    if (!canPreview || previewBusy || previewOpen) return
    previewParamDone.current = true
    window.history.replaceState(window.history.state, '', stripped)
    void openPreview('pane')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPreview, previewOpen, previewBusy])
  // ⌘\ / Ctrl+\ toggles live preview.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        if (previewOpen) closePreview()
        else if (canPreview) void openPreview('pane')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewOpen, canPreview])
  // Handoff from the universal assistant (content.create): open the AI panel on a new
  // object, seeded with the brief (ready to edit + send).
  const aiPrompt = (useLocation().state as { aiPrompt?: string } | null)?.aiPrompt
  const aiPrefill = useMemo(() => (aiPrompt ? { text: aiPrompt } : null), [aiPrompt])
  useEffect(() => {
    if (isNew && aiPrompt) setShowAIGenerate(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [aiTitleEnabled, setAiTitleEnabled] = useState(false)
  const [aiTag, setAiTag] = useState<TaggedField | null>(null)
  const [aiApplySeq, setAiApplySeq] = useState(0)
  const [panelRemountSeq, setPanelRemountSeq] = useState(0)

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Deduped autosave-failure toast: surface a server error once (not on every
  // debounced retry), and re-arm after a successful save.
  const autoSaveErroredRef = useRef(false)
  // Render-body caches for the dirty-state computations below the early
  // returns (hooks can't live there). Keyed on input identities so a
  // keystroke costs ONE snapshot stringify instead of re-serializing the
  // whole document plus every panel map on every render.
  const dirtySnapRef = useRef<{ title: unknown; fv: unknown; str: string }>({ title: undefined, fv: undefined, str: '' })
  const draftCalcRef = useRef<{ key: unknown[]; val: boolean }>({ key: [], val: false })
  const slugDirty = useRef(false)

  // ── Presentation-mode navigation (preview pane → editor follow) ─────────────
  // Clicking a link inside the live-preview pane loads the target object into
  // the editor AND keeps the pane on that object. The editor is REMOUNTED per
  // object is switched in place (the router no longer remounts it), so following
  // just navigates and the iframe stays where the user clicked. Origin-checked.
  // Per-render snapshot of what the message handler needs, so the listener can
  // stay subscribed without re-binding on every keystroke.
  const navStateRef = useRef<{ currentId?: string; hasType: (t: string) => boolean }>({
    currentId: undefined, hasType: () => false,
  })
  navStateRef.current = {
    currentId: object?.id as string | undefined,
    hasType: (t: string) => allTypeDefs.has(t),
  }
  // When the preview shows a page with NO editable content object (a listing, a
  // static page, home…), hold its path here and render a "not editable" panel
  // instead of following. Cleared when the user lands on editable content.
  const [previewNotEditable, setPreviewNotEditable] = useState<{ path: string } | null>(null)
  useEffect(() => { if (!previewOpen) { setPreviewNotEditable(null); setPreviewPath(null) } }, [previewOpen])

  useEffect(() => {
    if (!previewOpen) return
    const frontendOrigin = safeOrigin(previewCfg?.frontendUrl)
    if (!frontendOrigin) return
    // A page reports its location on every in-pane navigation: content pages
    // with id/type (editable), listings/static pages with editable:false.
    // Editable reports are acted on IMMEDIATELY (follow); not-editable reports
    // wait a short grace period so a content page's editable report — which
    // lands a beat after the layout's default not-editable report — cancels it
    // before it flashes on screen.
    let notEditableTimer: ReturnType<typeof setTimeout> | null = null
    let editableForPath: string | null = null   // a path resolved as editable - ignore its later not-editable
    const resolveEditable = async (d: { id?: string; objectType?: string; slug?: string }, path: string) => {
      const targetType = d.objectType as string
      let targetId = typeof d.id === 'string' ? d.id : undefined
      if (!targetId && typeof d.slug === 'string') {
        try {
          const res = await adminFetch<{ data?: { id?: string } }>(
            `/objects/${encodeURIComponent(targetType)}/by-slug/${encodeURIComponent(d.slug)}`)
          targetId = res.data?.id
        } catch { return }
      }
      if (!targetId) return
      editableForPath = path
      setPreviewNotEditable(null)
      if (targetId !== navStateRef.current.currentId) {
        navigate(`/${params.workspaceId}/objects/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`)
      }
    }
    const onNav = (e: MessageEvent) => {
      if (e.origin !== frontendOrigin) return
      const d = e.data as { type?: string; id?: string; objectType?: string; slug?: string; path?: string; editable?: boolean } | null
      if (!d || d.type !== PREVIEW_NAVIGATE_TYPE || typeof d.path !== 'string') return
      const path = d.path
      setPreviewPath(path)   // toolbar URL / open-in-new-tab / reload track the current page
      const isEditable = d.editable !== false && typeof d.objectType === 'string'
        && navStateRef.current.hasType(d.objectType) && (typeof d.id === 'string' || typeof d.slug === 'string')
      if (isEditable) {
        if (notEditableTimer) { clearTimeout(notEditableTimer); notEditableTimer = null }
        void resolveEditable(d, path)
      } else {
        if (editableForPath === path) return   // already resolved this exact path as editable
        editableForPath = null
        if (notEditableTimer) clearTimeout(notEditableTimer)
        notEditableTimer = setTimeout(() => { setPreviewNotEditable({ path }) }, 260)
      }
    }
    window.addEventListener('message', onNav)
    return () => { window.removeEventListener('message', onNav); if (notEditableTimer) clearTimeout(notEditableTimer) }
  }, [previewOpen, previewCfg?.frontendUrl, params.workspaceId, navigate])
  const liveDataRef = useRef<{ title: string; slug: string; fieldValues: Record<string, unknown> } | null>(null)
  // Always reflects the latest real draft state — updated inline every render so async
  // functions (like viewVersion) never capture stale closure values.
  const trueDraftRef = useRef<{ title: string; slug: string; fieldValues: Record<string, unknown> }>({ title: '', slug: '', fieldValues: {} })

  // Version history: list + read-only preview + restore flow (R3). exitPreview
  // here leaves the version preview - distinct from closePreview (the pane).
  const {
    versions, versionsLoading, restoringId, previewingVersion, previewLoading,
    showHistory, restoreTarget, setRestoreTarget, orphanFields, showDiff, setShowDiff,
    loadVersions, toggleHistory, viewVersion, exitPreview, handleRestore, executeRestore,
    refreshVersions, refreshVersionsRef, resetVersionState,
  } = useObjectVersions<ObjectData>({
    isNew,
    typeName: params.typeName,
    object,
    setObject,
    fields: typeDef?.fields ?? null,
    setTitle, setSlug, setFieldValues, setValidationErrors, setRichTextKey, setSaveStatus,
    autoSaveTimer, lastSavedRef, liveDataRef, trueDraftRef,
  })

  // Register as the Gen AI host so the TopBar button opens the assistant here
  useEffect(() => {
    if (!aiEnabled || viewingLive || previewingVersion) return
    useUIStore.getState().setGenAIHost(() => setShowAIGenerate(true))
    return () => useUIStore.getState().setGenAIHost(null)
  }, [aiEnabled, viewingLive, previewingVersion])

  useEffect(() => {
    if (!accessToken) return
    cachedAdminGet<{ data: { enabled: boolean; providers?: { available: boolean; imageModels?: string[] }[] } }>('/admin/ai/providers')
      .then((r) => {
        setAiEnabled(r.data.enabled)
        setAiImageEnabled((r.data.providers ?? []).some(p => p.available && (p.imageModels?.length ?? 0) > 0))
      })
      .catch(() => { setAiEnabled(false); setAiImageEnabled(false) })
    cachedAdminGet<{ data: { titleGeneration: boolean } }>('/admin/ai/settings')
      .then((r) => setAiTitleEnabled(Boolean(r.data.titleGeneration)))
      .catch(() => setAiTitleEnabled(false))
  }, [accessToken])

  // Translations map — loaded once per object when localization is on
  // Media fields localize at the asset level (variants), never via side tables
  const localizedFields = useMemo(
    () => (typeDef?.fields ?? []).filter(
      (f: any) => (f.config as any)?.localized === true && isLocalizableFieldType(f.fieldType)),
    [typeDef],
  )
  // BL-4: container fields (component/repeater) with a localized sub-field
  // ANYWHERE inside (nested slots, rows, groups - the server's rule): their
  // translations live as overlays keyed by block/row _key, nested per slot.
  const reusableComponents = useReusableComponents(!!localesInfo?.enabled)
  const localizedContainers = useMemo(
    () => (typeDef?.fields ?? []).filter(
      (f: any) => containerIsLocalized(f, reusableComponents as never),
    ).map((f: any) => f.name as string),
    [typeDef, reusableComponents],
  )
  // A type is localizable when it opts in at the type level (`localized: true`,
  // title translatable at minimum) OR has a localized field/container — the same
  // condition under which push generates its <type>_i18n side table (codegen.ts).
  const typeIsLocalizable = (typeDef as { localized?: boolean } | undefined)?.localized === true
    || localizedFields.length > 0 || localizedContainers.length > 0
  const hasI18nValue = (v: unknown) =>
    !(v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0))
  // Only fields with actual default-locale content are translatable —
  // an empty English field has nothing to translate and never counts.
  const translatableFields = useMemo(
    () => localizedFields.filter((f: any) => hasI18nValue(fieldValues[f.name])),
    [localizedFields, fieldValues],
  )

  // Seed the working-locale toggle from the ambient selector once
  useEffect(() => {
    if (localeSeeded.current || !localesInfo) return
    localeSeeded.current = true
    if (activeLocale) setWorkingLocales([activeLocale])
  }, [localesInfo, activeLocale])

  // Per-locale inline translation drafts + dirty tracking + save fan-out (R5).
  const {
    localeDrafts, dirtyLocales,
    setLocaleField, setLocaleContainerSubRef, setLocaleContainerPathRef, saveDirtyLocales,
  } = useLocaleDrafts({
    localesInfo, i18nLoaded, i18nMap, setI18nMap,
    localizedFields, localizedContainers, typeIsLocalizable,
    typeName: params.typeName, })

  // Identity-cached locale derivations - they feed memoized FieldControl props
  // (blockLocaleCtx), so rebuilding them per render would defeat the memo.
  const storeLocales = localeStore.enabled ? localeStore.locales : null
  const workingLocaleDefs: WorkingLocale[] = useMemo(
    () => (storeLocales ?? []).filter((l) => workingLocales.includes(l.code) && l.code !== localeStore.defaultLocale),
    [storeLocales, workingLocales, localeStore.defaultLocale],
  )
  const visibleWorkingDefs = useMemo(
    () => workingLocaleDefs.filter((l) => !hiddenLocales.has(l.code)),
    [workingLocaleDefs, hiddenLocales],
  )
  const localeCodes = useMemo(() => (storeLocales ?? []).map((l) => l.code), [storeLocales])
  const localeColors: Record<string, LocaleColor> = useMemo(
    () => Object.fromEntries(localeCodes.map((c) => [c, localeColor(c, localeCodes)])),
    [localeCodes],
  )
  const hideDefault = localesInfo ? hiddenLocales.has(localesInfo.defaultLocale) : false

  // BL-4 ctx per container field, identity-cached so memoized FieldControls
  // only re-render when the working-locale set or a translation draft changes
  // (localeDrafts IS a dep: overlay edits must reach the open block inputs),
  // not on every keystroke in an unrelated field.
  const blockLocaleCtxByField = useMemo(() => {
    const map: Record<string, BlockLocaleCtx> = {}
    if (visibleWorkingDefs.length === 0 || viewingLive || previewingVersion) return map
    const locales = visibleWorkingDefs.map((l) => ({
      code: l.code,
      label: l.label,
      railClass: localeColors[l.code]?.rail ?? 'border-border',
      badgeClass: localeColors[l.code]?.badge ?? 'bg-surface-hover text-fg-muted',
    }))
    for (const name of localizedContainers) {
      map[name] = {
        locales,
        getOverlay: (code) => (localeDrafts[code]?.[name] ?? {}) as Record<string, Record<string, unknown>>,
        setSub: (code, rowKey, sub, v) => setLocaleContainerSubRef.current(code, name, rowKey, sub, v),
        // Nested block editors scope this ctx per slot (nestedLocaleCtx) and
        // write through the path setter, so kit text inside a section lands
        // at `overlay[section][children][block][sub]` - the shape the
        // server validates and Studio's canvas reads.
        setPath: (code, path, v) => setLocaleContainerPathRef.current(code, name, path, v),
      } satisfies BlockLocaleCtx
    }
    return map
  }, [visibleWorkingDefs, localeColors, localizedContainers, localeDrafts, viewingLive, previewingVersion])

  useEffect(() => {
    if (!accessToken) return
    // Load current type + all types in parallel (all types used to detect taxonomy picker fields)
    Promise.all([
      adminFetch<{ data: TypeDef }>(`/types/${params.typeName}`),
      cachedAdminGet<{ data: AllTypeDef[] }>('/types'),
    ]).then(([typeRes, allRes]) => {
      // Soft-disabled fields are hidden from the editor entirely (kept in schema/data).
      setTypeDef({ ...typeRes.data, fields: activeFields(typeRes.data.fields ?? []) })
      setAllTypeDefs(new Map((allRes.data ?? []).map(t => [t.name, t])))
      if (isNew) {
        // A singleton IS its type — start it titled after the schema label
        // so "Home" opens ready to fill, not as an "Untitled" draft.
        if ((typeRes.data as { singleton?: boolean }).singleton) setTitle(typeRes.data.label ?? params.typeName ?? '')
        const defaults: Record<string, unknown> = {}
        const me = useAuthStore.getState().member
        for (const f of typeRes.data.fields) {
          const d = f.config.default
          if (d === undefined) continue
          // Dynamic defaults resolve visibly in the form (the server resolves again on create)
          const v = isDynamicDefault(d) ? resolveDynamicDefault(d.$dynamic, { actorId: me?.memberId ?? null }) : d
          if (v !== null && v !== undefined) defaults[f.name] = v
        }
        if (Object.keys(defaults).length > 0) setFieldValues(defaults)
      }
    }).catch(() => {})
  }, [accessToken, params.typeName, isNew])

  // Fetch app-defined center-stage panels installed in this workspace
  useEffect(() => {
    if (!accessToken) return
    // Cached: the panel LIST depends only on (workspace, type) - the editor
    // is not remounted per object, so every object switch re-ran this
    // identical request. Per-object panel DATA below still fetches fresh.
    cachedWorkspaceGet<{ data: Array<{ id: string; extensionId: string; label: string; renderMode?: string; placement?: string; buttonLabel?: string; ai?: { enabled?: boolean; instructions?: string; fields?: { name: string; label: string; fieldType: string; config?: Record<string, unknown> }[] } }> }>(
      `/admin/workspaces/${params.workspaceId}/sidebar-panels?type=${params.typeName}`,
    )
      .then((r) => {
        const panels = r.data
          .filter((p) => panelRegistryKey(p.extensionId, p.id) in panelRegistry)
          .map((p) => ({
            id: p.id,
            extensionId: p.extensionId,
            label: p.label,
            renderMode: (p.renderMode === 'modal' ? 'modal' : 'inline') as 'inline' | 'modal',
            placement: (p.placement === 'sidebar' ? 'sidebar' : 'main') as 'main' | 'sidebar',
            buttonLabel: p.buttonLabel ?? 'Open',
            ai: p.ai,
          }))
        setAppPanels(panels)
        // Panel DATA comes with the main object GET (extensionData +
        // publishedExtensionData) - this effect only resolves which panels
        // exist for the type, so it no longer depends on the object id.
      })
      .catch(() => {})
  }, [accessToken, params.workspaceId, params.typeName])

  // Seed collapsedFields with any group that declares collapsedByDefault: true.
  // Runs once per type definition load so user toggles are not reset.
  useEffect(() => {
    if (!typeDef) return
    const defaults = typeDef.fields
      .filter(f => f.fieldType === 'group' && f.config.collapsedByDefault)
      .map(f => f.name)
    if (defaults.length > 0) {
      setCollapsedFields(prev => {
        const next = new Set(prev)
        for (const name of defaults) next.add(name)
        return next
      })
    }
  }, [typeDef])

  function setField(name: string, value: unknown) {
    editor.setField(name, value)
  }

  // ── Identity-stable per-field props for the memoized FieldControl ──────────
  // Latest setField without effects (assigning during render keeps it fresh);
  // the cached per-field onChange closures read through it so their identity
  // never has to change - a fresh closure per render would re-render every
  // control on every keystroke.
  const setFieldRef = useRef(setField)
  setFieldRef.current = setField
  const fieldOnChangeCache = useRef<Record<string, (v: unknown) => void>>({})
  const onChangeFor = (name: string) =>
    (fieldOnChangeCache.current[name] ??= (v: unknown) => setFieldRef.current(name, v))

  // Same ref pattern for reads: getSourceValue closures resolve title/field
  // values at CALL time, so a cached closure never returns stale data.
  const entryValuesRef = useRef<{ title: string; fieldValues: Record<string, unknown> }>({ title: '', fieldValues: {} })
  entryValuesRef.current = { title, fieldValues }
  const readEntryValue = useCallback((n: string) => {
    const cur = entryValuesRef.current
    return n === 'title' ? cur.title : cur.fieldValues[n]
  }, [])
  // getSourceValue also feeds RENDER-time reads (slug Generate source, section
  // visibility), so its identity is tied to the values that field can read:
  // unchanged values reuse the cached closure, a change mints a new one so the
  // memoized control re-renders and re-reads.
  const sourceValueFnCache = useRef<Record<string, { deps: unknown[]; fn: (n: string) => unknown }>>({})
  function sourceValueFnFor(fieldName: string, deps: unknown[]): (n: string) => unknown {
    const hit = sourceValueFnCache.current[fieldName]
    if (hit && hit.deps.length === deps.length && hit.deps.every((d, i) => d === deps[i])) return hit.fn
    const fn = (n: string) => readEntryValue(n)
    sourceValueFnCache.current[fieldName] = { deps, fn }
    return fn
  }

  // TaxonomyPicker configs embed the sibling primary value, so they're rebuilt
  // only when that value (or the schema derivation) changes - see FieldRenderer.
  const taxonomyCfgCache = useRef<Record<string, { deps: unknown[]; cfg: TaxonomyPickerConfig }>>({})

  // Applies an accepted AI generation preview and saves the draft immediately
  // (autosave skips new objects, so the post-apply effect below covers creation too)
  function handleAIApply(patch: ApplyPatch) {
    if (patch.title) handleTitleChange(patch.title)
    for (const [k, v] of Object.entries(patch.values)) setField(k, v)
    setAiApplySeq((n) => n + 1)
  }

  // AI panel apply → merge into extension panel data (same path as manual panel edits)
  function handleAIApplyPanel(extensionId: string, values: Record<string, unknown>) {
    const current = pendingPanelDataRef.current[extensionId] ?? panelDataMap[extensionId] ?? {}
    pendingPanelDataRef.current[extensionId] = { ...current, ...values }
    setPanelDataMap((prev) => ({ ...prev, [extensionId]: { ...(prev[extensionId] ?? {}), ...values } }))
    setHasPendingPanelChanges(true)
    setPanelDataSeq((n) => n + 1)
    setPanelRemountSeq((n) => n + 1) // remount panels so they re-init from the new data
    setAiApplySeq((n) => n + 1)
  }

  // After any AI apply, persist: create the draft for new objects, save otherwise.
  useEffect(() => {
    if (aiApplySeq === 0) return
    if (isNew) {
      if (!title.trim()) {
        // Nothing is saved yet - applied values (incl. generated images) live
        // only in this form until the draft exists. Silent loss on reload was
        // a real field report; say it out loud.
        toast.warning('Applied to the form only - add a title and click Create Draft to save it')
        return
      }
      handleCreateDraft()
    } else {
      doSave(false, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiApplySeq])

  // Per-field ✨ — opens the AI Assistant with this field tagged
  function openAssistantForField(field: { name: string; label: string; fieldType: string }) {
    setAiTag({ kind: 'field', name: field.name, label: field.label, fieldType: field.fieldType })
    setShowAIGenerate(true)
  }

  // Extension panels: one AI icon per panel opens the assistant tagged with the
  // panel's declared field schema (manifest sidebarPanels[].ai.fields)
  function openAssistantForPanel(panel: { id: string; extensionId: string; label: string; ai?: { enabled?: boolean; instructions?: string; fields?: any[] } }) {
    if (panel.ai?.enabled !== true || !panel.ai.fields?.length) return
    setAiTag({
      kind: 'panel', extensionId: panel.extensionId, panelId: panel.id, label: panel.label,
      instructions: panel.ai.instructions, fields: panel.ai.fields,
    })
    setShowAIGenerate(true)
  }

  // Realtime field presence: who else is editing this field, on its label.
  // Each label selects its own editors, so only the touched label re-renders.
  function presenceFor(name: string) {
    if (isNew || !object) return null
    return <FieldPresence objectId={params.id as string} field={name} currentMemberId={currentMember?.memberId ?? null} />
  }

  function aiFill(field: FieldDefinition) {
    if (!aiEnabled || !canWrite || !canUseAI) return null
    const cfg = field.config as Record<string, any> | undefined
    if (cfg?.ai?.enabled === false) return null
    if (cfg?.admin?.readonly) return null
    // media fields draw instead of write — need an image-capable provider AND
    // a field that actually accepts images (a pdf/video field never gets a ✨,
    // even if the schema says ai.enabled: true)
    if (field.fieldType === 'media') {
      if (!aiImageEnabled) return null
      const mimes = cfg?.mimeTypes as string[] | undefined
      if (Array.isArray(mimes) && mimes.length > 0 && !mimes.some(m => String(m).toLowerCase().startsWith('image/'))) return null
    } else if (!AI_FILLABLE_TYPES.has(field.fieldType)) return null
    return <AIFillButton label={field.label} onOpen={() => openAssistantForField(field)} />
  }

  function handleTitleChange(value: string) {
    setTitle(value)
    if (validationErrors.__title) setValidationErrors((e) => { const n = { ...e }; delete n.__title; return n })
    if (isNew && !slugDirty.current) setSlug(slugify(value))
  }

  const {
    slugEditing, slugDraft, setSlugDraft, slugStatus, setSlugStatus,
    handleSlugChange, checkSlugAvailability, openSlugEdit, commitSlugEdit, cancelSlugEdit,
  } = useSlugEditing({
    slug, setSlug, title, isNew, objectId: object?.id as string | undefined,
    typeName: params.typeName, slugDirty,
  })

  function viewLive() {
    if (!object?.published_values || !typeDef) return
    let snap = object.published_values as Record<string, unknown>
    if (typeof snap === 'string') {
      try { snap = JSON.parse(snap) } catch { return }
    }
    liveDataRef.current = { ...trueDraftRef.current }
    setTitle((snap.title as string) ?? '')
    setSlug((snap.slug as string) ?? '')
    setFieldValues(extractFieldValues(snap, typeDef.fields))
    setRichTextKey(k => k + 1)
    setValidationErrors({})
    setViewingLive(true)
  }

  function exitLiveView() {
    if (liveDataRef.current) {
      setTitle(liveDataRef.current.title)
      setSlug(liveDataRef.current.slug)
      setFieldValues(liveDataRef.current.fieldValues)
      liveDataRef.current = null
    }
    setRichTextKey(k => k + 1)
    setViewingLive(false)
  }

  /** Live non-blocking warning for a field (amber; red errors take precedence). */
  const fieldWarning = useCallback((field: { name: string; label: string; config?: Record<string, unknown> }): string | null => {
    const rules = (field.config?.validation as { warnings?: FieldWarningRules } | undefined)?.warnings
    if (!rules) return null
    return evalFieldWarning(rules, field.label, fieldValues[field.name])
  }, [fieldValues])

  /** After a local write, the actor is me — update bylines without a refetch. */
  const markMeAs = useCallback((...keys: Array<'updated_by' | 'published_by'>) => {
    const me = useAuthStore.getState().member
    if (!me?.memberId) return
    const mine: AuditActor = { id: me.memberId, label: me.email, kind: 'member' }
    setAudit((a) => {
      const next: AuditInfo = {
        created_by: a?.created_by ?? null,
        updated_by: a?.updated_by ?? null,
        published_by: a?.published_by ?? null,
      }
      for (const k of keys) next[k] = mine
      return next
    })
  }, [])

  const doSave = useCallback(async (isAuto = false, silent = false, successLabel = 'Draft saved'): Promise<ObjectData | null> => {
    if (!title.trim()) return null
    setSaveStatus(isAuto ? 'autosaving' : 'saving')
    try {
      // Translate-only roles: base PATCH would 403 — persist locale drafts only
      if (baseLocked) {
        if (dirtyLocales.size > 0) await saveDirtyLocales(params.id as string)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
        if (!isAuto && !silent) toast.success('Translations saved')
        return object
      }

      // What the PATCH carries - the untouched slug omitted, panel data under
      // its prefix, noRevision for autosave, If-Match for optimistic
      // concurrency (Phase 6B, Unit 6: a colleague's newer edit is never
      // silently overwritten; the server answers STALE_OBJECT and the catch
      // below tells the editor to reload rather than retrying) - is the pure
      // buildSaveRequest, tested in lib/__tests__/editor-model.test.ts.
      const req = buildSaveRequest({
        title, slug, slugDirty: slugDirty.current, fieldValues, fields: typeDef?.fields ?? [],
        pendingPanelData: pendingPanelDataRef.current, isAuto, etag: etagRef.current ?? null,
      })
      saveIssuedAtRef.current = Date.now()
      const res = await adminFetch<{ data: ObjectData }>(`/objects/${params.typeName}/${params.id}`, {
        method: 'PATCH', body: JSON.stringify(req.body),
        ...(Object.keys(req.headers).length ? { headers: req.headers } : {}),
      }, req.query)
      etagRef.current = etagOf(res) ?? etagRef.current
      const saved = normalizeObjectData(res.data as Record<string, unknown>) as unknown as ObjectData
      setObject(saved)
      markMeAs('updated_by')
      // The baseline is the values that were SENT, not the store's latest:
      // a keystroke during the request must still read as unsaved.
      lastSavedRef.current = snapshotOf(title, fieldValues)
      const savedPanelData = { ...pendingPanelDataRef.current }
      pendingPanelDataRef.current = {}
      setHasPendingPanelChanges(false)
      if (Object.keys(savedPanelData).length > 0) {
        setPanelDataMap((prev) => ({ ...prev, ...savedPanelData }))
      }
      // Inline translation drafts save with the object
      if (dirtyLocales.size > 0) {
        await saveDirtyLocales(params.id as string)
      }
      setSaveStatus('saved')
      autoSaveErroredRef.current = false   // recovered - re-arm the failure toast
      setTimeout(() => setSaveStatus('idle'), 2000)
      if (!isAuto && !silent) toast.success(successLabel)
      refreshVersionsRef.current()
      return res.data
    } catch (err) {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
      const failure = classifySaveFailure(err)
      if (failure.kind === 'field-errors') {
        setValidationErrors((prev) => ({ ...prev, ...failure.fieldErrors }))
        if (!isAuto) {
          const count = Object.keys(failure.fieldErrors).length
          toast.error(count === 1 ? 'Please fix 1 field error' : `Please fix ${count} field errors`)
          const firstKey = Object.keys(failure.fieldErrors)[0]
          document.querySelector(`[data-field="${firstKey}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        return null
      }
      // Someone else saved this object while this editor held it (Phase 6B,
      // Unit 6). Never retry without the token - that is the overwrite the
      // conditional save exists to prevent. Say so, and stop autosaving until
      // the editor reloads.
      if (failure.kind === 'stale') {
        autoSaveErroredRef.current = true
        // The banner is the state; the toast is only the moment it happened.
        setConflict(true)
        toast.error(
          'This entry changed elsewhere',
          'Someone else saved it while you were editing. Your changes are still here - reload to see their version, then reapply.',
        )
        return null
      }
      if (failure.kind === 'slug-taken') {
        setSlugStatus('taken')
        openSlugEdit()
        toast.error('Slug already in use', 'Choose a different slug and try again')
      } else if (!isAuto) {
        toast.error('Save failed', failure.message || undefined)
      } else if (!autoSaveErroredRef.current) {
        // Autosave failed on the server - surface it ONCE (deduped) so a broken
        // save (e.g. a 500) isn't silently swallowed. Re-arms after a save works.
        autoSaveErroredRef.current = true
        toast.error('Autosave failed', failure.message || 'Your recent changes were not saved.')
      }
      return null
    }
  }, [title, slug, fieldValues, params, dirtyLocales, localeDrafts, baseLocked, object])

  // Auto-save: debounce after any content or panel data change (existing objects only)
  useEffect(() => {
    // The rules (new object, no object, empty title, live view, version
    // preview, a standing conflict, no baseline yet, nothing changed) are the
    // model's decision table, tested without a page.
    const decision = editor.autosaveDecision({
      isNew, hasObject: !!object, viewingLive, previewingVersion: !!previewingVersion,
      hasPendingPanelData: Object.keys(pendingPanelDataRef.current).length > 0,
      dirtyLocaleCount: dirtyLocales.size,
      locked: editLocked,
    })
    if (!decision.fire) return

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    setSaveStatus('pending')
    autoSaveTimer.current = setTimeout(() => { doSave(true) }, 3_000)
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
  }, [title, fieldValues, panelDataSeq, isNew, object, doSave, viewingLive, previewingVersion, localeDrafts, dirtyLocales, conflict, editLocked])

  // Publish lifecycle: create/publish/schedule/unpublish/archive + the publish
  // split-button menu state and the required-relation cascade dialog (R6).
  const {
    showSchedule, setShowSchedule, scheduleAt, setScheduleAt,
    showPublishDropdown, setShowPublishDropdown, confirmArchive, setConfirmArchive,
    cascadeDialog, setCascadeDialog, publishDropdownRef,
    handleCreateDraft, handlePublish, handleSchedule, handleUnschedule, handleUnpublish,
    executeArchive, resetLifecycleState,
  } = useObjectLifecycle<ObjectData>({
    isNew,
    typeName: params.typeName,
    workspaceId: params.workspaceId,
    navigate,
    object, setObject,
    fields: typeDef?.fields ?? null,
    title, slug, fieldValues,
    dirtyLocales, saveDirtyLocales, doSave,
    setSaveStatus, setValidationErrors, markMeAs, refreshVersions,
    lastSavedRef, createdHandoffRef, extractedForObjectId,
    pendingPanelDataRef, panelDataMap, setPublishedPanelDataMap, setHasPendingPanelChanges,
    setSlugStatus, openSlugEdit,
  })

  // Per-object reset fan-out for the load effect (R8). The editor is no longer
  // remounted per object (router key removed), so every per-object piece of
  // page/hook state must clear on an in-place switch or it leaks across.
  // Assigned every render so the load effect always calls the current resets.
  resetPerObjectStateRef.current = () => {
    setValidationErrors({})
    setViewingLive(false)
    // Version-history state (list, preview, diff, restore target) - R3 hook
    resetVersionState()
    // Publish-lifecycle state (schedule panel, cascade dialog, menus) - R6 hook
    resetLifecycleState()
    setOpenModalPanel(null)
    setCollapsedFields(new Set())
    slugDirty.current = false
    liveDataRef.current = null
    setRichTextKey((k) => k + 1)   // force rich-text editors to re-init with the new content
  }

  // Detect if this field is the self-referential parent field for a hierarchical taxonomy
  const taxonomyParentFieldName = useMemo(() => {
    if (!typeDef?.admin?.taxonomy?.hierarchical || !typeDef.fields) return null
    return typeDef.fields.find(
      f => f.fieldType === 'relation'
        && f.config?.targetType === params.typeName
        && !f.config?.many,
    )?.name ?? null
  }, [typeDef, params.typeName])

  // Set of field names that are managed inside a TaxonomyPicker — should not render standalone.
  // A many:false relation to a taxonomy type is "managed" when a sibling many:true relation to
  // the same type exists (i.e. it acts as the primary field controlled by the ◎ toggle).
  const managedTaxonomyPrimaryFields = useMemo((): Set<string> => {
    const managed = new Set<string>()
    if (!typeDef?.fields) return managed
    for (const f of typeDef.fields) {
      if (f.fieldType !== 'relation' || f.config?.many || !f.config?.targetType) continue
      const targetAdmin = allTypeDefs.get(f.config.targetType)?.admin
      if (!targetAdmin?.taxonomy) continue
      const hasManyCounterpart = typeDef.fields.some(
        s => s.name !== f.name
          && s.fieldType === 'relation'
          && s.config?.targetType === f.config?.targetType
          && s.config?.many,
      )
      if (hasManyCounterpart) managed.add(f.name)
    }
    return managed
  }, [typeDef, allTypeDefs])

  // Shared props for <FieldRenderer> (R7) - a fresh object per render, exactly
  // like the old inline closure. The identity-stable values FieldControl's memo
  // depends on (onChangeFor cache, sourceValueFnFor cache, taxonomyCfgCache,
  // blockLocaleCtxByField) pass through by reference - never rebuilt here.
  const fieldRendererShared = {
    fieldValues, validationErrors,
    workspaceId: params.workspaceId, typeName: params.typeName,
    currentObjectId: isNew ? null : params.id,
    richTextKey, relationReloadNonce,
    taxonomyParentFieldName, allTypeDefs, typeFields: typeDef?.fields,
    taxonomyCfgCache, onChangeFor, sourceValueFnFor, readEntryValue,
    blockLocaleCtxByField, hideDefault, visibleWorkingDefs, viewingLive, previewingVersion,
    localesInfo, toggleHiddenLocale, setLocalizeAssetId,
    localeColors, localeDrafts, setLocaleField, canWriteLoc,
  }

  // Field-level access: fold role rules into hidden/readonly so every
  // downstream consumer (render loops, FieldControl) behaves without changes
  const patchFieldAccess = useCallback(<F extends { config?: any }>(f: F): F => {
    // Members without object-write see every field read-only;
    // locale-scoped roles get base fields read-only (translate-only mode)
    if (!canWrite || baseLocked) {
      return {
        ...f,
        config: { ...f.config, admin: { ...f.config?.admin, readonly: true } },
      }
    }
    const access = f.config?.admin?.access as { read?: string[]; write?: string[] } | undefined
    if (!access) return f
    const meBundle = me
    const isAdminSession = meBundle?.capabilities === 'all'
    const role = meBundle?.effectiveRole
    if (isAdminSession || !role) return f
    const readDenied = (access.read?.length ?? 0) > 0 && !access.read!.includes(role)
    const writeDenied = readDenied || ((access.write?.length ?? 0) > 0 && !access.write!.includes(role))
    if (!readDenied && !writeDenied) return f
    return {
      ...f,
      config: {
        ...f.config,
        admin: {
          ...f.config?.admin,
          hidden: f.config?.admin?.hidden || readDenied,
          readonly: f.config?.admin?.readonly || writeDenied,
        },
      },
    }
  }, [me, canWrite, baseLocked])

  // Group sub-fields patched once per access-rule change and reused by index -
  // patching inline in the render loop would hand the memoized FieldControl a
  // new field object every render.
  const patchedGroupSubFields = useMemo(() => {
    const map = new Map<string, FieldDefinition[]>()
    for (const f of typeDef?.fields ?? []) {
      if (f.fieldType === 'group') map.set(f.name, (f.config.groupFields ?? []).map(sf => patchFieldAccess(sf) as FieldDefinition))
    }
    return map
  }, [typeDef, patchFieldAccess])

  const sidebarFieldNames = useMemo(
    () => new Set(typeDef?.admin?.editorView?.sidebar ?? []),
    [typeDef],
  )
  const mainFields = useMemo(() => {
    if (!typeDef) return []
    const mainNames = typeDef.admin?.editorView?.main
    if (mainNames) {
      const mainNameSet = new Set(mainNames)
      const explicit = mainNames
        .map(n => typeDef.fields.find(f => f.name === n))
        .filter((f): f is FieldDefinition => f != null)
      // Any field not in main or sidebar falls through to the bottom
      const unlisted = typeDef.fields.filter(f => !mainNameSet.has(f.name) && !sidebarFieldNames.has(f.name))
      return [...explicit, ...unlisted].map(patchFieldAccess)
    }
    return typeDef.fields.filter(f => !sidebarFieldNames.has(f.name)).map(patchFieldAccess)
  }, [typeDef, sidebarFieldNames, patchFieldAccess])
  const sidebarFields = useMemo(() => {
    if (!typeDef) return []
    return (typeDef.admin?.editorView?.sidebar ?? [])
      .map(n => typeDef.fields.find(f => f.name === n))
      .filter((f): f is FieldDefinition => f != null)
      .map(patchFieldAccess)
  }, [typeDef, patchFieldAccess])

  // Names of fields that live inside a group — skipped in the main/sidebar loop
  // because they are rendered by the group's own accordion.
  const groupedFieldNames = useMemo(() => {
    if (!typeDef) return new Set<string>()
    return new Set(
      typeDef.fields
        .filter(f => f.fieldType === 'group')
        .flatMap(f => (f.config.groupFields ?? []).map(sf => sf.name))
    )
  }, [typeDef])

  // Keep trueDraftRef current on every render so async handlers never capture stale closures.
  if (!previewingVersion && !viewingLive) {
    trueDraftRef.current = { title, slug, fieldValues }
  }

  // Version history derived state
  const currentVersionType = versions[0]?.versionType ?? null
  const isCurrentLive = currentVersionType === 'published'
  const liveRevisionId = !isCurrentLive && object?.status === 'published'
    ? versions.find(v => v.versionType === 'published')?.id
    : undefined
  // Stable id — computed before the outer ternary so narrowing doesn't collapse the type
  const previewingVersionId = previewingVersion?.id ?? null

  // Creating requires write permission — direct /new URLs get the lock page
  if (isNew && canReady && !canWrite) {
    return <NoPermission note="Your role cannot create content of this type." />
  }

  // Only hard-block on the FIRST load, before the type definition exists. Once a
  // type is loaded it persists across object switches, so an in-place switch
  // (loading === true, typeDef present) falls through to the main render below —
  // the editor panel shows a field skeleton while the iframe stays mounted.
  if (!typeDef) {
    return (
      <div className="flex h-full animate-pulse">
        <div className="flex-1 min-w-0 px-8 py-8 space-y-6">
          <div className="h-9 w-3/4 bg-surface-hover rounded-lg" />
          <div className="h-4 w-32 bg-surface-hover rounded" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-4 w-24 bg-surface-hover rounded" />
              <div className="h-10 w-full bg-surface-hover rounded-lg" />
            </div>
          ))}
          <div className="space-y-1.5">
            <div className="h-4 w-28 bg-surface-hover rounded" />
            <div className="h-32 w-full bg-surface-hover rounded-lg" />
          </div>
        </div>
        <div className="w-72 shrink-0 border-l border-border bg-surface p-5 space-y-4">
          <div className="h-9 w-full bg-surface-hover rounded-lg" />
          <div className="h-9 w-full bg-surface-hover rounded-lg" />
          <div className="mt-4 space-y-2">
            <div className="h-3 w-20 bg-surface-hover rounded" />
            <div className="h-4 w-36 bg-surface-hover rounded" />
          </div>
        </div>
      </div>
    )
  }

  const label = typeDef.label
  const status = object?.status ?? 'draft'
  // Snapshot stringify cached on state identity - recomputed once per edit,
  // not once per render.
  if (dirtySnapRef.current.title !== title || dirtySnapRef.current.fv !== fieldValues) {
    dirtySnapRef.current = { title, fv: fieldValues, str: JSON.stringify({ title, fieldValues }) }
  }
  const hasChanges = !viewingLive && !isNew && object !== null &&
    (dirtySnapRef.current.str !== lastSavedRef.current || hasPendingPanelChanges)

  // True when a published item has unsaved edits OR saved edits not yet reflected in publishedValues.
  // Identity-cached: typing only flips it via hasChanges; the expensive panel
  // and per-field comparisons rerun only when their inputs actually change.
  const draftKey = [status, viewingLive, isNew, hasChanges, panelDataMap, publishedPanelDataMap, object, typeDef, i18nMap]
  if (draftCalcRef.current.key.length !== draftKey.length || draftCalcRef.current.key.some((v, i) => v !== draftKey[i])) {
    draftCalcRef.current = {
      key: draftKey,
      val: status === 'published' && !viewingLive && !isNew && (() => {
        if (hasChanges) return true
        // Any panel whose draft differs from its published snapshot. The two
        // maps arrive in different shapes (stored {draft,published} vs a panel's
        // bare draft emit), so the compare normalizes both - see save-request.
        if (panelDataHasDraftChanges(panelDataMap, publishedPanelDataMap)) return true
        if (!object?.published_values) return true // no snapshot - assume draft diverged
        let pv = object.published_values as Record<string, unknown>
        if (typeof pv === 'string') { try { pv = JSON.parse(pv) } catch { return false } }
        if ((object.title ?? '') !== ((pv.title as string) ?? '')) return true
        // Compare like-for-like: the API coerces NUMERIC fields (price/rating) to
        // numbers while the published snapshot holds strings; relation/media fields
        // may arrive expanded (objects) while the snapshot holds ids. Normalize both
        // sides per field type, then compare canonically (key order agnostic) so an
        // unedited published entry never falsely reads as "draft changes".
        for (const f of typeDef.fields) {
          if (fieldValueChanged(f.fieldType, object[f.name], pv[f.name])) return true
        }
        // Saved translations count too: published sites serve the publish-
        // time snapshot (publishedValues.i18n), so edited translations are
        // draft until the next Publish.
        if (i18nDiverges(i18nMap, (pv as { i18n?: Record<string, Record<string, unknown>> }).i18n)) return true
        return false
      })(),
    }
  }
  const hasDraftChanges = draftCalcRef.current.val

  /**
   * The lifecycle context EVERY extension panel gets, defined once and spread
   * into both render paths. Center-stage and sidebar panels used to build
   * this separately by hand, so props added to one silently never reached the
   * other - which is how the review rail went on showing a stale warning only
   * after a page reload.
   */
  const panelLifecycleProps = {
    // C4: identity + lifecycle context for panels ('' / 'draft' on /new)
    objectId: isNew ? '' : (params.id as string),
    status,
    refresh: refreshObject,
    // Locale context so a panel can edit per-locale (e.g. SEO title/description).
    activeLocale: activeLocale ?? localesInfo?.defaultLocale ?? null,
    locales: localesInfo?.enabled ? localesInfo.locales : [],
    defaultLocale: localesInfo?.defaultLocale ?? null,
    // Changes on every successful save, so a panel whose server state depends
    // on the CONTENT (e.g. the review gate's stale-approval check) can
    // re-read instead of going quietly out of date until a page reload.
    savedAt: (object?.updatedAt as string | undefined) ?? null,
    /** Published object edited since it went out - nothing to re-review without it. */
    hasDraftChanges,
    /** When a scheduled publish is due, so a panel can show the deadline it
     *  has to be ready by (the review gate blocks the auto-publish). */
    scheduledAt: (object?.scheduled_at as string | null | undefined) ?? null,
    // Flush any pending edit before the panel acts. Autosave is debounced 3s,
    // so a panel action taken right after typing would otherwise operate on
    // content the server has not seen yet.
    save: async () => {
      if (saveStatus !== 'pending') return
      if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null }
      await doSave(true, true)
    },
  }
  const versioningEnabled = typeDef.admin?.versioning?.enabled !== false

  return (
    <div className="relative flex flex-col flex-1 min-h-0">

      {/* Autosave - a bottom-centered floating pill so it never shifts the top bar's layout. */}
      {previewOpen && savePulse && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-fg/85 text-white text-[11px] shadow-lg">
            {saveStatus === 'saved' ? <IconCheck className="size-3" /> : <IconLoader className="size-3 animate-spin" />}
            {saveStatus === 'saved' ? 'Saved' : 'Saving…'}
          </span>
        </div>
      )}

      {/* ── Single top bar spanning BOTH panes (editor + live preview) ── */}
      {previewOpen && (
        <div className="flex items-center gap-3 px-3 h-12 border-b border-border bg-surface shrink-0">
          {/* Zone 1 - exit + editor-pane controls */}
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={closePreview} title="Exit preview"
              className="flex items-center justify-center size-7 rounded-md text-fg-muted hover:bg-surface-hover">
              <IconX className="size-4" />
            </button>
            <button type="button" onClick={() => setEditorHidden((v) => !v)} title={editorHidden ? 'Show editor' : 'Hide editor (full preview)'} aria-pressed={editorHidden}
              className={clsx('grid size-7 place-items-center rounded-control transition-colors motion-fast', editorHidden ? 'bg-surface-selected text-fg' : 'text-fg-subtle hover:bg-surface-hover hover:text-fg')}>
              <IconLayoutLeft className="size-4" />
            </button>
            {!editorHidden && !previewNotEditable && (
              <div role="tablist" className="ml-1 flex items-center gap-0.5 rounded-control bg-surface-sunken p-0.5">
                <button type="button" role="tab" aria-selected={editorTab === 'content'} onClick={() => setEditorTab('content')}
                  className={clsx(editorTabPill, editorTab === 'content' ? 'bg-surface-raised text-fg shadow-raised' : 'text-fg-muted hover:text-fg')}>Content</button>
                <button type="button" role="tab" aria-selected={editorTab === 'settings'} onClick={() => setEditorTab('settings')}
                  className={clsx(editorTabPill, editorTab === 'settings' ? 'bg-surface-raised text-fg shadow-raised' : 'text-fg-muted hover:text-fg')}>Details</button>
              </div>
            )}
            {localesInfo?.enabled && typeIsLocalizable && !previewNotEditable && (
              <select
                value={activeLocale ?? localesInfo.defaultLocale}
                onChange={(e) => switchPreviewLocale((e.target as HTMLSelectElement).value)}
                title="Preview language (also opens it in the editor)"
                className="ml-1 text-xs rounded-md bg-transparent px-1.5 py-1 text-fg-muted hover:bg-surface-hover outline-none focus-visible:ring-[3px] focus-visible:ring-focus/25 cursor-pointer"
              >
                {localesInfo.locales.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            )}
          </div>

          {/* Open middle - lets the bar breathe; pushes tools + publish right */}
          <div className="flex-1" />

          {/* Zone 2 - viewport + frame tools: device · reload · open in new tab */}
          {previewSrc && previewCfg?.frontendUrl && (
            <div className="flex items-center gap-1 shrink-0">
              <PreviewBreakpoints bp={previewBp} />
              <span className="w-px h-5 bg-border mx-1" />
              <button type="button" title="Reload page" onClick={reloadPreview}
                className="grid place-items-center size-7 rounded-md text-fg-subtle hover:bg-surface-hover"><IconRefresh className="size-4" /></button>
              <a href={previewFullUrl ?? previewSrc} target="_blank" rel="noopener" title="Open in new tab"
                className="grid place-items-center size-7 rounded-md text-fg-subtle hover:bg-surface-hover"><IconExternalLink className="size-4" /></a>
            </div>
          )}

          {/* Zone 3 - doc status + publish (hidden when the page has no editable object) */}
          {!previewNotEditable && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="w-px h-5 bg-border" />
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-fg-muted whitespace-nowrap"
                title={`Status: ${status === 'published' ? 'Published' : status === 'scheduled' ? 'Scheduled' : status === 'archived' ? 'Archived' : 'Draft'}`}>
                <span className={clsx('size-1.5 rounded-full',
                  status === 'published' ? 'bg-success'
                  : status === 'scheduled' ? 'bg-blue-500'
                  : status === 'archived' ? 'bg-fg-faint'
                  : 'bg-warning')} />
                {status === 'published' ? 'Published' : status === 'scheduled' ? 'Scheduled' : status === 'archived' ? 'Archived' : 'Draft'}
              </span>
              {status === 'published' && hasDraftChanges && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-warning-fg whitespace-nowrap">
                  <span className="size-1.5 shrink-0 rounded-full bg-warning" />
                  Changes in draft
                </span>
              )}
              {canWrite && (baseLocked ? (
                <Button variant="primary" size="sm" onClick={() => doSave(false, false, 'Translations saved')}
                  disabled={saveStatus === 'saving' || saveStatus === 'autosaving'}>Save translations</Button>
              ) : !canPublish ? (
                <Button variant="primary" size="sm" onClick={() => doSave(false, false, 'Saved')}
                  disabled={!hasChanges || saveStatus === 'saving' || saveStatus === 'autosaving'}>Save changes</Button>
              ) : publishPolicy?.blocked ? (
                // An extension is between this type and publishing, so offer
                // the action that CAN succeed instead of one that would be
                // refused. The reason rides on the tooltip.
                <Button variant="primary" size="sm" onClick={() => doSave(false, false, 'Saved')}
                  title={publishPolicy.reason}
                  disabled={saveStatus === 'saving' || saveStatus === 'autosaving'}>
                  {publishPolicy.actionLabel || 'Save as draft'}
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={handlePublish}
                  disabled={saveStatus === 'autosaving'} isLoading={saveStatus === 'saving'} loadingText="Publishing…">
                  {status === 'published' ? 'Publish changes' : 'Publish'}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      <div ref={splitRef} className="flex flex-1 min-h-0">

      {/* Publish blocked - the required items it links to must be published first.
          We never auto-publish them: the user opens + publishes each, then retries. */}
      <Dialog open={!!cascadeDialog} onOpenChange={(o) => { if (!o) setCascadeDialog(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish these required items first</DialogTitle>
            <DialogDescription>
              This item links to required items that aren’t published yet. Open each, publish it
              (fix any missing fields first), then publish this item again.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto text-sm">
            {(() => {
              const nodes = [...(cascadeDialog?.plan.dependencies ?? []), ...(cascadeDialog?.plan.blockers ?? [])]
              const seen = new Set<string>()
              return nodes.filter((n) => { const k = `${n.typeName}:${n.id}`; if (seen.has(k)) return false; seen.add(k); return true })
            })().map((node) => (
              <a
                key={`${node.typeName}:${node.id}`}
                href={`/${params.workspaceId}/objects/${node.typeName}/${node.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 px-6 py-3 hover:bg-surface-sunken transition-colors"
              >
                <span className="min-w-0 truncate">
                  <span className="text-fg">{node.title}</span>
                  <span className="text-fg-muted"> · {node.typeLabel}</span>
                  {node.reason ? <span className="block text-xs text-danger-fg truncate">{node.reason}</span> : null}
                </span>
                <span className="text-xs text-fg-muted shrink-0">open ↗</span>
              </a>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCascadeDialog(null)} disabled={saveStatus === 'saving'}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => cascadeDialog?.retry()}
              isLoading={saveStatus === 'saving'}
              loadingText="Publishing…"
            >
              Try again
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore version confirm dialog */}
      <Dialog open={!!restoreTarget} onOpenChange={(o) => { if (!o) setRestoreTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore version {restoreTarget?.version ? `v${restoreTarget.version}` : ''}</DialogTitle>
            <DialogDescription>
              This will overwrite the current content with this older version. The current version will be saved as a new entry in history.
            </DialogDescription>
          </DialogHeader>
          {orphanFields.length > 0 && (
            <Callout variant="danger" title="Not recommended">
              <div className="space-y-2">
              <p className="text-xs">
                This version contains data from fields that have since been removed from your schema:{' '}
                <span className="font-mono font-semibold">{orphanFields.map(f => f.name).join(', ')}</span>.
              </p>
              <p className="text-xs">
                Restoring it may break your API responses or cause unexpected behaviour on your site.
                It is recommended to not restore this version.
              </p>
              </div>
            </Callout>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRestoreTarget(null)}>Cancel</Button>
            <Button
              variant={orphanFields.length > 0 ? 'destructive' : 'primary'}
              onClick={() => restoreTarget && executeRestore(restoreTarget.id)}
              isLoading={!!restoreTarget && restoringId === restoreTarget.id}
              loadingText="Restoring…"
            >
              {orphanFields.length > 0 ? 'Restore anyway' : 'Restore'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diff modal - compare previewed version against current version */}
      {showDiff && previewingVersion && (
        <ObjectVersionDiff
          versionNumber={previewingVersion.version}
          versionValues={fieldValues}
          draftValues={liveDataRef.current?.fieldValues ?? trueDraftRef.current.fieldValues}
          fields={typeDef?.fields ?? []}
          onClose={() => setShowDiff(false)}
        />
      )}

      {/* Archive confirm dialog */}
      <Dialog open={confirmArchive} onOpenChange={(o) => { if (!o) setConfirmArchive(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive this item?</DialogTitle>
            <DialogDescription>
              It will be hidden from content queries but can be restored at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmArchive(false)} disabled={saveStatus === 'saving'}>Cancel</Button>
            <Button variant="destructive" onClick={executeArchive} isLoading={saveStatus === 'saving'} loadingText="Archiving…">Archive</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Editor column - full width normally; 40% in preview focus mode ── */}
      <div
        className={clsx('flex flex-col min-h-0 bg-surface', !previewOpen && 'flex-1 min-w-0', previewOpen && editorHidden && 'hidden')}
        style={previewOpen && !editorHidden ? { flexBasis: `${editorPct}%`, flexGrow: 0, flexShrink: 0, minWidth: 340 } : undefined}
      >
        {/* Stage + settings row (both visible normally; tabbed in preview - the top bar is shared) */}
        {stacked && !previewNotEditable && (
          <div role="tablist" aria-label="Editor sections" className="flex shrink-0 items-center gap-0.5 border-b border-border-subtle bg-surface px-4 py-2">
            <div className="flex items-center gap-0.5 rounded-control bg-surface-sunken p-0.5">
              <button type="button" role="tab" aria-selected={editorTab === 'content'} onClick={() => setEditorTab('content')}
                className={clsx(editorTabPill, editorTab === 'content' ? 'bg-surface-raised text-fg shadow-raised' : 'text-fg-muted hover:text-fg')}>Content</button>
              <button type="button" role="tab" aria-selected={editorTab === 'settings'} onClick={() => setEditorTab('settings')}
                className={clsx(editorTabPill, editorTab === 'settings' ? 'bg-surface-raised text-fg shadow-raised' : 'text-fg-muted hover:text-fg')}>Details</button>
            </div>
          </div>
        )}
        <div
          className="flex flex-1 min-h-0"
          onFocusCapture={(e) => setFocusedField(fieldOfFocusTarget(e.target))}
          onBlurCapture={(e) => setFocusedField(fieldOfFocusTarget(e.relatedTarget))}
        >
      {/* Main editor - white card */}
      <div className={clsx('relative flex-1 bg-surface', previewNotEditable ? 'overflow-hidden flex items-center justify-center text-center px-8 py-8' : 'overflow-y-auto', (previewOpen || stacked) && editorTab !== 'content' && !previewNotEditable && 'hidden')}>
      {/* Realtime R2: another actor changed this object - say so, offer a reload, never block.
          Pinned to the top of the scroll area, above the form, so it is seen wherever the author is. */}
      {!isNew && !!object && (
        <ChangedElsewhereNotice
          objectId={params.id as string}
          enabled={!loading && !previewNotEditable}
          currentMemberId={currentMember?.memberId ?? null}
          lastSavedAt={(object?.updatedAt as string | undefined) ?? null}
          saveIssuedAt={saveIssuedAtRef.current}
          onReload={refreshObject}
          onStaleChange={setStaleElsewhere}
          follow={!!lockedBy && !takingOver && !hasChanges}
          onFollow={onFollow}
        />
      )}
      {/* The soft lock: someone else holds the editing claim - read-only here until taken over; the loser sees the same bar the other way round. */}
      {!isNew && !!object && lockedBy && !takingOver && (
        <EditorBar
          tone="info"
          testId="editing-lock"
          title={takenOver ? `${lockedBy.name} took over this entry` : `${lockedBy.name} is editing this entry`}
          detail={takenOver
            ? 'It is read-only here now. Your unsaved changes stay on this page - copy what you need, or take it back to keep editing.'
            : `It is read-only here until you take over; ${lockedBy.name}'s saves appear here as they happen${followedAt ? ` (last at ${new Date(followedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ''}. Taking over tells them, and their unsaved changes stay on their page.`}
          actions={<Button size="sm" variant={takenOver ? 'secondary' : 'primary'} onClick={takeOver} isLoading={takingOver}>{takenOver ? 'Take back' : 'Take over'}</Button>}
        />
      )}
      {/* A conflict is a condition, not a notification: it stays until the reader acts on it, and it says where their work is. */}
      {conflict && (
        <EditorBar
          tone="warning"
          testId="save-conflict"
          title="Someone else saved this entry while you were editing"
          detail="This copy is read-only until you reload. Your unsaved changes are still on this page - copy anything you need, then reload to see their version and reapply it."
          actions={<Button size="sm" variant="primary" onClick={() => window.location.reload()}>Reload</Button>}
        />
      )}
      <div className={clsx(!previewNotEditable && 'mx-auto w-full max-w-[840px] px-5 py-6 sm:px-8 sm:py-8')}>
      {/* In-place object switch: cover the (briefly empty) form with a skeleton
          while the new object loads, so the left panel reads as a smooth swap. */}
      {loading && (
        <div className="absolute inset-0 z-10 bg-surface motion-safe:animate-pulse overflow-hidden">
          <div className="mx-auto w-full max-w-[840px] space-y-6 px-5 py-6 sm:px-8 sm:py-8">
          <div className="h-8 w-3/4 rounded-control bg-surface-hover" />
          <div className="h-3.5 w-28 rounded-sm bg-surface-hover" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3.5 w-24 rounded-sm bg-surface-hover" />
              <div className="h-8 w-full rounded-control bg-surface-hover" />
            </div>
          ))}
          </div>
        </div>
      )}
      {/* The preview navigated to a page with no editable content object - show
          the message INSTEAD of the (hidden) editor fields, so there is nothing
          to scroll to behind it. */}
      {previewNotEditable && (
        <div className="max-w-xs">
          <p className="text-sm font-medium text-fg">This page is not editable</p>
          <p className="text-xs text-fg-subtle mt-2 leading-relaxed">
            <code className="font-mono text-fg-muted break-all">{previewNotEditable.path || 'This page'}</code> is not controlled by a content object, so there is nothing to edit here.
          </p>
        </div>
      )}
      {/* Locked: the form fades and goes inert under the bar - legible, plainly not editable, no scrim over the words. */}
      <div className={clsx((viewingLive || previewingVersion || editLocked) && 'pointer-events-none select-none', editLocked && 'opacity-55 transition-opacity motion-fast', previewNotEditable && 'hidden')}>

        {/* Title */}
        <div className="mb-6" data-field="__title">
          {/* div, not <label> - a label with no htmlFor activates the AI button. */}
          <div className={fieldLabel}>
            Title <span className="text-danger">*</span>
            {presenceFor('title')}
            {aiEnabled && aiTitleEnabled && canWrite && canUseAI && !viewingLive && !previewingVersion && (
              <AIFillButton label="Title" onOpen={() => openAssistantForField({ name: '__title', label: 'Title', fieldType: 'text' })} />
            )}
          </div>
          {hideDefault && visibleWorkingDefs.length > 0 && !viewingLive && !previewingVersion ? (
            <button
              type="button"
              onClick={() => localesInfo && toggleHiddenLocale(localesInfo.defaultLocale)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-control border border-dashed border-border bg-surface-sunken px-3 py-2 text-ui-xs text-fg-subtle transition-colors motion-fast hover:border-border-strong hover:text-fg-muted"
              title="Show the default-locale title"
            >
              <IconEye className="size-3.5" />
              {localesInfo?.locales.find(l => l.code === localesInfo.defaultLocale)?.label ?? 'Default'} hidden
            </button>
          ) : (
          <input
            type="text"
            placeholder={`Untitled ${label}`}
            value={title}
            readOnly={!!previewingVersion || viewingLive || editLocked}
            onChange={(e) => handleTitleChange((e.target as HTMLInputElement).value)}
            aria-invalid={validationErrors.__title ? true : undefined}
            className={clsx(
              // The document's title reads as a title (spec §19): display size, no box.
              'block w-full appearance-none border-0 bg-transparent px-0 py-1 text-display text-fg placeholder:text-fg-faint outline-none',
              'border-b border-transparent focus-visible:border-focus-border transition-colors motion-fast',
              validationErrors.__title && 'border-danger',
              (previewingVersion || viewingLive || editLocked) && 'cursor-default text-fg-muted',
            )}
          />
          )}
          {validationErrors.__title && (
            <p className="mt-1 text-ui-xs text-danger-fg">{validationErrors.__title}</p>
          )}
          {!viewingLive && !previewingVersion && visibleWorkingDefs.length > 0 && (
            <div className="mt-3 space-y-3">
              {visibleWorkingDefs.map((l) => (
                <div key={l.code} className={clsx('border-l-2 pl-3', localeColors[l.code]?.rail)}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-ui-xs font-medium text-fg-muted">Title</span>
                    <LocaleBadge locale={l} color={localeColors[l.code]} />
                  </div>
                  <input
                    type="text"
                    value={(localeDrafts[l.code]?.title as string) ?? ''}
                    placeholder={title || 'Untitled'}
                    onChange={(e) => setLocaleField(l.code, 'title', (e.target as HTMLInputElement).value)}
                    className={fieldInput}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {typeDef && (
          <>
          <AIAssistantPanel
            open={showAIGenerate}
            onClose={() => { setShowAIGenerate(false); setAiTag(null) }}
            workspaceId={params.workspaceId as string}
            typeName={params.typeName as string}
            objectId={isNew ? null : (params.id as string)}
            fields={typeDef.fields as any}
            title={title}
            values={fieldValues}
            tagField={aiTag}
            onApply={handleAIApply}
            onApplyField={(name, v) => {
              if (name === '__title') handleTitleChange(String(v))
              else setField(name, v)
              setAiApplySeq((n) => n + 1)
            }}
            onApplyPanel={handleAIApplyPanel}
            prefill={aiPrefill}
          />
          </>
        )}

        {/* Asset-level localization for media fields */}
        <LocalizeAssetModal
          assetId={localizeAssetId}
          open={localizeAssetId !== null}
          onOpenChange={(o) => { if (!o) setLocalizeAssetId(null) }}
        />

        {/* Primary actions - portaled into the secondary header bar */}
        {pageActionsSlot && !viewingLive && !previewingVersion && !previewOpen && canWrite && createPortal(
          <div className="flex items-center gap-2" ref={publishDropdownRef}>
            {/* A long document gets a jump list (spec §19): fields that need
                attention first, then every field, each scrolling and focusing. */}
            {mainFields.length > JUMP_MENU_THRESHOLD && (
              <FieldJumpMenu targets={mainFields
                .filter((f) => !f.config?.admin?.hidden)
                .map((f) => ({ name: f.name, label: f.label, required: !!f.required, error: !!validationErrors[f.name] }))} />
            )}
            {/* Realtime R3: who else is here, in the crumb row - avatars, a word, the take-over. */}
            {!isNew && !!object && (
              <EditingPresence
                objectId={params.id as string}
                enabled={!loading && !previewNotEditable}
                currentMemberId={currentMember?.memberId ?? null}
                editing={hasChanges && !editLocked}
                field={editLocked ? null : focusedField}
                typeSlug={params.typeName as string}
                fieldLabel={(root) => (
                  root === 'title' ? 'Title'
                    : root.startsWith('ext:') ? appPanels.find((p) => p.extensionId === root.slice(4))?.label
                      : typeDef?.fields.find((f) => f.name === root)?.label
                )}
              />
            )}
            {(saveStatus === 'saved' || saveStatus === 'autosaving' || saveStatus === 'saving') && (
              <span className="text-xs text-fg-subtle">{saveStatus === 'saved' ? 'Saved' : 'Saving…'}</span>
            )}
            {canPreview && (
              <Button
                variant="secondary"
                size="sm"
                icon={<IconEye className="size-3.5" />}
                onClick={() => (previewOpen ? closePreview() : openPreview('pane'))}
                isLoading={previewBusy}
                title="See this draft rendered on your site - live as you edit"
              >
                {previewOpen ? 'Close preview' : 'Preview'}
              </Button>
            )}
            {aiEnabled && !baseLocked && canUseAI && !editLocked && (
              <GenAIButton onClick={() => setShowAIGenerate(true)}>Gen AI</GenAIButton>
            )}
            {editLocked ? null : status === 'scheduled' ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => doSave(false, false, 'Saved')}
                  disabled={!hasChanges || saveStatus === 'saving' || saveStatus === 'autosaving'}
                >
                  {saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? 'Error' : 'Save changes'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-danger-fg hover:bg-danger-muted hover:border-danger/40"
                  onClick={handleUnschedule}
                  disabled={saveStatus === 'saving' || saveStatus === 'autosaving'}
                >
                  Cancel schedule
                </Button>
              </>
            ) : baseLocked ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => doSave(false, false, 'Translations saved')}
                disabled={saveStatus === 'saving' || saveStatus === 'autosaving'}
              >
                Save translations
              </Button>
            ) : !isNew && !canPublish ? (
              // Write-without-publish roles save drafts; publish/schedule/
              // unpublish stay out of reach (the API enforces the same).
              <Button
                variant="primary"
                size="sm"
                onClick={() => doSave(false, false, 'Saved')}
                disabled={!hasChanges || saveStatus === 'saving' || saveStatus === 'autosaving'}
              >
                {saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? 'Error' : 'Save changes'}
              </Button>
            ) : (
              <div className="relative">
                <div className="flex">
                  <Button
                    variant="primary"
                    size="sm"
                    className="rounded-r-none"
                    onClick={isNew ? handleCreateDraft : handlePublish}
                    disabled={saveStatus === 'autosaving'}
                    isLoading={saveStatus === 'saving'}
                    loadingText={isNew ? 'Creating…' : 'Publishing…'}
                  >
                    {isNew ? 'Create Draft' :
                     status === 'published' ? 'Publish Changes' :
                     'Publish'}
                  </Button>
                  <button
                    onClick={() => setShowPublishDropdown(v => !v)}
                    disabled={saveStatus === 'saving' || saveStatus === 'autosaving'}
                    aria-label="More publish options"
                    aria-expanded={showPublishDropdown}
                    className="flex h-7 cursor-pointer items-center rounded-l-none rounded-r-control border-l border-accent-contrast/25 bg-accent px-1.5 text-accent-contrast transition-colors motion-fast hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-accent-muted disabled:text-fg-faint outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                  >
                    <IconChevronDown className="size-3.5" />
                  </button>
                </div>
                <AnchoredDropdown anchorRef={publishDropdownRef} open={showPublishDropdown} align="end" matchWidth={false} estHeight={220}
                  className="w-64 overflow-hidden rounded-lg bg-surface-raised p-1 shadow-popover">
                    {isNew ? (
                      <>
                        <button type="button" onClick={() => { setShowPublishDropdown(false); handlePublish() }} className="w-full rounded-control px-2 py-1.5 text-left text-ui-xs text-fg transition-colors motion-fast hover:bg-surface-hover">
                          <span className="font-medium">Publish Now</span>
                          <span className="block text-fg-subtle mt-0.5">Create and go live immediately</span>
                        </button>
                        <button type="button" onClick={() => { setShowPublishDropdown(false); setShowSchedule(v => !v) }} className="mt-1 w-full rounded-control border-t border-border-subtle px-2 py-1.5 pt-2 text-left text-ui-xs text-fg transition-colors motion-fast hover:bg-surface-hover">
                          <span className="font-medium">Schedule for later</span>
                          <span className="block text-fg-subtle mt-0.5">Set a date in the sidebar panel</span>
                        </button>
                      </>
                    ) : status === 'published' ? (
                      <>
                        {lifecycleAllows('unpublish') && (
                          <button type="button" onClick={() => { setShowPublishDropdown(false); handleUnpublish() }} className="w-full rounded-control px-2 py-1.5 text-left text-ui-xs text-fg transition-colors motion-fast hover:bg-surface-hover">
                            <span className="font-medium">Unpublish</span>
                            <span className="block text-fg-subtle mt-0.5">Take content offline</span>
                          </button>
                        )}
                        {lifecycleAllows('schedule') && (
                          <button type="button" onClick={() => { setShowPublishDropdown(false); setShowSchedule(v => !v) }} className="mt-1 w-full rounded-control border-t border-border-subtle px-2 py-1.5 pt-2 text-left text-ui-xs text-fg transition-colors motion-fast hover:bg-surface-hover">
                            <span className="font-medium">Schedule changes…</span>
                            <span className="block text-fg-subtle mt-0.5">Set a date in the sidebar panel</span>
                          </button>
                        )}
                        {lifecycleAllows('archive') && (
                          <button type="button" onClick={() => { setShowPublishDropdown(false); setConfirmArchive(true) }} className="mt-1 w-full rounded-control border-t border-border-subtle px-2 py-1.5 pt-2 text-left text-ui-xs text-danger-fg transition-colors motion-fast hover:bg-danger-muted">
                            <span className="font-medium">Archive</span>
                            <span className="mt-0.5 block text-danger-fg/80">Hide from all queries</span>
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {lifecycleAllows('schedule') && (
                          <button type="button" onClick={() => { setShowPublishDropdown(false); setShowSchedule(v => !v) }} className="w-full rounded-control px-2 py-1.5 text-left text-ui-xs text-fg transition-colors motion-fast hover:bg-surface-hover">
                            <span className="font-medium">Schedule…</span>
                            <span className="block text-fg-subtle mt-0.5">Set a date in the sidebar panel</span>
                          </button>
                        )}
                        {!isNew && object && status !== 'archived' && lifecycleAllows('archive') && (
                          <button type="button" onClick={() => { setShowPublishDropdown(false); setConfirmArchive(true) }} className="mt-1 w-full rounded-control border-t border-border-subtle px-2 py-1.5 pt-2 text-left text-ui-xs text-danger-fg transition-colors motion-fast hover:bg-danger-muted">
                            <span className="font-medium">Archive</span>
                            <span className="mt-0.5 block text-danger-fg/80">Hide from all queries</span>
                          </button>
                        )}
                      </>
                    )}
                </AnchoredDropdown>
              </div>
            )}
          </div>,
          pageActionsSlot,
        )}

        {/* Slug - inline edit row */}
        <div className="mb-7 -mt-4">
          {slugEditing ? (
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-fg-subtle font-mono shrink-0">/</span>
              <input
                autoFocus
                type="text"
                value={slugDraft}
                onChange={(e) => {
                  const v = (e.target as HTMLInputElement).value
                  setSlugDraft(v)
                  checkSlugAvailability(slugify(v) || v)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitSlugEdit()
                  if (e.key === 'Escape') cancelSlugEdit()
                }}
                placeholder="slug"
                className="h-7 min-w-0 flex-1 rounded-control border border-border bg-surface-raised px-2 font-mono text-ui-sm text-fg shadow-raised outline-none focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25"
              />
              {/* Status indicator */}
              {slugStatus === 'checking' && (
                <IconLoader className="size-3.5 text-fg-subtle animate-spin shrink-0" />
              )}
              {slugStatus === 'available' && (
                <IconCheck className="size-3.5 shrink-0 text-success" />
              )}
              {slugStatus === 'taken' && (
                <span className="shrink-0 text-ui-xs text-danger-fg">taken</span>
              )}
              <button
                onClick={commitSlugEdit}
                disabled={slugStatus === 'taken' || slugStatus === 'checking'}
                className="flex size-6 items-center justify-center rounded-control text-fg-muted transition-colors motion-fast hover:bg-surface-hover hover:text-fg disabled:text-fg-faint outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                title="Save slug"
              >
                <IconCheck className="size-3.5" />
              </button>
              <button
                onClick={cancelSlugEdit}
                className="flex size-6 items-center justify-center rounded-control text-fg-subtle transition-colors motion-fast hover:bg-surface-hover hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                title="Cancel"
              >
                <IconX className="size-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 group">
              <span className="font-mono text-ui-sm text-fg-subtle">
                /{slug || <span className="italic">{slugify(title) || 'auto-generated'}</span>}
              </span>
              <button
                onClick={openSlugEdit}
                className="flex size-5 items-center justify-center rounded-xs text-fg-subtle opacity-0 transition-[opacity,background-color,color] motion-fast group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-hover hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                title="Edit slug"
              >
                <IconPencil className="size-3" />
              </button>
            </div>
          )}
          {slugStatus === 'taken' && (
            <p className="mt-1 text-ui-xs text-danger-fg">This slug is already in use</p>
          )}
        </div>

        {/* Custom fields - 6-column grid; width controlled per field via config.admin.width */}
        <div className="grid grid-cols-6 gap-x-6 gap-y-6">
          {mainFields.map((field) => {
            const adm = field.config?.admin
            // hidden — completely omit from layout
            if (adm?.hidden) return null
            // sub-fields of groups are rendered inside their parent group accordion — skip here
            if (groupedFieldNames.has(field.name)) return null
            // primary taxonomy fields are managed by TaxonomyPicker — don't render standalone
            if (managedTaxonomyPrimaryFields.has(field.name)) return null
            // conditional visibility (single rule or multi-rule group)
            const cv = adm?.conditionalVisibility
            if (cv && !evalVisibility(cv, (n) => fieldValues[n])) return null
            const w = adm?.width
            const isRepeater = field.fieldType === 'repeater'
            const isComponent = field.fieldType === 'component'
            const isGroup = field.fieldType === 'group'
            const isComplex = isRepeater || isComponent

            // ── Group: collapsible shell with nested fields ──────────────────
            if (isGroup) {
              const subFields = field.config.groupFields ?? []
              if (subFields.length === 0) return null
              const groupCv = field.config?.admin?.conditionalVisibility
              if (groupCv && !evalVisibility(groupCv, (n) => fieldValues[n])) return null
              const isCollapsed = collapsedFields.has(field.name)
              const toggleCollapse = () => setCollapsedFields(prev => {
                const next = new Set(prev)
                next.has(field.name) ? next.delete(field.name) : next.add(field.name)
                return next
              })
              return (
                <div key={field.name} className="col-span-6 rounded-xl border border-border overflow-hidden" data-field={field.name}>
                  <button
                    type="button"
                    onClick={toggleCollapse}
                    className={clsx(
                      'flex items-center gap-2 w-full text-left px-4 py-2.5 bg-surface-sunken transition-colors preview-clickable',
                      isCollapsed ? '' : 'border-b border-border',
                    )}
                  >
                    <IconChevronDown className={clsx('size-3.5 shrink-0 transition-transform duration-200 text-fg-subtle', isCollapsed && '-rotate-90')} />
                    <span className="text-sm font-medium text-fg">{field.label}</span>
                    <span className="text-[10px] font-medium text-fg-subtle bg-surface-hover px-1.5 py-0.5 rounded">group</span>
                    {presenceFor(field.name)}
                  </button>
                  {!isCollapsed && (
                    <div className="p-4 grid grid-cols-6 gap-x-6 gap-y-5">
                      {subFields.map((sf, sfIdx) => {
                        // Index-aligned with subFields - the memo maps the same array
                        const sfPatched = patchedGroupSubFields.get(field.name)?.[sfIdx] ?? patchFieldAccess(sf)
                        const sfAdm = sfPatched.config?.admin
                        if (sfAdm?.hidden) return null
                        const sfIsRepeater = sf.fieldType === 'repeater'
                        const sfIsComponent = sf.fieldType === 'component'
                        const sfIsComplex = sfIsRepeater || sfIsComponent
                        if (sfIsComplex) {
                          const sfIsCollapsed = collapsedFields.has(`${field.name}.${sf.name}`)
                          const sfToggle = () => setCollapsedFields(prev => {
                            const next = new Set(prev)
                            const key = `${field.name}.${sf.name}`
                            next.has(key) ? next.delete(key) : next.add(key)
                            return next
                          })
                          const sfHeaderCls = sfIsRepeater ? 'bg-surface-sunken px-4 py-2.5' : 'bg-violet-50 px-4 py-2.5'
                          const sfBorderCls = sfIsRepeater ? 'border-border' : 'border-violet-200'
                          const sfLabelCls = sfIsRepeater ? 'text-sm font-medium text-fg' : 'text-sm font-semibold text-violet-900'
                          const sfBadgeCls = sfIsRepeater
                            ? 'text-[10px] font-medium text-fg-muted bg-surface-hover px-1.5 py-0.5 rounded'
                            : 'text-[10px] font-medium text-violet-600 bg-violet-100 px-1.5 py-0.5 rounded'
                          const sfChevronCls = sfIsRepeater ? 'text-fg-subtle' : 'text-violet-400'
                          return (
                            <div key={sf.name} className={clsx('col-span-6 rounded-xl border overflow-hidden', sfBorderCls)} data-field={sf.name}>
                              <button
                                type="button"
                                onClick={sfToggle}
                                className={clsx('flex items-center gap-2 w-full text-left transition-colors preview-clickable', sfHeaderCls, sfIsCollapsed ? '' : 'border-b ' + sfBorderCls)}
                              >
                                <IconChevronDown className={clsx('size-3.5 shrink-0 transition-transform duration-200', sfChevronCls, sfIsCollapsed && '-rotate-90')} />
                                <span className={sfLabelCls}>{sf.label}{sf.required && <span className="text-danger ml-0.5">*</span>}</span>
                                <span className={sfBadgeCls}>{sfIsRepeater ? 'repeater' : 'sections'}</span>
                                {presenceFor(sf.name)}
                              </button>
                              {!sfIsCollapsed && (
                                <div className="p-4">
                                  <FieldRenderer {...fieldRendererShared} field={sfPatched as FieldDefinition} />
                                  {validationErrors[sf.name] && <p className="mt-1 text-xs text-danger-fg">{validationErrors[sf.name]}</p>}
                                </div>
                              )}
                            </div>
                          )
                        }
                        const sfW = sfAdm?.width
                        const sfColClass = sfW === 'half' ? 'col-span-3' : sfW === 'third' ? 'col-span-2' : 'col-span-6'
                        return (
                          <div key={sf.name} className={sfColClass} data-field={sf.name}>
                            {/* div, not <label>: a label with no htmlFor activates its first
                                labelable descendant - the AI sparkle button - so clicking the
                                TEXT opened Gen AI. */}
                            <div className={fieldLabel}>
                              {sf.label}
                              {sf.required && <span className="text-danger-fg ml-0.5">*</span>}
                              {aiFill(sf as FieldDefinition)}
                              {presenceFor(sf.name)}
                            </div>
                            <FieldRenderer {...fieldRendererShared} field={sfPatched as FieldDefinition} />
                            {sf.helpText && !validationErrors[sf.name] && <p className="mt-1.5 text-xs text-fg-subtle">{sf.helpText}</p>}
                            {validationErrors[sf.name] && <p className="mt-1 text-xs text-danger-fg">{validationErrors[sf.name]}</p>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            }

            if (isComplex) {
              const isCollapsed = collapsedFields.has(field.name)
              const toggleCollapse = () => setCollapsedFields(prev => {
                const next = new Set(prev)
                next.has(field.name) ? next.delete(field.name) : next.add(field.name)
                return next
              })
              // One family for structured fields (spec §18 C): a raised card with a
              // hairline, a 36px header, the kind as a neutral chip.
              const headerCls = 'h-9 bg-surface-sunken px-3'
              const borderCls = 'border-border-subtle'
              const labelCls = 'text-ui-sm font-medium text-fg'
              const typeBadgeCls = 'rounded-sm bg-surface-hover px-1.5 py-0.5 text-ui-2xs text-fg-muted'
              const chevronCls = 'text-fg-subtle'
              return (
                <div key={field.name} className={clsx('col-span-6 overflow-hidden rounded-lg border bg-surface-raised', borderCls)} data-field={field.name}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={toggleCollapse}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapse() } }}
                    className={clsx('flex w-full cursor-pointer items-center gap-2 text-left transition-colors motion-fast preview-clickable hover:bg-surface-hover', headerCls, isCollapsed ? '' : 'border-b ' + borderCls)}
                  >
                    <IconChevronDown className={clsx('size-3.5 shrink-0 transition-transform duration-200', chevronCls, isCollapsed && '-rotate-90')} />
                    <span className={labelCls}>
                      {field.label}
                      {field.required && <span className="ml-0.5 text-danger">*</span>}
                    </span>
                    {aiFill(field)}
                    <span className={typeBadgeCls}>{isRepeater ? 'repeater' : 'sections'}</span>
                    {presenceFor(field.name)}
                    {adm?.readonly && <span className="ml-auto text-ui-2xs font-normal text-fg-subtle">read-only</span>}
                  </div>
                  {!isCollapsed && (
                    <div className="p-4">
                      <FieldRenderer {...fieldRendererShared} field={field} />
                      {field.helpText && !validationErrors[field.name] && (
                        <p className="mt-2 text-ui-xs text-fg-subtle">{field.helpText}</p>
                      )}
                      {validationErrors[field.name] && (
                        <p className="mt-1 text-ui-xs text-danger-fg">{validationErrors[field.name]}</p>
                      )}
                      {!validationErrors[field.name] && fieldWarning(field) && (
                        <p className="mt-1 text-ui-xs text-warning-fg">{fieldWarning(field)}</p>
                      )}
                    </div>
                  )}
                </div>
              )
            }

            const colClass = w === 'half' ? 'col-span-3' : w === 'third' ? 'col-span-2' : 'col-span-6'
            return (
              <div key={field.name} className={colClass} data-field={field.name}>
                {/* div, not <label> - see the group sub-field note above. */}
                <div className={fieldLabel}>
                  {field.label}
                  {field.required && <span className="ml-0.5 text-danger">*</span>}
                  {aiFill(field)}
                  {presenceFor(field.name)}
                  {adm?.readonly && <span className="ml-1.5 text-ui-2xs font-normal text-fg-subtle">read-only</span>}
                </div>
                <FieldRenderer {...fieldRendererShared} field={field} />
                {field.helpText && !validationErrors[field.name] && (
                  <p className="mt-1.5 text-ui-xs text-fg-subtle">{field.helpText}</p>
                )}
                {validationErrors[field.name] && (
                  <p className="mt-1 text-ui-xs text-danger-fg">{validationErrors[field.name]}</p>
                )}
                {!validationErrors[field.name] && fieldWarning(field) && (
                  <p className="mt-1 text-ui-xs text-warning-fg">{fieldWarning(field)}</p>
                )}
              </div>
            )
          })}
        </div>

        {/* Orphan fields - present in this version snapshot but removed from the current schema */}
        {previewingVersion && orphanFields.length > 0 && (
          <div className="mt-6 overflow-hidden rounded-lg bg-danger-muted">
            <div className="flex items-start gap-2.5 border-b border-danger/20 px-4 py-3">
              <IconWarning className="mt-0.5 size-4 shrink-0 text-danger" />
              <div>
                <p className="text-ui-sm font-medium text-danger-fg">Removed fields</p>
                <p className="mt-0.5 text-ui-xs text-danger-fg">
                  The following fields exist in this version but have been removed from the schema.
                  Their data is shown here for reference only and will not be included in a restore.
                </p>
              </div>
            </div>
            <div className="divide-y divide-danger/15">
              {orphanFields.map(({ name, value }) => (
                <div key={name} className="px-4 py-3">
                  <p className="mb-1.5 font-mono text-ui-xs font-medium text-danger-fg">{name}</p>
                  {value === null || value === undefined
                    ? <span className="text-xs italic text-fg-subtle">empty</span>
                    : typeof value === 'object'
                      ? (
                        <pre className="preview-clickable max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-control bg-surface-raised px-3 py-2 font-mono text-ui-xs text-fg">
                          {JSON.stringify(value, null, 2)}
                        </pre>
                      )
                      : <span className="text-xs text-fg break-all">{String(value)}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* App center-stage panels - Metabox cards below the custom fields.
            Panels declaring placement: 'sidebar' render in the right rail
            below (compact card), not here. */}
        {appPanels.some((p) => (p as { placement?: string }).placement !== 'sidebar') && (() => {
          const contentText = Object.entries(fieldValues)
            .filter(([, v]) => typeof v === 'string')
            .map(([, v]) => v as string)
            .join(' ')
          const basePanelProps = {
            title,
            content: contentText,
            fieldValues,
            objectUrl: slug ? `${typeof window !== 'undefined' ? window.location.origin : ''}/content/${slug}` : '',
            ...panelLifecycleProps,
          }
          return (
            <div className="mt-8 space-y-4">
              {appPanels.filter((p) => (p as { placement?: string }).placement !== 'sidebar').map((panel) => {
                const PanelComponent = panelRegistry[panelRegistryKey(panel.extensionId, panel.id)]
                if (!PanelComponent) return null

                const panelProps = {
                  ...basePanelProps,
                  ai: {
                    available: aiEnabled,
                    openAssistant: ((panel as any).ai?.enabled === true && (panel as any).ai?.fields?.length) ? () => openAssistantForPanel(panel as any) : undefined,
                    fill: async (instruction: string) => {
                      const r = await adminFetch<{ data: { value: unknown } }>('/admin/ai/fill', {
                        method: 'POST',
                        body: JSON.stringify({ type: params.typeName, field: '__text', instruction, values: { title, ...fieldValues } }),
                      })
                      return String(r.data.value ?? '')
                    },
                  },
                  panelData: panelDataMap[panel.extensionId] ?? {},
                  onPanelDataChange: (data: Record<string, unknown>) => {
                    const current = pendingPanelDataRef.current[panel.extensionId] ?? panelDataMap[panel.extensionId] ?? {}
                    if (JSON.stringify(data) === JSON.stringify(current)) return
                    pendingPanelDataRef.current[panel.extensionId] = data
                    setPanelDataSeq((n) => n + 1)
                    setHasPendingPanelChanges(true)
                  },
                }

                if (panel.renderMode === 'modal') {
                  return (
                    <div key={panel.id} data-field={`ext:${panel.extensionId}`}>
                    <Metabox
                      title={panel.label}
                      badge="extension"
                      meta={presenceFor(`ext:${panel.extensionId}`)}
                      collapsible={false}
                      action={
                        <>
                          <button
                            type="button"
                            onClick={() => setOpenModalPanel(panel.id)}
                            className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-fg shadow-xs hover:bg-surface-sunken transition-colors"
                          >
                            {panel.buttonLabel}
                          </button>
                          <Dialog open={openModalPanel === panel.id} onOpenChange={(open) => !open && setOpenModalPanel(null)}>
                            <DialogContent className="max-w-2xl">
                              <DialogHeader>
                                <DialogTitle>{panel.label}</DialogTitle>
                              </DialogHeader>
                              <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
                                <Suspense fallback={null}><PanelComponent key={`${panel.id}:${panelRemountSeq}`} {...panelProps} /></Suspense>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </>
                      }
                    />
                    </div>
                  )
                }

                // Panels are presence anchors too (2026-09-13): `ext:<extensionId>`
                // is the field name a session publishes while its focus is inside.
                return (
                  <div key={panel.id} data-field={`ext:${panel.extensionId}`}>
                    <Metabox title={panel.label} badge="extension" meta={presenceFor(`ext:${panel.extensionId}`)}>
                      <Suspense fallback={null}><PanelComponent key={`${panel.id}:${panelRemountSeq}`} {...panelProps} /></Suspense>
                    </Metabox>
                  </div>
                )
              })}
            </div>
          )
        })()}
      </div>
      </div>
      </div>

      {/* The inspector's resize handle: a sibling, so the aside keeps its own scroll. */}
      {!(previewOpen || stacked) && (
        <div className="relative hidden w-0 shrink-0 lg:block">
          <button
            type="button"
            {...inspector.handleProps}
            className="group/resize absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none select-none border-none bg-transparent p-0 outline-none"
          >
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border-prominent opacity-0 transition-opacity motion group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100 group-data-[dragging]/resize:opacity-100" />
          </button>
        </div>
      )}
      {/* Right sidebar */}
      <aside
        data-dragging={inspector.dragging || undefined}
        style={{ '--tg-inspector-w': `${inspector.width}px` } as React.CSSProperties}
        className={clsx(
          'shrink-0 h-full bg-surface border-l border-border-subtle flex flex-col overflow-y-auto',
          (previewOpen || stacked) ? (editorTab === 'settings' ? 'flex-1 min-w-0 border-l-0' : 'hidden') : 'w-(--tg-inspector-w)',
        )}
      >

      {previewingVersion ? (
        <>
          {/* Compact amber strip - version history preview */}
          <div className="space-y-2 border-b border-border-subtle bg-warning-muted px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <IconWarning className="size-3.5 shrink-0 text-warning" />
              <p className="min-w-0 flex-1 truncate text-ui-xs font-medium text-warning-fg">
                Viewing v{previewingVersion.version} - read-only
              </p>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={restoringId === previewingVersion.id}
                onClick={() => handleRestore(previewingVersion.id)}
                className="flex h-7 flex-1 items-center justify-center gap-1 rounded-control bg-warning px-2 text-ui-xs font-medium text-accent-contrast transition-colors motion-fast hover:bg-warning-fg disabled:bg-warning-muted disabled:text-fg-faint"
              >
                {restoringId === previewingVersion.id
                  ? <><IconLoader className="size-3 animate-spin" /> Restoring…</>
                  : <><IconUndo className="size-3" /> Restore</>}
              </button>
              <button
                type="button"
                onClick={exitPreview}
                className="flex h-7 flex-1 items-center justify-center rounded-control border border-warning/40 bg-surface-raised px-2 text-ui-xs text-warning-fg transition-colors motion-fast hover:bg-warning-muted"
              >
                ← Cancel
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowDiff(true)}
              className="flex h-7 w-full items-center justify-center rounded-control border border-warning/40 bg-surface-raised px-2 text-ui-xs text-warning-fg transition-colors motion-fast hover:bg-warning-muted"
            >
              Compare with current version
            </button>
          </div>

          {/* Full version list - scroll to jump between versions */}
          <div className="flex-1 overflow-y-auto">
            <p className="px-3 pt-2.5 pb-1 text-ui-2xs text-fg-subtle">
              Version history
            </p>
            {versionsLoading ? (
              <div className="px-3 py-2 space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="space-y-1">
                    <div className="h-3 w-20 bg-surface-hover rounded animate-pulse" />
                    <div className="h-3 w-28 bg-surface-hover rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {/* Synthetic "Current Version" entry pinned at top */}
                <li className={clsx(
                  'px-3 py-2 flex items-start gap-1.5',
                  !previewingVersion ? 'bg-success-muted' : 'hover:bg-surface-sunken',
                )}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className={clsx('text-ui-xs font-medium leading-tight', !previewingVersion ? 'text-success-fg' : 'text-fg')}>
                        Current Version
                      </p>
                      {currentVersionType && (
                        <span className={clsx(
                          'inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide leading-none',
                          currentVersionType === 'published' && 'bg-success-muted text-success-fg',
                          currentVersionType === 'staged'    && 'bg-purple-100 text-purple-700',
                          currentVersionType === 'scheduled' && 'bg-accent-muted text-accent-fg',
                          currentVersionType === 'draft'     && 'bg-surface-hover text-fg-muted',
                          currentVersionType === 'autosave'  && 'bg-sky-50 text-sky-500',
                        )}>
                          {currentVersionType === 'autosave' ? 'auto' : currentVersionType}
                        </span>
                      )}
                      {isCurrentLive && (
                        <span className="inline-flex items-center rounded-sm bg-success-muted px-1 py-0.5 text-ui-2xs font-medium leading-none text-success-fg">live</span>
                      )}
                    </div>
                    {versions[0] && (
                      <p className="text-[11px] text-fg-subtle mt-0.5" title={fullDateTime(versions[0].createdAt)}>
                        {relativeTime(versions[0].createdAt)}
                      </p>
                    )}
                  </div>
                  {previewingVersion && (
                    <button
                      type="button"
                      onClick={exitPreview}
                      className="shrink-0 text-[11px] text-accent-fg hover:underline pt-0.5"
                    >
                      ← Back
                    </button>
                  )}
                </li>

                {versions.length <= 1 ? (
                  <li className="px-3 py-2 text-xs text-fg-subtle">No previous versions.</li>
                ) : versions.slice(1).map((v) => {
                  const isCurrent = previewingVersion?.id === v.id
                  const isLive = v.id === liveRevisionId
                  const creatorLabel = v.createdByType === 'member'
                    ? (v.createdByLabel ?? 'Admin')
                    : v.createdByType === 'api_key'
                    ? `Key ${v.createdBy?.slice(0, 6) ?? '?????'}`
                    : 'Admin'
                  const creatorText = v.createdBy && v.createdBy === currentMember?.memberId
                    ? `${creatorLabel} (You)`
                    : creatorLabel
                  return (
                    <li
                      key={v.id}
                      className={clsx(
                        'px-3 py-2 flex items-start gap-1.5',
                        isCurrent ? 'bg-warning-muted border-l-2 border-warning/40' : 'hover:bg-surface-sunken',
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className={clsx('text-ui-xs font-medium leading-tight', isCurrent ? 'text-warning-fg' : 'text-fg')}>
                            v{v.version}
                          </p>
                          {v.versionType && (
                            <span className={clsx(
                              'inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide leading-none',
                              v.versionType === 'published'  && 'bg-success-muted text-success-fg',
                              v.versionType === 'staged'     && 'bg-purple-100 text-purple-700',
                              v.versionType === 'scheduled'  && 'bg-accent-muted text-accent-fg',
                              v.versionType === 'draft'      && 'bg-surface-hover text-fg-muted',
                              v.versionType === 'autosave'   && 'bg-sky-50 text-sky-500',
                            )}>
                              {v.versionType === 'autosave' ? 'auto' : v.versionType}
                            </span>
                          )}
                          {isLive && (
                            <span className="inline-flex items-center rounded-sm bg-success-muted px-1 py-0.5 text-ui-2xs font-medium leading-none text-success-fg">live</span>
                          )}
                          {isCurrent && <span className="text-[10px] text-warning-fg font-normal">← viewing</span>}
                        </div>
                        <p className="text-[11px] text-fg-subtle mt-0.5" title={fullDateTime(v.createdAt)}>
                          {relativeTime(v.createdAt)}
                        </p>
                        <p className="text-[11px] text-fg-subtle">{creatorText}</p>
                      </div>
                      {!isCurrent && (
                        <button
                          type="button"
                          disabled={previewLoading}
                          onClick={() => viewVersion(v)}
                          className="shrink-0 text-[11px] text-accent-fg hover:underline disabled:opacity-40 transition-opacity pt-0.5"
                        >
                          View
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      ) : viewingLive ? (
        <>
          {/* Green live-version banner */}
          <Callout variant="success" title="Viewing live - read-only" className="m-3">
            <p className="text-[11px] leading-relaxed">
              Content currently visible to visitors.
            </p>
            <button
              type="button"
              onClick={exitLiveView}
              className="mt-2 flex w-full items-center justify-center rounded-control border border-border bg-surface-raised px-2 py-1.5 text-xs font-medium text-fg shadow-raised transition-colors hover:bg-surface-hover"
            >
              ← Back to editing
            </button>
          </Callout>
          {object && (
            <div className="px-4 py-4 border-b border-border">
              <p className="text-sm font-medium text-fg mb-1.5">Status</p>
              <Badge variant="success">published</Badge>
            </div>
          )}
          {object?.published_at && (
            <div className="px-4 py-4 border-b border-border space-y-3">
              <div>
                <p className="text-xs font-medium text-fg-muted uppercase tracking-wider mb-0.5">Published</p>
                <p className="text-xs text-fg-muted">{formatSidebarDate(object.published_at)}</p>
              </div>
            </div>
          )}
        </>
      ) : (
        <>

        {/* Actions */}
        <div className="space-y-2 border-b border-border-subtle p-4">

          {/* Status tags */}
          {!isNew && object && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1">
              {status === 'published' && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-fg">
                  <span className="size-1.5 shrink-0 rounded-full bg-success" />
                  Published
                </span>
              )}
              {status === 'published' && hasDraftChanges && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning-fg">
                  <span className="size-1.5 rounded-full bg-warning shrink-0" />
                  Changes in draft
                </span>
              )}
              {status === 'draft' && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                  <span className="size-1.5 shrink-0 rounded-full bg-fg-subtle" />
                  Draft
                </span>
              )}
              {status === 'archived' && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-subtle">
                  <span className="size-1.5 shrink-0 rounded-full bg-fg-faint" />
                  Archived
                </span>
              )}
              {status === 'scheduled' && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-fg">
                  <span className="size-1.5 rounded-full bg-accent shrink-0" />
                  Scheduled for {object.scheduled_at ? formatScheduledDateTime(object.scheduled_at) : '-'}
                </span>
              )}
              {(saveStatus === 'saved' || saveStatus === 'autosaving') && (
                <span className="text-xs text-fg-subtle">
                  {saveStatus === 'saved' ? 'Saved' : 'Saving…'}
                </span>
              )}
            </div>
          )}

          {status === 'scheduled' ? (
            <div className="space-y-2">
              <div className="rounded-lg bg-accent-muted px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <IconClock className="size-3.5 text-accent-fg shrink-0" />
                  <p className="text-xs font-medium text-accent-fg">Scheduled to publish</p>
                </div>
                <p className="text-xs text-accent-fg leading-snug">
                  {object?.scheduled_at ? formatScheduledDateTime(object.scheduled_at) : '-'}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Schedule panel */}
              {showSchedule && (
                <div className="space-y-2">
                  <DatePicker
                    withTime
                    value={scheduleAt || undefined}
                    onChange={(v) => setScheduleAt(v ?? '')}
                    placeholder="Pick date & time"
                    minDate={new Date().toISOString().slice(0, 10)}
                  />
                  <Button
                    variant="primary"
                    className="w-full justify-center"
                    onClick={handleSchedule}
                    disabled={!scheduleAt || saveStatus === 'autosaving'}
                    isLoading={saveStatus === 'saving'}
                    loadingText="Scheduling…"
                    size="sm"
                  >
                    Confirm schedule
                  </Button>
                </div>
              )}

              {/* View live version - when published with pending draft changes */}
              {!isNew && status === 'published' && hasDraftChanges && object?.published_values && (
                <button
                  type="button"
                  onClick={viewLive}
                  className="flex h-7 w-full items-center justify-center gap-1.5 rounded-control border border-border bg-surface-raised px-2 text-ui-xs font-medium text-fg-muted shadow-raised transition-colors motion-fast hover:bg-surface-hover hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                >
                  <IconEye className="size-3 shrink-0" />
                  View live version
                </button>
              )}
            </>
          )}
        </div>

        {/* Extension panels that declared placement: 'sidebar' - compact rail cards */}
        {!viewingLive && !previewingVersion && appPanels.filter((p) => (p as { placement?: string }).placement === 'sidebar').map((panel) => {
          const PanelComponent = panelRegistry[panelRegistryKey(panel.extensionId, panel.id)]
          if (!PanelComponent) return null
          const props = {
            title,
            content: '',
            fieldValues,
            objectUrl: slug ? `${typeof window !== 'undefined' ? window.location.origin : ''}/content/${slug}` : '',
            ...panelLifecycleProps,
            ai: {
              available: aiEnabled,
              fill: async (instruction: string) => {
                const r = await adminFetch<{ data: { value: unknown } }>('/admin/ai/fill', {
                  method: 'POST',
                  body: JSON.stringify({ type: params.typeName, field: '__text', instruction, values: { title, ...fieldValues } }),
                })
                return String(r.data.value ?? '')
              },
            },
            panelData: panelDataMap[panel.extensionId] ?? {},
            onPanelDataChange: (data: Record<string, unknown>) => {
              const current = pendingPanelDataRef.current[panel.extensionId] ?? panelDataMap[panel.extensionId] ?? {}
              if (JSON.stringify(data) === JSON.stringify(current)) return
              pendingPanelDataRef.current[panel.extensionId] = data
              setPanelDataSeq((n) => n + 1)
              setHasPendingPanelChanges(true)
            },
          }
          return (
            <div key={panel.id} className="border-b border-border-subtle px-4 py-3.5" data-field={`ext:${panel.extensionId}`}>
              <p className="mb-2 text-ui-xs font-medium text-fg-subtle">{panel.label}{presenceFor(`ext:${panel.extensionId}`)}</p>
              <Suspense fallback={null}><PanelComponent key={`${panel.id}:${panelRemountSeq}`} {...props} /></Suspense>
            </div>
          )
        })}

        {/* Labels - operational, cross-cutting tags (distinct from a modeled `tags`
            field). Needs a saved id. */}
        {!isNew && object?.id && (
          <div className="border-b border-border-subtle px-4 py-3.5">
            <LabelInput entityType={`content:${params.typeName}`} entityId={object.id as string} canWrite={canWrite} />
          </div>
        )}

        {/* A type that is not localizable shows no Localizations panel at all (2026-09-08):
            a code change is documentation, not an editor's sidebar. */}
        {/* Localizations - pick working locales; fields duplicate inline (Hygraph-style) */}
        {localesInfo && typeIsLocalizable && !viewingLive && !previewingVersion && (
          <div className="border-b border-border-subtle px-4 py-3.5">
            <p className="mb-2.5 text-ui-xs font-medium text-fg-subtle">Localizations</p>
            <div className="space-y-1.5">
              {localesInfo.locales.map((l) => {
                const isDefault = l.code === localesInfo.defaultLocale
                const checked = isDefault || workingLocales.includes(l.code)
                const draftForCount = localeDrafts[l.code] ?? {}
                const titleDone = typeof draftForCount.title === 'string' && draftForCount.title.trim() !== ''
                const done = translatableFields.filter((f: any) => hasI18nValue(draftForCount[f.name])).length + (titleDone ? 1 : 0)
                const totalTranslatable = translatableFields.length + 1 // +1 = title (always has default content)
                const missing = isDefault ? [] : translatableFields.filter((f: any) => !hasI18nValue(draftForCount[f.name]))
                const titleMissing = !isDefault && !titleDone
                return (
                  <div key={l.code}>
                  <div className="flex items-center gap-2">
                    <span className={clsx('size-2 rounded-full shrink-0', localeColors[l.code]?.dot)} />
                    <label className={clsx('flex items-center gap-2 flex-1 text-sm', isDefault ? 'text-fg-subtle cursor-default' : 'text-fg cursor-pointer')}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isDefault || (!checked && workingLocales.length >= 5) || !canWriteLoc(l.code, localesInfo?.defaultLocale)}
                        onChange={(e) => {
                          const on = (e.target as HTMLInputElement).checked
                          setWorkingLocales((prev) => on
                            ? (prev.length >= 5 ? prev : [...prev, l.code])
                            : prev.filter((c) => c !== l.code))
                        }}
                        className="form-checkbox size-3.5 rounded-sm border-border-strong text-accent focus:ring-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:border-border-subtle"
                      />
                      <span className="truncate">{l.label}</span>
                      {isDefault && <span className="text-[10px] text-fg-subtle">default</span>}
                      {!isDefault && totalTranslatable > 0 && (
                        <button
                          type="button"
                          title="Show untranslated fields (only fields with default-locale content count)"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMissingOpenFor((cur) => cur === l.code ? null : l.code) }}
                          className={clsx(
                            'text-[10px] tabular-nums rounded px-1 py-0.5 cursor-pointer hover:bg-surface-hover',
                            done === 0 ? 'text-fg-subtle' : done < totalTranslatable ? 'text-warning-fg' : 'text-success-fg',
                            missingOpenFor === l.code && 'bg-surface-hover',
                          )}
                        >
                          {done}/{totalTranslatable}
                        </button>
                      )}
                    </label>
                    {(isDefault ? workingLocaleDefs.length > 0 : checked) && (
                      <button
                        type="button"
                        title={hiddenLocales.has(l.code) ? `Show ${l.label} inputs` : `Hide ${l.label} inputs`}
                        onClick={() => toggleHiddenLocale(l.code)}
                        className={clsx('p-1 rounded cursor-pointer', hiddenLocales.has(l.code) ? 'text-accent-fg bg-accent-muted' : 'text-fg-subtle hover:text-fg-muted hover:bg-surface-hover')}
                      >
                        {hiddenLocales.has(l.code) ? <IconEyeOff className="size-3.5" /> : <IconEye className="size-3.5" />}
                      </button>
                    )}
                  </div>
                  {missingOpenFor === l.code && (
                    <div className="mt-1.5 mb-1 ml-4 flex flex-wrap gap-1">
                      {missing.length === 0 && !titleMissing ? (
                        <span className="text-ui-2xs font-normal text-success-fg">All fields translated ✓</span>
                      ) : (
                        <>
                          {titleMissing && (
                            <button
                              type="button"
                              onClick={() => {
                                if (!workingLocales.includes(l.code)) setWorkingLocales((prev) => prev.length >= 5 ? prev : [...prev, l.code])
                                setHiddenLocales((prev) => { const n = new Set(prev); n.delete(l.code); return n })
                                document.querySelector('[data-field="__title"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                              }}
                              className="cursor-pointer rounded-sm bg-warning-muted px-1.5 py-0.5 text-ui-2xs font-normal text-warning-fg ring-1 ring-inset ring-warning/25 transition-colors motion-fast hover:ring-warning/50"
                            >
                              Title
                            </button>
                          )}
                          {missing.map((f: any) => (
                            <button
                              key={f.name}
                              type="button"
                              title={`Jump to ${f.label}`}
                              onClick={() => {
                                if (!workingLocales.includes(l.code)) setWorkingLocales((prev) => prev.length >= 5 ? prev : [...prev, l.code])
                                setHiddenLocales((prev) => { const n = new Set(prev); n.delete(l.code); return n })
                                document.querySelector(`[data-field="${f.name}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                              }}
                              className="cursor-pointer rounded-sm bg-warning-muted px-1.5 py-0.5 text-ui-2xs font-normal text-warning-fg ring-1 ring-inset ring-warning/25 transition-colors motion-fast hover:ring-warning/50"
                            >
                              {f.label}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                  </div>
                )
              })}
            </div>
            {workingLocales.length >= 5 && (
              <p className="mt-2 text-ui-2xs font-normal text-fg-subtle">Up to 5 locales at a time - untick one to add another</p>
            )}
            {dirtyLocales.size > 0 && (
              <p className="mt-2 text-ui-2xs font-normal text-warning-fg">Unsaved translations - saved with the draft</p>
            )}
          </div>
        )}

        {/* Sidebar fields from editorView.sidebar */}
        {sidebarFields.length > 0 && (
          <div className={clsx('space-y-1 border-b border-border-subtle px-4 py-3', editLocked && 'pointer-events-none select-none opacity-55 transition-opacity motion-fast')}>
            <p className="mb-1 text-ui-xs font-medium text-fg-subtle">Properties</p>
            {sidebarFields.map((field) => {
              const adm = field.config?.admin
              if (adm?.hidden) return null
              const cv = adm?.conditionalVisibility
              if (cv && !evalVisibility(cv, (n) => fieldValues[n])) return null
              // Presentation follows the field type (spec §18): a compact
              // property is one line, label and its OWN control; document and
              // structured fields stack. Placement stayed the schema's.
              const layout = viewingLive || previewingVersion ? 'stacked' : inspectorLayout(field as never)
              return (
                <PropertyRow
                  key={field.name}
                  data-field={field.name}
                  layout={layout}
                  label={field.label}
                  required={!!field.required}
                  labelExtras={<>{aiFill(field)}{presenceFor(field.name)}{adm?.readonly && <span className="ml-1 text-ui-2xs font-normal text-fg-subtle">read-only</span>}</>}
                  control={<FieldRenderer {...fieldRendererShared} field={field} />}
                  help={field.helpText}
                  error={validationErrors[field.name]}
                />
              )
            })}
          </div>
        )}

        {/* Timestamps - collapsed by default, expand to see all */}
        {object && (
          <div className="border-b border-border-subtle">
            <button
              type="button"
              onClick={() => setShowTimestamps(v => !v)}
              className={clsx(
                'flex items-center gap-2 w-full px-4 py-3 text-xs font-medium transition-colors',
                showTimestamps
                  ? 'text-accent-fg bg-accent-muted border-b border-accent/30'
                  : 'text-fg-muted hover:text-fg hover:bg-surface-hover border-b border-border',
              )}
            >
              <span className="flex-1 text-left">
                {object.published_at
                  ? <>Published · <span className={clsx('font-normal', showTimestamps ? 'text-fg' : 'text-fg-subtle')}>{formatSidebarDate(object.published_at)}</span></>
                  : object.updated_at
                  ? <>Updated · <span className={clsx('font-normal', showTimestamps ? 'text-fg' : 'text-fg-subtle')}>{formatSidebarDate(object.updated_at)}</span></>
                  : 'Dates'}
              </span>
              <span className={clsx('text-ui-xs transition-transform motion-fast', showTimestamps ? 'rotate-180 text-fg' : 'text-fg-subtle')}>▾</span>
            </button>
            {showTimestamps && (
              <div className="px-4 pt-3 pb-4 space-y-3">
                {object.scheduled_at && (
                  <div>
                    <p className="mb-0.5 text-ui-2xs text-fg-subtle">Scheduled</p>
                    <p className="text-xs text-fg-muted">{formatScheduledDateTime(object.scheduled_at)}</p>
                  </div>
                )}
                {object.published_at && (
                  <div>
                    <p className="mb-0.5 text-ui-2xs text-fg-subtle">Published</p>
                    <p className="text-xs text-fg-muted">{formatSidebarDate(object.published_at)}</p>
                    <Byline actor={audit?.published_by} />
                  </div>
                )}
                {object.updated_at && (
                  <div>
                    <p className="mb-0.5 text-ui-2xs text-fg-subtle">Updated</p>
                    <p className="text-xs text-fg-muted">{formatSidebarDate(object.updated_at)}</p>
                    <Byline actor={audit?.updated_by} />
                  </div>
                )}
                {object.created_at && (
                  <div>
                    <p className="mb-0.5 text-ui-2xs text-fg-subtle">Created</p>
                    <p className="text-xs text-fg-muted">{formatSidebarDate(object.created_at)}</p>
                    <Byline actor={audit?.created_by} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Version history accordion */}
        {!isNew && object && versioningEnabled && (
          <div className="border-t border-border-subtle">
            <button
              type="button"
              onClick={toggleHistory}
              className={clsx(
                'flex items-center gap-2 w-full px-4 py-3 text-xs font-medium transition-colors',
                showHistory
                  ? 'text-accent-fg bg-accent-muted border-b border-accent/30'
                  : 'text-fg-muted hover:text-fg hover:bg-surface-hover',
              )}
            >
              <IconHistory className="size-3.5 shrink-0" />
              Version history
              <span className={clsx(
                'ml-auto text-xs transition-transform duration-150',
                showHistory ? 'rotate-180' : '',
              )}>▾</span>
            </button>

            {showHistory && (
              <div className="max-h-[280px] overflow-y-auto">
                {versionsLoading ? (
                  <div className="px-4 py-4 space-y-2">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="space-y-1">
                        <div className="h-3 w-20 bg-surface-hover rounded animate-pulse" />
                        <div className="h-3 w-32 bg-surface-hover rounded animate-pulse" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <ul className="divide-y divide-border-subtle">
                    {/* Synthetic "Current Version" entry */}
                    <li className={clsx(
                      'px-4 py-2.5 flex items-start gap-2',
                      !previewingVersionId ? 'bg-success-muted' : 'hover:bg-surface-sunken',
                    )}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className={clsx('text-ui-xs font-medium leading-tight truncate', !previewingVersionId ? 'text-success-fg' : 'text-fg')}>
                            Current Version
                          </p>
                          {currentVersionType && (
                            <span className={clsx(
                              'inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide leading-none shrink-0',
                              currentVersionType === 'published' && 'bg-success-muted text-success-fg',
                              currentVersionType === 'staged'    && 'bg-purple-100 text-purple-700',
                              currentVersionType === 'scheduled' && 'bg-accent-muted text-accent-fg',
                              currentVersionType === 'draft'     && 'bg-surface-hover text-fg-muted',
                              currentVersionType === 'autosave'  && 'bg-sky-50 text-sky-500',
                            )}>
                              {currentVersionType === 'autosave' ? 'auto' : currentVersionType}
                            </span>
                          )}
                          {isCurrentLive && (
                            <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide leading-none bg-success-muted text-success-fg shrink-0">live</span>
                          )}
                        </div>
                        {versions[0] && (
                          <p className="text-[11px] text-fg-subtle mt-0.5" title={fullDateTime(versions[0].createdAt)}>
                            {relativeTime(versions[0].createdAt)}
                          </p>
                        )}
                      </div>
                      {previewingVersionId && (
                        <button
                          type="button"
                          onClick={exitPreview}
                          className="shrink-0 text-[11px] text-accent-fg hover:underline pt-0.5"
                        >
                          ← Back
                        </button>
                      )}
                    </li>

                    {versions.length <= 1 ? (
                      <li className="px-4 py-4 text-xs text-fg-subtle">No previous versions.</li>
                    ) : versions.slice(1).map((v: VersionEntry) => {
                      const isCurrent = previewingVersionId === v.id
                      const isLive = v.id === liveRevisionId
                      const creatorLabel = v.createdByType === 'member'
                        ? (v.createdByLabel ?? 'Admin')
                        : v.createdByType === 'api_key'
                        ? `Key ${v.createdBy?.slice(0, 6) ?? '?????'}`
                        : 'Admin'
                      const creatorText = v.createdBy && v.createdBy === currentMember?.memberId
                        ? `${creatorLabel} (You)`
                        : creatorLabel
                      return (
                        <li key={v.id} className={clsx(
                          'px-4 py-2.5 flex items-start gap-2',
                          isCurrent ? 'bg-warning-muted border-l-2 border-warning/40' : 'hover:bg-surface-sunken',
                        )}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className={clsx('text-ui-xs font-medium leading-tight truncate', isCurrent ? 'text-warning-fg' : 'text-fg')}>
                                {v.title ?? '(untitled)'}
                              </p>
                              {v.versionType && (
                                <span className={clsx(
                                  'inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide leading-none shrink-0',
                                  v.versionType === 'published'  && 'bg-success-muted text-success-fg',
                                  v.versionType === 'staged'     && 'bg-purple-100 text-purple-700',
                                  v.versionType === 'scheduled'  && 'bg-accent-muted text-accent-fg',
                                  v.versionType === 'draft'      && 'bg-surface-hover text-fg-muted',
                                  v.versionType === 'autosave'   && 'bg-sky-50 text-sky-500',
                                )}>
                                  {v.versionType === 'autosave' ? 'auto' : v.versionType}
                                </span>
                              )}
                              {isLive && (
                                <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide leading-none bg-success-muted text-success-fg shrink-0">live</span>
                              )}
                              {isCurrent && <span className="text-[10px] text-warning-fg font-normal shrink-0">← viewing</span>}
                            </div>
                            <p className="text-[11px] text-fg-subtle mt-0.5" title={fullDateTime(v.createdAt)}>
                              v{v.version} · {relativeTime(v.createdAt)}
                            </p>
                            <p className="text-[11px] text-fg-subtle">{creatorText}</p>
                          </div>
                          {!isCurrent && (
                            <button
                              type="button"
                              disabled={previewLoading}
                              onClick={() => viewVersion(v)}
                              className="shrink-0 text-[11px] text-accent-fg hover:underline disabled:opacity-40 transition-opacity pt-0.5"
                            >
                              View
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        </>
      )}
      </aside>
        </div>{/* stage + settings row */}
      </div>{/* editor column */}

      {/* Drag handle - resize the editor (25–40%); preview keeps the rest. */}
      {previewOpen && !editorHidden && (
        <div
          onPointerDown={startResize}
          title="Drag to resize"
          className="w-1.5 shrink-0 cursor-col-resize bg-border hover:bg-accent-strong/60 transition-colors touch-none"
        />
      )}

      {/* ── Preview column - the live-preview stage (chrome lives in the shared top bar) ── */}
      {previewOpen && previewSrc && previewCfg?.frontendUrl && (
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 relative flex flex-col">
          <LivePreviewCanvas
            src={previewSrc}
            targetOrigin={previewCfg.frontendUrl}
            width={previewBp.width}
            reloadKey={previewReloadKey}
            snapshot={(() => {
              // Overlay the active locale's translations onto the default-locale
              // values — but FALL BACK to the default for anything untranslated
              // (empty/blank), so a locale with no Tamil text shows the default,
              // not "Untitled" / blank fields. Mirrors server localizeRow.
              const overlay = activeLocale && activeLocale !== localesInfo?.defaultLocale
                ? (localeDrafts[activeLocale] ?? {}) : {}
              const isBlank = (v: unknown) =>
                v === null || v === undefined || v === ''
                || (Array.isArray(v) && v.length === 0)
                || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0)
              const values = { ...fieldValues }
              for (const [k, v] of Object.entries(overlay)) {
                if (k === 'title') continue
                if (!isBlank(v)) values[k] = v   // translated → override; blank → keep default
              }
              const localizedTitle = typeof overlay.title === 'string' && overlay.title.trim() ? overlay.title : title
              return {
                id: (object?.id as string) ?? '',
                type: params.typeName as string,
                title: localizedTitle,
                slug,
                status: object?.status as string | undefined,
                locale: activeLocale ?? localesInfo?.defaultLocale,
                values,
              } satisfies PreviewSnapshot
            })()}
          />
          {/* Floating dev cluster - bottom-right of the stage: SDK status + console.
              Out of the top bar so the chrome stays calm, over the frame so it's
              always reachable without crowding the controls. */}
          <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-full border border-border bg-surface/95 backdrop-blur-sm pl-2 pr-1 py-1 shadow-sm">
            <ConnectionBadge connected={previewConn.connected} />
            <button type="button" title="Front-end console" onClick={() => setShowConsole((v) => !v)}
              className={clsx('relative grid place-items-center size-6 rounded-full', showConsole ? 'bg-accent-muted text-accent-fg' : 'text-fg-subtle hover:bg-surface-hover')}>
              <IconCodeBox className="size-3.5" />
              {consoleErrors > 0 && <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 grid place-items-center text-[9px] rounded-full bg-danger text-white">{consoleErrors}</span>}
            </button>
          </div>
          </div>
          {showConsole && (
            <PreviewConsole logs={previewConn.logs} onClear={previewConn.clearLogs} onClose={() => setShowConsole(false)} />
          )}
        </div>
      )}
      </div>{/* split row */}
    </div>
  )
}
