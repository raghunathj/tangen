/**
 * File Name: richtext-engine-prosemirror.tsx
 * Purpose: The ProseMirror implementation of `RichtextEngine` - slice 7 of
 *          tasks/plan-editor.md. The ONLY file in the Admin that imports an
 *          editor engine.
 *
 *          ProseMirror directly, rather than through a framework on top of
 *          it, for three reasons the plan records: its schema IS a
 *          declarative node spec, so Tangen's own vocabulary projects onto it
 *          (`./richtext-schema`); it is MIT with no paid tier to drift into;
 *          and pinning current `prosemirror-*` is what clears the paste
 *          handling advisory that the previous engine's 2.x line will never
 *          be fixed for.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The field's three sync workarounds survive the swap,
 *          because they are properties of a CONTROLLED editor and not of any
 *          engine:
 *
 *          - `mountedRef` keeps a change nobody made from reaching the field.
 *            The old engine needed it because its placeholder emitted
 *            transactions during init; the placeholder here is a decoration
 *            and emits none, but a mount-time dispatch from anywhere else
 *            would still be a false edit, so the guard stays.
 *          - a programmatic set never enters history: `setContent` below
 *            dispatches with `addToHistory: false`, which is what makes an
 *            external sync invisible to undo.
 *          - the prop-versus-typing discriminator stays with the field, which
 *            owns the prop.
 *
 *          `Surface` is ONE component identity per view (memoised). A fresh
 *          arrow function would be a new component type on every render, so
 *          React would remount the editable element and the caret would die
 *          on the first click - a defect the editor lane caught once already.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorState, Plugin, TextSelection, type Command, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { DOMParser as PMDOMParser, DOMSerializer, type Mark, type MarkType, type Node as PMNode, type ResolvedPos, type Schema } from 'prosemirror-model'
import { baseKeymap, chainCommands, exitCode, lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands'
import { keymap } from 'prosemirror-keymap'
import { history, redo, redoDepth, undo, undoDepth } from 'prosemirror-history'
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list'
import { inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { safeDocHref } from '@tangen/types'
import { RICHTEXT_SCHEMA, richtextSchema } from './richtext-schema'
import { CONTENT_DOC_VOCABULARY, type ContentDocVocabulary } from '@tangen/types'
import type { RichtextCommand, RichtextEngine, RichtextEngineOptions } from './richtext-adapter'
import 'prosemirror-view/style/prosemirror.css'
import 'prosemirror-gapcursor/style/gapcursor.css'

/**
 * The compiled schema for a vocabulary, built once per vocabulary.
 *
 * A workspace whose extensions contribute nodes gets a different schema from
 * the built-in one, and a ProseMirror state is bound to exactly one schema -
 * a document built under one and a command built under another is a crash,
 * not a degradation. So the schema is pinned for the life of an engine (see
 * the hook) and the FIELD remounts when the vocabulary changes.
 */
const _schemas = new WeakMap<ContentDocVocabulary, Schema>()

export function schemaFor(vocabulary: ContentDocVocabulary | undefined): Schema {
  if (!vocabulary || vocabulary === CONTENT_DOC_VOCABULARY) return RICHTEXT_SCHEMA
  const hit = _schemas.get(vocabulary)
  if (hit) return hit
  let built: Schema
  try {
    built = richtextSchema(vocabulary)
  } catch (err) {
    // A declaration can pass every shape rule and still be a schema
    // ProseMirror refuses - two nodes whose content expressions cannot be
    // satisfied, say. The field falls back to the built-in vocabulary, because
    // an editor missing one contributed node is a degradation and an editor
    // that throws on mount is an outage. Named, so it is a bug report rather
    // than a mystery.
    console.error('[tangen] a contributed richtext node could not be compiled; the built-in vocabulary is in use', err)
    built = RICHTEXT_SCHEMA
  }
  _schemas.set(vocabulary, built)
  return built
}

