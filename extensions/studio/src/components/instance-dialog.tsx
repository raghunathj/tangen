/**
 * File Name: instance-dialog.tsx
 * Purpose: Name an instance - the one prompt behind every way a designer
 *          makes or renames a shared tree, without leaving Studio.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Dialog per the house rule: Sheets are for editors,
 *          Dialogs for confirmations and small prompts. The validation is
 *          lib/instance-lifecycle.ts (pure, tested), so the refusal a person
 *          reads here is the same one the caller would have hit.
 *
 *          `note` is where the consequence goes - what this will do to the
 *          pages already using the instance, or what a section is about to
 *          lose by being shared. Said BEFORE the act, which is the whole
 *          compensation V1 offers for having no overrides.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter, Input, Spinner } from '@/kit'
import { checkInstanceTitle } from '../lib/instance-lifecycle'
import { INSTANCE_PLACEMENTS, placementLabel, type InstancePlacement } from '../lib/instances'

export interface InstanceDialogValue {
  title: string
  placement: InstancePlacement
}

export interface InstanceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What is being done: "New instance", "Create instance from this section", "Rename instance". */
  heading: string
  submitLabel: string
  /** Prefilled name: the current one for a rename, a suggestion for a section. */
  initial?: string
  /** Offer the placement choice. A rename does not change where it is placed. */
  withPlacement?: boolean
  initialPlacement?: InstancePlacement
  /** The consequence, or a warning, said before the act. */
  note?: ReactNode
  /** Names already in use, so a duplicate is refused before anything is written. */
  taken?: string[]
  /** A failure from the write, shown where the person can fix it. */
  error?: string | null
  busy?: boolean
  onSubmit: (value: InstanceDialogValue) => void
}

export function InstanceDialog({
  open, onOpenChange, heading, submitLabel, initial = '', withPlacement = false,
  initialPlacement = 'manual', note, taken = [], error, busy = false, onSubmit,
}: InstanceDialogProps) {
  const [title, setTitle] = useState(initial)
  const [placement, setPlacement] = useState<InstancePlacement>(initialPlacement)
  const [refusal, setRefusal] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle(initial)
    setPlacement(initialPlacement)
    setRefusal(null)
  }, [open, initial, initialPlacement])

  const submit = () => {
    if (busy) return
    // The name a rename keeps is not a duplicate of itself.
    const others = taken.filter((t) => t.trim().toLowerCase() !== initial.trim().toLowerCase())
    const checked = checkInstanceTitle(title, others)
    if (!checked.ok) { setRefusal(checked.error); return }
    setRefusal(null)
    onSubmit({ title: checked.title, placement })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{heading}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); submit() }}>
          <DialogBody className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1" htmlFor="instance-name">Name</label>
              <Input
                id="instance-name"
                autoFocus
                value={title}
                placeholder="Latest Articles"
                onChange={(e) => { setRefusal(null); setTitle((e.target as HTMLInputElement).value) }}
              />
              <p className="mt-1 text-[11px] text-fg-subtle">
                What the panel lists and what every reference to it reads in the tree.
              </p>
            </div>
            {withPlacement && (
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1" htmlFor="instance-placement">Placement</label>
                <select
                  id="instance-placement"
                  value={placement}
                  onChange={(e) => setPlacement(e.target.value as InstancePlacement)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
                >
                  {INSTANCE_PLACEMENTS.map((p) => (
                    <option key={p} value={p}>{placementLabel(p)}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-fg-subtle">
                  Placed by hand is inserted on a page from this panel. Header and Footer are placed by the system on every page.
                </p>
              </div>
            )}
            {note && (
              <div className="rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-fg-muted" role="note">
                {note}
              </div>
            )}
            {(refusal || error) && (
              <p className="text-xs text-red-600" role="alert">{refusal ?? error}</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy ? <><Spinner className="size-3.5" /> Working…</> : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
