

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import {
  IconImage, IconFileText, IconFilm, IconMusic, IconFile,
  IconUpload, IconSearch, IconX, IconCheck, IconSparkles,
  IconGlobe, IconCloud, IconFolder,
} from '@tangen/icons'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from '@/components/ui/dialog'
import { useAuthStore } from '@/lib/auth'
import { useCan } from '@/lib/use-can'
import { uploadWithProgress } from '@/lib/upload'
import { adminFetch } from '@/lib/api'
import { cachedAdminGet } from '@/lib/api-cache'
import { GenAIButton } from '@/components/gen-ai-button'
import { AIAssistantPanel } from '@/components/fields/ai-assistant-panel'
import { formatFileSize, getMediaCategory, buildThumbnailUrl } from '@/lib/media'
import { getMediaCategoryForMime, type MediaCategory } from '@tangen/types'
import { apiOrigin } from '@/lib/api-origin'

interface MediaAsset {
  id: string
  filename: string
  originalName: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  altText: string | null
  storagePath: string
  thumbnailPath: string | null
  ai?: { provider: string; model: string; prompt: string } | null
  /** AI drafts are false until "Add to Media"; ordinary uploads are always kept. */
  kept?: boolean
  /** locale → variant asset id — set when the asset serves per-language files. */
  localeAssets?: Record<string, string> | null
  /** Storage backend name — null/absent for local-disk assets. */
  storage?: string | null
}

interface FolderNode {
  id: string | null
  name: string
  parentId: string | null
  children: FolderNode[]
}

/** Flattens the folder tree into select options with depth indentation. */
export function flattenFolders(node: FolderNode | null, depth = 0): Array<{ id: string; label: string }> {
  if (!node) return []
  const out: Array<{ id: string; label: string }> = []
  // the root node represents "All files" and is rendered separately
  for (const child of node.children ?? []) {
    out.push({ id: child.id as string, label: `${'\u00a0\u00a0'.repeat(depth)}${child.name}` })
    out.push(...flattenFolders(child, depth + 1))
  }
  return out
}

/** File-input accept attr from the field's constraints (categories → wildcards). */
export function buildUploadAccept(accept?: MediaCategory[], mimeTypes?: string[]): string | undefined {
  const parts: string[] = [...(mimeTypes ?? [])]
  const CATEGORY_ACCEPT: Record<string, string> = {
    image: 'image/*', video: 'video/*', audio: 'audio/*',
    document: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.csv,.md',
  }
  for (const c of accept ?? []) {
    if (CATEGORY_ACCEPT[c]) parts.push(CATEGORY_ACCEPT[c])
  }
  return parts.length ? parts.join(',') : undefined
}

const CATEGORY_FILTERS: Array<{ label: string; value: '' | MediaCategory }> = [
  { label: 'All', value: '' },
  { label: 'Images', value: 'image' },
  { label: 'Video', value: 'video' },
  { label: 'Audio', value: 'audio' },
  { label: 'Documents', value: 'document' },
]

function AssetIcon({ mimeType }: { mimeType: string }) {
  const cat = getMediaCategory(mimeType)
  const cls = 'size-8 text-fg-faint'
  if (cat === 'image') return <IconImage className={cls} />
  if (cat === 'video') return <IconFilm className={cls} />
  if (cat === 'audio') return <IconMusic className={cls} />
  if (cat === 'document') return <IconFileText className={cls} />
  return <IconFile className={cls} />
}

// ── Asset thumbnail grid cell ──────────────────────────────────────────────────

