import { useState } from 'react'
import {
  AdminPage, Button, Callout, toast, useConfirm, Skeleton, Spinner, Card, Text, Input, Label,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription,
} from '@/kit'
import { Example, ExampleStack, useSinkCrumbs } from './example'

/** Feedback — toasts (transient), callouts (persistent), overlays, loading. */
export function SinkFeedbackPage() {
  const { confirm, confirmDialog } = useConfirm()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <AdminPage breadcrumbs={useSinkCrumbs('Feedback')}>
      <ExampleStack>

        <Example
          title="Toasts - transient acknowledgements"
          description="A card, bottom right. {Noun} {past participle} as the title; ONE action (Undo, Retry, View) or a link; it leaves by itself unless persist. The Toaster is mounted by the shell."
          code={`import { toast } from '@/kit'

toast.success('Post published', 'It is live on the site')
toast.success('Key revoked', { action: { label: 'Undo', onClick: () => restore(id) } })
toast.info('Import started', { link: { label: 'View run', href: '/runs/42' } })
toast.error('Could not save', { description: err.message, persist: true, action: { label: 'Retry', onClick: save } })

// One toast for one async flow: loading, then the terminal state in its place.
await toast.promise(publish(), {
  loading: 'Publishing…',
  success: (obj) => ({ title: 'Published', link: { label: 'Open', href: obj.url } }),
  error: (e) => ({ title: 'Could not publish', description: String(e) }),
})`}
        >
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => toast.success('Post published', 'It is live on the site')}>success</Button>
            <Button size="sm" variant="secondary" onClick={() => toast.success('Key revoked', { action: { label: 'Undo', onClick: () => toast.info('Key restored') } })}>with Undo</Button>
            <Button size="sm" variant="secondary" onClick={() => toast.info('Import started', { description: 'Two files, 1,204 rows', link: { label: 'View run', href: '#' } })}>with a link</Button>
            <Button size="sm" variant="secondary" onClick={() => toast.warning('Almost out of quota', 'Media storage is at 92%')}>warning</Button>
            <Button size="sm" variant="secondary" onClick={() => toast.error('Could not save', { description: 'The API returned 500', persist: true, action: { label: 'Retry', onClick: () => new Promise((r) => setTimeout(r, 800)) } })}>error, persists, Retry</Button>
            <Button size="sm" variant="secondary" onClick={() => { void toast.promise(new Promise<{ url: string }>((r) => setTimeout(() => r({ url: '#' }), 1500)), { loading: 'Publishing…', success: (v) => ({ title: 'Published', link: { label: 'Open', href: v.url } }), error: 'Could not publish' }) }}>promise</Button>
            <Button size="sm" variant="secondary" onClick={() => { void toast.promise(new Promise((_, rej) => setTimeout(() => rej(new Error('Row 12: missing title')), 1500)), { loading: 'Importing…', success: 'Imported', error: (e) => ({ title: 'Import failed', description: (e as Error).message, action: { label: 'Retry', onClick: () => {} } }) }).catch(() => {}) }}>promise that fails</Button>
          </div>
        </Example>

        <Example
          title="Callout - persistent inline messages"
          description="In-flow state the user should keep seeing (setup steps, degraded services, destructive warnings)"
          code={`import { Callout } from '@/kit'

<Callout variant="info" title="Sandbox environment">
  Records here are wiped nightly.
</Callout>
<Callout variant="warning">Storage adapter is falling back to local.</Callout>
<Callout variant="danger" title="This deletes 214 records">There is no undo.</Callout>`}
        >
          <div className="space-y-3">
            <Callout variant="info" title="Sandbox environment">Records here are wiped nightly.</Callout>
            <Callout variant="success" title="Connected">The S3 bucket answered in 84 ms.</Callout>
            <Callout variant="warning">Storage adapter is falling back to local - check your credentials.</Callout>
            <Callout variant="danger" title="This deletes 214 records">There is no undo.</Callout>
          </div>
        </Example>

        <Example
          title="Confirmation"
          description="Promise-based useConfirm for destructive flows; render {confirmDialog} once per page"
          code={`const { confirm, confirmDialog } = useConfirm()

if (await confirm({ title: 'Delete this record?', variant: 'destructive' })) {
  await doDelete()
  toast.success('Deleted')
}
// …
{confirmDialog}`}
        >
          <Button
            size="sm"
            variant="destructive"
            onClick={async () => {
              if (await confirm({ title: 'Delete this record?', message: 'This cannot be undone.', variant: 'destructive' })) {
                toast.success('Deleted')
              }
            }}
          >
            Delete with confirm
          </Button>
          {confirmDialog}
        </Example>

        <Example
          title="Overlays - Sheet vs Dialog vs Confirm"
          description="Sheet (side-slider) for EDITOR forms - it does NOT close on Escape or outside-click, so a stray keystroke never discards a half-filled form; only ×/Cancel/Save close it. Dialog (centered modal) for short confirmations and quick pickers. Confirm for destructive yes/no."
          code={`import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button,
} from '@/kit'

// Editor form → Sheet (Escape-safe; close only via buttons)
<Sheet open={open} onOpenChange={(o) => { if (!o) setOpen(false) }}>
  <SheetContent>                     {/* side="right" default; dismissible={false} */}
    <SheetHeader><SheetTitle>Edit item</SheetTitle></SheetHeader>
    <SheetBody>{/* your form */}</SheetBody>
    <SheetFooter>
      <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
      <Button onClick={save}>Save</Button>
    </SheetFooter>
  </SheetContent>
</Sheet>

// Short confirmation / picker → Dialog (Escape + outside close)
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent>…</DialogContent>
</Dialog>`}
        >
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setSheetOpen(true)}>Open editor (Sheet)</Button>
            <Button size="sm" variant="secondary" onClick={() => setDialogOpen(true)}>Open modal (Dialog)</Button>
            <Button size="sm" variant="destructive" onClick={async () => {
              if (await confirm({ title: 'Delete this record?', message: 'This cannot be undone.', variant: 'destructive' })) toast.success('Deleted')
            }}>Confirm delete</Button>
          </div>

          <Sheet open={sheetOpen} onOpenChange={(o) => { if (!o) setSheetOpen(false) }}>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Edit item</SheetTitle>
                <SheetDescription>Press Escape - it stays open. Only Cancel / × / Save close it.</SheetDescription>
              </SheetHeader>
              <SheetBody>
                <div className="space-y-3">
                  <div><Label>Name</Label><Input placeholder="Type something, then hit Escape…" /></div>
                  <div><Label>Notes</Label><Input placeholder="Nothing is discarded on Esc" /></div>
                </div>
              </SheetBody>
              <SheetFooter>
                <Button variant="secondary" onClick={() => setSheetOpen(false)}>Cancel</Button>
                <Button onClick={() => { setSheetOpen(false); toast.success('Saved') }}>Save</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Quick confirmation</DialogTitle>
                <DialogDescription>A centered modal - Escape and outside-click DO close it (fine for a confirmation).</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="secondary" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={() => setDialogOpen(false)}>OK</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Example>

        <Example
          title="Loading states"
          description="Skeleton for known layouts, Spinner for indeterminate waits - never a blank region"
          code={`<Skeleton variant="rows" rows={3} />
<Skeleton variant="block" />
<Spinner size="sm" label="Syncing…" />`}
        >
          <div className="grid grid-cols-2 gap-4">
            <Card title="Skeleton">
              <Skeleton variant="rows" rows={3} />
            </Card>
            <Card title="Spinner">
              <div className="space-y-3">
                <Spinner size="sm" label="Syncing…" />
                <Text variant="help">Prefer Skeleton when you know the shape of what's coming.</Text>
              </div>
            </Card>
          </div>
        </Example>

      </ExampleStack>
    </AdminPage>
  )
}
