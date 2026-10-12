/**
 * File Name: section-css-control.tsx
 * Purpose: The inspector's "Custom CSS" box for ONE block (X-T1), or for
 *          the page (X-T2, `scope: 'page'`) - the
 *          declarations the designer writes, the sanitiser's error when they
 *          cannot be used, and the list of what the block's protection
 *          refused, each with its reason.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A renderer of what it is handed. The state comes from
 *          `sectionCssState` (lib/section-css.ts), which asks the compiler,
 *          so what this shows is what publish will do - never a second
 *          opinion. Local while typing and saved on blur, like the class
 *          box: every keystroke of a half-written declaration would
 *          otherwise be validated, refused, and shown as an error the author
 *          is in the middle of fixing.
 *
 *          Refusals are shown, not hidden. A Guided root refuses `display`
 *          in raw CSS exactly as it does in the class panel, and a designer
 *          who typed it deserves the reason beside the box rather than a
 *          page that did not move. The other declarations still apply.
 *
 *          The locked reading (no `onSave`) exists for the designer who may
 *          not write raw CSS but is looking at a block that carries some: it
 *          is shown read-only with the reason, because invisible styling is
 *          the worse surprise.
 */
import { useEffect, useState } from 'react'
import { IconChevronRight } from '@tangen/icons'
import { MAX_CUSTOM_CSS } from '../lib/custom-css'
import type { SectionCssState } from '../lib/section-css'

export interface SectionCssControlProps {
  /** The stored raw CSS, '' for none. */
  value: string
  /** What the compiler says about `value`. */
  state: SectionCssState
  /** Absent means this member may not write raw CSS; the box reads only. */
  onSave?: (css: string) => void
  /** Why the box reads only, when it does. */
  lockedReason?: string
  /** The compiler's answer for a draft the designer is still typing. */
  check: (css: string) => SectionCssState
  disabled?: boolean
  /** What the declarations are scoped to. The block is the default. */
  scope?: 'block' | 'page'
}

export function SectionCssControl({ value, state, onSave, lockedReason, check, disabled, scope = 'block' }: SectionCssControlProps) {
  const [draft, setDraft] = useState(value)
  // A colleague's save, or a block switch, has to reach the box - otherwise
  // it keeps showing CSS that is no longer on the block.
  useEffect(() => { setDraft(value) }, [value])
  const live = draft === value ? state : check(draft)
  const locked = !onSave

  return (
    <details open={value !== ''} className="group border-t border-border" data-testid="section-css">
      <summary className="flex items-center gap-1.5 py-1.5 cursor-pointer list-none select-none">
        <IconChevronRight className="size-3 shrink-0 text-fg-subtle transition-transform duration-(--tg-motion-fast) group-open:rotate-90" />
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
          Custom CSS
        </span>
        {value !== '' && <span className="text-[10px] text-accent-fg">set</span>}
      </summary>
      <div className="pb-2 space-y-1">
        <textarea
          value={draft}
          disabled={disabled || locked}
          rows={3}
          spellCheck={false}
          aria-label={scope === 'page' ? 'Custom CSS for this page' : 'Custom CSS for this block'}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (onSave && !live.error && draft.trim() !== value.trim()) onSave(draft.trim()) }}
          placeholder={'text-wrap: balance;\nhyphens: auto'}
          className="w-full rounded-md border border-border bg-surface-sunken px-2 py-1.5 font-mono text-[11px] text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
        />
        {locked && lockedReason ? (
          <p className="text-[10px] text-fg-subtle">{lockedReason}</p>
        ) : null}
        {live.error ? (
          <p className="text-[10px] text-danger" role="alert">{live.error}</p>
        ) : (
          // Saying what this box IS prevents the commonest mistake: pasting a
          // whole rule, braces and all, and wondering why it is refused.
          <p className="text-[10px] text-fg-subtle">
            Declarations only, no selectors or braces. {scope === 'page' ? 'Applied to every section of this page.' : 'Scoped to this block.'} Up to {MAX_CUSTOM_CSS} characters.
          </p>
        )}
        {live.refused.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[10px] text-fg" data-testid="section-css-refused">
            <p className="font-semibold">
              {live.refused.length === 1
                ? (scope === 'page' ? '1 declaration is refused by a Block on this page' : '1 declaration is refused by this Block')
                : `${live.refused.length} declarations are refused by ${scope === 'page' ? 'Blocks on this page' : 'this Block'}`}
            </p>
            <ul className="mt-0.5 space-y-0.5">
              {live.refused.map((r) => (
                <li key={`${r.property}:${r.reason}`}>
                  <span className="font-mono">{r.property}</span>: {r.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
}
