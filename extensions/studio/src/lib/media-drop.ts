/**
 * File Name: media-drop.ts
 * Purpose: What picking a media asset does - which block it fills, or why it
 *          cannot be placed.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Schema-driven rather than hardcoded to kit.image: a
 *          developer's own component with a media field is just as valid a
 *          target, and the field's `accept` list already says what it takes.
 *
 *          Not every media kind has a home. kit.video holds a URL (YouTube
 *          and friends), not an uploaded asset, and nothing in the kit takes
 *          a PDF - so those return a REASON rather than a click that
 *          silently does nothing.
 */
import type { ComponentDef, SubField } from '@tangen/types'
import { allowedChildTypes } from './drop'

export type MediaCategory = 'image' | 'video' | 'audio' | 'document'

/** The block Studio falls back to when the selection cannot take an asset. */
const IMAGE_BLOCK = { blockType: 'kit.image', prop: 'image' } as const

export type MediaTarget =
  /** Fill this prop on the block already selected. */
  | { action: 'set'; prop: string }
  /** Insert a new block carrying the asset. */
  | { action: 'insert'; blockType: string; prop: string }
  /** Nothing can hold it; `reason` is written for the person who clicked. */
  | { action: 'none'; reason: string }

/** The broad kind of an asset, from its mime type. */
export function mediaCategory(mime: string | undefined): MediaCategory {
  const head = String(mime ?? '').split('/')[0]
  if (head === 'image') return 'image'
  if (head === 'video') return 'video'
  if (head === 'audio') return 'audio'
  return 'document'
}

/** True when a media field will take this category. */
function accepts(field: SubField, category: MediaCategory): boolean {
  if (field.fieldType !== 'media') return false
  const accept = (field.config as { accept?: unknown } | undefined)?.accept
  // No list means no restriction - the field takes whatever it is given.
  if (!Array.isArray(accept) || accept.length === 0) return true
  return accept.includes(category)
}

/**
 * Where a picked asset should land. Filling the SELECTED block wins when it
 * has a field that accepts the asset - that is what "I selected this, now
 * give it a picture" means. Otherwise a new image block is inserted, and if
 * the asset is not an image, nothing can hold it.
 */
export function mediaTarget(mime: string | undefined, selected: ComponentDef | null): MediaTarget {
  const category = mediaCategory(mime)

  const field = (selected?.fields ?? []).find((f) => accepts(f as SubField, category))
  if (field) return { action: 'set', prop: (field as SubField).name }

  if (category === 'image') return { action: 'insert', ...IMAGE_BLOCK }

  return {
    action: 'none',
    reason: category === 'video'
      ? 'The video block takes a URL rather than an uploaded file. Paste the video link into a video block instead.'
      : `No block on this page accepts ${category === 'audio' ? 'audio' : 'this kind of file'} yet. Link to it from text instead.`,
  }
}

export type ImagePlacement =
  /** Inside the selected container, in this slot, at the end. */
  | { action: 'into'; slot: string }
  /** As the selected block's next sibling. */
  | { action: 'after' }
  /** At the end of the page - nothing is selected. */
  | { action: 'append' }

/**
 * Where a NEW image block lands on a click in the Media panel. The
 * selection is the cue, and the slot decides exactly as a drop does: a
 * selected container whose slot takes an image gets it inside; any other
 * selection gets it as the next sibling; no selection appends to the page.
 */
export function imagePlacement(
  selected: ComponentDef | null,
  defs: readonly ComponentDef[],
  fieldComponents: string[],
): ImagePlacement {
  if (!selected) return { action: 'append' }
  const slot = (selected.fields ?? []).find((f) => (f as SubField).fieldType === 'component') as SubField | undefined
  if (slot && allowedChildTypes(selected.name, defs as never, fieldComponents).includes(IMAGE_BLOCK.blockType)) {
    return { action: 'into', slot: slot.name }
  }
  return { action: 'after' }
}

/** The block a dragged asset becomes on the canvas, or null when none can hold it. */
export function draggedBlockType(mime: string | undefined): string | null {
  return mediaCategory(mime) === 'image' ? IMAGE_BLOCK.blockType : null
}
