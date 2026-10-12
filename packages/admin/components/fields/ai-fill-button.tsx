/**
 * File Name: ai-fill-button.tsx
 * Purpose: Per-field ✨ affordance — opens the AI Assistant sidebar with this
 *          field tagged, scoping the chat to it. Also home to the shared
 *          fillable-type set and value preview renderer used by the panel.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: the actual generation UX lives in ai-assistant-panel.tsx.
 */
import { IconSparkles } from '@tangen/icons'
import { buildThumbnailUrl, formatFileSize } from '@/lib/media'

/** Field types the fill endpoint supports — others never show the button. */
export const AI_FILLABLE_TYPES = new Set([
  'text', 'textarea', 'email', 'url', 'phone', 'color', 'time', 'code', 'date',
  'select', 'number', 'currency', 'rating', 'boolean', 'tags', 'multiselect',
  'richtext', 'geopoint', 'repeater', 'json', 'component',
])

/** Human-readable preview of any field value (richtext docs become plain text). */
export function previewValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) {
    return value
      .map(v => {
        if (typeof v === 'string') return v
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          // rows: skip internal keys (_key/_type), humanize the rest
          return Object.entries(v as Record<string, unknown>)
            .filter(([k]) => !k.startsWith('_'))
            .map(([, x]) => (typeof x === 'boolean' ? (x ? 'Yes' : 'No') : String(x)))
            .join(' - ')
        }
        return JSON.stringify(v)
      })
      .join('\n')
  }
  if (typeof value === 'object') {
    const doc = value as any
    if (doc.type === 'doc' && Array.isArray(doc.content)) {
      const text = doc.content
        .map((n: any) => (Array.isArray(n.content) ? walkText(n.content) : ''))
        .filter(Boolean)
        .join('\n')
      return text || '(empty document)'
    }
    return JSON.stringify(value, null, 2)
  }
  return String(value)
}

function walkText(nodes: any[]): string {
  return nodes
    .map((n) => (typeof n.text === 'string' ? n.text : Array.isArray(n.content) ? walkText(n.content) : ''))
    .join(' ')
    .trim()
}

interface AIFillButtonProps {
  label: string
  onOpen: () => void
}

export function AIFillButton({ label, onOpen }: AIFillButtonProps) {
  return (
    <button
      type="button"
      title={`Work on "${label}" with Gen AI`}
      className="ml-1.5 inline-flex items-center align-middle text-fg-faint hover:text-accent transition-colors cursor-pointer"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpen() }}
    >
      <IconSparkles className="w-3.5 h-3.5" />
    </button>
  )
}

// ─── Schema-aware value preview ───────────────────────────────────────────────

interface SubFieldDef { name: string; label?: string; fieldType?: string; fields?: SubFieldDef[] }

function humanize(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return previewValue(v)
}

function LabeledRows({ row, defs }: { row: Record<string, unknown>; defs: SubFieldDef[] }) {
  const byName = new Map(defs.map(d => [d.name, d]))
  const ordered = [
    ...defs.filter(d => row[d.name] !== undefined && row[d.name] !== null),
    ...Object.keys(row)
      .filter(k => !k.startsWith('_') && !byName.has(k))
      .map(k => ({ name: k, label: k })),
  ]
  return (
    <div className="space-y-0.5">
      {ordered.map(d => {
        const v = row[d.name]
        if (v === undefined || v === null || v === '') return null
        return (
          <p key={d.name} className="text-sm leading-snug">
            <span className="text-fg-subtle">{d.label ?? d.name}: </span>
            <span className="text-fg whitespace-pre-wrap">{humanize(v)}</span>
          </p>
        )
      })}
    </div>
  )
}

/**
 * Renders an AI-suggested value the way an editor thinks about it — component
 * blocks as labelled cards, repeater rows as numbered entries with field
 * labels, everything else via previewValue. Internal keys (_key/_type) never
 * surface as raw text.
 */
export function ValuePreview({ value, fieldType, config }: {
  value: unknown
  fieldType?: string
  config?: Record<string, unknown>
}) {
  if (fieldType === 'component' && Array.isArray(value)) {
    const comps = (config?.components ?? []) as { name: string; label?: string; fields?: SubFieldDef[] }[]
    const byType = new Map(comps.map(c => [c.name, c]))
    return (
      <div className="space-y-2">
        {(value as Record<string, unknown>[]).map((block, i) => {
          const comp = byType.get(String(block._type))
          return (
            <div key={i} className="rounded-lg border border-violet-100 bg-violet-50/40 px-2.5 py-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500 mb-0.5">
                {comp?.label ?? String(block._type ?? 'Block')}
              </p>
              <LabeledRows row={block} defs={comp?.fields ?? []} />
            </div>
          )
        })}
      </div>
    )
  }

  // Generated images — show the picture, not its record
  if (fieldType === 'media' && value && typeof value === 'object') {
    const asset = value as { id: string; originalName?: string; sizeBytes?: number; thumbnailPath?: string | null }
    return (
      <div className="rounded-lg border border-border overflow-hidden bg-surface-sunken">
        {asset.thumbnailPath && (
          <img src={buildThumbnailUrl(asset.id)} alt={asset.originalName ?? ''} className="w-full max-h-48 object-cover" />
        )}
        <p className="px-2.5 py-1.5 text-[11px] text-fg-muted truncate">
          {asset.originalName ?? asset.id}
          {typeof asset.sizeBytes === 'number' ? ` · ${formatFileSize(asset.sizeBytes)}` : ''}
        </p>
      </div>
    )
  }

  if (fieldType === 'date' && typeof value === 'string') {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) {
      return <span>{d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
    }
  }

  if (fieldType === 'repeater' && Array.isArray(value)) {
    const defs = (config?.fields ?? []) as SubFieldDef[]
    return (
      <div className="space-y-2">
        {(value as Record<string, unknown>[]).map((row, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface-sunken/60 px-2.5 py-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle mb-0.5">#{i + 1}</p>
            <LabeledRows row={row} defs={defs} />
          </div>
        ))}
      </div>
    )
  }

  return <span className="whitespace-pre-wrap">{humanize(value)}</span>
}
