/**
 * File Name: preset-name-dialog.tsx
 * Purpose: Name prompt for Studio presets - used by "Save as preset" (new
 *          name) and Rename (prefilled). Dialog per the house rule: Sheets
 *          are for editors, Dialogs for confirmations and small prompts.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from '@/kit'

export interface PresetNameDialogProps {
  open: boolean
  title: string
  /** Prefill (rename); empty for a new preset. */
  initial?: string
  submitLabel?: string
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => void
}

export function PresetNameDialog({ open, title, initial = '', submitLabel = 'Save', onOpenChange, onSubmit }: PresetNameDialogProps) {
  const [name, setName] = useState(initial)
  useEffect(() => { if (open) setName(initial) }, [open, initial])

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); submit() }} className="mt-2">
          <Input
            autoFocus
            placeholder="Preset name"
            value={name}
            onChange={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!name.trim()}>{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
