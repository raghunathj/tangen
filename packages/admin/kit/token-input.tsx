/**
 * File Name: token-input.tsx
 * Purpose: A field that takes data from a run: type `{{` and the paths the run
 *          will actually resolve are offered, or press the data button and
 *          browse them by group.
 *
 *          Both, deliberately. The button teaches an operator what exists -
 *          they cannot guess `trigger.submission.values.email` - and the
 *          autocomplete is what they want once they know. Before this, a panel
 *          at the bottom of the node copied a token to the clipboard for the
 *          operator to paste into a field above (the user, 2026-09-19), which
 *          made the grammar a prerequisite for using it at all.
 *
 *          The suggestion list under the caret is drawn plainly rather than in
 *          a Popover, because a Popover moves focus into itself and the whole
 *          point here is to keep typing. The browse button, where browsing IS
 *          the task, uses one.
 *
 * Dependencies/Notes: Lives in the kit rather than in components because it
 *          IS a primitive: it builds the field, its offers list and its
 *          browse button out of raw elements, which is what the kit's own
 *          home is for (kit-lint scans everything else).
 *
 * Author: Raghunath J
 * License: MIT
 */
import * as React from 'react'
import { IconDatabase } from '@tangen/icons'
import { Label, Popover, PopoverAnchor, PopoverContent, PopoverTrigger, cx } from '@tangen/ui'
import { activeToken, applyToken, filterTokens, groupTokens, insertToken, type TokenOption } from '@/lib/token-suggest'


/**
 * Where the caret is, in the field's own coordinates.
 *
 * A textarea gives no caret position, so the text before it is measured in a
 * mirror element that copies the field's own typography and width. The offers
 * then open AT the caret rather than under the whole field, which matters most
 * in a tall mapping - and in a dialog, where a list pinned to the bottom of
 * the field was being clipped by the dialog itself (the user, 2026-09-19).
 */
function caretPoint(el: HTMLInputElement | HTMLTextAreaElement, caret: number): { x: number; y: number; line: number } {
  const style = window.getComputedStyle(el)
  const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4 || 16
  const mirror = document.createElement('div')
  for (const prop of [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
    'textTransform', 'wordSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
    'borderLeftWidth', 'borderRightWidth', 'borderTopWidth', 'boxSizing',
  ] as const) {
    mirror.style[prop] = style[prop]
  }
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = el instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre'
  mirror.style.wordWrap = 'break-word'
  mirror.style.width = `${el.clientWidth}px`
  mirror.style.top = '0'
  mirror.style.left = '-9999px'
  mirror.textContent = el.value.slice(0, caret)
  const marker = document.createElement('span')
  marker.textContent = '\u200b'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const x = marker.offsetLeft
  const y = marker.offsetTop
  document.body.removeChild(mirror)
  // Clamped to the field, so a caret scrolled out of view still anchors
  // somewhere visible instead of off the edge.
  return {
    x: Math.max(0, Math.min(x, el.clientWidth)),
    y: Math.max(0, Math.min(y - el.scrollTop, el.clientHeight)),
    line,
  }
}

export interface TokenInputProps {
  value: string
  onChange: (next: string) => void
  /** What this field may reference. No tokens means a plain field. */
  tokens?: readonly TokenOption[]
  label?: React.ReactNode
  placeholder?: string
  /** A mapping or a body needs room; a single value does not. */
  multiline?: boolean
  rows?: number
  disabled?: boolean
  id?: string
  /** Paths and JSON read better in a monospace face. */
  mono?: boolean
  className?: string
}

const FIELD = 'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-ui-sm text-fg placeholder:text-fg-faint focus:outline-none focus-visible:border-focus-border disabled:opacity-60'

