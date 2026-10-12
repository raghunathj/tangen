/**
 * File Name: ObjectVersionDiff.tsx
 * Purpose: The "v{n} vs current version" field-diff dialog, extracted from the
 *          object-editor page (R2 of the SRP refactor). Presentational — the row
 *          computation is the pure `computeVersionDiff` in lib/editor.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { clsx } from 'clsx'
import type { FieldDefinition } from '@tangen/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { computeVersionDiff } from '@/lib/editor'

function copyToClipboard(v: unknown) {
  const text = v == null ? '' : typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)
  navigator.clipboard.writeText(text).catch(() => {})
}

function renderVal(v: unknown) {
  if (v == null || v === '') return <span className="italic text-fg-subtle">empty</span>
  const content = typeof v === 'boolean'
    ? <span>{v ? 'true' : 'false'}</span>
    : typeof v === 'object'
      ? <pre className="text-[11px] font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{JSON.stringify(v, null, 2)}</pre>
      : <span className="break-all">{String(v)}</span>
  return (
    <div className="group relative">
      {content}
      <button
        type="button"
        onClick={() => copyToClipboard(v)}
        className="absolute top-0 right-0 hidden group-hover:flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-surface border border-border text-fg-muted hover:text-fg shadow-xs transition-colors"
      >
        Copy
      </button>
    </div>
  )
}

export interface ObjectVersionDiffProps {
  /** The version being compared (for the "v{n}" labels). */
  versionNumber: number
  /** Values of the previewed version. */
  versionValues: Record<string, unknown>
  /** Values of the current draft. */
  draftValues: Record<string, unknown>
  /** Schema fields (for labels + ordering). */
  fields: FieldDefinition[]
  onClose: () => void
}

export function ObjectVersionDiff({
  versionNumber, versionValues, draftValues, fields, onClose,
}: ObjectVersionDiffProps) {
  const rows = computeVersionDiff(fields, versionValues, draftValues)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>v{versionNumber} vs current version</DialogTitle>
          <DialogDescription>
            {rows.length === 0
              ? 'No field differences - this version matches the current version.'
              : `${rows.length} field${rows.length !== 1 ? 's' : ''} differ between this version and the current version.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto min-h-0">
          {rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-fg-subtle">All fields are identical.</div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2 font-semibold text-fg-muted w-[22%]">Field</th>
                  <th className="text-left px-3 py-2 font-semibold text-fg-muted w-[39%]">v{versionNumber} (this version)</th>
                  <th className="text-left px-3 py-2 font-semibold text-fg-muted w-[39%]">Current version</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(({ key, label, vVal, dVal, status }) => {
                  const rowCls = status === 'added' ? 'bg-success-muted' : status === 'removed' ? 'bg-danger-muted' : 'bg-warning-muted'
                  const vCellCls = (status === 'removed' || status === 'changed') ? 'text-danger-fg' : 'text-fg-subtle'
                  const dCellCls = (status === 'added' || status === 'changed') ? 'text-success-fg' : 'text-fg-subtle'
                  return (
                    <tr key={key} className={rowCls}>
                      <td className="px-3 py-2 align-top">
                        <p className="font-semibold text-fg">{label}</p>
                        <p className="font-mono text-[10px] text-fg-subtle">{key}</p>
                      </td>
                      <td className={clsx('px-3 py-2 align-top', vCellCls)}>{renderVal(vVal)}</td>
                      <td className={clsx('px-3 py-2 align-top', dCellCls)}>{renderVal(dVal)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
