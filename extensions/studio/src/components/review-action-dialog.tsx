/**
 * File Name: review-action-dialog.tsx
 * Purpose: Approving or rejecting a review stage, with the note that goes
 *          with it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A note is REQUIRED to reject - the server refuses
 *          without one, with its own reason: tell the author what to fix. A
 *          rejection that arrives with no explanation is the worst message a
 *          workflow can send, so the UI asks rather than letting the request
 *          fail after the fact.
 *
 *          Approving takes an optional note, because "looks good" is a real
 *          and complete review.
 */
import { useEffect, useState } from 'react'
import {
  Button, Dialog, DialogContent, DialogHeader, DialogBody, DialogTitle, DialogFooter,
} from '@/kit'

export type ReviewActionKind = 'advance' | 'reject'

interface ReviewActionDialogProps {
  kind: ReviewActionKind | null
  stageName?: string
  busy?: boolean
  onCancel: () => void
  onConfirm: (note: string) => void
}

export function ReviewActionDialog({ kind, stageName, busy, onCancel, onConfirm }: ReviewActionDialogProps) {
  const [note, setNote] = useState('')
  useEffect(() => { setNote('') }, [kind])

  if (!kind) return null
  const rejecting = kind === 'reject'
  // Mirrors the server's rule rather than guessing at it.
  const noteRequired = rejecting
  const canConfirm = !noteRequired || note.trim() !== ''

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rejecting ? 'Reject this page' : `Approve${stageName ? `: ${stageName}` : ''}`}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="text-xs text-fg-muted">
            {rejecting
              ? 'It goes back to the author, who sees your note. Nothing is lost - the draft stays as it is.'
              : 'The page moves to the next stage. It can be published once every stage is approved.'}
          </p>
          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1">
              Note{noteRequired ? '' : ' (optional)'}
            </label>
            <textarea
              autoFocus
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={rejecting ? 'What needs to change?' : 'Anything the next reviewer should know'}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-fg focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            {noteRequired && (
              <p className="mt-1 text-[11px] text-fg-subtle">
                Required - a rejection with no explanation leaves the author guessing.
              </p>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            variant={rejecting ? 'destructive' : 'primary'}
            onClick={() => onConfirm(note.trim())}
            disabled={!canConfirm}
            isLoading={busy}
            loadingText={rejecting ? 'Rejecting…' : 'Approving…'}
          >
            {rejecting ? 'Reject' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
