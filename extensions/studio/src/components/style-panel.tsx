/**
 * File Name: style-panel.tsx
 * Purpose: The class-based Style panel - which class is being edited, at
 *          which state, and the properties themselves.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The class chip carries the USAGE COUNT deliberately and
 *          prominently. Webflow's equivalent is quiet and after the fact, so
 *          people fork classes rather than risk editing a shared one - which
 *          is how a project ends up with hundreds of near-duplicates. Making
 *          the blast radius visible before the edit is the antidote.
 */
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import {
  STYLE_SECTIONS, hasOverride, readValue, styleValueError,
  type StyleState, type Breakpoint, type StoredValue, type StyleProperty,
} from '@tangen/studio'
import { IconChevronRight, IconX } from '@tangen/icons'
import { visibleProperties, valueSource } from '../lib/provenance'
import { CompactText, CompactSelect } from './inspector-row'
import { ColorControl } from './style-controls'
import { BoxModelControl } from './box-model-control'
import { TokenRefPicker } from './token-ref-picker'
import { InteractionEditor } from './interaction-editor'
import type { AnyInteraction, BlockProtection, StyleTarget } from '@tangen/studio-schema'
import { propertyAccess, allowedChanges, targetLabel, type PartTarget } from '../lib/style-protection'
import { formatRefusedNote } from '../lib/refused-note'
import type { Refusal } from '@tangen/studio-compiler'
import { displayUnsupportedReason, displayOptionsFor } from '@tangen/studio-schema'
import { tokenSlotsFor, pickedValue } from '../lib/token-pick'
import type { StudioTokens } from '../tokens'
import { InspectorRow } from './inspector-row'
import { LengthControl } from './style-controls'
import type { StyleClass } from '../lib/classes'
import { customCssError, MAX_CUSTOM_CSS } from '../lib/custom-css'
import { ClassHousekeeping, type ClassHousekeepingProps } from './class-housekeeping'

interface StylePanelProps {
  /** Null while nothing is selected, or before a class exists for it. */
  styleClass: StyleClass | null
  /** What minting would name it - shown before the first edit creates it. */
  pendingName: string | null
  /** Blocks already wearing the pending class, when it is a REUSE. */
  pendingUsage?: number
  usage: number
  /** Element kinds this block can set a site-wide default for. */
  tags: readonly { tag: string; label: string }[]
  /** Non-null while styling EVERY element of a kind rather than this one. */
  tagTarget: string | null
  /**
   * What this block's author has opened up. Undefined means Open - a Block
   * opts IN to protection. A refused control is shown WITH its reason rather
   * than hidden: a designer whose value saved and did nothing learns to
   * distrust the tool, and a control that vanished teaches them nothing.
   */
  protection?: BlockProtection
  /** The selected block's type, so a control offers only what that structure can honour. */
  blockType?: string
  tagProps: Record<string, StoredValue>
  onTarget: (tag: string | null) => void
  /**
   * The Style Parts this block's author exposed beside the root, in
   * declaration order. Empty on an Open block, and then no switch is shown.
   */
  parts?: readonly PartTarget[]
  /** The part the class being edited is aimed at; null is the root. */
  partTarget?: string | null
  onPartTarget?: (part: string | null) => void
  /**
   * Declarations the last draft render refused by Block protection, shown
   * ONCE as a dismissible note rather than left to the publish log.
   */
  refused?: readonly Refusal[]
  /**
   * "Priya changed .card a moment ago": classes this block wears, or tag
   * defaults it can set, that someone else wrote since this editor loaded
   * them. Already formatted (lib/design-notice.ts). Advisory: the server's
   * stale-write guard still refuses a save built on the old row; this says
   * so BEFORE that happens, while reloading is still cheap.
   */
  changedElsewhere?: readonly string[]
  /** Refetches classes and tag defaults; unsaved panel state is replaced by the server copy. */
  onReloadStyles?: () => void
  /** Classes already applied to blocks of this type, offered for reuse. */
  available: StyleClass[]
  /** Every class, for resolving where a value came from. */
  allClasses: StyleClass[]
  /** Class names on this element, in application order. */
  applied: string[]
  /** Fork the shared class for this element only. */
  onMakeUnique: () => void
  onPickClass: (name: string | null) => void
  /** Only the states this block can actually use (see statesFor). */
  states: readonly StyleState[]
  state: StyleState
  onState: (s: StyleState) => void
  breakpoint: Breakpoint
  breakpointLabel: string
  onChange: (propertyId: string, value: string) => void
  /** Several properties in ONE write - a drag that touched two sides must not
   *  race itself through the version guard. */
  onChangeMany: (changes: Record<string, string>) => void
  /** Sets or removes (null) the class's Interaction. */
  onInteractionChange: (next: AnyInteraction | null) => void
  /** The workspace's token slots, per family - the scoped pickers draw from these. */
  tokens: StudioTokens
  /**
   * The workspace's font token NAMES. Separate from `tokens` because font
   * tokens are named rather than scaled, and they are the only fonts the
   * stylesheet loads - so they are the only fonts a class may name.
   */
  fonts?: readonly string[]
  /**
   * Raw CSS on this class - the escape hatch Creative Mode retired into.
   * Undefined when this member may not use it, which is the ONLY way the box
   * is hidden: the panel never evaluates the capability itself.
   */
  onCustomCss?: (value: string) => void
  busy?: boolean
  /**
   * The housekeeping list surface - duplicates to merge, unworn classes to
   * delete - under the class picker, where the class explosion it cleans up
   * is created. Absent when the page has no classes to tidy.
   */
  housekeeping?: ClassHousekeepingProps
}

