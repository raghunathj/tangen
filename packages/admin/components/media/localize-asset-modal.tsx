/**
 * File Name: localize-asset-modal.tsx
 * Purpose: Asset-level localization manager — shows the default-language asset
 *          and, per enabled locale, its variant asset with replace (library
 *          pick or fresh upload) and remove actions. Used from the media
 *          library's Localization tab and from media fields in the editor.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: variants are real assets — uploads are tagged variantOf
 *          and hidden from the gallery; library picks stay library assets and
 *          are only linked/unlinked. Locale accent colors follow the editor's
 *          localization palette (localeColor).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { IconUpload, IconImage, IconSearch, IconX, IconChevronDown } from '@tangen/icons'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MediaPicker } from '@/components/fields/media-picker'
import { localeColor, type LocaleColor } from '@/components/i18n/localized-field-inputs'
import { useLocaleStore } from '@/lib/locale'
import { useAuthStore } from '@/lib/auth'
import { adminFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { buildThumbnailUrl, formatFileSize, getMediaCategory } from '@/lib/media'
import { apiOrigin } from '@/lib/api-origin'

interface AssetSummary {
  id: string
  originalName: string
  mimeType: string
  sizeBytes: number
  thumbnailPath: string | null
  localeAssets?: Record<string, string> | null
  i18n?: Record<string, { title?: string; caption?: string; altText?: string }> | null
}

type LocaleText = { title: string; altText: string; caption: string }
const emptyText = (): LocaleText => ({ title: '', altText: '', caption: '' })

function AssetThumb({ asset, size = 'size-14' }: { asset: AssetSummary; size?: string }) {
  return (
    <div className={clsx('shrink-0 rounded-md border border-border bg-surface-sunken overflow-hidden flex items-center justify-center', size)}>
      {asset.thumbnailPath ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={buildThumbnailUrl(asset.id)} alt={asset.originalName} className="h-full w-full object-cover" />
      ) : (
        <IconImage className="size-5 text-fg-subtle" />
      )}
    </div>
  )
}

export interface LocalizeAssetModalProps {
  /** The default-language asset whose variants are managed. */
  assetId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fired after any variant change so callers can refresh their asset data. */
  onChanged?: () => void
}