// ── the document, in and out ──────────────────────────────────────────────────

/** An empty document that satisfies the schema, for a field with no value. */
const emptyDoc = (schema: Schema): PMNode => schema.topNodeType.createAndFill()!

/**
 * A stored value as a document. The storage layer tolerates a bare string and
 * a document with no content, so both are met here rather than thrown on: a
 * field that refuses to open is worse than one that opens empty.
 */
function docFrom(schema: Schema, value: unknown): PMNode {
  if (value == null) return emptyDoc(schema)
  if (typeof value === 'string') return value.trim() ? docFromHtml(schema, value) : emptyDoc(schema)
  if (typeof value !== 'object') return emptyDoc(schema)
  const json = value as { type?: unknown; content?: unknown }
  if (Array.isArray(json.content) && json.content.length === 0) return emptyDoc(schema)
  try {
    return schema.nodeFromJSON(json)
  } catch {
    // An unparseable document is still somebody's content. Opening empty would
    // invite them to save over it, so the field reports nothing and the
    // validator's message is what they see on the next write.
    return emptyDoc(schema)
  }
}

const element = (html: string): HTMLElement => {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

const docFromHtml = (schema: Schema, html: string): PMNode =>
  PMDOMParser.fromSchema(schema).parse(element(html))

function htmlFrom(schema: Schema, doc: PMNode): string {
  const host = document.createElement('div')
  host.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content))
  return host.innerHTML
}

// ── marks and ranges ──────────────────────────────────────────────────────────

/**
 * The whole run of one mark around a position.
 *
 * This is what makes editing a link with the caret merely INSIDE it do what an
 * editor should: without it, applying the new href to a collapsed selection
 * splits the link in two and the writer ends up with two anchors.
 */
function markRange($pos: ResolvedPos, type: MarkType): { from: number; to: number } | null {
  const { parent, parentOffset } = $pos
  const at = parent.childAfter(parentOffset)
  // At the very end of a mark, `childAfter` is already past it; step back one.
  const start = at.node?.marks.some((m) => m.type === type) ? at : parent.childBefore(parentOffset)
  if (!start.node) return null
  const mark = start.node.marks.find((m) => m.type === type)
  if (!mark) return null

  let index = start.index
  let from = $pos.start() + start.offset
  let to = from + start.node.nodeSize
  while (index > 0 && mark.isInSet(parent.child(index - 1).marks)) {
    index -= 1
    from -= parent.child(index).nodeSize
  }
  let after = start.index + 1
  while (after < parent.childCount && mark.isInSet(parent.child(after).marks)) {
    to += parent.child(after).nodeSize
    after += 1
  }
  return { from, to }
}

/** The selection, widened over a mark it sits inside. */
function rangeFor(state: EditorState, type: MarkType): { from: number; to: number } {
  const { from, to, empty, $from } = state.selection
  if (!empty) return { from, to }
  return markRange($from, type) ?? { from, to }
}

/** Whether a node or mark of this name (and these attrs) covers the selection. */
function isActiveIn(state: EditorState | null, name: string, attrs?: Record<string, unknown>): boolean {
  if (!state) return false
  const matches = (found: { attrs: Record<string, unknown> }) =>
    !attrs || Object.entries(attrs).every(([key, value]) => found.attrs[key] === value)

  // The state knows its own schema, which is a stronger guarantee than a
  // module-level one: the answer can never be about a different vocabulary
  // from the document being asked about.
  const markType = state.schema.marks[name]
  if (markType) {
    const { from, to, empty, $from } = state.selection
    const mark = empty
      ? (state.storedMarks ?? $from.marks()).find((m) => m.type === markType)
      : markOver(state.doc, from, to, markType)
    return !!mark && matches(mark)
  }

  const nodeType = state.schema.nodes[name]
  if (!nodeType) return false
  for (let depth = state.selection.$from.depth; depth >= 0; depth--) {
    const node = state.selection.$from.node(depth)
    if (node.type === nodeType) return matches(node)
  }
  return false
}

