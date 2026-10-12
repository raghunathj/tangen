

import { useEffect, useRef, useState, useCallback } from 'react'
import { Callout } from '@tangen/ui'
import { useParams, useSearchParams } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  IconImage, IconFileText, IconFilm, IconMusic, IconFile,
  IconUpload, IconFolderAdd, IconSearch, IconFolder,
  IconX, IconCheck, IconCopy, IconSparkles, IconGlobe, IconCloud, IconTrash} from '@tangen/icons'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '@/lib/auth'
import { uploadWithProgress } from '@/lib/upload'
import { adminFetch } from '@/lib/api'
import { cachedAdminGet } from '@/lib/api-cache'
import { toast } from '@/lib/toast'
import { useLocaleStore } from '@/lib/locale'
import { LocaleSwitcher } from '@/components/i18n/locale-switcher'
import { useUIStore } from '@/lib/ui-store'
import { usePageHeader } from '@/lib/page-header'
import { AIAssistantPanel } from '@/components/fields/ai-assistant-panel'
import { LocalizeAssetModal } from '@/components/media/localize-asset-modal'
import { MediaDeleteDialog } from '@/components/media/media-delete-dialog'
import { LabelInput } from '@/components/labels/label-input'
import { GenAIButton } from '@/components/gen-ai-button'
import { useCan } from '@/lib/use-can'
import { formatFileSize, getMediaCategory, buildStaticUrl, buildTransformUrl, buildFileUrl } from '@/lib/media'
import { apiOrigin } from '@/lib/api-origin'


interface VariantMeta {
  storagePath: string
  width: number
  height: number
  format: string
  sizeBytes: number
}

interface MediaAsset {
  storage?: string | null
  id: string
  folderId: string | null
  filename: string
  originalName: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  altText: string | null
  tags: string[]
  storagePath: string
  thumbnailPath: string | null
  variants: Record<string, VariantMeta>
  createdAt: string
  title?: string | null
  caption?: string | null
  ai?: { provider: string; model: string; prompt: string } | null
  /** AI drafts are false until "Add to Media"; ordinary uploads are always kept. */
  kept?: boolean
  i18n?: Record<string, { title?: string; caption?: string; altText?: string }> | null
  localeAssets?: Record<string, string> | null
}

interface FolderNode {
  id: string | null
  name: string
  parentId: string | null
  children: FolderNode[]
}

const MIME_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Images', value: 'image' },
  { label: 'Video', value: 'video' },
  { label: 'Audio', value: 'audio' },
  { label: 'Documents', value: 'application/pdf' },
]

function CategoryIcon({ mimeType, size = 20 }: { mimeType: string; size?: number }) {
  const cat = getMediaCategory(mimeType)
  const cls = 'text-fg-subtle'
  const px = `${size}px`
  if (cat === 'image') return <IconImage style={{ width: px, height: px }} className={cls} />
  if (cat === 'video') return <IconFilm style={{ width: px, height: px }} className={cls} />
  if (cat === 'audio') return <IconMusic style={{ width: px, height: px }} className={cls} />
  if (cat === 'document') return <IconFileText style={{ width: px, height: px }} className={cls} />
  return <IconFile style={{ width: px, height: px }} className={cls} />
}

function UrlCopyRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div>
      <p className="text-[11px] font-medium text-fg-muted mb-1 capitalize">{label}</p>
      <div className="flex items-center gap-1.5 bg-surface-sunken border border-border rounded-md px-2 py-1.5 min-w-0">
        <code className="text-[11px] text-fg-muted truncate flex-1">{url}</code>
        <button
          onClick={copy}
          title="Copy URL"
          className="shrink-0 p-0.5 rounded hover:bg-surface-hover text-fg-subtle hover:text-fg transition-colors"
        >
          {copied
            ? <IconCheck className="size-3 text-success-fg" />
            : <IconCopy className="size-3" />}
        </button>
      </div>
    </div>
  )
}

