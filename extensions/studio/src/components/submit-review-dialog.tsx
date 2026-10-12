/**
 * File Name: submit-review-dialog.tsx
 * Purpose: Submitting a page for review - choosing who should look at it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Submitting used to fire immediately with no assignee,
 *          which put the page in a queue nobody owned. Asking once, at the
 *          moment of handing it over, is the only point where the author
 *          knows who should see it.
 *
 *          The member list comes from the same endpoint and the same
 *          capability the review extension's own picker uses, so Studio
 *          offers exactly the people that extension would.
 */
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import {
  Button, Dialog, DialogContent, DialogHeader, DialogBody, DialogTitle, DialogFooter,
} from '@/kit'
import { adminFetch } from '@/lib/api'

interface MemberOption {
  id: string
  name?: string | null
  email?: string | null
}

interface SubmitReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy?: boolean
  onSubmit: (assigneeId: string | null) => void
}

/** Members eligible to act on reviews - the review extension's own rule. */
const ASSIGNABLE_CAPABILITY = 'review:approve'

export function SubmitReviewDialog({ open, onOpenChange, busy, onSubmit }: SubmitReviewDialogProps) {
  const [members, setMembers] = useState<MemberOption[] | null>(null)
  const [assignee, setAssignee] = useState<string>('')

  useEffect(() => {
    if (!open) return
    setAssignee('')
    let alive = true
    adminFetch<{ data: MemberOption[] }>(
      `/members/directory?capability=${ASSIGNABLE_CAPABILITY}`,
    )
      .then((r) => { if (alive) setMembers(r.data ?? []) })
      // A caller who may not list members still submits - the queue picks it
      // up unassigned rather than the submit being refused.
      .catch(() => { if (alive) setMembers(null) })
    return () => { alive = false }
  }, [open])

  const label = (m: MemberOption) => m.name || m.email || m.id

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Submit for review</DialogTitle></DialogHeader>
        <DialogBody className="space-y-3">
          <p className="text-xs text-fg-muted">
            The page goes to the first review stage. It stays editable, but it
            cannot be published until review completes.
          </p>

          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1">Reviewer</label>
            {members === null ? (
              <p className="text-[11px] text-fg-subtle">
                Reviewers cannot be listed with your permissions - it will be submitted unassigned.
              </p>
            ) : (
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full h-8 rounded-md border border-border bg-surface px-2 text-xs text-fg focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                {/* Unassigned is legitimate: a queue a team watches together
                    is a real workflow, so it is not forced. */}
                <option value="">Anyone on the review queue</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{label(m)}</option>
                ))}
              </select>
            )}
            {members?.length === 0 && (
              <p className="mt-1 text-[11px] text-warning">
                Nobody holds the review permission yet, so it will sit unassigned.
              </p>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            onClick={() => onSubmit(assignee || null)}
            isLoading={busy}
            loadingText="Submitting…"
            className={clsx(busy && 'pointer-events-none')}
          >
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
