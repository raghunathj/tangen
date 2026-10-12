import { useState } from 'react'

/**
 * Object-editor sidebar panels. Panels receive the ExtensionPanelProps
 * contract from the admin:
 *
 *   panelData          previously persisted data (our hooks saved it)
 *   onPanelDataChange  stage new data — it is sent with the NEXT save and
 *                      handed to your afterChange hook as
 *                      ctx.panelData['<extension-id>']
 *   title / content / fieldValues   the object's current values (read-only)
 *   ai                 Content AI bridge when the workspace enabled it
 *
 * Keep panels dependency-light: they bundle into the admin. @tangen/ui and
 * react are peer deps; anything heavier belongs behind a modal or page.
 */
interface PanelProps {
  title?: string
  content?: string
  fieldValues?: Record<string, unknown>
  /** The object's id ('' while the editor is on /new). */
  objectId?: string
  /** Lifecycle status: draft | published | scheduled | archived. */
  status?: string
  /** Re-runs the editor's object load (fresh data + panel data). */
  refresh?: () => void
  panelData?: Record<string, unknown>
  onPanelDataChange?: (data: Record<string, unknown>) => void
}

/** renderMode 'inline' — renders below the content fields on every type. */
export function ScratchNotesPanel({ panelData, onPanelDataChange }: PanelProps) {
  const [note, setNote] = useState<string>((panelData?.note as string) ?? '')
  return (
    <div className="space-y-2">
      <textarea
        value={note}
        onChange={(e) => {
          setNote(e.target.value)
          // Staged, not saved — persists via the extension's afterChange hook
          onPanelDataChange?.({ note: e.target.value })
        }}
        rows={3}
        placeholder="Editor-only notes for this object - saved with the next save, versioned with revisions."
        className="w-full rounded-md border border-border-strong px-2.5 py-2 text-sm text-fg placeholder:text-fg-subtle focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25 outline-none"
      />
      <p className="text-xs text-fg-subtle">
        Round-trips through <code className="font-mono">ctx.extensionData</code> - see the
        extension&apos;s <code className="font-mono">hooks.ts</code>.
      </p>
    </div>
  )
}

/** renderMode 'modal' — a card + button in the editor; this renders in the dialog. */
export function SinkToolsPanel({ title, fieldValues, objectId, status, refresh }: PanelProps) {
  const fieldCount = Object.keys(fieldValues ?? {}).length
  return (
    <div className="space-y-3 text-sm text-fg-muted">
      <p>
        Modal panels get the whole dialog - use them for flows too big for the
        editor&apos;s center stage (imports, integrations, bulk tooling).
      </p>
      <div className="rounded-md bg-surface-sunken border border-border p-3 text-xs font-mono">
        title: {JSON.stringify(title ?? null)}<br />
        objectId: {JSON.stringify(objectId || null)}<br />
        status: {JSON.stringify(status ?? null)}<br />
        fields in scope: {fieldCount}
      </div>
      <button
        type="button"
        onClick={() => refresh?.()}
        className="rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-sunken transition-colors"
      >
        Reload object (refresh())
      </button>
      <p className="text-xs text-fg-subtle">
        <code className="font-mono">objectId</code>, <code className="font-mono">status</code> and{' '}
        <code className="font-mono">refresh()</code> arrive with the panel props - use them to call
        your extension&apos;s own routes for this object and re-sync the editor afterwards.
      </p>
    </div>
  )
}
