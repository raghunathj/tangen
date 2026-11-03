

import { useRef, useState, useEffect, useMemo } from 'react'
import { clsx } from 'clsx'
import { useRichtextEngine } from './richtext-engine-prosemirror'
import type { RichtextEngine } from './richtext-adapter'
import { recognisedHtml } from './richtext-schema'
import { htmlDropReport, describeHtmlDrop } from './richtext-html-check'
import { useRichtextVocabulary, insertAttrsFor } from '@/lib/use-richtext-vocabulary'
import type { RichtextContribution } from '@/lib/use-capabilities'
import type { ContentDocVocabulary } from '@tangen/types'
import {
  Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectItem } from '@/components/ui/select'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RichTextEditorProps {
  value: unknown
  onChange: (json: unknown) => void
  workspaceId?: string
  toolbar?: 'basic' | 'advanced'
  media?: boolean
  placeholder?: string
}

// ── Toolbar button ────────────────────────────────────────────────────────────

function Btn({ onClick, active, title, children, disabled }: {
  onClick: () => void
  active?: boolean
  title: string
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      className={clsx(
        'px-1.5 py-1 rounded text-xs font-medium transition-colors duration-100 min-w-[1.75rem] text-center',
        active
          ? 'bg-accent-muted text-accent-fg'
          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
        disabled && 'opacity-30 pointer-events-none',
      )}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <span className="w-px h-4 bg-surface-hover mx-0.5 shrink-0 self-center" />
}

// ── Block type select ─────────────────────────────────────────────────────────

function BlockTypeSelect({ editor }: { editor: RichtextEngine }) {
  if (!editor.ready) return null

  const activeType =
    editor.isActive('heading', { level: 1 }) ? 'h1' :
    editor.isActive('heading', { level: 2 }) ? 'h2' :
    editor.isActive('heading', { level: 3 }) ? 'h3' :
    editor.isActive('heading', { level: 4 }) ? 'h4' :
    editor.isActive('heading', { level: 5 }) ? 'h5' :
    editor.isActive('heading', { level: 6 }) ? 'h6' :
    editor.isActive('codeBlock') ? 'codeblock' :
    editor.isActive('blockquote') ? 'blockquote' :
    'paragraph'

  const options: { value: string; label: string }[] = [
    { value: 'paragraph', label: 'Paragraph' },
    { value: 'h1', label: 'Heading 1' },
    { value: 'h2', label: 'Heading 2' },
    { value: 'h3', label: 'Heading 3' },
    { value: 'h4', label: 'Heading 4' },
    { value: 'h5', label: 'Heading 5' },
    { value: 'h6', label: 'Heading 6' },
    { value: 'codeblock', label: 'Code block' },
    { value: 'blockquote', label: 'Blockquote' },
  ]

  function apply(val: string) {
    if (!editor.ready) return
    const heading = /^h([1-6])$/.exec(val)
    if (heading) {
      editor.run({ kind: 'heading', level: Number(heading[1]) as 1 | 2 | 3 | 4 | 5 | 6 })
      return
    }
    if (val === 'codeblock') editor.run({ kind: 'codeBlock' })
    else if (val === 'blockquote') editor.run({ kind: 'blockquote' })
    else editor.run({ kind: 'paragraph' })
  }

  return (
    <select
      value={activeType}
      onChange={(e) => apply((e.target as HTMLSelectElement).value)}
      onMouseDown={(e) => e.stopPropagation()}
      className="text-xs text-fg border border-border rounded px-1.5 py-0.5 bg-surface focus:outline-none focus-visible:border-focus-border cursor-pointer h-7"
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// ── Insert menu ───────────────────────────────────────────────────────────────

/**
 * The affordance a contributed node has no other way to get.
 *
 * Every built-in has a toolbar button; a declared element has a `label` and
 * nothing else, which is why `ExtensionRichtextNode` has carried `label` and
 * `priority` since slice 5 with nothing reading them. The menu is absent
 * entirely when no extension contributes, so the common toolbar is unchanged.
 *
 * The server orders the list by priority, so this renders it as given rather
 * than having its own opinion about which element comes first.
 */
function InsertMenu({ contributions, onInsert, disabled }: {
  contributions: RichtextContribution[]
  onInsert: (name: string, attrs: Record<string, unknown>) => void
  disabled: boolean
}) {
  return (
    <Select
      aria-label="Insert element"
      // Always empty: the control is an action, not a state. Holding the last
      // choice would claim the selection IS that element.
      value=""
      placeholder="Insert"
      disabled={disabled}
      onValueChange={(name) => {
        const node = contributions.find((n) => n.name === name)
        if (node) onInsert(node.name, insertAttrsFor(node))
      }}
      className="h-7 w-auto min-w-24 text-xs"
    >
      {contributions.map((n) => (
        <SelectItem key={n.name} value={n.name}>{n.label}</SelectItem>
      ))}
    </Select>
  )
}

// ── Main editor ───────────────────────────────────────────────────────────────

/**
 * The field, over this workspace's vocabulary.
 *
 * The split is not decoration. The vocabulary can arrive AFTER the field has
 * mounted - the Admin bootstrap read is what carries an extension's
 * contributed nodes - and an editor state belongs to exactly one compiled
 * schema, so swapping one under a live document throws rather than degrades.
 * Keying the inner component on the vocabulary makes a late arrival a REMOUNT,
 * which is the instrument this field already uses for restore and publish, and
 * which is lossless because the document is controlled by `value`. With no
 * contributed nodes the key never changes and nothing ever remounts, which is
 * every workspace until an extension declares one.
 */
export default function RichTextEditor(props: RichTextEditorProps) {
  const { vocabulary, key, contributions } = useRichtextVocabulary(props.workspaceId)
  return <RichTextField {...props} key={key} vocabulary={vocabulary} contributions={contributions} />
}

function RichTextField({
  value,
  onChange,
  workspaceId,
  vocabulary,
  contributions,
  toolbar = 'advanced',
  media = false,
  placeholder: placeholderText = 'Write something…',
}: RichTextEditorProps & { vocabulary: ContentDocVocabulary; contributions: RichtextContribution[] }) {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkNewTab, setLinkNewTab] = useState(false)
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [htmlMode, setHtmlMode] = useState(false)
  const [htmlSource, setHtmlSource] = useState('')
  const linkInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  // Track the last value string we pushed into the editor so we can distinguish
  // external (prop) changes from internal (typing) changes.
  const lastValueStrRef = useRef(JSON.stringify(value ?? null))

  // The engine is behind one interface (./richtext-adapter). Nothing in this
  // file knows which editor renders the document, which is the point.
  const editor = useRichtextEngine({
    initial: value,
    placeholder: placeholderText,
    media: !!media,
    vocabulary,
    onChange: (json) => {
      lastValueStrRef.current = JSON.stringify(json)
      onChange(json)
    },
  })

  // Sync editor content when value changes externally (e.g. after publish, version restore,
  // or initial load when value arrives after editor creation).
  useEffect(() => {
    if (!editor.ready) return
    const str = JSON.stringify(value ?? null)
    if (str !== lastValueStrRef.current) {
      lastValueStrRef.current = str
      editor.setJSON(value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.ready, value])

  // ── Link dialog ─────────────────────────────────────────────────────────────

  function openLinkDialog() {
    const attrs = editor.linkAttrs()
    setLinkUrl(attrs.href ?? 'https://')
    setLinkNewTab(attrs.target === '_blank')
    setLinkDialogOpen(true)
    setTimeout(() => { linkInputRef.current?.select() }, 50)
  }

  function applyLink() {
    setLinkDialogOpen(false)
    // An empty box removes the link; the engine clears target/rel when the
    // new-tab box is unticked, so editing back to same-tab really does.
    if (!linkUrl.trim()) editor.run({ kind: 'unsetLink' })
    else editor.run({ kind: 'setLink', href: linkUrl.trim(), newTab: linkNewTab })
  }

  function removeLink() {
    setLinkDialogOpen(false)
    editor.run({ kind: 'unsetLink' })
  }

  // ── Image dialog ────────────────────────────────────────────────────────────

  function openImageDialog() {
    setImageUrl('')
    setImageDialogOpen(true)
    setTimeout(() => { imageInputRef.current?.focus() }, 50)
  }

  function applyImage() {
    setImageDialogOpen(false)
    if (imageUrl.trim()) editor.run({ kind: 'setImage', src: imageUrl.trim() })
  }

  // ── HTML source mode ────────────────────────────────────────────────────────

  function enterHtmlMode() {
    setHtmlSource(editor.getHTML())
    setHtmlMode(true)
  }

  // Said BEFORE Apply, not after. ProseMirror keeps what the vocabulary can
  // represent and discards the rest in silence, so this is the only place a
  // person can be told that their `<table>` is about to become three
  // paragraphs - while they can still cancel.
  // Derived from THIS field's vocabulary, so a contributed node's element is
  // not reported as something the editor will throw away.
  const recognised = useMemo(() => recognisedHtml(vocabulary), [vocabulary])
  const htmlWarning = useMemo(
    () => (htmlMode ? describeHtmlDrop(htmlDropReport(htmlSource, recognised)) : null),
    [htmlMode, htmlSource, recognised],
  )

  function exitHtmlMode(apply: boolean) {
    if (apply) {
      editor.setHTML(htmlSource)
      onChange(editor.getJSON())
    }
    setHtmlMode(false)
  }

  if (!editor) return null

  const isAdvanced = toolbar === 'advanced'

  return (
    <>
      {/* Link dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={(o) => { if (!o) setLinkDialogOpen(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Insert link</DialogTitle></DialogHeader>
          <DialogBody>
            <label className="block text-xs font-medium text-fg-muted mb-1.5">URL</label>
            <input
              ref={linkInputRef}
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyLink()}
              placeholder="https://"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25"
            />
            <label className="flex items-center gap-2 mt-3 text-sm text-fg-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={linkNewTab}
                onChange={(e) => setLinkNewTab(e.currentTarget.checked)}
                className="accent-accent-strong"
              />
              Open in new tab
            </label>
          </DialogBody>
          <DialogFooter>
            {editor.isActive('link') && (
              <Button variant="ghost" onClick={removeLink} className="mr-auto text-danger-fg hover:text-danger-fg hover:bg-danger-muted">Remove link</Button>
            )}
            <Button variant="secondary" onClick={() => setLinkDialogOpen(false)}>Cancel</Button>
            <Button onClick={applyLink}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image dialog */}
      {media && (
        <Dialog open={imageDialogOpen} onOpenChange={(o) => { if (!o) setImageDialogOpen(false) }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Insert image</DialogTitle></DialogHeader>
            <DialogBody>
              <label className="block text-xs font-medium text-fg-muted mb-1.5">Image URL</label>
              <input
                ref={imageInputRef}
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyImage()}
                placeholder="https://example.com/image.jpg"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25"
              />
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setImageDialogOpen(false)}>Cancel</Button>
              <Button onClick={applyImage}>Insert</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <div className="rounded-lg border border-border-strong bg-surface overflow-hidden shadow-xs focus-within:border-accent focus-within:ring-2 focus-within:ring-focus/25 transition-colors">

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-border bg-surface-sunken">

          {/* Block type */}
          <BlockTypeSelect editor={editor} />
          <Sep />

          {/* Inline marks */}
          <Btn onClick={() => editor.run({ kind: 'bold' })} active={editor.isActive('bold')} title="Bold"><strong>B</strong></Btn>
          <Btn onClick={() => editor.run({ kind: 'italic' })} active={editor.isActive('italic')} title="Italic"><em>I</em></Btn>
          <Btn onClick={() => editor.run({ kind: 'underline' })} active={editor.isActive('underline')} title="Underline"><span className="underline">U</span></Btn>
          {isAdvanced && (
            <Btn onClick={() => editor.run({ kind: 'strike' })} active={editor.isActive('strike')} title="Strikethrough"><s>S</s></Btn>
          )}
          {isAdvanced && (
            <Btn onClick={() => editor.run({ kind: 'code' })} active={editor.isActive('code')} title="Inline code">
              <svg className="size-3.5 inline" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 4L1 8l4 4M11 4l4 4-4 4"/></svg>
            </Btn>
          )}
          <Sep />

          {/* Lists */}
          <Btn onClick={() => editor.run({ kind: 'bulletList' })} active={editor.isActive('bulletList')} title="Bullet list">
            <svg className="size-3.5 inline" viewBox="0 0 16 16" fill="currentColor"><circle cx="2" cy="4.5" r="1.2"/><rect x="5" y="3.75" width="9" height="1.5" rx="0.5"/><circle cx="2" cy="8" r="1.2"/><rect x="5" y="7.25" width="9" height="1.5" rx="0.5"/><circle cx="2" cy="11.5" r="1.2"/><rect x="5" y="10.75" width="9" height="1.5" rx="0.5"/></svg>
          </Btn>
          <Btn onClick={() => editor.run({ kind: 'orderedList' })} active={editor.isActive('orderedList')} title="Ordered list">
            <svg className="size-3.5 inline" viewBox="0 0 16 16" fill="currentColor"><text x="0" y="5.5" fontSize="5" fontFamily="monospace">1.</text><rect x="5" y="3.75" width="9" height="1.5" rx="0.5"/><text x="0" y="9" fontSize="5" fontFamily="monospace">2.</text><rect x="5" y="7.25" width="9" height="1.5" rx="0.5"/><text x="0" y="12.5" fontSize="5" fontFamily="monospace">3.</text><rect x="5" y="10.75" width="9" height="1.5" rx="0.5"/></svg>
          </Btn>
          <Sep />

          {/* Link */}
          <Btn onClick={openLinkDialog} active={editor.isActive('link')} title="Insert / edit link">
            <svg className="size-3.5 inline" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5L7.5 3.5"/><path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5L8.5 12.5"/></svg>
          </Btn>

          {/* Image */}
          {media && (
            <Btn onClick={openImageDialog} active={false} title="Insert image">
              <svg className="size-3.5 inline" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5.5" cy="6" r="1.5"/><path d="M1.5 11.5l3.5-3.5 2.5 2.5 2-2 4 4"/></svg>
            </Btn>
          )}

          {/* Declared elements, when this workspace has any */}
          {contributions.length > 0 && (
            <>
              <Sep />
              <InsertMenu
                contributions={contributions}
                onInsert={(name, attrs) => editor.run({ kind: 'insertNode', name, attrs })}
                disabled={!editor.ready}
              />
            </>
          )}

          {/* Advanced-only */}
          {isAdvanced && (
            <>
              <Sep />
              <Btn onClick={() => editor.run({ kind: 'horizontalRule' })} active={false} title="Horizontal rule">
                <svg className="size-3.5 inline" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="7.25" width="14" height="1.5" rx="0.5"/></svg>
              </Btn>
              <Btn onClick={() => editor.run({ kind: 'undo' })} active={false} title="Undo" disabled={!editor.can('undo')}>
                <svg className="size-3.5 inline" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 6h7a4 4 0 0 1 0 8H6"/><path d="M2 6l3-3-3 3 3 3"/></svg>
              </Btn>
              <Btn onClick={() => editor.run({ kind: 'redo' })} active={false} title="Redo" disabled={!editor.can('redo')}>
                <svg className="size-3.5 inline" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 6H7a4 4 0 0 0 0 8h3"/><path d="M14 6l-3-3 3 3-3 3"/></svg>
              </Btn>
              <Sep />
              {/* HTML source mode toggle */}
              <Btn
                onClick={htmlMode ? () => exitHtmlMode(true) : enterHtmlMode}
                active={htmlMode}
                title={htmlMode ? 'Apply HTML and return to editor' : 'View / edit HTML source'}
              >
                <span className="font-mono text-[10px] tracking-tight">&lt;/&gt;</span>
              </Btn>
            </>
          )}
        </div>

        {/* Editor area or HTML source */}
        {htmlMode ? (
          <div className="flex flex-col">
            <textarea
              value={htmlSource}
              onChange={(e) => setHtmlSource((e.target as HTMLTextAreaElement).value)}
              spellCheck={false}
              className="w-full font-mono text-xs text-fg bg-gray-950 text-green-300 px-4 py-3 min-h-[200px] resize-y outline-none leading-relaxed"
              placeholder="<p>HTML source…</p>"
            />
            {htmlWarning && (
              <p
                role="status"
                className="px-4 py-2 text-xs text-warning-fg bg-warning-muted border-t border-border"
              >
                {htmlWarning}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 px-3 py-2 bg-surface-hover border-t border-border">
              <button
                type="button"
                onClick={() => exitHtmlMode(false)}
                className="text-xs text-fg-muted hover:text-fg px-2.5 py-1 rounded hover:bg-surface-hover transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => exitHtmlMode(true)}
                className="text-xs text-white bg-accent-strong hover:bg-accent-strong px-2.5 py-1 rounded transition-colors"
              >
                Apply HTML
              </button>
            </div>
          </div>
        ) : (
          <editor.Surface className="px-4 py-3 text-fg text-sm" />
        )}
      </div>
    </>
  )
}