export function TokenInput({
  value, onChange, tokens = [], label, placeholder, multiline, rows = 4, disabled, id, mono, className,
}: TokenInputProps) {
  const ref = React.useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const [open, setOpen] = React.useState(false)
  const [highlight, setHighlight] = React.useState(0)
  const [browsing, setBrowsing] = React.useState(false)
  const [caret, setCaret] = React.useState(0)
  const [point, setPoint] = React.useState<{ x: number; y: number; line: number }>({ x: 0, y: 0, line: 16 })

  const active = open ? activeToken(value, caret) : null
  const offers = React.useMemo(
    () => (active ? filterTokens(tokens, active.query) : []),
    [active?.query, tokens, active],
  )
  const visible = open && offers.length > 0

  /** Write the text and put the caret back where the insertion left it. */
  const write = (next: { text: string; caret: number }) => {
    onChange(next.text)
    setOpen(false)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(next.caret, next.caret)
      setCaret(next.caret)
    })
  }

  const accept = (option: TokenOption) => {
    const at = activeToken(value, caret)
    write(at ? applyToken(value, option.token, at) : insertToken(value, caret, option.token))
  }

  const onInput = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = e.currentTarget.value
    const at = e.currentTarget.selectionStart ?? next.length
    setCaret(at)
    onChange(next)
    // Open only while a token is actually being composed, so an ordinary
    // field never grows a dropdown.
    const composing = tokens.length > 0 && activeToken(next, at) !== null
    if (composing && ref.current) setPoint(caretPoint(ref.current, at))
    setOpen(composing)
    setHighlight(0)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!visible) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => (h + 1) % offers.length); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => (h - 1 + offers.length) % offers.length); return }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(offers[Math.min(highlight, offers.length - 1)]!); return }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  const track = (e: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setCaret(e.currentTarget.selectionStart ?? 0)
  }

  const common = {
    ref,
    id,
    value,
    placeholder,
    disabled,
    onChange: onInput,
    onKeyDown,
    onClick: track,
    onKeyUp: track,
    // A click away is a decision to stop composing; a click ON an offer is
    // handled by mousedown before this runs.
    onBlur: () => setOpen(false),
    className: cx(FIELD, mono && 'font-mono text-ui-xs', tokens.length > 0 && 'pr-8', className),
    'aria-autocomplete': tokens.length > 0 ? ('list' as const) : undefined,
    'aria-expanded': tokens.length > 0 ? visible : undefined,
  }

  return (
    <div className="space-y-1">
      {label && <Label htmlFor={id}>{label}</Label>}
      <div className="relative">
        {multiline
          ? <textarea {...(common as React.TextareaHTMLAttributes<HTMLTextAreaElement> & { ref: typeof ref })} rows={rows} />
          : <input {...(common as React.InputHTMLAttributes<HTMLInputElement> & { ref: typeof ref })} type="text" />}

        {tokens.length > 0 && (
          <Popover open={browsing} onOpenChange={setBrowsing}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                title="Insert data from the run"
                aria-label="Insert data from the run"
                className={cx(
                  'absolute right-1.5 grid size-6 place-items-center rounded-md text-fg-subtle hover:bg-surface-hover hover:text-fg disabled:opacity-50',
                  multiline ? 'top-1.5' : 'top-1/2 -translate-y-1/2',
                )}
              >
                <IconDatabase className="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent flush className="max-h-72 w-80 overflow-y-auto p-1">
              {groupTokens(tokens).map((group) => (
                <div key={group.group} className="py-1">
                  <p className="px-2 pb-1 text-ui-2xs font-semibold uppercase tracking-wider text-fg-subtle">{group.group}</p>
                  {group.items.map((option) => (
                    <button
                      key={option.token}
                      type="button"
                      className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
                      onClick={() => { setBrowsing(false); accept(option) }}
                    >
                      <span className="text-ui-sm text-fg">{option.label}</span>
                      <span className="font-mono text-ui-2xs text-fg-subtle">{option.token}</span>
                    </button>
                  ))}
                </div>
              ))}
            </PopoverContent>
          </Popover>
        )}

        {/* The offers are anchored AT the caret and rendered in a portal, so
            they are not clipped by whatever the field sits in (a dialog, a
            scrolling panel) and flip above the line when there is no room
            below. Focus never leaves the field: the whole point is to keep
            typing, so both autofocus hooks are refused and every item is
            taken on mousedown, before the field's own blur. */}
        <Popover open={visible} onOpenChange={(next) => { if (!next) setOpen(false) }}>
          <PopoverAnchor asChild>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute"
              style={{ left: point.x, top: point.y, width: 1, height: point.line }}
            />
          </PopoverAnchor>
          <PopoverContent
            flush
            align="start"
            side="bottom"
            sideOffset={4}
            collisionPadding={12}
            role="listbox"
            className="max-h-60 w-72 overflow-y-auto p-1"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            {offers.map((option, i) => (
              <button
                key={option.token}
                type="button"
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => { e.preventDefault(); accept(option) }}
                onMouseEnter={() => setHighlight(i)}
                className={cx(
                  'flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left',
                  i === highlight ? 'bg-surface-hover' : 'hover:bg-surface-hover',
                )}
              >
                <span className="text-ui-sm text-fg">{option.label}</span>
                <span className="shrink-0 font-mono text-ui-2xs text-fg-subtle">{option.group}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
