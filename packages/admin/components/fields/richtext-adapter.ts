/**
 * File Name: richtext-adapter.ts
 * Purpose: The one seam between Tangen's richtext UI and whichever editor
 *          engine renders it - slice 6 of tasks/plan-editor.md.
 *
 *          The toolbar, the dialogs and the HTML-source panel talk to this
 *          interface and never to an engine. Everything engine-specific lives
 *          behind `useRichtextEngine`, so replacing the engine is one file
 *          rather than a component rewrite, and so the engine stops being a
 *          decision the UI has an opinion about.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The command set is CLOSED and names what the toolbar
 *          offers, not what an engine happens to expose. That is what makes
 *          it portable: a new engine must answer these and nothing more, and
 *          `richtext.tsx` cannot quietly reach past the seam for one more
 *          command (a counted source gate in the tests holds that).
 */

import type { ContentDocVocabulary } from '@tangen/types'

/** Everything the toolbar can ask for. One shape, so a new engine has a checklist. */
export type RichtextCommand =
  | { kind: 'paragraph' }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: 'bold' } | { kind: 'italic' } | { kind: 'underline' } | { kind: 'strike' }
  | { kind: 'code' } | { kind: 'codeBlock' } | { kind: 'blockquote' }
  | { kind: 'bulletList' } | { kind: 'orderedList' }
  | { kind: 'horizontalRule' }
  | { kind: 'undo' } | { kind: 'redo' }
  | { kind: 'setLink'; href: string; newTab: boolean }
  | { kind: 'unsetLink' }
  | { kind: 'setImage'; src: string }
  /**
   * Insert one node of the vocabulary by name. The only command that names a
   * node rather than a fixed affordance, because it is the only one that
   * serves nodes the toolbar cannot know about: a contributed element has a
   * `label` and no button. `attrs` is the caller's, since only the
   * DECLARATION knows what a required attribute may hold.
   */
  | { kind: 'insertNode'; name: string; attrs?: Record<string, unknown> }

/** What the toolbar asks about the selection, by the vocabulary's own names. */
export interface RichtextActiveQuery {
  /** A node or mark name, with attrs when the state depends on them (`heading`, level 2). */
  (name: string, attrs?: Record<string, unknown>): boolean
}

export interface RichtextEngine {
  /** Null until the engine has mounted; the UI renders disabled until then. */
  ready: boolean
  /** The editable surface. Rendered by the UI, owned by the engine. */
  Surface: (props: { className?: string }) => JSX.Element | null
  isActive: RichtextActiveQuery
  /** Whether history has anything to undo or redo, for the toolbar's disabled state. */
  can: (action: 'undo' | 'redo') => boolean
  /** The current link's attributes, for the link dialog to pre-fill. */
  linkAttrs: () => { href?: string; target?: string }
  run: (command: RichtextCommand) => void
  getJSON: () => unknown
  getHTML: () => string
  /** Replaces the document without putting the change on the undo stack. */
  setJSON: (value: unknown) => void
  setHTML: (html: string) => void
  /** Puts the caret back in the document, after a dialog or a toolbar click. */
  focus: () => void
}

export interface RichtextEngineOptions {
  /** The document to start from; null means an empty one. */
  initial: unknown
  placeholder: string
  /** Called on every change the USER made, never on a programmatic set. */
  onChange: (json: unknown) => void
  /** Whether the image command is offered at all. */
  media: boolean
  /**
   * The document vocabulary this field edits: the built-in nodes plus whatever
   * this workspace's active extensions contribute. A Tangen type, not an
   * engine one - the seam stays engine-neutral, and an engine is free to
   * compile it however it likes.
   *
   * Omitted means the built-in vocabulary, which is what a surface with no
   * workspace in hand (a preview, a test) should get.
   */
  vocabulary?: ContentDocVocabulary
}
