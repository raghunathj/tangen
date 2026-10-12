/**
 * File Name: delete-type-dialog.tsx
 * Purpose: Typed-confirmation dialog for PERMANENT content-type deletion — shared by
 *   the schema listing and the builder header. Spells out the blast radius (table +
 *   all content drop on the confirmed push) and points to Disable as the reversible
 *   alternative.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useState } from 'react'
import { Badge, Button, Callout, Input } from '@/kit'
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@/kit'

export function DeleteTypeDialog({ type, busy, onCancel, onConfirm, cascade = [] }: {
  type: { name: string; label: string } | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
  /** "type.field" relation fields elsewhere that will be DETACHED by this delete. */
  cascade?: string[]
}) {
  const [input, setInput] = useState('')
  if (!type) return null
  const close = () => { setInput(''); onCancel() }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete "{type.label}" permanently?</DialogTitle>
          <DialogDescription>
            This removes the schema from code and <span className="font-medium text-danger-fg">drops the "{type.name}" table with ALL its content</span> on push.
            It cannot be undone - if you just want it out of the way, use Disable instead.
            The push will refuse while other types still have relation fields targeting it.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 py-4">
          {cascade.length > 0 && (
            <Callout variant="warning" className="mb-3">
              <p className="font-medium mb-1.5">Also detaches {cascade.length === 1 ? 'this relation field' : `${cascade.length} relation fields`} pointing here (column + stored values drop):</p>
              <div className="flex flex-wrap gap-1.5">
                {cascade.map((c) => <Badge key={c} variant="warning" className="font-mono">{c}</Badge>)}
              </div>
            </Callout>
          )}
          <div className="text-ui-xs text-fg-muted">
            Type <span className="font-mono font-medium">{type.name}</span> to confirm
            <Input autoFocus value={input} className="mt-1.5 font-mono" onChange={(e) => setInput(e.currentTarget.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="destructive" disabled={input !== type.name || busy} isLoading={busy} loadingText="Deleting…" onClick={() => { setInput(''); onConfirm() }}>Delete permanently</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