/** The first instance of a mark in a range, so its attributes can be read. */
function markOver(doc: PMNode, from: number, to: number, type: MarkType): Mark | undefined {
  let found: Mark | undefined
  doc.nodesBetween(from, to, (node) => {
    if (found) return false
    found = node.marks.find((m) => m.type === type)
    return !found
  })
  return found
}

// ── plugins ───────────────────────────────────────────────────────────────────

/**
 * The placeholder, as a decoration on the one empty block. The attribute and
 * the class are the ones the stylesheet already targets, so the visual
 * behaviour is unchanged by the engine swap.
 */
function placeholder(text: () => string): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { doc } = state
        const only = doc.childCount === 1 ? doc.firstChild : null
        if (!only || !only.isTextblock || only.content.size > 0) return null
        return DecorationSet.create(doc, [
          Decoration.node(0, only.nodeSize, { class: 'is-editor-empty', 'data-placeholder': text() }),
        ])
      },
    },
  })
}

const hardBreak: Command = (state, dispatch) => {
  dispatch?.(state.tr.replaceSelectionWith(state.schema.nodes.hardBreak!.create()).scrollIntoView())
  return true
}

/** Toggles a block type between itself and a paragraph. */
const toggleBlock = (name: string, attrs?: Record<string, unknown>): Command => (state, dispatch, view) =>
  (isActiveIn(state, name, attrs)
    ? setBlockType(state.schema.nodes.paragraph!)
    : setBlockType(state.schema.nodes[name]!, attrs))(state, dispatch, view)

/** Toggles a wrapping block: out of it when inside, into it otherwise. */
const toggleWrap = (name: string): Command => (state, dispatch, view) =>
  (isActiveIn(state, name) ? lift : wrapIn(state.schema.nodes[name]!))(state, dispatch, view)

/** Toggles a list: out of the item when already in that list, into it otherwise. */
const toggleList = (name: string): Command => (state, dispatch, view) =>
  (isActiveIn(state, name)
    ? liftListItem(state.schema.nodes.listItem!)
    : wrapInList(state.schema.nodes[name]!))(state, dispatch, view)

