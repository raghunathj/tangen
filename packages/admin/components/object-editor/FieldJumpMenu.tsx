/**
 * File Name: FieldJumpMenu.tsx
 * Purpose: The long-form jump list of UI V2 spec §19: when a document has
 *          more than a dozen fields, a "Jump to" menu in the frame header
 *          lists them (with the ones that need attention first) and scrolls
 *          the document to the field, focusing its control. Keyboard users
 *          get the same path: it is a Menu, and the target receives focus.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Fields are found by the `data-field` attribute every
 *          field row already carries; nothing else in the editor changes.
 */
import { IconListOrdered } from '@tangen/icons'
import { Button, Menu, MenuTrigger, MenuContent, MenuItem, MenuLabel, MenuSeparator } from '@tangen/ui'

export interface JumpTarget {
  name: string
  label: string
  /** The field currently carries a validation error. */
  error?: boolean
  required?: boolean
}

/** Show the menu only when the document is long enough to need one. */
export const JUMP_MENU_THRESHOLD = 12

export function scrollToField(name: string): void {
  const el = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(name)}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const control = el.querySelector<HTMLElement>('input, textarea, select, [contenteditable="true"], button')
  control?.focus({ preventScroll: true })
}

export function FieldJumpMenu({ targets }: { targets: JumpTarget[] }) {
  const errors = targets.filter((t) => t.error)
  const rest = targets.filter((t) => !t.error)
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="sm" icon={<IconListOrdered />} aria-label="Jump to a field">
          {errors.length > 0 ? `${errors.length} need${errors.length === 1 ? 's' : ''} attention` : 'Jump to'}
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="max-h-[70vh] min-w-56 overflow-y-auto">
        {errors.length > 0 && (
          <>
            <MenuLabel>Needs attention</MenuLabel>
            {errors.map((t) => (
              <MenuItem key={t.name} onSelect={() => scrollToField(t.name)} className="text-danger-fg">
                {t.label}
              </MenuItem>
            ))}
            <MenuSeparator />
          </>
        )}
        <MenuLabel>Fields</MenuLabel>
        {rest.map((t) => (
          <MenuItem key={t.name} onSelect={() => scrollToField(t.name)}>
            {t.label}
            {t.required && <span className="text-danger" aria-hidden>*</span>}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}