export function LocalizeAssetModal({ assetId, open, onOpenChange, onChanged }: LocalizeAssetModalProps) {
  const { enabled, defaultLocale, locales } = useLocaleStore()
  const [parent, setParent] = useState<AssetSummary | null>(null)
  const [variants, setVariants] = useState<Record<string, AssetSummary>>({})
  const [busyLocale, setBusyLocale] = useState<string | null>(null)
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const [textOpenFor, setTextOpenFor] = useState<Set<string>>(new Set())
  const [textDrafts, setTextDrafts] = useState<Record<string, LocaleText>>({})
  const [dirtyText, setDirtyText] = useState<Set<string>>(new Set())
  const [savingText, setSavingText] = useState<string | null>(null)
  const uploadForRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const localeCodes = locales.map((l) => l.code)
  const otherLocales = locales.filter((l) => l.code !== defaultLocale)
  const defaultLabel = locales.find((l) => l.code === defaultLocale)?.label ?? defaultLocale

  const load = useCallback(async () => {
    if (!assetId) return
    try {
      const r = await adminFetch<{ data: AssetSummary }>(`/media/asset/${assetId}`, undefined, { locale: 'all' })
      setParent(r.data)
      const i18n = r.data.i18n ?? {}
      setTextDrafts(Object.fromEntries(Object.entries(i18n).map(([code, t]) => [code, {
        title: t.title ?? '', altText: t.altText ?? '', caption: t.caption ?? '',
      }])))
      setDirtyText(new Set())
      const map = r.data.localeAssets ?? {}
      const entries = await Promise.all(
        Object.entries(map).map(async ([code, id]) => {
          try {
            const v = await adminFetch<{ data: AssetSummary }>(`/media/asset/${id}`)
            return [code, v.data] as const
          } catch { return null }
        }),
      )
      setVariants(Object.fromEntries(entries.filter((e): e is [string, AssetSummary] => e !== null)))
    } catch (e: any) {
      toast.error('Could not load asset', e.message)
    }
  }, [assetId])

  useEffect(() => { if (open) void load() }, [open, load])

  async function linkAsset(locale: string, pickedId: string) {
    if (!assetId) return
    setBusyLocale(locale)
    try {
      await adminFetch(`/media/asset/${assetId}/locale/${locale}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: pickedId }),
      })
      await load()
      onChanged?.()
    } catch (e: any) {
      toast.error(`Could not set the ${locale} asset`, e.message)
    } finally {
      setBusyLocale(null)
    }
  }

  async function uploadVariant(locale: string, file: File) {
    if (!assetId) return
    setBusyLocale(locale)
    try {
      const form = new FormData()
      form.append('file', file)
      const apiHost = apiOrigin()
      const token = useAuthStore.getState().accessToken
      const res = await fetch(`${apiHost}/api/v1/media/asset/${assetId}/locale/${locale}/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error((errBody as any)?.error?.message ?? `Upload failed (${res.status})`)
      }
      await load()
      onChanged?.()
    } catch (e: any) {
      toast.error(`Could not upload the ${locale} asset`, e.message)
    } finally {
      setBusyLocale(null)
    }
  }

  function setText(locale: string, key: keyof LocaleText, value: string) {
    setTextDrafts((d) => ({ ...d, [locale]: { ...(d[locale] ?? emptyText()), [key]: value } }))
    setDirtyText((prev) => new Set(prev).add(locale))
  }

  /** Saves a language's title/alt/caption onto the asset (metadata.i18n). */
  async function saveText(locale: string) {
    if (!assetId) return
    const t = textDrafts[locale] ?? emptyText()
    setSavingText(locale)
    try {
      await adminFetch(`/media/asset/${assetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale, title: t.title, altText: t.altText, caption: t.caption }),
      })
      setDirtyText((prev) => { const n = new Set(prev); n.delete(locale); return n })
      onChanged?.()
    } catch (e: any) {
      toast.error(`Could not save ${locale} details`, e.message)
    } finally {
      setSavingText(null)
    }
  }

  async function removeVariant(locale: string) {
    if (!assetId) return
    setBusyLocale(locale)
    try {
      await adminFetch(`/media/asset/${assetId}/locale/${locale}`, { method: 'DELETE' })
      await load()
      onChanged?.()
    } catch (e: any) {
      toast.error(`Could not remove the ${locale} asset`, e.message)
    } finally {
      setBusyLocale(null)
    }
  }

  if (!enabled) return null

  const mimeFamily = parent ? parent.mimeType.split('/')[0] : 'image'

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader className="px-5 py-3.5">
            <DialogTitle>Manage localization</DialogTitle>
          </DialogHeader>

          <div className="px-5 pt-4 pb-5 space-y-4">
            <p className="text-xs text-fg-muted">
              Each language can serve its own asset - content that references this
              asset automatically delivers the language's version. Languages without
              their own asset fall back to the {defaultLabel} one.
            </p>

            {/* Default-language asset */}
            {parent && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-sunken/60 p-3">
                <AssetThumb asset={parent} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg truncate">{parent.originalName}</p>
                  <p className="text-xs text-fg-subtle">{formatFileSize(parent.sizeBytes)} · {parent.mimeType}</p>
                </div>
                <span className="shrink-0 text-[11px] font-medium text-fg-muted bg-surface border border-border rounded-full px-2 py-0.5">
                  {defaultLabel} · default
                </span>
              </div>
            )}

            {/* Per-locale variants */}
            <div className="space-y-2.5">
              {otherLocales.map((l) => {
                const color: LocaleColor = localeColor(l.code, localeCodes)
                const variant = variants[l.code]
                const busy = busyLocale === l.code
                const textOpen = textOpenFor.has(l.code)
                const text = textDrafts[l.code] ?? emptyText()
                const hasText = Boolean(text.title || text.altText || text.caption)
                return (
                  <div key={l.code} className={clsx('border-l-2 pl-3 py-1.5', color.rail)}>
                    <div className="flex items-center gap-3">
                      <span className={clsx('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium w-24 shrink-0', color.badge)}>
                        <span className={clsx('size-1.5 rounded-full', color.dot)} />
                        {l.label}
                      </span>
                      {variant ? (
                        <>
                          <AssetThumb asset={variant} size="size-10" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-fg truncate">{variant.originalName}</p>
                            <p className="text-[11px] text-fg-subtle">{formatFileSize(variant.sizeBytes)}</p>
                          </div>
                        </>
                      ) : (
                        <p className="flex-1 text-xs text-fg-subtle">Falls back to {defaultLabel}</p>
                      )}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setPickerFor(l.code)}
                          title="Choose from the media library"
                          className="p-1.5 rounded-md text-fg-subtle hover:text-accent-fg hover:bg-accent-muted transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <IconSearch className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => { uploadForRef.current = l.code; fileInputRef.current?.click() }}
                          title="Upload a replacement for this language"
                          className="p-1.5 rounded-md text-fg-subtle hover:text-accent-fg hover:bg-accent-muted transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <IconUpload className="size-3.5" />
                        </button>
                        {variant && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => removeVariant(l.code)}
                            title={`Remove - ${l.label} falls back to ${defaultLabel}`}
                            className="p-1.5 rounded-md text-fg-subtle hover:text-danger-fg hover:bg-danger-muted transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <IconX className="size-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setTextOpenFor((prev) => {
                            const n = new Set(prev)
                            if (n.has(l.code)) n.delete(l.code); else n.add(l.code)
                            return n
                          })}
                          title="Title, alt text & caption for this language"
                          className={clsx(
                            'flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] transition-colors cursor-pointer',
                            hasText || textOpen ? 'text-accent-fg hover:bg-accent-muted' : 'text-fg-subtle hover:text-accent-fg hover:bg-accent-muted',
                          )}
                        >
                          Text
                          <IconChevronDown className={clsx('size-3 transition-transform', textOpen && 'rotate-180')} />
                        </button>
                      </div>
                    </div>
                    {textOpen && (
                      <div className="mt-2 mr-1 space-y-1.5">
                        <input
                          value={text.title}
                          onChange={(e) => setText(l.code, 'title', (e.target as HTMLInputElement).value)}
                          placeholder={`Title in ${l.label}…`}
                          className="w-full border border-border rounded-md px-2 py-1.5 text-xs text-fg focus:outline-none focus-visible:border-focus-border"
                        />
                        <input
                          value={text.altText}
                          onChange={(e) => setText(l.code, 'altText', (e.target as HTMLInputElement).value)}
                          placeholder={`Alt text in ${l.label}…`}
                          className="w-full border border-border rounded-md px-2 py-1.5 text-xs text-fg focus:outline-none focus-visible:border-focus-border"
                        />
                        <input
                          value={text.caption}
                          onChange={(e) => setText(l.code, 'caption', (e.target as HTMLInputElement).value)}
                          placeholder={`Caption in ${l.label}…`}
                          className="w-full border border-border rounded-md px-2 py-1.5 text-xs text-fg focus:outline-none focus-visible:border-focus-border"
                        />
                        {dirtyText.has(l.code) && (
                          <Button size="sm" isLoading={savingText === l.code} onClick={() => saveText(l.code)}>
                            Save {l.label} text
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={parent ? `${mimeFamily}/*` : undefined}
            className="hidden"
            onChange={(e) => {
              const file = (e.target as HTMLInputElement).files?.[0]
              const locale = uploadForRef.current
              ;(e.target as HTMLInputElement).value = ''
              if (file && locale) void uploadVariant(locale, file)
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Library pick - same family as the default asset */}
      <MediaPicker
        open={pickerFor !== null}
        onOpenChange={(o) => { if (!o) setPickerFor(null) }}
        onSelect={(picked: any) => {
          const locale = pickerFor
          setPickerFor(null)
          if (locale && picked?.id) void linkAsset(locale, picked.id)
        }}
        mimeTypes={[`${mimeFamily}/*`]}
      />
    </>
  )
}
