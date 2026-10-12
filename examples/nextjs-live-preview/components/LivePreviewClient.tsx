'use client'
/**
 * The preview surface. Tier 1: fetch the DRAFT behind the preview token from the URL. Tier 2:
 * overlay UNSAVED edits streamed from the Tangen admin via origin-verified postMessage, so the
 * page re-renders as the editor types. Pure SDK — no Tangen-admin code runs here.
 */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { onLivePreview, type LivePreviewObject } from '@tangen/sdk'
import { enableStudioOverlay } from '@tangen/studio-react'
import { getDraftByToken, ADMIN_ORIGIN, type Entry } from '@/lib/tangen'
import { EntryView } from '@/components/EntryView'

export function LivePreviewClient() {
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const type = params.get('type') ?? 'post'
  const token = params.get('preview_token') ?? ''
  const initialLocale = params.get('preview_locale') ?? undefined

  const [entry, setEntry] = useState<Entry | null>(null)
  const [live, setLive] = useState(false)
  const [locale, setLocale] = useState<string | undefined>(initialLocale)
  const [error, setError] = useState<string | null>(null)

  // Tier 1 — render the draft behind the token, in the requested locale.
  useEffect(() => {
    if (!id || !token) { setError('This page expects ?id=…&type=…&preview_token=… from the admin Preview button.'); return }
    getDraftByToken(id, type, token, initialLocale)
      .then((d) => d ? setEntry(d) : setError('Draft not found, or the preview token has expired. Re-open Preview from the admin.'))
      .catch(() => setError('Could not reach the Tangen API. Check NEXT_PUBLIC_TANGEN_API_URL and CORS.'))
  }, [id, type, token])

  // Studio — click-in-preview. A no-op outside a real Tangen preview (needs
  // the framing iframe AND preview_token), so it costs nothing in production.
  useEffect(() => enableStudioOverlay({ adminOrigin: ADMIN_ORIGIN || undefined }), [])

  // Tier 2 — merge live unsaved field values as they arrive.
  useEffect(() => {
    return onLivePreview((obj: LivePreviewObject) => {
      setLive(true)
      if (obj.locale) setLocale(obj.locale)
      setEntry((prev) => ({
        ...(prev ?? {}),
        id: obj.id, type: obj.type, status: obj.status, title: obj.title, slug: obj.slug,
        ...obj.values,
      }))
    }, { allowedOrigin: ADMIN_ORIGIN || undefined, forwardConsole: true })
  }, [])

  if (error && !entry) return <div className="notice">{error}</div>
  if (!entry) return <p className="empty">Loading preview…</p>

  return (
    <>
      {live
        ? <div className="live-bar"><span className="live-dot" /> Live preview — unsaved edits{locale ? ` · ${locale}` : ''}</div>
        : <div className="notice">Preview mode — rendering the <strong>draft</strong> of <code>{type}</code>{locale ? ` in ${locale}` : ''}. Edit it in the admin to see live updates here.</div>}
      <EntryView entry={entry} />
    </>
  )
}