function AssetCell({
  asset, selected, onSelect,
}: {
  asset: MediaAsset
  selected: boolean
  onSelect: () => void
}) {
  const cat = getMediaCategory(asset.mimeType)
  const thumbUrl = asset.thumbnailPath ? buildThumbnailUrl(asset.id) : null

  return (
    <button
      onClick={onSelect}
      className={clsx(
        'relative group rounded-lg border-2 overflow-hidden transition-all text-left',
        selected
          ? 'border-accent ring-2 ring-focus/25'
          : 'border-border hover:border-accent/30',
      )}
    >
      <div className="aspect-square bg-surface-sunken flex items-center justify-center overflow-hidden">
        {cat === 'image' && thumbUrl ? (
          <img
            src={thumbUrl}
            alt={asset.altText ?? asset.originalName}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <AssetIcon mimeType={asset.mimeType} />
        )}
      </div>
      <div className="px-2 py-1.5">
        <p className="text-xs text-fg truncate">{asset.originalName}</p>
        <p className="text-[10px] text-fg-subtle">{formatFileSize(asset.sizeBytes)}</p>
      </div>
      {!selected && (asset.ai || (asset.storage && asset.storage !== 'local')) && (
        <span className="absolute top-1.5 right-1.5 flex items-center gap-1">
          {asset.storage && asset.storage !== 'local' && (
            <span
              title={`Cloud storage - ${asset.storage.toUpperCase()}`}
              className="flex items-center justify-center size-5 rounded-full bg-sky-500/90 text-white shadow-sm"
            >
              <IconCloud className="size-3" />
            </span>
          )}
          {asset.ai && (
            <span
              title={`AI generated - ${asset.ai.provider} · ${asset.ai.model}`}
              className="flex items-center justify-center size-5 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm"
            >
              <IconSparkles className="size-3" />
            </span>
          )}
        </span>
      )}
      {asset.localeAssets && Object.keys(asset.localeAssets).length > 0 && (
        <span
          title={`Localized - ${Object.keys(asset.localeAssets).join(', ')}`}
          className="absolute top-1.5 left-1.5 flex items-center justify-center size-5 rounded-full bg-white/90 border border-border text-fg-muted shadow-sm"
        >
          <IconGlobe className="size-3" />
        </span>
      )}
      {selected && (
        <div className="absolute top-1.5 right-1.5 size-5 rounded-full bg-accent flex items-center justify-center">
          <IconCheck className="size-3 text-white" />
        </div>
      )}
    </button>
  )
}

// ── Picker modal ──────────────────────────────────────────────────────────────

export interface MediaPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (asset: MediaAsset) => void
  mimeTypes?: string[]
  /** High-level category allow-list (field config `accept`) — union with mimeTypes. */
  accept?: MediaCategory[]
  currentId?: string | null
  /** Field-level processing config sent with uploads (variants/skipPresets/imageOverrides). */
  uploadOptions?: {
    variants?: unknown[]
    skipPresets?: boolean
    imageOverrides?: { quality?: number; format?: string }
  }
  /** Workspace id — required to offer the Gen AI panel (image generation) in the picker. */
  workspaceId?: string
}

/** Whether the field's category constraints resolve to images ONLY (the gate for AI gen). */
export function isImageOnlyScope(allowedCategories: MediaCategory[] | null): boolean {
  return allowedCategories?.length === 1 && allowedCategories[0] === 'image'
}

