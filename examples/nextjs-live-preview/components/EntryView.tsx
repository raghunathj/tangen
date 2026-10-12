/**
 * Renders a Tangen entry (post OR page). Field-agnostic and recursive, so it handles a flat
 * post (title/subtitle/body/tags) AND a page whose content is `sections` (blocks/components)
 * with nested fields. Shared by the published route and the live-preview route, so what you
 * see while editing is what ships.
 */
import type { ReactNode } from 'react'
import type { Entry } from '@/lib/tangen'
import { StudioSections } from '@/components/StudioSections'

/** A Builder Kit tree - render it with the real runtime, not the generic dump. */
function isKitTree(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value)
    && value.length > 0
    && value.some((b) => !!b && typeof b === 'object' && typeof (b as { _type?: unknown })._type === 'string'
      && String((b as { _type: string })._type).startsWith('kit.'))
}

const SYSTEM = new Set([
  'id', 'type', 'status', 'slug', 'createdAt', 'updatedAt', 'publishedAt', 'publishedValues',
  'position', 'archived', 'createdBy', 'updatedBy',
])

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}
const looksLikeHtml = (s: string) => /<[a-z][\s\S]*>/i.test(s)
const humanize = (k: string) => k.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/** Recursively render any field value: strings (HTML or text), arrays, and nested blocks. */
function FieldValue({ value }: { value: unknown }): ReactNode {
  if (value == null || value === '') return null

  if (typeof value === 'string') {
    return looksLikeHtml(value)
      ? <div className="prose" dangerouslySetInnerHTML={{ __html: value }} />
      : <p>{value}</p>
  }
  if (typeof value === 'number' || typeof value === 'boolean') return <p>{String(value)}</p>

  if (Array.isArray(value)) {
    // An array of plain strings (e.g. tags) renders as pills; otherwise as stacked blocks.
    if (value.every((v) => typeof v === 'string')) {
      return <ul className="tags">{value.map((t) => <li key={String(t)}>{String(t)}</li>)}</ul>
    }
    return <div className="blocks">{value.map((item, i) => <FieldValue key={i} value={item} />)}</div>
  }

  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (typeof o.html === 'string') return <div className="prose" dangerouslySetInnerHTML={{ __html: o.html }} />
    // Media object → show the image if we can.
    if (typeof o.url === 'string' && /\.(png|jpe?g|gif|webp|svg)$/i.test(o.url)) {
      return <img src={o.url} alt={str(o.altText)} />
    }
    // A block/component: render its meaningful sub-fields (skip _key/_type/etc.).
    const entries = Object.entries(o).filter(([k, v]) => !k.startsWith('_') && v != null && v !== '')
    if (entries.length === 0) return null
    const kind = str(o._type ?? o.component ?? o.__component)
    return (
      <div className="block">
        {kind && <span className="block-kind">{humanize(kind)}</span>}
        {entries.map(([k, v]) => (
          <div key={k} className="block-field">
            <span className="block-key">{humanize(k)}</span>
            <FieldValue value={v} />
          </div>
        ))}
      </div>
    )
  }
  return null
}

export function EntryView({ entry }: { entry: Entry }) {
  const title = str(entry.title) || 'Untitled'
  const subtitle = str(entry.subtitle)
  // Every content field (posts: body/tags; pages: sections/layout/seo), rendered visibly.
  const fields = Object.entries(entry).filter(
    ([k, v]) => !SYSTEM.has(k) && k !== 'title' && k !== 'subtitle' && v != null && v !== '',
  )

  return (
    <article className="entry">
      <header>
        {typeof entry.status === 'string' && entry.status !== 'published' && (
          <span className="badge">{entry.status}</span>
        )}
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </header>
      {fields.length === 0 ? (
        <p className="empty">This entry has no content fields filled yet.</p>
      ) : (
        fields.map(([k, v]) => (
          isKitTree(v)
            // Builder Kit sections render through the real runtime, so what
            // the preview shows is what the published page will show.
            ? <StudioSections key={k} blocks={v as never} />
            : (
              <section key={k} className="field">
                <h2 className="field-label">{humanize(k)}</h2>
                <FieldValue value={v} />
              </section>
            )
        ))
      )}
    </article>
  )
}
