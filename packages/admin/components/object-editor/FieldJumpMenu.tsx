/**
 * File Name: FieldJumpMenu.tsx
 * Purpose: The long-form jump list of UI V2 spec §19: when a document has
 *          more than a dozen fields, a "Jump to" menu in the frame header
 *          lists them (with the ones that need attention first) and scrolls
 *          the document to the field, focusing its control. Keyboard users
 *          get the same path: it is a Menu, and the target receives focus.
 *
 *          It is also where a refused publish is read: a field that errors is
 *          listed first, with an alert icon and the REASON under its label,
 *          because for a container field the label names the field while only
 *          the message names the block inside it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Fields are found by the `data-field` attribute every
 *          field row already carries; nothing else in the editor changes.
 */
import type { ConditionalVisibility } from '@tangen/types'
import { IconAlert, IconListOrdered } from '@tangen/icons'
import { Button, Menu, MenuTrigger, MenuContent, MenuItem, MenuLabel, MenuSeparator } from '@tangen/ui'
import { evalVisibility } from '@/lib/editor'

export interface JumpTarget {
  name: string
  label: string
  /**
   * The validation message the field currently carries, or null. It is the
   * MESSAGE rather than a flag because for a container field the label cannot
   * say what is wrong: every block on a page lives under one `blocks` field,
   * so "Blocks" names the field and the message names the block.
   */
  error?: string | null
  required?: boolean
}

/** Show the menu only when the document is long enough to need one. */
export const JUMP_MENU_THRESHOLD = 12

/** The shape this list needs of a field; a FieldDefinition satisfies it. */
interface JumpField {
  name: string
  label: string
  required?: boolean
  config?: { admin?: { hidden?: boolean; conditionalVisibility?: ConditionalVisibility } }
}

/**
 * The fields this list may offer, in order, each carrying its message.
 *
 * ONLY FIELDS THAT ARE ON THE PAGE. `scrollToField` finds its target by the
 * `data-field` attribute a drawn row carries, so offering a field the editor
 * did not draw produces a row that scrolls nowhere and returns in silence -
 * which reads as a broken menu rather than as a hidden field. Both reasons a
 * field is undrawn are therefore read here, the unconditional `hidden` and the
 * field's own rule, and read the same way the editor reads them.
 *
 * Group children are not in this list: it is given the top-level fields, and a
 * `group` is one row among them.
 */
export function jumpTargets(
  fields: JumpField[],
  values: Record<string, unknown>,
  errors: Record<string, string>,
): JumpTarget[] {
  return fields
    .filter((f) => {
      if (f.config?.admin?.hidden) return false
      const cv = f.config?.admin?.conditionalVisibility
      return !cv || evalVisibility(cv, (n) => values[n])
    })
    .map((f) => ({
      name: f.name,
      label: f.label,
      required: !!f.required,
      // The message, not a flag: a container field's label cannot say which
      // block is wrong, and the message can.
      error: errors[f.name] ?? null,
    }))
}

export function scrollToField(name: string): void {
  const el = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(name)}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const control = el.querySelector<HTMLElement>('input, textarea, select, [contenteditable="true"], button')
  control?.focus({ preventScroll: true })
}

/**
 * What an erroring field shows in the list: the icon, the label, the reason.
 *
 * Its own component because `MenuContent` portals, so nothing inside an open
 * menu is reachable by a static render - this is the seam that makes the row
 * assertable without a DOM.
 */
export function JumpErrorRow({ target }: { target: JumpTarget }) {
  return (
    <>
      <IconAlert aria-hidden className="mt-0.5 self-start" />
      <span className="flex min-w-0 flex-col">
        <span>{target.label}</span>
        {target.error && <span className="text-ui-xs opacity-80">{target.error}</span>}
      </span>
    </>
  )
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
              <MenuItem
                key={t.name}
                destructive
                onSelect={() => scrollToField(t.name)}
                // `destructive` is the kit's danger row, which also colours the
                // icon and keeps contrast while highlighted; the hand-rolled
                // `text-danger-fg` this replaced lost both on hover. The height
                // is released because the reason is a second line.
                className="h-auto items-start py-1.5"
              >
                <JumpErrorRow target={t} />
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