export function MediaPicker({ open, onOpenChange, onSelect, mimeTypes, accept, currentId, uploadOptions, workspaceId }: MediaPickerProps) {
  const { accessToken } = useAuthStore()
  const { hasCapability } = useCan()
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  // Categories allowed by the field's constraints (union of accept + mimeTypes kinds)
  const allowedCategories: MediaCategory[] | null = (() => {
    if (!accept?.length && !mimeTypes?.length) return null   // unconstrained
    const set = new Set<MediaCategory>(accept ?? [])
    for (const m of mimeTypes ?? []) set.add(getMediaCategoryForMime(m.includes('/') ? m.replace('/*', '/x') : `${m}/x`))
    return [...set]
  })()
  const [categoryFilter, setCategoryFilter] = useState<'' | MediaCategory>(
    allowedCategories?.length === 1 ? allowedCategories[0] : '',
  )
  const [selectedId, setSelectedId] = useState<string | null>(currentId ?? null)
  const [uploading, setUploading] = useState(false)
  const [folderTree, setFolderTree] = useState<FolderNode | null>(null)
  const [folderId, setFolderId] = useState<string>('')   // '' = all files
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── AI image generation (only when the field is image-scoped) ─────────────────
  // Reuses the SAME Gen AI chat panel as the media gallery — model picker, guideline/
  // brand-profile picker, threads and all. The panel floats ABOVE the picker (it stays
  // open): while it's up we make the picker non-modal (so the panel is interactive) and
  // guard the picker's outside-close, and lift the panel into a z-[60] stacking context.
  const isImageScoped = isImageOnlyScope(allowedCategories)
  const canUseAI = hasCapability('use:ai')
  const [imageAiEnabled, setImageAiEnabled] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const showGenerate = isImageScoped && canUseAI && imageAiEnabled && !!workspaceId

  // Is any configured provider actually image-capable? (mirrors the media library page)
  useEffect(() => {
    if (!open || !accessToken || !isImageScoped || !canUseAI) return
    cachedAdminGet<{ data: { providers: { available: boolean; imageModels?: string[] }[] } }>('/admin/ai/providers')
      .then((r) => setImageAiEnabled(r.data.providers.some((p) => p.available && (p.imageModels?.length ?? 0) > 0)))
      .catch(() => setImageAiEnabled(false))
  }, [open, accessToken, isImageScoped, canUseAI])

  // Close the panel if the picker itself closes, so it can't linger orphaned.
  useEffect(() => { if (!open) setGenOpen(false) }, [open])

  /** Open the Gen AI panel over the (still-open) picker. */
  function openGenerate() { setGenOpen(true) }
  /** Panel closed. */
  function closeGenerate() { setGenOpen(false) }
  /** A draft was KEPT ("Add to media") — it's now a real asset, so it appears in the grid.
   *  Refresh and select it (drafts themselves are never shown in the grid). */
  function onKept(asset: Record<string, unknown>) {
    const id = (asset as { id?: string }).id
    if (!id) return
    void fetchAssets().then(() => setSelectedId(id))
  }


  // Read the current search via a ref so typing does NOT recreate fetchAssets:
  // with `search` in the deps, every keystroke refired the [open, fetchAssets]
  // effect with an immediate undebounced GET, then the 300ms timer sent the
  // identical request again - two /media calls per keystroke.
  const searchValRef = useRef('')
  const fetchAssets = useCallback(async (q?: string) => {
    if (!accessToken) return
    setLoading(true)
    try {
      const term = q ?? searchValRef.current
      const extra: Record<string, string> = {}
      if (categoryFilter) extra.category = categoryFilter
      if (term) extra.q = term
      if (folderId) extra.folderId = folderId
      const res = await adminFetch<{ data: MediaAsset[] }>('/media', undefined, extra)
      setAssets(res.data)
    } catch {
      setAssets([])
    } finally {
      setLoading(false)
    }
  }, [accessToken, categoryFilter, folderId])

  useEffect(() => {
    if (open) fetchAssets()
  }, [open, fetchAssets])

  // Folder tree — same logical folders as the media library
  useEffect(() => {
    if (!open || !accessToken) return
    adminFetch<{ data: FolderNode }>('/media/folders')
      .then((res) => setFolderTree(res.data))
      .catch(() => setFolderTree(null))
  }, [open, accessToken])

  useEffect(() => {
    if (open) setSelectedId(currentId ?? null)
  }, [open, currentId])

  function handleSearchChange(q: string) {
    searchValRef.current = q
    setSearch(q)
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => fetchAssets(q), 300)
  }

  const [uploadPercent, setUploadPercent] = useState<number | null>(null)

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('file', file)
        // uploads through a field honor its schema-level processing config
        if (uploadOptions?.variants?.length) form.append('variants', JSON.stringify(uploadOptions.variants))
        if (uploadOptions?.skipPresets) form.append('skipPresets', 'true')
        if (uploadOptions?.imageOverrides) form.append('imageOverrides', JSON.stringify(uploadOptions.imageOverrides))
        if (folderId) form.append('folderId', folderId)
        const apiHost = apiOrigin()
        const token = useAuthStore.getState().accessToken
        await uploadWithProgress(`${apiHost}/api/v1/media/upload`, form, {
          token,
          onProgress: (p) => setUploadPercent(p.percent),
        })
      }
      await fetchAssets()
    } finally {
      setUploading(false)
      setUploadPercent(null)
    }
  }

  function handleConfirm() {
    const asset = assets.find((a) => a.id === selectedId)
    if (asset) {
      onSelect(asset)
      onOpenChange(false)
    }
  }

  // When the field constrains kinds, never show "All" — only allowed category tabs
  const visibleFilters = allowedCategories
    ? CATEGORY_FILTERS.filter((f) => f.value && allowedCategories.includes(f.value as MediaCategory))
    : CATEGORY_FILTERS

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange} modal={!genOpen}>
      <DialogContent
        className="max-w-3xl h-[80vh] flex flex-col p-0"
        // The header renders its own close button — suppress DialogContent's default X
        // (otherwise two X icons overlap in the corner).
        showClose={false}
        // While the Gen AI panel is up, interacting with it (or pressing Escape to close
        // it) must not dismiss the picker underneath.
        onPointerDownOutside={(e) => { if (genOpen) e.preventDefault() }}
        onInteractOutside={(e) => { if (genOpen) e.preventDefault() }}
        onEscapeKeyDown={(e) => { if (genOpen) e.preventDefault() }}
      >
        <DialogHeader className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle>Choose media</DialogTitle>
            <DialogClose className="rounded-md p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg-muted transition-colors">
              <IconX className="size-4" />
            </DialogClose>
          </div>
        </DialogHeader>

        {/* Toolbar */}
        <div className="px-5 py-3 border-b border-border flex items-center gap-3 shrink-0">
          <div className="relative flex-1">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-fg-subtle pointer-events-none" />
            <input
              value={search}
              onChange={(e) => handleSearchChange((e.target as HTMLInputElement).value)}
              placeholder="Search…"
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-border bg-surface outline-none focus-visible:ring-[3px] focus-visible:ring-focus/25 focus-visible:border-focus-border"
            />
          </div>

          {folderTree && flattenFolders(folderTree).length > 0 && (
            <div className="relative shrink-0">
              <IconFolder className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-fg-subtle pointer-events-none" />
              <select
                value={folderId}
                onChange={(e) => setFolderId((e.target as HTMLSelectElement).value)}
                className="pl-8 pr-7 py-1.5 text-xs rounded-md border border-border bg-surface text-fg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-focus/25 focus-visible:border-focus-border appearance-none cursor-pointer max-w-[180px]"
                title="Filter by folder - uploads land in the selected folder"
              >
                <option value="">All files</option>
                {flattenFolders(folderTree).map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </div>
          )}

          {visibleFilters.length > 1 && (
            <div className="flex gap-1">
              {visibleFilters.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setCategoryFilter(f.value)}
                  className={clsx(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                    categoryFilter === f.value
                      ? 'bg-accent-muted text-accent-fg border border-accent/30'
                      : 'text-fg-muted hover:bg-surface-hover border border-transparent',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {showGenerate && (
            <GenAIButton onClick={openGenerate} title="Generate an image with Gen AI">
              Generate with Gen AI
            </GenAIButton>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-fg-muted border border-border hover:bg-surface-sunken transition-colors disabled:opacity-50"
          >
            <IconUpload className="size-3.5" />
            {uploading ? (uploadPercent != null && uploadPercent >= 0 ? `${uploadPercent}%` : 'Uploading…') : 'Upload'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept={buildUploadAccept(accept, mimeTypes)}
            onChange={(e) => handleUpload((e.target as HTMLInputElement).files)}
          />
        </div>
        {uploading && (
          <div className="px-5 pb-2">
            <div className="h-1.5 w-full rounded-full bg-surface-sunken overflow-hidden">
              <div
                className="h-full bg-accent-strong transition-[width] duration-150"
                style={{ width: uploadPercent != null && uploadPercent >= 0 ? `${uploadPercent}%` : '100%' }}
              />
            </div>
          </div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-lg bg-surface-hover animate-pulse" />
              ))}
            </div>
          ) : assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2">
              <IconImage className="size-8 text-fg-faint" />
              <p className="text-sm text-fg-subtle">No assets found</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
              {assets.map((asset) => (
                <AssetCell
                  key={asset.id}
                  asset={asset}
                  selected={selectedId === asset.id}
                  onSelect={() => setSelectedId(asset.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between shrink-0">
          <p className="text-xs text-fg-subtle">{assets.length} asset{assets.length !== 1 ? 's' : ''}</p>
          <div className="flex gap-2">
            <button
              onClick={() => onOpenChange(false)}
              className="px-3 py-1.5 rounded-md text-sm text-fg-muted border border-border hover:bg-surface-sunken transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selectedId}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-accent-strong text-white hover:bg-accent-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Select
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* The SAME Gen AI chat as the media gallery (library mode) - provider/model +
        guideline/brand-profile pickers, threads and all. PORTALED to <body> in a z-[60]
        stacking context so it paints ABOVE the picker's own body-level z-50 portal (an
        inline z-index can't win against a portal in a different stacking context).
        Generated drafts live only in the chat; "Add to media" (onKept) promotes one into
        the library, then it appears in the grid, selected. */}
    {showGenerate && workspaceId && genOpen && typeof document !== 'undefined' && createPortal(
      <>
      {/* The picker goes non-modal while the panel is open (so the panel is interactive),
          and Radix only renders its dim overlay in modal mode - so restore the backdrop
          ourselves, behind the picker content (z-50) and the panel (z-60). */}
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] pointer-events-none" />
      <div className="relative z-[60]">
        <AIAssistantPanel
          open={genOpen}
          onClose={closeGenerate}
          workspaceId={workspaceId}
          typeName="__library"
          objectId="__library"
          fields={[]}
          title=""
          values={{}}
          tagField={null}
          onApply={() => {}}
          onApplyField={() => {}}
          onApplyPanel={() => {}}
          mode="library"
          folderId={folderId || null}
          onImageKept={onKept}
          onImageRemoved={(id) => {
            setSelectedId((cur) => (cur === id ? null : cur))
            void fetchAssets()
          }}
        />
      </div>
      </>,
      document.body,
    )}
    </>
  )
}