function PromptRow({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="flex items-start gap-1.5">
      <p className="text-xs text-fg flex-1 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">{prompt}</p>
      <button
        onClick={copy}
        title="Copy prompt - reuse it in Gen AI"
        className="shrink-0 p-0.5 rounded hover:bg-accent-muted text-accent hover:text-accent-fg transition-colors cursor-pointer"
      >
        {copied
          ? <IconCheck className="size-3 text-success-fg" />
          : <IconCopy className="size-3" />}
      </button>
    </div>
  )
}

function FolderTree({
  node,
  depth = 0,
  currentId,
  onSelect,
}: {
  node: FolderNode
  depth?: number
  currentId: string | null
  onSelect: (id: string | null) => void
}) {
  const isActive = node.id === currentId
  return (
    <>
      <button
        onClick={() => onSelect(node.id)}
        className={clsx(
          'flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm transition-colors text-left',
          isActive ? 'text-accent-fg bg-accent-muted' : 'text-fg hover:bg-surface-hover',
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <IconFolder className={clsx('size-3.5 shrink-0', isActive ? 'text-accent' : 'text-fg-subtle')} />
        <span className="truncate">{node.name}</span>
      </button>
      {node.children.map((child) => (
        <FolderTree
          key={child.id}
          node={child}
          depth={depth + 1}
          currentId={currentId}
          onSelect={onSelect}
        />
      ))}
    </>
  )
}

export default function MediaBrowserPage() {
  const params = useParams() as { workspaceId: string; }
  const { can, hasCapability } = useCan()
  const canWriteMedia = can('write', 'media')
  const canUseAI = hasCapability('use:ai')
  const { accessToken } = useAuthStore()

  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [folderTree, setFolderTree] = useState<FolderNode | null>(null)
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [mimeFilter, setMimeFilter] = useState('')
  const [missingAlt, setMissingAlt] = useState(() => new URLSearchParams(window.location.search).get('missingAlt') === '1')
  // Seed the filter from ?q= so the command palette can deep-link a search.
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const [selected, setSelected] = useState<MediaAsset | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Gen AI: image-capable providers + generate/regenerate state
  const [imageProviders, setImageProviders] = useState<{ name: string; imageModels: string[] }[]>([])
  const [genOpen, setGenOpen] = useState(false)
  const [genPrefill, setGenPrefill] = useState<{ text: string; provider?: string; model?: string } | null>(null)
  const [detailTab, setDetailTab] = useState<'info' | 'urls' | 'localization' | 'ai'>('info')
  const [localizeOpen, setLocalizeOpen] = useState(false)
  // Locale-variant asset details (for per-language URL sets in the URLs tab)
  const [localeAssetDetails, setLocaleAssetDetails] = useState<Record<string, MediaAsset>>({})
  // Ambient locale from the TopBar — media title/alt/caption edits follow it
  const assetLocale = useLocaleStore((st) => (st.enabled ? st.activeLocale : null))
  const localesEnabled = useLocaleStore((st) => st.enabled)
  const localeDefs = useLocaleStore((st) => st.locales)
  const defaultLocale = useLocaleStore((st) => st.defaultLocale)

  useEffect(() => {
    if (!accessToken) return
    cachedAdminGet<{ data: { providers: { name: string; available: boolean; imageModels?: string[] }[] } }>('/admin/ai/providers')
      .then((r) => {
        const capable = r.data.providers
          .filter((p) => p.available && (p.imageModels?.length ?? 0) > 0)
          .map((p) => ({ name: p.name, imageModels: p.imageModels! }))
        setImageProviders(capable)
      })
      .catch(() => setImageProviders([]))
  }, [accessToken])

  /** Regenerate = open Gen AI with the stored prompt ready to edit and send. */
  function regenerateInChat() {
    if (!selected?.ai) return
    setGenPrefill({ text: selected.ai.prompt, provider: selected.ai.provider, model: selected.ai.model })
    setGenOpen(true)
  }


  // The gallery hosts Gen AI (library mode) — the TopBar button opens it here
  useEffect(() => {
    if (imageProviders.length === 0) return
    useUIStore.getState().setGenAIHost(() => setGenOpen(true))
    return () => useUIStore.getState().setGenAIHost(null)
  }, [imageProviders.length])

  // selecting a different asset resets the detail tab + editable fields
  const [editTitle, setEditTitle] = useState('')
  const [editAlt, setEditAlt] = useState('')
  const [editCaption, setEditCaption] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)
  useEffect(() => { setDetailTab('info') }, [selected?.id])

  // Load each language's variant asset so the URLs tab can list its renditions
  useEffect(() => {
    const map = selected?.localeAssets
    if (!map || Object.keys(map).length === 0) { setLocaleAssetDetails({}); return }
    let cancelled = false
    Promise.all(
      Object.entries(map).map(async ([code, id]) => {
        try {
          const r = await adminFetch<{ data: MediaAsset }>(`/media/asset/${id}`)
          return [code, r.data] as const
        } catch { return null }
      }),
    ).then((entries) => {
      if (!cancelled) {
        setLocaleAssetDetails(Object.fromEntries(entries.filter((e): e is [string, MediaAsset] => e !== null)))
      }
    })
    return () => { cancelled = true }
  }, [selected?.id, selected?.localeAssets])
  useEffect(() => {
    if (assetLocale) {
      const section = selected?.i18n?.[assetLocale] ?? {}
      setEditTitle(section.title ?? '')
      setEditAlt(section.altText ?? '')
      setEditCaption(section.caption ?? '')
    } else {
      setEditTitle(selected?.title ?? '')
      setEditAlt(selected?.altText ?? '')
      setEditCaption(selected?.caption ?? '')
    }
  }, [selected?.id, assetLocale])

  const metaBaseline = assetLocale
    ? { title: selected?.i18n?.[assetLocale]?.title ?? '', alt: selected?.i18n?.[assetLocale]?.altText ?? '', caption: selected?.i18n?.[assetLocale]?.caption ?? '' }
    : { title: selected?.title ?? '', alt: selected?.altText ?? '', caption: selected?.caption ?? '' }
  const metaDirty = selected && (
    editTitle !== metaBaseline.title ||
    editAlt !== metaBaseline.alt ||
    editCaption !== metaBaseline.caption
  )

  async function saveAssetMeta() {
    if (!selected || savingMeta) return
    setSavingMeta(true)
    try {
      const res = await adminFetch<{ data: MediaAsset }>(`/media/asset/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: editTitle, altText: editAlt, caption: editCaption, ...(assetLocale ? { locale: assetLocale } : {}) }),
      })
      setSelected(res.data)
      setAssets((list) => list.map((a) => (a.id === res.data.id ? res.data : a)))
      toast.success('Asset details saved')
    } catch (e: any) {
      toast.error('Could not save', e.message)
    } finally {
      setSavingMeta(false)
    }
  }

  const fetchAssets = useCallback(async (q?: string) => {
    if (!accessToken) return
    setLoading(true)
    try {
      const extra: Record<string, string> = {}
      if (currentFolderId) extra.folderId = currentFolderId
      if (mimeFilter) extra.mimeType = mimeFilter
      if (missingAlt) extra.missingAlt = '1'
      if (q !== undefined ? q : search) extra.q = q ?? search
      const res = await adminFetch<{ data: MediaAsset[]; meta: { total: number } }>(
        '/media', undefined, extra,
      )
      setAssets(res.data)
      setTotal(res.meta.total)
    } catch {
      setAssets([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [accessToken, currentFolderId, mimeFilter, missingAlt, search])

  const fetchFolders = useCallback(async () => {
    if (!accessToken) return
    try {
      const res = await adminFetch<{ data: FolderNode }>('/media/folders')
      setFolderTree(res.data)
    } catch {}
  }, [accessToken])

  useEffect(() => {
    fetchFolders()
  }, [fetchFolders])

  useEffect(() => {
    fetchAssets()
  }, [currentFolderId, mimeFilter])

  function handleSearchChange(q: string) {
    setSearch(q)
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    if (!q) { setLoading(true); fetchAssets(q); return }
    searchDebounce.current = setTimeout(() => { setLoading(true); fetchAssets(q) }, 300)
  }

  const [uploadProgress, setUploadProgress] = useState<{ name: string; percent: number; index: number; total: number } | null>(null)

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadError(null)
    const list = Array.from(files)
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i]
        const form = new FormData()
        form.append('file', file)
        if (currentFolderId) form.append('folderId', currentFolderId)

        const apiHost = apiOrigin()
        const token = useAuthStore.getState().accessToken
        setUploadProgress({ name: file.name, percent: 0, index: i + 1, total: list.length })
        await uploadWithProgress(`${apiHost}/api/v1/media/upload`, form, {
          token,
          onProgress: (p) => setUploadProgress({ name: file.name, percent: p.percent, index: i + 1, total: list.length }),
        })
      }
      await fetchAssets()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      setUploadProgress(null)
    }
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return
    try {
      await adminFetch('/media/folders', {
        method: 'POST',
        body: JSON.stringify({ name: newFolderName.trim(), parentId: currentFolderId }),
      })
      setNewFolderName('')
      setShowNewFolder(false)
      await fetchFolders()
    } catch {}
  }

  // Page chrome — search in the center, mime filters as tabs, CTAs on the right
  usePageHeader({
    title: 'Media',
    icon: <IconImage className="size-4" />,
    description: 'Files and images shared across this environment',
    tabsRight: (
      <div className="flex items-center gap-2 w-64 bg-surface-sunken border border-border rounded-lg px-3 py-1.5">
        <IconSearch className="size-3.5 text-fg-subtle shrink-0" />
        <input
          type="text"
          placeholder="Search files…"
          value={search}
          onChange={(e) => handleSearchChange((e.target as HTMLInputElement).value)}
          className="bg-transparent text-sm text-fg placeholder:text-fg-subtle flex-1 border-0 outline-none focus:outline-none focus:ring-0"
        />
      </div>
    ),
    actions: !canWriteMedia ? null : (
      <>
        {imageProviders.length > 0 && canUseAI && (
          <GenAIButton size="xs" onClick={() => setGenOpen(true)} title="Generate images with Gen AI">
            Generate with Gen AI
          </GenAIButton>
        )}
        <Button
          variant="primary"
          size="sm"
          icon={<IconUpload className="size-3.5" />}
          isLoading={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploadProgress
            ? `${uploadProgress.total > 1 ? `${uploadProgress.index}/${uploadProgress.total} · ` : ''}${uploadProgress.percent >= 0 ? `${uploadProgress.percent}%` : 'Uploading…'}`
            : 'Upload'}
        </Button>
      </>
    ),
    tabs: MIME_FILTERS.map((f) => ({ id: f.value, label: f.label })),
    activeTab: mimeFilter,
    onTabChange: (id) => { setLoading(true); setMimeFilter(id) },
  }, [search, imageProviders.length, uploading, uploadProgress, mimeFilter, canWriteMedia])

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    handleUpload(e.dataTransfer.files)
  }

  return (
    <div
      className="relative flex flex-1 min-h-0"
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {/* Upload progress bar - spans the top while files upload */}
      {uploadProgress && (
        <div className="absolute top-0 inset-x-0 z-50 h-1 bg-surface-sunken">
          <div
            className="h-full bg-accent-strong transition-[width] duration-150"
            style={{ width: uploadProgress.percent >= 0 ? `${uploadProgress.percent}%` : '100%' }}
          />
        </div>
      )}
      {/* Drop overlay */}
      {dragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-accent-muted/90 border-2 border-dashed border-accent pointer-events-none">
          <IconUpload className="size-10 text-accent mb-3" />
          <p className="text-accent-fg font-medium">Drop files to upload</p>
        </div>
      )}

      {/* Folder sidebar */}
      <aside className="w-52 shrink-0 border-r border-border bg-surface flex flex-col overflow-hidden">
        <div className="px-3 py-3 border-b border-border flex items-center justify-between">
          <span className="text-xs font-medium text-fg-muted">Folders</span>
          <button
            onClick={() => setShowNewFolder((v) => !v)}
            className="p-1 rounded hover:bg-surface-hover text-fg-subtle hover:text-fg transition-colors"
            title="New folder"
          >
            <IconFolderAdd className="size-3.5" />
          </button>
        </div>

        {showNewFolder && (
          <form
            onSubmit={(e) => { e.preventDefault(); handleCreateFolder() }}
            className="flex gap-1 px-2 py-2 border-b border-border"
          >
            <input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName((e.target as HTMLInputElement).value)}
              placeholder="Folder name"
              className="flex-1 min-w-0 text-xs border border-border rounded px-2 py-1 focus:outline-none focus-visible:border-focus-border"
            />
            <button type="submit" aria-label="Create folder" className="p-1 rounded text-accent-fg hover:bg-accent-muted"><IconCheck className="size-3.5" /></button>
            <button type="button" aria-label="Cancel new folder" onClick={() => setShowNewFolder(false)} className="p-1 rounded text-fg-subtle hover:bg-surface-hover"><IconX className="size-3.5" /></button>
          </form>
        )}

        <nav className="flex-1 overflow-y-auto py-1.5 px-1.5">
          {/* Root / All files */}
          <button
            onClick={() => { setLoading(true); setCurrentFolderId(null) }}
            className={clsx(
              'flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm transition-colors text-left',
              currentFolderId === null ? 'text-accent-fg bg-accent-muted' : 'text-fg hover:bg-surface-hover',
            )}
          >
            <IconFolder className={clsx('size-3.5 shrink-0', currentFolderId === null ? 'text-accent' : 'text-fg-subtle')} />
            <span>All files</span>
          </button>
          {folderTree?.children.map((child) => (
            <FolderTree
              key={child.id}
              node={child}
              depth={0}
              currentId={currentFolderId}
              onSelect={(id) => { setLoading(true); setCurrentFolderId(id) }}
            />
          ))}
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Upload input - triggered from the header action */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleUpload((e.target as HTMLInputElement).files)}
        />

        {uploadError && (
          <Callout variant="danger" className="mx-5 mt-3">
            <p className="text-sm">{uploadError}</p>
          </Callout>
        )}

        {/* Asset grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {missingAlt && (
            <div className="mb-3 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning-muted px-2.5 py-1 text-xs font-medium text-warning-fg">
                Showing files missing alt text
                <button type="button" aria-label="Clear filter" className="hover:text-warning-fg" onClick={() => setMissingAlt(false)}>✕</button>
              </span>
            </div>
          )}
          {loading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 animate-pulse">
              {Array.from({ length: 16 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border overflow-hidden bg-surface">
                  <div className="h-[100px] bg-surface-hover" />
                  <div className="px-2 py-2 space-y-1">
                    <div className="h-3 w-full bg-surface-hover rounded" />
                    <div className="h-3 w-10 bg-surface-hover rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <IconImage className="size-10 text-fg-faint" />
              <div className="text-center">
                <p className="text-sm text-fg-muted mb-1">
                  {search ? `No files matching "${search}"` : 'No files yet'}
                </p>
                {!search && (
                  <p className="text-xs text-fg-subtle">Drag and drop files here or click Upload</p>
                )}
              </div>
              {!search && (
                <Button variant="secondary" size="sm" icon={<IconUpload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                  Upload files
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                {assets.map((asset) => {
                  const thumbUrl = asset.thumbnailPath ? buildStaticUrl(asset.thumbnailPath) : null
                  const isSelected = selected?.id === asset.id
                  return (
                    <button
                      key={asset.id}
                      onClick={() => setSelected(isSelected ? null : asset)}
                      className={clsx(
                        'group relative flex flex-col rounded-xl border bg-surface overflow-hidden text-left transition-all',
                        isSelected
                          ? 'border-accent ring-2 ring-focus/25'
                          : 'border-border hover:border-border-strong hover:shadow-sm',
                      )}
                    >
                      {/* Thumbnail */}
                      <div className="relative flex items-center justify-center h-[100px] bg-surface-sunken">
                        {thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumbUrl}
                            alt={asset.altText ?? asset.originalName}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <CategoryIcon mimeType={asset.mimeType} size={32} />
                        )}
                        {(asset.ai || (asset.storage && asset.storage !== 'local')) && (
                          <span className="absolute top-1.5 right-1.5 flex items-center gap-1">
                            {asset.storage && asset.storage !== 'local' && (
                              <span
                                title={`Cloud storage - ${asset.storage.toUpperCase()}`}
                                className="flex items-center justify-center w-5 h-5 rounded-full bg-sky-500/90 text-white shadow-sm"
                              >
                                <IconCloud className="w-3 h-3" />
                              </span>
                            )}
                            {asset.ai && (
                              <span
                                title={`AI generated - ${asset.ai.provider} · ${asset.ai.model}`}
                                className="flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm"
                              >
                                <IconSparkles className="w-3 h-3" />
                              </span>
                            )}
                          </span>
                        )}
                        {asset.localeAssets && Object.keys(asset.localeAssets).length > 0 && (
                          <span
                            title={`Localized - ${Object.keys(asset.localeAssets).join(', ')}`}
                            className="absolute top-1.5 left-1.5 flex items-center justify-center w-5 h-5 rounded-full bg-white/90 border border-border text-fg-muted shadow-sm"
                          >
                            <IconGlobe className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                      {/* Meta */}
                      <div className="px-2 py-2">
                        <p className="text-xs font-medium text-fg truncate">{asset.originalName}</p>
                        <p className="text-xs text-fg-subtle mt-0.5">{formatFileSize(asset.sizeBytes)}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
              {total > assets.length && (
                <p className="text-xs text-fg-subtle text-center mt-4">
                  Showing {assets.length} of {total} files
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <aside className="w-72 shrink-0 border-l border-border bg-surface flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <span className="text-sm font-medium text-fg">Details</span>
            <button onClick={() => setSelected(null)} className="p-1 rounded hover:bg-surface-hover text-fg-subtle">
              <IconX className="size-3.5" />
            </button>
          </div>

          {/* Preview */}
          <div className="flex items-center justify-center h-40 bg-surface-sunken border-b border-border shrink-0">
            {selected.thumbnailPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={buildStaticUrl(selected.thumbnailPath)}
                alt={selected.altText ?? selected.originalName}
                className="max-h-full max-w-full object-contain"
                loading="lazy"
            decoding="async"
          />
            ) : (
              <CategoryIcon mimeType={selected.mimeType} size={40} />
            )}
          </div>

          {/* Detail tabs */}
          <div className="flex items-center gap-1 px-3 pt-2 border-b border-border shrink-0">
            {([['info', 'Info'], ['urls', 'URLs'], ...(localesEnabled ? [['localization', 'Localization']] : []), ...(selected.ai ? [['ai', 'AI']] : [])] as [typeof detailTab, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setDetailTab(key)}
                className={clsx(
                  'px-2.5 py-1.5 text-xs rounded-t-md border-b-2 -mb-px transition-colors cursor-pointer',
                  detailTab === key
                    ? 'border-accent text-accent-fg font-medium'
                    : 'border-transparent text-fg-muted hover:text-fg',
                )}
              >
                {key === 'ai' ? (
                  <span className="inline-flex items-center gap-1"><IconSparkles className="size-3" />{label}</span>
                ) : label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable]">
          {detailTab === 'info' && (
            <div className="p-4 space-y-3">
              <div className="pb-3 border-b border-border">
                <LabelInput entityType="media" entityId={selected.id} />
              </div>
              {localesEnabled && (
                <div className="flex items-center gap-1.5">
                  <LocaleSwitcher label="Editing" />
                  {assetLocale && <span className="text-[10px] text-accent">defaults shown as placeholders</span>}
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-fg-muted mb-1">Title</p>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle((e.target as HTMLInputElement).value)}
                  placeholder="Display name…"
                  className="w-full border border-border rounded-md px-2 py-1.5 text-sm text-fg focus:outline-none focus-visible:border-focus-border"
                />
              </div>
              <div>
                <p className="text-xs font-medium text-fg-muted mb-1">Alt text</p>
                <textarea
                  value={editAlt}
                  onChange={(e) => setEditAlt((e.target as HTMLTextAreaElement).value)}
                  placeholder="Describe the image for screen readers…"
                  rows={2}
                  className="w-full border border-border rounded-md px-2 py-1.5 text-sm text-fg resize-y focus:outline-none focus-visible:border-focus-border"
                />
              </div>
              <div>
                <p className="text-xs font-medium text-fg-muted mb-1">Caption</p>
                <textarea
                  value={editCaption}
                  onChange={(e) => setEditCaption((e.target as HTMLTextAreaElement).value)}
                  placeholder="Shown alongside the image…"
                  rows={2}
                  className="w-full border border-border rounded-md px-2 py-1.5 text-sm text-fg resize-y focus:outline-none focus-visible:border-focus-border"
                />
              </div>
              {metaDirty && (
                <Button size="sm" onClick={saveAssetMeta} isLoading={savingMeta}>Save {assetLocale ?? 'details'}</Button>
              )}

              <div className="pt-2 border-t border-border space-y-3">
                <div>
                  <p className="text-xs font-medium text-fg-muted mb-1">Filename</p>
                  <p className="text-sm text-fg break-all">{selected.originalName}</p>
                </div>
                <div className="flex gap-4">
                  <div>
                    <p className="text-xs font-medium text-fg-muted mb-1">Size</p>
                    <p className="text-sm text-fg">{formatFileSize(selected.sizeBytes)}</p>
                  </div>
                  {selected.width && selected.height && (
                    <div>
                      <p className="text-xs font-medium text-fg-muted mb-1">Dimensions</p>
                      <p className="text-sm text-fg">{selected.width} × {selected.height}</p>
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium text-fg-muted mb-1">Type</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="neutral">{selected.mimeType}</Badge>
                    {selected.storage && selected.storage !== 'local' && (
                      <Badge variant="default">
                        <IconCloud className="w-3 h-3" />
                        {selected.storage.toUpperCase()}
                      </Badge>
                    )}
                  </div>
                </div>
                {selected.tags.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-fg-muted mb-1">Tags</p>
                    <div className="flex flex-wrap gap-1">
                      {selected.tags.map((tag) => (
                        <Badge key={tag} variant="neutral">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {detailTab === 'urls' && (
            <div className="p-4 space-y-3">
              <UrlCopyRow label="Original" url={buildStaticUrl(selected.storagePath)} />
              {selected.thumbnailPath && (
                <UrlCopyRow label="Thumbnail" url={buildStaticUrl(selected.thumbnailPath)} />
              )}
              {Object.entries(selected.variants).map(([name, v]) => (
                <UrlCopyRow key={name} label={name} url={buildStaticUrl(v.storagePath)} />
              ))}
              {selected.mimeType.startsWith('image/') && (
                <UrlCopyRow label="Transform (example)" url={buildTransformUrl(selected.id, { w: 800, format: 'webp' })} />
              )}
              {selected.localeAssets && Object.keys(selected.localeAssets).length > 0 && (
                <div className="pt-2 border-t border-border space-y-4">
                  {Object.entries(selected.localeAssets).map(([code, id]) => {
                    const label = localeDefs.find((l) => l.code === code)?.label ?? code
                    const detail = localeAssetDetails[code]
                    return (
                      <div key={code} className="space-y-3">
                        <p className="text-[11px] font-medium text-fg-muted">{label}</p>
                        {detail ? (
                          <>
                            <UrlCopyRow label="Original" url={buildStaticUrl(detail.storagePath)} />
                            {Object.entries(detail.variants).map(([name, v]) => (
                              <UrlCopyRow key={name} label={name} url={buildStaticUrl(v.storagePath)} />
                            ))}
                          </>
                        ) : (
                          <UrlCopyRow label="Original" url={buildFileUrl(id)} />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {detailTab === 'localization' && (
            <div className="p-4 space-y-3">
              <p className="text-xs text-fg-muted">
                Serve a different asset per language - content referencing this asset
                delivers the language's version automatically, with fallback to{' '}
                {localeDefs.find((l) => l.code === defaultLocale)?.label ?? defaultLocale}.
              </p>
              <div className="space-y-1.5">
                {localeDefs.filter((l) => l.code !== defaultLocale).map((l) => {
                  const variantId = selected.localeAssets?.[l.code]
                  return (
                    <div key={l.code} className="flex items-center justify-between text-xs">
                      <span className="text-fg">{l.label}</span>
                      {variantId ? (
                        <span className="inline-flex items-center gap-1 text-success-fg">
                          <IconCheck className="size-3" /> own asset
                        </span>
                      ) : (
                        <span className="text-fg-subtle">falls back</span>
                      )}
                    </div>
                  )
                })}
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<IconGlobe className="size-3.5" />}
                onClick={() => setLocalizeOpen(true)}
              >
                Manage localization
              </Button>
            </div>
          )}

          {detailTab === 'ai' && selected.ai && (
            <div className="p-4 space-y-3">
              <div className="rounded-lg border border-accent/30 bg-accent-muted/50 p-2.5 space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-medium text-accent-fg">
                  <IconSparkles className="w-3.5 h-3.5" /> AI generated
                </p>
                <p className="text-xs text-fg-muted">
                  {selected.ai.provider} · <span className="font-mono">{selected.ai.model}</span>
                </p>
                {selected.ai.prompt && (
                  <>
                    <p className="text-[11px] font-medium text-fg-muted pt-1">Prompt</p>
                    <PromptRow prompt={selected.ai.prompt} />
                  </>
                )}
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<IconSparkles className="size-3.5" />}
                onClick={regenerateInChat}
              >
                Regenerate as new asset
              </Button>
              <p className="text-[10px] text-fg-subtle">
                Opens Gen AI with this prompt ready to tweak - hit send to generate a new
                asset on {selected.ai.provider} · {selected.ai.model}; the current one stays untouched.
              </p>
            </div>
          )}
          </div>
          {/* Footer - destructive delete (checks usage first) */}
          <div className="shrink-0 border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-danger-fg hover:text-danger-fg"
            >
              <IconTrash className="size-3.5" /> Delete asset
            </button>
          </div>
        </aside>
      )}

      <MediaDeleteDialog
        assetId={selected?.id ?? null}
        assetName={selected?.title || selected?.originalName || 'this asset'}
        workspaceId={params.workspaceId as string}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => { setDeleteOpen(false); setSelected(null); fetchAssets() }}
      />

      {/* Asset-level localization manager */}
      <LocalizeAssetModal
        assetId={selected?.id ?? null}
        open={localizeOpen}
        onOpenChange={setLocalizeOpen}
        onChanged={async () => {
          await fetchAssets()
          if (selected) {
            try {
              const r = await adminFetch<{ data: MediaAsset }>(`/media/asset/${selected.id}`)
              setSelected(r.data)
            } catch { /* keep the stale selection */ }
          }
        }}
      />

      {/* Generate with Gen AI - the same chat as the content editor, in library mode */}
      <AIAssistantPanel
        open={genOpen}
        onClose={() => setGenOpen(false)}
        workspaceId={params.workspaceId}
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
        folderId={currentFolderId}
        prefill={genPrefill}
        onImageKept={async (asset) => {
          // Drafts are hidden from the library; a kept image is now a real asset.
          await fetchAssets()
          setSelected(asset as unknown as MediaAsset)
        }}
        onImageRemoved={(id) => {
          setSelected((cur) => (cur?.id === id ? null : cur))
          void fetchAssets()
        }}
      />
    </div>
  )
}
