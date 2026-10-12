/**
 * File Name: media-delete-dialog.tsx
 * Purpose: Delete a media asset safely — first checks where it's used
 *   (GET /media/asset/:id/usage). If any content entry references it, deletion
 *   is BLOCKED with a "remove it from these first" list (links to each entry);
 *   otherwise a plain destructive confirm. Mirrors the type-delete flow.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { adminFetch } from '@/lib/api'
import { toast } from '@/lib/toast'

interface Usage { type: string; typeLabel: string; id: string; title: string | null }

export function MediaDeleteDialog({
  assetId, assetName, workspaceId, open, onClose, onDeleted,
}: {
  assetId: string | null
  assetName: string
  workspaceId: string
  open: boolean
  onClose: () => void
  onDeleted: () => void
}) {
  const [usage, setUsage] = useState<Usage[] | null>(null)   // null = still checking
  const [busy, setBusy] = useState(false)

  const checkUsage = useCallback(() => {
    if (!assetId) return
    setUsage(null)
    adminFetch<{ data: { usage: Usage[] } }>(`/media/asset/${assetId}/usage`)
      .then((r) => setUsage(r.data?.usage ?? []))
      .catch(() => setUsage([]))   // fail-open to the button; the server guard still blocks
  }, [assetId])

  useEffect(() => {
    if (!open || !assetId) { setUsage(null); return }
    checkUsage()
  }, [open, assetId, checkUsage])

  const inUse = (usage?.length ?? 0) > 0

  async function handleDelete() {
    if (!assetId) return
    setBusy(true)
    try {
      // cascade removes the asset's owned locale variants too.
      await adminFetch(`/media/asset/${assetId}?cascade=true`, { method: 'DELETE' })
      toast.success('Asset deleted')
      onDeleted()
    } catch (e: any) {
      toast.error('Could not delete asset', e?.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Delete asset</DialogTitle></DialogHeader>
        <div className="px-6 py-4 space-y-3">
          {usage === null ? (
            <DialogDescription>Checking where “{assetName}” is used…</DialogDescription>
          ) : inUse ? (
            <>
              <DialogDescription>
                “{assetName}” is still used by {usage!.length} content {usage!.length === 1 ? 'entry' : 'entries'}.
                Remove it from {usage!.length === 1 ? 'it' : 'them'} first, then delete.
              </DialogDescription>
              <ul className="max-h-52 overflow-y-auto rounded-md border border-border divide-y divide-border text-sm">
                {usage!.map((u) => (
                  <li key={`${u.type}:${u.id}`} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0 truncate">
                      <span className="text-fg-subtle">{u.typeLabel}:</span> {u.title || 'Untitled'}
                    </span>
                    <a
                      href={`/${workspaceId}/objects/${u.type}/${u.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-xs text-accent-fg hover:underline"
                    >
                      Open ↗
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <DialogDescription>
              Permanently delete “{assetName}”? This removes the file and can’t be undone.
            </DialogDescription>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>{inUse ? 'Close' : 'Cancel'}</Button>
          {inUse && (
            <Button variant="secondary" onClick={checkUsage} disabled={usage === null}>
              Re-check
            </Button>
          )}
          {usage !== null && !inUse && (
            <Button variant="destructive" onClick={handleDelete} isLoading={busy}>Delete</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
