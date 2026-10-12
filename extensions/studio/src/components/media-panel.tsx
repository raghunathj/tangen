/**
 * File Name: media-panel.tsx
 * Purpose: The Media panel - the workspace's real media library, browsable
 *          and placeable on the canvas.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Reads the SAME /media endpoints the media picker and
 *          the admin's library use, so Studio shows the one library rather
 *          than a Studio-flavoured copy of it. Where an asset lands when
 *          dropped is decided by lib/media-drop.ts, from the schema.
 *
 *          This used to list 60 assets flat, with no folders and no type
 *          filter, drawing one generic icon for anything that was not an
 *          image - so an organised workspace looked like a jumble and
 *          documents, video and audio were effectively invisible. Folders,
 *          categories, upload and folder creation all existed in the API
 *          already; the panel simply used none of them.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import {
  IconSearch, IconImage, IconFolderAdd, IconUpload,
  IconPlay, IconMusic, IconFileText,
} from '@tangen/icons'
import { adminFetch } from '@/lib/api'
import { buildThumbnailUrl } from '@/lib/media'
import { FolderPicker } from './folder-picker'
import { useAuthStore } from '@/lib/auth'
import {
  MEDIA_FILTERS, mediaListQuery, folderNodes, flattenFolders, fileKind, isUploadable,
  type MediaFilter, type MediaFolderNode, type FileKind,
} from '../lib/media-browse'

export interface StudioMediaAsset {
  id: string
  originalName: string
  mimeType: string
  thumbnailPath: string | null
}

interface MediaPanelProps {
  /** Placing an asset - the caller decides where, via mediaTarget. */
  onPick: (asset: StudioMediaAsset) => void
  onDragAsset: (asset: StudioMediaAsset | null) => void
}

const SEARCH_MS = 300

/** The glyph for a file that has no thumbnail worth showing. */
const KIND_ICON: Record<FileKind, typeof IconImage> = {
  image: IconImage,
  video: IconPlay,
  audio: IconMusic,
  document: IconFileText,
}