const markdownShortcuts = (schema: Schema) => inputRules({
  rules: [
    wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bulletList!),
    wrappingInputRule(/^(\d+)\.\s$/, schema.nodes.orderedList!),
    wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote!),
    textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading!, (match) => ({ level: match[1]!.length })),
    textblockTypeInputRule(/^```$/, schema.nodes.codeBlock!),
  ],
})

const shortcuts = (schema: Schema) => keymap({
  'Mod-b': toggleMark(schema.marks.bold!),
  'Mod-i': toggleMark(schema.marks.italic!),
  'Mod-u': toggleMark(schema.marks.underline!),
  'Mod-Shift-x': toggleMark(schema.marks.strike!),
  'Mod-e': toggleMark(schema.marks.code!),
  'Mod-Shift-8': toggleList('bulletList'),
  'Mod-Shift-7': toggleList('orderedList'),
  'Mod-Shift-b': toggleWrap('blockquote'),
  'Mod-z': undo,
  'Mod-y': redo,
  'Shift-Mod-z': redo,
  'Shift-Enter': chainCommands(exitCode, hardBreak),
  Enter: splitListItem(schema.nodes.listItem!),
  Tab: sinkListItem(schema.nodes.listItem!),
  'Shift-Tab': liftListItem(schema.nodes.listItem!),
})

// ── the engine ────────────────────────────────────────────────────────────────

/** A state over this document, with the editing behaviour attached. */
const freshState = (schema: Schema, doc: PMNode, placeholderText: () => string): EditorState =>
  EditorState.create({
    doc,
    plugins: [
      markdownShortcuts(schema),
      shortcuts(schema),
      keymap(baseKeymap),
      dropCursor(),
      gapCursor(),
      history(),
      placeholder(placeholderText),
    ],
  })

export function useRichtextEngine(opts: RichtextEngineOptions): RichtextEngine {
  // Everything that changes between renders is read through this, so the
  // mount callback below can stay stable for the life of the field.
  const live = useRef(opts)
  live.current = opts

  /**
   * ONE schema for the life of this engine.
   *
   * The vocabulary can change under the field (a bootstrap read lands, an
   * extension is enabled), and a ProseMirror state belongs to exactly one
   * schema: a document built under the old one and a command built under the
   * new one do not merely disagree, they throw. So the engine pins the schema
   * it mounted with, and `richtext.tsx` REMOUNTS when the vocabulary changes -
   * which is the same instrument the field already uses for restore and
   * publish, and the opposite of the identity-changes-after-mount shape that
   * caused slice 7's render loop.
   */
  const schemaRef = useRef<Schema | null>(null)
  schemaRef.current ??= schemaFor(opts.vocabulary)
  const schema = schemaRef.current
  const { nodes: N, marks: M } = schema

  const viewRef = useRef<EditorView | null>(null)
  const stateRef = useRef<EditorState | null>(null)
  // Re-render the toolbar on every transaction: its active states and its
  // undo availability are questions about the CURRENT selection.
  const [, bump] = useState(0)

  const mountedRef = useRef(false)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const programmatic = useRef(false)

  /**
   * The document lives in the HOOK, never in the DOM.
   *
   * The field swaps the editable surface for an HTML panel, which unmounts the
   * surface - so an engine that kept its state inside the view would lose the
   * whole document the moment someone opened the panel, and hand back an
   * empty one on the way out. The editor lane caught exactly that. The view is
   * a renderer over this state, and it may come and go.
   */
  if (!stateRef.current) stateRef.current = freshState(schema, docFrom(schema, opts.initial), () => live.current.placeholder)

  const stateOf = (): EditorState => viewRef.current?.state ?? stateRef.current!

  /** One way in for every change, whether a view is mounted or not. */
  const dispatch = useCallback((tr: Transaction) => {
    const view = viewRef.current
    if (view) view.updateState(view.state.apply(tr))
    else stateRef.current = stateRef.current!.apply(tr)
    bump((n) => n + 1)
    if (!tr.docChanged) return
    // A change nobody made must never reach the field: not one from the
    // mount, and not a programmatic replacement.
    if (!mountedRef.current || programmatic.current) return
    live.current.onChange((view?.state ?? stateRef.current!).doc.toJSON())
  }, [])

  const mount = useCallback((host: HTMLDivElement | null) => {
    const open = viewRef.current
    if (!host) {
      if (!open) return
      // Keep the document on the way out, so a remount resumes rather than
      // restarts - history included.
      stateRef.current = open.state
      open.destroy()
      viewRef.current = null
      bump((n) => n + 1)
      return
    }
    if (open) return
    const view = new EditorView(host, {
      state: stateRef.current!,
      attributes: { class: 'tg-richtext outline-none min-h-[160px]' },
      dispatchTransaction: (tr) => dispatch(tr),
    })
    viewRef.current = view
    bump((n) => n + 1)
  }, [dispatch])

  /** Replaces the whole document WITHOUT entering history. */
  const setContent = useCallback((doc: PMNode) => {
    programmatic.current = true
    try {
      const state = stateOf()
      const tr = state.tr.replaceWith(0, state.doc.content.size, doc.content)
      tr.setMeta('addToHistory', false)
      dispatch(tr)
    } finally {
      programmatic.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch])

  const run = useCallback((command: RichtextCommand): void => {
    const view = viewRef.current
    view?.focus()
    const state = stateOf()
    const apply = (cmd: Command) => { cmd(state, dispatch, view ?? undefined) }

    switch (command.kind) {
      case 'paragraph':      return apply(setBlockType(N.paragraph!))
      case 'heading':        return apply(toggleBlock('heading', { level: command.level }))
      case 'bold':           return apply(toggleMark(M.bold!))
      case 'italic':         return apply(toggleMark(M.italic!))
      case 'underline':      return apply(toggleMark(M.underline!))
      case 'strike':         return apply(toggleMark(M.strike!))
      case 'code':           return apply(toggleMark(M.code!))
      case 'codeBlock':      return apply(toggleBlock('codeBlock'))
      case 'blockquote':     return apply(toggleWrap('blockquote'))
      case 'bulletList':     return apply(toggleList('bulletList'))
      case 'orderedList':    return apply(toggleList('orderedList'))
      case 'horizontalRule': return dispatch(state.tr.replaceSelectionWith(N.horizontalRule!.create()).scrollIntoView())
      case 'undo':           return apply(undo)
      case 'redo':           return apply(redo)
      case 'insertNode': {
        const type = state.schema.nodes[command.name]
        // A name the schema does not know is a no-op rather than a throw: the
        // menu is built from a vocabulary that can lag a disabled extension by
        // one bootstrap read, and an editor must not break for that.
        if (!type) return
        const node = type.createAndFill(command.attrs ?? null)
        // `createAndFill` returns null when it cannot build something valid -
        // a required attribute with no usable value, say. Nothing to insert.
        if (!node) return
        return dispatch(state.tr.replaceSelectionWith(node).scrollIntoView())
      }
      case 'setImage': {
        const src = safeDocHref(command.src)
        if (!src) return
        return dispatch(state.tr.replaceSelectionWith(N.image!.create({ src })).scrollIntoView())
      }
      case 'setLink': {
        // A scheme the vocabulary refuses is refused here too, so the editor
        // cannot author a link the stored format would drop.
        const href = safeDocHref(command.href)
        if (!href) return
        const { from, to } = rangeFor(state, M.link!)
        if (from === to) return
        const attrs = command.newTab
          ? { href, target: '_blank', rel: 'noopener noreferrer' }
          : { href, target: null, rel: null }
        const tr = state.tr.removeMark(from, to, M.link!).addMark(from, to, M.link!.create(attrs))
        tr.setSelection(TextSelection.create(tr.doc, from, to))
        return dispatch(tr)
      }
      case 'unsetLink': {
        const { from, to } = rangeFor(state, M.link!)
        if (from === to) return
        return dispatch(state.tr.removeMark(from, to, M.link!))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch])

  // ONE component identity per mount callback, which is stable for the life of
  // the field. See the note at the top of the file.
  const Surface = useMemo(
    () => function RichtextSurface({ className }: { className?: string }) {
      return <div ref={mount} className={className} />
    },
    [mount],
  )

  return {
    // The document exists before any view does, so the toolbar is never
    // disabled waiting for one.
    ready: true,
    Surface,
    isActive: (name, attrs) => isActiveIn(stateOf(), name, attrs),
    can: (action) => (action === 'undo' ? undoDepth(stateOf()) > 0 : redoDepth(stateOf()) > 0),
    linkAttrs: () => {
      const state = stateOf()
      const { from, to } = rangeFor(state, M.link!)
      // An empty range means the caret is in no link at all; reading one
      // character further would pre-fill the dialog from the next link along.
      if (from === to) return {}
      const mark = markOver(state.doc, from, to, M.link!)
      return { href: mark?.attrs.href as string | undefined, target: mark?.attrs.target as string | undefined }
    },
    run,
    getJSON: () => stateOf().doc.toJSON(),
    getHTML: () => htmlFrom(schema, stateOf().doc),
    setJSON: (value) => { if (value != null) setContent(docFrom(schema, value)) },
    setHTML: (html) => { setContent(docFromHtml(schema, html)) },
    focus: () => { viewRef.current?.focus() },
  }
}
