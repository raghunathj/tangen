import { Button, toast, useConfirm, AdminPage } from '@/kit'
import { IconPlus, IconSearch, IconChevronRight, IconTrash } from '@tangen/icons'
import { Example, ExampleStack, useSinkCrumbs } from './example'

/** Buttons — variants, sizes, icons (pre/post), loading, groups, confirm. */
export function SinkButtonsPage() {
  const { confirm, confirmDialog } = useConfirm()
  return (
    <AdminPage breadcrumbs={useSinkCrumbs('Buttons')}>
      <ExampleStack>

        <Example
          title="Variants"
          description="primary / secondary / light / ghost / destructive"
          code={`import { Button } from '@/kit'

<Button>Primary</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="light">Light</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="destructive">Destructive</Button>`}
        >
          <div className="flex flex-wrap gap-2">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="light">Light</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
          </div>
        </Example>

        <Example
          title="Sizes"
          code={`<Button size="xs">Extra small</Button>
<Button size="sm">Small</Button>
<Button size="md">Medium (default)</Button>`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button size="xs" variant="secondary">Extra small</Button>
            <Button size="sm" variant="secondary">Small</Button>
            <Button size="md" variant="secondary">Medium (default)</Button>
          </div>
        </Example>

        <Example
          title="Icons - start and end"
          description="iconPosition places the icon before (default) or after the label"
          code={`<Button icon={<IconPlus className="size-4" />}>New record</Button>
<Button variant="secondary" icon={<IconChevronRight className="size-4" />} iconPosition="end">
  Continue
</Button>`}
        >
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<IconPlus className="size-4" />}>New record</Button>
            <Button size="sm" variant="secondary" icon={<IconSearch className="size-4" />}>Search</Button>
            <Button size="sm" variant="secondary" icon={<IconChevronRight className="size-4" />} iconPosition="end">Continue</Button>
          </div>
        </Example>

        <Example
          title="Loading & disabled"
          description="isLoading swaps in a spinner and disables the button; loadingText replaces the label"
          code={`<Button isLoading loadingText="Saving…">Save</Button>
<Button disabled>Disabled</Button>`}
        >
          <div className="flex flex-wrap gap-2">
            <Button size="sm" isLoading loadingText="Saving…">Save</Button>
            <Button size="sm" disabled>Disabled</Button>
          </div>
        </Example>

        <Example
          title="Action rows & destructive confirm"
          description="Group with flex gap; destructive actions go through useConfirm"
          code={`const { confirm, confirmDialog } = useConfirm()

<div className="flex gap-2">
  <Button variant="secondary">Cancel</Button>
  <Button variant="destructive" icon={<IconTrash className="size-4" />}
    onClick={async () => {
      if (await confirm({ title: 'Delete this record?', variant: 'destructive' })) {
        toast.success('Deleted')
      }
    }}>
    Delete
  </Button>
</div>
{confirmDialog}   // render once per page`}
        >
          <div className="flex gap-2">
            <Button size="sm" variant="secondary">Cancel</Button>
            <Button
              size="sm"
              variant="destructive"
              icon={<IconTrash className="size-4" />}
              onClick={async () => {
                if (await confirm({ title: 'Delete this record?', message: 'This cannot be undone.', variant: 'destructive' })) {
                  toast.success('Deleted')
                }
              }}
            >
              Delete
            </Button>
          </div>
          {confirmDialog}
        </Example>

      </ExampleStack>
    </AdminPage>
  )
}
