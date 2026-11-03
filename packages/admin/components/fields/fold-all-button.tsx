/**
 * File Name: fold-all-button.tsx
 * Purpose: The one control that folds or unfolds every card in a block field
 *          or a repeater.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: ONE button, not two, labelled with the action it will
 *          perform: while any card is open it collapses them, and once they
 *          are all closed it expands them. Two buttons would leave one of them
 *          inert most of the time, and the label would stop saying what a
 *          click does.
 *
 *          `anyExpanded` rather than a count, because the editor already knows
 *          which cards it renders and a stale fold entry for a deleted card
 *          must not decide the label.
 */
import { useMemo } from 'react'
import { Button } from '@tangen/ui'
import { IconChevronDown, IconChevronUp } from '@tangen/icons'
import { useFoldState } from '@/lib/use-fold-state'

export interface FoldAllButtonProps {
  /** True while at least one card is open, which makes this a Collapse all. */
  anyExpanded: boolean
  onToggle: () => void
  /** What the cards are called here: "sections", "items". */
  noun: string
}

export function FoldAllButton({ anyExpanded, onToggle, noun }: FoldAllButtonProps) {
  const label = anyExpanded ? 'Collapse all' : 'Expand all'
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={(e) => {
        // The field header this sits in is itself a click target that folds the
        // whole field. Without this, one click would fold the cards AND close
        // the field over them, so the result would never be seen.
        e.stopPropagation()
        onToggle()
      }}
      title={`${label} ${noun}`}
      icon={anyExpanded ? <IconChevronUp aria-hidden /> : <IconChevronDown aria-hidden />}
    >
      {label}
    </Button>
  )
}

/** The card keys in a stored block or repeater value, in order. */
export function cardKeysOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => (row as { _key?: unknown } | null)?._key)
    .filter((k): k is string => typeof k === 'string' && k !== '')
}

/**
 * The control as the field HEADER renders it, deriving the cards from the
 * stored value so the header needs no prop threading down to the editor. It
 * shares the editor's record through FoldProvider, so the two agree.
 *
 * One honest edge: a block hidden by a visibility rule is counted here but not
 * by the editor, which filters to what it renders. If a hidden block is the
 * only expanded one the label reads "Collapse all" and the first click appears
 * to do nothing visible, the second then expands. Taking the keys from the
 * editor instead would need it to register them in an effect, which pops the
 * button in a frame late on every load. One rare extra click beats that.
 */
export function FoldAllForValue({ value, noun }: { value: unknown; noun: string }) {
  const keys = useMemo(() => cardKeysOf(value), [value])
  const fold = useFoldState(keys)
  // One card has nothing to fold against, and none has nothing at all.
  if (keys.length < 2) return null
  return <FoldAllButton anyExpanded={fold.anyExpanded} onToggle={() => fold.setAll(fold.anyExpanded)} noun={noun} />
}