export function StylePanel({
  styleClass, pendingName, usage, tags, tagTarget, tagProps, onTarget, protection,
  available, allClasses, applied, onPickClass, onMakeUnique, blockType,
  states, state, onState, breakpoint, breakpointLabel, onChange, onChangeMany, onInteractionChange, tokens, fonts, busy, pendingUsage,
  onCustomCss, housekeeping, parts = [], partTarget = null, onPartTarget, refused,
  changedElsewhere = [], onReloadStyles,
}: StylePanelProps) {
  const props = (tagTarget ? tagProps : styleClass?.props ?? {}) as Record<string, StoredValue>
  const name = styleClass?.name ?? pendingName

  // What protection kept out of the last draft. Dismissal is keyed by the
  // refusals themselves, so the same list stays dismissed across renders
  // and a different one shows again - see refused-note.ts.
  const refusedNote = formatRefusedNote(refused)
  const [dismissedRefusals, setDismissedRefusals] = useState<string | null>(null)
  const showRefused = refusedNote && refusedNote.key !== dismissedRefusals

  // A protected Block constrains what a WORKSPACE class may set on it. A tag
  // default is not that - it is site-wide and belongs to no block - so it is
  // left alone here rather than being refused for the wrong reason.
  const guard = tagTarget ? undefined : protection
  // Where the class lands: the root, or the Style Part the switch chose. The
  // part's own declared list is then what the schema answers from, so the
  // panel refuses exactly what the compiler will refuse for that part.
  const target: StyleTarget = partTarget ? { kind: 'part', part: partTarget } : { kind: 'root' }
  const access = (id: string) => propertyAccess(guard, id, target)
  // The panel does not merely decline to OFFER a refused control: it must not
  // write one either, because a value that saves and is dropped at publish is
  // the silent failure this whole model exists to prevent.
  const write = (id: string, value: string) => { if (access(id).allowed) onChange(id, value) }
  const writeMany = (changes: Record<string, string>) => {
    const kept = allowedChanges(guard, changes, target)
    if (Object.keys(kept).length > 0) onChangeMany(kept)
  }

  if (!name && !tagTarget) {
    return <p className="text-[11px] text-fg-subtle">Select a block to style it.</p>
  }

  return (
    <div className="space-y-2">
      {/* WHAT is being styled: this element's class, or every element of a
          kind. Without the second option a designer sets the heading font on
          forty elements and changing it later means forty edits. */}
      {tags.length > 0 && (
        <div className="flex rounded-md border border-border bg-surface-sunken p-0.5 gap-0.5">
          <button
            type="button"
            onClick={() => onTarget(null)}
            className={clsx(
              'flex-1 rounded px-1 py-0.5 text-[10px] font-medium transition-colors duration-(--tg-motion-fast)',
              !tagTarget ? 'bg-surface text-fg shadow-sm' : 'text-fg-subtle hover:text-fg-muted',
            )}
          >
            This element
          </button>
          {tags.map((t) => (
            <button
              key={t.tag}
              type="button"
              onClick={() => onTarget(t.tag)}
              title={`Every ${t.label.toLowerCase()} on the site`}
              className={clsx(
                'flex-1 rounded px-1 py-0.5 text-[10px] font-medium transition-colors duration-(--tg-motion-fast)',
                tagTarget === t.tag ? 'bg-surface text-fg shadow-sm' : 'text-fg-subtle hover:text-fg-muted',
              )}
            >
              All {t.tag.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {/* WHICH PART of the block the class lands on: its root, or a Style
          Part its author exposed. Offered only when the author declared
          one - a part is reachable because it was declared, never because
          the panel guessed at the widget's internals. */}
      {parts.length > 0 && !tagTarget && onPartTarget && (
        <div className="flex rounded-md border border-border bg-surface-sunken p-0.5 gap-0.5">
          <button
            type="button"
            onClick={() => onPartTarget(null)}
            className={clsx(
              'flex-1 rounded px-1 py-0.5 text-[10px] font-medium transition-colors duration-(--tg-motion-fast)',
              !partTarget ? 'bg-surface text-fg shadow-sm' : 'text-fg-subtle hover:text-fg-muted',
            )}
          >
            Root
          </button>
          {parts.map((p) => (
            <button
              key={p.part}
              type="button"
              onClick={() => onPartTarget(p.part)}
              title={`The ${p.label.toLowerCase()} inside this block`}
              className={clsx(
                'flex-1 rounded px-1 py-0.5 text-[10px] font-medium transition-colors duration-(--tg-motion-fast)',
                partTarget === p.part ? 'bg-surface text-fg shadow-sm' : 'text-fg-subtle hover:text-fg-muted',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Which class, and how much it affects. A PICKER, not a label: without
          a way to apply an existing class, every styled block mints its own
          and you get .section, .section-2, .section-3 - class explosion by
          construction. */}
      <div className={clsx(tagTarget && 'hidden')}>
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-fg-subtle mb-1">
          Class
        </label>
        <div className="flex items-center gap-1">
          <div className="flex-1 min-w-0 flex items-center gap-1 rounded-md border border-border bg-surface-sunken px-2 h-(--tg-control-h)">
            <span className="text-fg-subtle shrink-0">.</span>
            <select
              value={styleClass?.name ?? ''}
              onChange={(e) => onPickClass(e.target.value || null)}
              className="flex-1 min-w-0 bg-transparent text-(length:--tg-text-label) font-medium text-fg focus:outline-none cursor-pointer"
            >
              {!styleClass && (
                <option value="">
                  {/* A reuse says so, with how many blocks already wear it -
                      the alternative is a silent multi-instance edit, which
                      is the other half of Webflow's class problem. */}
                  {pendingUsage !== undefined && pendingUsage > 0
                    ? `${pendingName} - ${pendingUsage} ${pendingUsage === 1 ? 'use' : 'uses'}`
                    : `${pendingName} (new)`}
                </option>
              )}
              {available.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>
          {styleClass ? (
            <span
              className={clsx(
                'shrink-0 rounded px-1.5 h-(--tg-control-h) grid place-items-center text-[10px] tabular-nums',
                usage > 1 ? 'bg-warning-muted text-warning' : 'border border-border text-fg-subtle',
              )}
              title={usage > 1
                ? `${usage} elements use this class - editing changes all of them`
                : 'Used once'}
            >
              {usage}
            </span>
          ) : (
            <span
              className="shrink-0 grid place-items-center h-(--tg-control-h) px-1.5 text-[10px] text-fg-subtle border border-border rounded"
              title="Created when you change something"
            >
              new
            </span>
          )}
        </div>
        {/* The provenance line: which class this edit lands on, and which
            part of the block when it is not the root. Shown whenever the
            block has parts at all, so switching targets visibly moves it. */}
        {name && parts.length > 0 && (
          <p className="mt-1 text-[10px] text-fg-subtle" data-testid="style-target">
            {targetLabel(name, partTarget)}
          </p>
        )}
        {usage > 1 && (
          <p className="mt-1 flex items-center gap-1.5 text-[10px] text-warning">
            <span>Editing changes {usage} elements.</span>
            {/* The escape hatch, next to the warning that motivates it: the
                alternative is people forking pre-emptively out of fear, which
                is where class explosion comes from. */}
            <button
              type="button"
              onClick={onMakeUnique}
              className="font-medium text-accent-fg hover:underline"
            >
              Make unique
            </button>
          </p>
        )}
        {/* Someone else wrote a class this block wears. Said here, beside
            the class, before the stale-write guard says it by refusing the
            next save. Reload replaces the panel's copy with the server's;
            the designer decides, the guard still stands either way. */}
        {changedElsewhere.length > 0 && (
          <div
            role="status"
            data-testid="changed-elsewhere"
            className="mt-1.5 rounded-md border border-warning/40 bg-warning-muted px-2 py-1.5 text-[10px] text-fg-muted space-y-1"
          >
            {changedElsewhere.map((line) => <p key={line}>{line}</p>)}
            <p className="flex items-center gap-2">
              <span>Reload before editing it, or your next save is refused as stale.</span>
              {onReloadStyles && (
                <button type="button" onClick={onReloadStyles} className="font-medium text-accent-fg hover:underline">
                  Reload
                </button>
              )}
            </p>
          </div>
        )}
      </div>

      {/* Housekeeping sits under the picker because the picker is where
          classes get minted: the mess and the broom in one place. */}
      {housekeeping && !tagTarget && <ClassHousekeeping {...housekeeping} />}

      {/* State, and the breakpoint the canvas width already chose. */}
      <div className="flex items-center gap-1">
        <div className="flex-1 flex rounded-md border border-border bg-surface-sunken p-0.5 gap-0.5">
          {states.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onState(s)}
              className={clsx(
                'flex-1 rounded px-1 py-0.5 text-[10px] font-medium capitalize transition-colors duration-(--tg-motion-fast)',
                s === state ? 'bg-surface text-fg shadow-sm' : 'text-fg-subtle hover:text-fg-muted',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <span
          className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-fg-muted whitespace-nowrap"
          title="Set by the preview width - narrow the canvas to style a breakpoint"
        >
          {breakpointLabel}
        </span>
      </div>

      {/* Say it ONCE, at the top, rather than only per refused control: a
          designer opening a Locked Block should learn why half the panel is
          dimmed before they try the first one. */}
      {guard && guard.level !== 'open' && (
        <p className="rounded-md border border-border bg-surface-sunken px-2 py-1.5 text-[10px] text-fg-muted">
          This block is {guard.level === 'locked' ? 'locked' : 'guided'} by its author. Only the
          properties they exposed can be styled from here - the rest are dimmed with the reason.
        </p>
      )}

      {/* What protection refused on the last draft render. Said ONCE, and
          dismissible: a value that is in the store and compiles to nothing
          is otherwise "the page did not move" with the reason only in the
          server log. The panel's own controls refuse before writing, so
          what lands here is a colleague's class, a declaration tightened
          after the class was written, or a row edited by hand. */}
      {showRefused && refusedNote && (
        <div
          role="status"
          data-testid="refused-note"
          className="rounded-md border border-warning/40 bg-warning-muted px-2 py-1.5 text-[10px] text-fg-muted space-y-1"
        >
          <div className="flex items-start gap-1.5">
            <span className="flex-1">{refusedNote.summary}</span>
            <button
              type="button"
              onClick={() => setDismissedRefusals(refusedNote.key)}
              className="shrink-0 text-fg-subtle hover:text-fg"
              aria-label="Dismiss"
              title="Dismiss"
            >
              <IconX className="size-3" />
            </button>
          </div>
          <ul className="pl-3 list-disc space-y-0.5">
            {refusedNote.lines.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}

      {busy && <p className="text-[10px] text-fg-subtle">Saving…</p>}

      {/* Interactions live on the CLASS, like every other style decision, so
          every block wearing it animates the same way and a change reaches
          all of them. Not offered for tag defaults - "all H2 fade in" is a
          page-wide effect nobody asks for by accident. Nor on a class aimed
          at a Style Part: an interaction animates the element wearing the
          class, which is the block's wrapper, not the part. */}
      {styleClass && !tagTarget && !partTarget && (
        <details open={!!styleClass.interaction} className="group border-t border-border">
          <summary className="flex items-center gap-1.5 py-1.5 cursor-pointer list-none select-none">
            <IconChevronRight className="size-3 shrink-0 text-fg-subtle transition-transform duration-(--tg-motion-fast) group-open:rotate-90" />
            <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Interaction</span>
            {styleClass.interaction && <span className="text-[10px] text-accent-fg">1</span>}
          </summary>
          <div className="pb-2">
            <InteractionEditor className={styleClass.name} value={styleClass.interaction} onChange={onInteractionChange} disabled={busy} />
          </div>
        </details>
      )}

      {/* Every registry section, collapsible, with a count of what is set.
          Sixty controls in one column is the clutter the tabs were meant to
          fix - a section you are not using should cost one row. */}
      <div className="pt-1">
        {STYLE_SECTIONS.map((section) => {
          const visible = visibleProperties(section.id, props)
          if (visible.length === 0) return null
          const set = visible.filter((p) => readValue(props[p.id], { state, breakpoint }) !== undefined).length
          return (
            <details key={section.id} open={set > 0 || section.id === 'layout'} className="group border-t border-border">
              <summary className="flex items-center gap-1.5 py-1.5 cursor-pointer list-none select-none">
                <IconChevronRight className="size-3 shrink-0 text-fg-subtle transition-transform duration-(--tg-motion-fast) group-open:rotate-90" />
                <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                  {section.label}
                </span>
                {set > 0 && <span className="text-[10px] tabular-nums text-accent-fg">{set}</span>}
              </summary>
              <div className="pb-2 space-y-1.5">
                {/* Spacing leads with the diagram, the way Webflow does -
                    eight numbers in a column is a form, one draggable box is
                    a design tool. The per-side rows stay underneath for the
                    times an exact value is already known. */}
                {section.id === 'spacing' && (
                  <BoxModelControl
                    read={(id) => readValue(props[id], { state, breakpoint })}
                    onCommit={writeMany}
                    spaceTokens={tokens.space}
                    isSet={(id) => hasOverride(props[id], { state, breakpoint })}
                    disabled={busy}
                  />
                )}
                {visible.map((p) => {
                  const own = hasOverride(props[p.id], { state, breakpoint })
                  // Where the EFFECTIVE value comes from, when it is not this
                  // class. "Why is this red?" has to be answerable.
                  const origin = !own && !tagTarget
                    ? valueSource(p.id, applied, allClasses, { state, breakpoint })
                    : null
                  const foreign = origin && origin.className !== styleClass?.name
                  const value = readValue(props[p.id], { state, breakpoint }) ?? ''
                  const slots = tokenSlotsFor(p, tokens, fonts)
                  // The compiler refuses a value a browser would drop. Saying
                  // so HERE is the difference between "this control does
                  // nothing" and "I used it wrong" - the same rule, read from
                  // the same module the emitter reads.
                  const invalid = styleValueError(p, value)
                  // Ownership first: a Block's author has said this property
                  // is not editable from outside, and the compiler will drop
                  // it whatever the panel does. Then the tokens-only case - a
                  // property with no tokens configured has nothing that could
                  // work. Dimmed WITH the reason beats a control that accepts
                  // a value and discards it.
                  const refused = access(p.id)
                  // Then structure: a kit block wraps a block-level element,
                  // and `display:inline` on that computes correctly and lays
                  // out nothing a designer wants. The value is not offered,
                  // and one already stored says why it is doing nothing.
                  const structural = p.id === 'display' && !tagTarget
                    ? displayUnsupportedReason(blockType, value)
                    : undefined
                  const unavailable = !refused.allowed
                    ? refused.reason
                    : structural ?? (p.tokensOnly && !slots ? p.hint : undefined)

                  return (
                    <InspectorRow
                      key={p.id}
                      label={p.label}
                      layout="inline"
                      lockedReason={unavailable}
                      below={
                        unavailable ? (
                          <p className="pl-[38%] text-[10px] text-fg-subtle">{unavailable}</p>
                        ) : invalid ? (
                          <p className="pl-[38%] text-[10px] text-danger">{invalid}</p>
                        ) : foreign ? (
                          <p className="pl-[38%] text-[10px] text-fg-subtle">from .{origin!.className}</p>
                        ) : own && breakpoint !== 'base' ? (
                          <p className="pl-[38%] text-[10px] text-accent-fg">Set for {breakpoint}</p>
                        ) : own && state !== 'normal' ? (
                          <p className="pl-[38%] text-[10px] text-accent-fg">Set for {state}</p>
                        ) : undefined
                      }
                    >
                      <TokenRefPicker
                        slots={slots}
                        value={value}
                        onPick={(slot) => write(p.id, slot ? pickedValue(p, slot) : '')}
                      >
                        <PropertyControl
                          property={p}
                          value={value}
                          onChange={(v) => write(p.id, v)}
                          options={p.id === 'display' && !tagTarget ? displayOptionsFor(blockType, p.options ?? []) : undefined}
                        />
                      </TokenRefPicker>
                    </InspectorRow>
                  )
                })}
              </div>
            </details>
          )
        })}
      </div>

      {/* Raw CSS, last and collapsed: it is the escape hatch, not the tool.
          Offered only on a class that EXISTS - there is nothing to attach it
          to before the first property is set, and minting a class just to
          hold raw CSS would name it after a block it does not really style. */}
      {onCustomCss && !tagTarget && styleClass && (
        <CustomCssControl
          key={styleClass.id}
          value={styleClass.custom ?? ''}
          onSave={onCustomCss}
          disabled={busy}
        />
      )}
    </div>
  )
}

/**
 * The raw-CSS box. Local while typing and saved on blur, because every
 * keystroke of a half-written declaration would otherwise be validated,
 * refused, and shown as an error the author is in the middle of fixing.
 */
function CustomCssControl({ value, onSave, disabled }: {
  value: string
  onSave: (v: string) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(value)
  // A colleague's save, or a class switch, has to reach the box - otherwise
  // it keeps showing CSS that is no longer on the class.
  useEffect(() => { setDraft(value) }, [value])
  const error = customCssError(draft)

  return (
    <details open={value !== ''} className="group border-t border-border">
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
          disabled={disabled}
          rows={3}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (!error && draft.trim() !== value.trim()) onSave(draft.trim()) }}
          placeholder={'text-wrap: balance;\nhyphens: auto'}
          className="w-full rounded-md border border-border bg-surface-sunken px-2 py-1.5 font-mono text-[11px] text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {error ? (
          <p className="text-[10px] text-danger">{error}</p>
        ) : (
          // Saying what this box IS prevents the commonest mistake: pasting a
          // whole rule, braces and all, and wondering why it is refused.
          <p className="text-[10px] text-fg-subtle">
            Declarations only, no selectors or braces. Up to {MAX_CUSTOM_CSS} characters.
          </p>
        )}
      </div>
    </details>
  )
}

/** One control, chosen by the registry's `control` kind. */
function PropertyControl({ property, value, onChange, options }: {
  property: StyleProperty
  value: string
  onChange: (v: string) => void
  /** The registry's options narrowed to what this block can honour. */
  options?: readonly string[]
}) {
  switch (property.control) {
    case 'color':
      return <ColorControl value={value} onChange={onChange} />
    case 'length':
      // The registry's unit list, not a hardcoded one: a property that does
      // not accept a percentage must not offer it.
      return <LengthControl value={value} onChange={onChange} units={property.units} />
    case 'enum':
      return (
        <CompactSelect
          value={value}
          options={[{ label: '—', value: '' }, ...(options ?? property.options ?? []).map((o) => ({ label: o, value: o }))]}
          onChange={onChange}
        />
      )
    case 'number':
    case 'text':
    case 'shadow':
    default:
      // Shadow and free text share the plain input until a shadow picker
      // exists - an honest text box beats a half-built visual control. The
      // The registry's placeholder shows the SHAPE a value has to take,
      // because the commonest way to lose on a free-text property is not
      // knowing it - see background-image.
      return <CompactText value={value} onChange={onChange} placeholder={property.placeholder} />
  }
}