export function MediaPanel({ onPick, onDragAsset }: MediaPanelProps) {
  const [assets, setAssets] = useState<StudioMediaAsset[]>([])
  const [folders, setFolders] = useState<MediaFolderNode[]>([])
  const [folderId, setFolderId] = useState<string | null>(null)
  const [filter, setFilter] = useState<MediaFilter>('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const loadFolders = useCallback(() => {
    adminFetch<{ data: unknown }>('/media/folders')
      // The API returns one root node, not a list - folderNodes reads either.
      .then((r) => setFolders(folderNodes(r.data)))
      .catch(() => setFolders([]))
  }, [])
  useEffect(() => { loadFolders() }, [loadFolders])

  const load = useCallback((q: string, f: MediaFilter, folder: string | null) => {
    setLoading(true)
    adminFetch<{ data: StudioMediaAsset[] }>('/media', undefined, mediaListQuery({ q, filter: f, folderId: folder }))
      .then((r) => setAssets(r.data ?? []))
      .catch(() => setAssets([]))     // an unreachable library shows empty, never breaks the builder
      .finally(() => setLoading(false))
  }, [])

  // Debounced, for the reason the media picker documents: an undebounced
  // fetch alongside the timer sends two requests per keystroke.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => load(query, filter, folderId), query ? SEARCH_MS : 0)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [query, filter, folderId, load])

  const options = flattenFolders(folders)

  /** Uploads into the folder currently open, which is what the user means. */
  const onUpload = useCallback(async (files: FileList | null) => {
    const list = [...(files ?? [])].filter(isUploadable)
    if (list.length === 0) return
    setError(null)
    try {
      for (let i = 0; i < list.length; i++) {
        setBusy(`Uploading ${i + 1} of ${list.length}…`)
        const form = new FormData()
        form.append('file', list[i])
        if (folderId) form.append('folderId', folderId)
        const apiHost = String((import.meta as never as { env: Record<string, string> }).env?.VITE_API_URL ?? '').replace(/\/+$/, '')
        const res = await fetch(`${apiHost}/api/v1/media/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${useAuthStore.getState().accessToken ?? ''}` },
          body: form,
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null) as { error?: { message?: string } } | null
          throw new Error(body?.error?.message ?? `Upload failed (${res.status})`)
        }
      }
      load(query, filter, folderId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(null)
    }
  }, [folderId, load, query, filter])

  const onCreateFolder = useCallback(async () => {
    const name = window.prompt('Folder name')?.trim()
    if (!name) return
    setError(null)
    setBusy('Creating folder…')
    try {
      await adminFetch('/media/folders', {
        method: 'POST',
        body: JSON.stringify({ name, ...(folderId ? { parentId: folderId } : {}) }),
      })
      loadFolders()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that folder')
    } finally {
      setBusy(null)
    }
  }, [folderId, loadFolders])

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-2 pb-2 shrink-0 space-y-2">
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-2 px-2 h-7 flex-1 min-w-0 rounded-md border border-border bg-surface-sunken">
            <IconSearch className="size-3.5 text-fg-subtle shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search media"
              className="flex-1 min-w-0 bg-transparent text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
            />
          </div>
          <button
            type="button" title="Upload files" onClick={() => fileInput.current?.click()}
            className="grid place-items-center size-7 shrink-0 rounded-md border border-border text-fg-muted hover:text-fg hover:border-accent transition-colors duration-(--tg-motion-fast)"
          >
            <IconUpload className="size-3.5" />
          </button>
          <button
            type="button" title="New folder" onClick={onCreateFolder}
            className="grid place-items-center size-7 shrink-0 rounded-md border border-border text-fg-muted hover:text-fg hover:border-accent transition-colors duration-(--tg-motion-fast)"
          >
            <IconFolderAdd className="size-3.5" />
          </button>
          <input
            ref={fileInput} type="file" multiple className="hidden"
            onChange={(e) => { onUpload(e.target.files); e.target.value = '' }}
          />
        </div>

        {/* Type filters - the library holds far more than images. */}
        <div className="flex items-center gap-0.5 overflow-x-auto">
          {MEDIA_FILTERS.map((f) => (
            <button
              key={f.id} type="button" onClick={() => setFilter(f.id)}
              className={clsx(
                'px-1.5 h-5 shrink-0 rounded text-[10px] font-medium transition-colors duration-(--tg-motion-fast)',
                filter === f.id ? 'bg-accent text-fg-inverted' : 'text-fg-subtle hover:text-fg',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* One searchable dropdown for the whole hierarchy, defaulting to
            All media. A native select cannot be searched, and a workspace
            with dozens of nested folders needs to be. */}
        <FolderPicker options={options} value={folderId} onChange={setFolderId} />

        {busy && <p className="text-[10px] text-fg-subtle">{busy}</p>}
        {error && <p className="text-[10px] text-danger">{error}</p>}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-2 space-y-1">
        {loading ? (
          <p className="px-1 py-2 text-xs text-fg-subtle">Loading media…</p>
        ) : assets.length === 0 ? (
          <p className="px-1 py-2 text-xs text-fg-subtle">
            {query ? 'Nothing matches.'
              : folderId ? 'This folder is empty.'
              : 'No media yet. Upload with the arrow above.'}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {assets.map((a) => {
              const kind = fileKind(a.mimeType)
              const Glyph = KIND_ICON[kind]
              return (
                <button
                  key={a.id}
                  type="button"
                  draggable
                  onDragStart={() => onDragAsset(a)}
                  onDragEnd={() => onDragAsset(null)}
                  onClick={() => onPick(a)}
                  title={a.originalName}
                  className={clsx(
                    'group relative aspect-square rounded border border-border overflow-hidden',
                    'bg-surface-sunken hover:border-accent transition-colors duration-(--tg-motion-fast)',
                  )}
                >
                  {kind === 'image' ? (
                    <img
                      src={buildThumbnailUrl(a.id)}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    // No thumbnail worth showing, so the tile says what the
                    // file IS rather than drawing a broken image.
                    <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-1">
                      <Glyph className="size-4 text-fg-subtle" />
                      <span className="text-[8px] leading-none text-fg-subtle uppercase">
                        {a.originalName.split('.').pop()?.slice(0, 4) ?? kind}
                      </span>
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-[9px] leading-tight text-white bg-black/60 truncate opacity-0 group-hover:opacity-100 transition-opacity duration-(--tg-motion-fast)">
                    {a.originalName}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
