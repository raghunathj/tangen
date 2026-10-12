

import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { clsx } from 'clsx'

interface SaveViewDialogProps {
  open: boolean
  onClose: () => void
  onSave: (name: string, visibility: 'private' | 'shared') => Promise<void>
}

export function SaveViewDialog({ open, onClose, onSave }: SaveViewDialogProps) {
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'shared'>('private')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true); setError(null)
    try {
      await onSave(name.trim(), visibility)
      setName('')
      setVisibility('private')
      onClose()
    } catch (e: any) {
      setError(e.message ?? 'Failed to save view')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Save view</DialogTitle>
          <DialogDescription className="mt-1">
            Name this filter combination for quick access.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-fg mb-1">
              View name <span className="text-danger-fg">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My drafts, Published this month"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-fg mb-2">Visible to</label>
            <div className="flex gap-2">
              {(['private', 'shared'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setVisibility(v)}
                  className={clsx(
                    'flex-1 rounded-lg border px-3 py-2.5 text-sm transition-colors text-left',
                    visibility === v
                      ? 'border-accent/30 bg-accent-muted text-accent-fg'
                      : 'border-border bg-surface text-fg hover:bg-surface-sunken',
                  )}
                >
                  <span className="font-medium block">
                    {v === 'private' ? 'Just me' : 'Everyone'}
                  </span>
                  <span className="text-xs text-fg-subtle mt-0.5 block">
                    {v === 'private' ? 'Only you can see this view' : 'Visible to all workspace members'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-danger-fg">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" isLoading={saving} onClick={handleSave}>
            Save view
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
