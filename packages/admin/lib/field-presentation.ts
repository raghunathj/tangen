/**
 * File Name: field-presentation.ts
 * Purpose: The presentation category of a field (UI V2 spec §18). Placement
 *          is the schema's decision (`admin.editorView.{main,sidebar}`);
 *          this decides HOW a field renders where the schema put it:
 *          `document` fields get comfortable vertical space, `compact`
 *          fields become a property row (label and control on one line)
 *          when they sit in the inspector, `structured` fields keep their
 *          dedicated surface. Never a second widget set: the control is
 *          the field's own.
 *
 *          A RELATION IS STRUCTURED, `many` or not. It reads like a property
 *          ("Client: Ather") but it does not RENDER like one: both pickers
 *          draw a bordered box holding the record's title, its status badge,
 *          a link that opens it and a button that changes it. Beside the
 *          inspector's fixed 120px label there is nothing left for the title,
 *          which truncates away while the badge and buttons keep their width,
 *          so a single relation in a sidebar read as an unlabelled strip of
 *          icons. `many` was never what made it too wide for one line.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { subFieldVisibility } from '@tangen/types'
import { evalVisibility } from './editor'

export type PresentationCategory = 'document' | 'compact' | 'structured'

const COMPACT = new Set(['boolean', 'number', 'currency', 'date', 'time', 'select', 'slug', 'color', 'rating', 'range', 'url', 'email', 'phone', 'form'])
const STRUCTURED = new Set(['media', 'object', 'json', 'code', 'geopoint', 'link', 'repeater', 'component', 'group', 'multiselect', 'tags', 'relation'])

export interface PresentationField {
  fieldType: string
  config?: { many?: boolean; localized?: boolean; admin?: { width?: unknown } } & Record<string, unknown>
}

export function presentationCategory(field: PresentationField): PresentationCategory {
  const t = field.fieldType
  if (COMPACT.has(t)) return 'compact'
  if (STRUCTURED.has(t)) return 'structured'
  // text, textarea, richtext and anything unknown (an extension field type)
  // read as document content: comfortable, stacked.
  return 'document'
}

/** In the inspector, a compact field is a one-line property row unless it is
 *  localized (its per-locale inputs need the stacked layout). */
export function inspectorLayout(field: PresentationField): 'inline' | 'stacked' {
  if (presentationCategory(field) !== 'compact') return 'stacked'
  if (field.config?.localized) return 'stacked'
  return 'inline'
}

// ── Column width ──────────────────────────────────────────────────────────────

/**
 * The editor grid is six columns; `admin.width` picks the span. ABSENT MEANS
 * FULL, which is what `FieldAdminBase.width` documents - the globals editor
 * used to read an absent width as half and span full only for three field
 * types it called "naturally wide", so a repeater declared without a width
 * landed in a half column of a side sheet. One mapping, one default, three
 * call sites.
 */
export type FieldWidth = 'full' | 'half' | 'third'

function widthOf(width?: string | null): FieldWidth {
  return width === 'half' ? 'half' : width === 'third' ? 'third' : 'full'
}

/** Span class for a grid that is six columns at every width (the object editor). */
export function fieldColSpan(width?: string | null): string {
  const w = widthOf(width)
  return w === 'half' ? 'col-span-3' : w === 'third' ? 'col-span-2' : 'col-span-6'
}

/**
 * Span class for a grid that stacks to one column below `sm` and is six
 * columns above it (the globals sheet, a repeater row). Written out rather
 * than prefixed at runtime so Tailwind's scanner sees every class.
 */
export function fieldColSpanSm(width?: string | null): string {
  const w = widthOf(width)
  return w === 'half' ? 'sm:col-span-3' : w === 'third' ? 'sm:col-span-2' : 'sm:col-span-6'
}

// ── Which control a repeater row renders ──────────────────────────────────────

/**
 * The compact controls a repeater row renders itself. Everything else goes to
 * the real `FieldControl`, because a text box is not an editor for a colour, a
 * link, a rating or a point on a map - and for several of those it does not
 * even store the right shape: a `link` value is an object, and the row's text
 * box wrote a bare string that `authoredLink` reads back as null. The server
 * never caught it, because the repeater branch of the field validator checks
 * row COUNT and sub-field required-ness and never a sub-field's type.
 *
 * This set is the single source of that split: `SubFieldControl` delegates
 * anything outside it, so an extension's own field type reaches its registered
 * input in a row exactly as it does at the top level.
 */
export const ROW_COMPACT_FIELD_TYPES = new Set([
  'text', 'textarea', 'number', 'boolean', 'date', 'select', 'multiselect', 'email', 'url', 'phone',
])

/** Whether a repeater row must hand this sub-field to the real `FieldControl`. */
export function rowDelegatesToFieldControl(fieldType: string): boolean {
  return !ROW_COMPACT_FIELD_TYPES.has(fieldType)
}

// ── A raw sub-field's admin options ───────────────────────────────────────────

/**
 * A raw sub-field (a repeater's `config.fields`, a component block's `fields`)
 * had TWO homes for its admin options depending on the key: `SubField.admin`
 * offers `helpText` and `width` and the row editors read them there, while
 * `placeholder` was only ever read from `config.admin` - because
 * `SubField.admin` does not offer it. Two homes per field, split by key, is a
 * trap to document and a nuisance to author.
 *
 * So both are read, and the top-level `admin` wins where a key appears twice.
 * A `FieldDefinition` (a top-level field, or a `field.group` sub-field built
 * with the `field.*` builders) keeps its single home at `config.admin` - that
 * shape has no top-level `admin` to confuse it with.
 */
export function subFieldAdmin(sf: {
  admin?: { helpText?: string; width?: string }
  config?: { admin?: { helpText?: string; width?: string; placeholder?: string } }
}): { helpText?: string; width?: string; placeholder?: string } {
  const outer = sf.admin ?? {}
  const inner = sf.config?.admin ?? {}
  return {
    helpText: outer.helpText ?? inner.helpText,
    width: outer.width ?? inner.width,
    placeholder: inner.placeholder,
  }
}

/**
 * A sub-field's default, resolved to the label an editor recognises, or null
 * when there is nothing to say.
 *
 * The CONTROL wears this rather than a caption under it. An empty select with
 * a line of text beneath reads as broken; a select whose empty option says
 * "Normal (default)" reads as configured and is still honest, because nothing
 * is stored until the editor picks a real option. Same for a text field, which
 * takes it as a placeholder.
 *
 * Never a write. Backfilling a default into the blocks a hundred pages already
 * hold would be a hundred revisions AND would freeze the value, so a later
 * change to the design default would move none of them. Absent-means-default is
 * what lets one line of code change every page at once.
 */
export function subFieldDefaultLabel(sf: DefaultBearing): string | null {
  const cfg = (sf.config ?? {}) as { default?: unknown; options?: Array<{ label?: string; value?: unknown }> }
  const dflt = cfg.default
  if (dflt === undefined || dflt === null || dflt === '') return null
  // A select stores its default as the option VALUE; an editor reads the label.
  const match = cfg.options?.find((o) => o.value === dflt)
  const shown = match?.label ?? String(dflt)
  return shown === '' ? null : shown
}

/**
 * Anything carrying a `config`: a SubField, a FieldDefinition, or the loose
 * object a test builds. Typed by what is READ rather than by one field shape,
 * because `subFieldAdmin` above already has to accept the same spread of
 * callers and a narrower type just pushes casts to every call site.
 */
type DefaultBearing = { config?: unknown }

/**
 * The empty option's label on a select: what leaving it alone means.
 *
 * It names the ACTION and then the value, not the value alone. A select's
 * default is resolved by looking it up among that select's own options
 * (`subFieldDefaultLabel`), so an empty option carrying the default's label is
 * GUARANTEED to duplicate one of the options below it - "Dark (default)" sat
 * directly above "Dark", and an editor could tell neither which was which nor
 * that one writes nothing while the other writes `dark`. The collision was
 * structural, not an edge case, so the label had to stop being a value.
 *
 * Still honest, and still not a write: picking this stores nothing, which is
 * what lets a later change to the design default move every page at once.
 *
 * NO DEFAULT ANSWERS "None", not "- select -". The string is now the label of
 * a radio and of a segmented button as well as a row in an open menu
 * (`selectChoices`), and an instruction wrapped in dashes reads as neither a
 * value nor a control once it is wearing a button. "None" is the state in all
 * three. The `subField` prefix is historical: a sub-field was where the empty
 * option existed first, and a top-level field reads the same function.
 */
export function subFieldEmptyOptionLabel(sf: DefaultBearing): string {
  const dflt = subFieldDefaultLabel(sf)
  return dflt ? `Use default (${dflt})` : 'None'
}

/**
 * A select's choices: the empty one FIRST, then the author's own.
 *
 * THE EMPTY STATE IS AN OPTION, which is the whole point. A select that is not
 * required has "nothing chosen" as a legal, meaningful value - `videoSource`
 * empty is "no video", and the two branch fields it gates are hidden and not
 * required precisely because of it - and before this a top-level select had no
 * way back to it. Picking MP4 was a one-way door: the dropdown listed only
 * real options, the radio group could not be unchecked, and the segmented
 * buttons had no unpressed state, so the field was MP4 forever and the fields
 * it gated stayed on screen, red, and unfillable.
 *
 * A sub-field select inside a block or a repeater row has offered the empty
 * option all along. `FieldControl` - the one control every top-level field in
 * the object editor goes through - offered it in none of its three
 * presentations. One list, built once here, is what stops the two from
 * disagreeing again, and it is why no presentation needs a branch for the
 * empty choice: it is an option like any other, and `coerceFieldValue` turns
 * its '' into the null the field stores.
 *
 * Offered whether or not the field is REQUIRED, exactly as a sub-field's
 * always has been. A required select an editor blanks goes red and refuses to
 * publish, which is what a required field with no value does everywhere else;
 * a required select an editor cannot blank is a value they can change but
 * never take back.
 */
export function selectChoices(
  field: DefaultBearing,
  options: ReadonlyArray<{ label: string; value: string }>,
): Array<{ label: string; value: string }> {
  return [{ label: subFieldEmptyOptionLabel(field), value: '' }, ...options]
}

/**
 * What a SEGMENTED group's button sends: the option it names, or nothing when
 * that option is already the one pressed.
 *
 * The segmented presentation is the one that does NOT take its empty state
 * from `selectChoices`, and the reason is the control: a group of two real
 * choices with a third button reading "None" makes a two-way decision look
 * like a three-way one, and the word sits oddly beside two actual values. A
 * pressed button that un-presses is the gesture the control already implies.
 *
 * It is a gesture, so it cannot be the whole answer and is not: the group also
 * draws a ✕ while a value is set, which is what tells an editor the exit
 * exists and gives a keyboard or screen-reader user a control with a name. The
 * bug this all comes from was an invisible dead end, and an invisible exit
 * fixes the mechanism without fixing that.
 *
 * NEITHER OF THE OTHER TWO CAN DO THIS. A native radio does not un-check, and
 * a dropdown has no pressed thing to click twice, so both keep the explicit
 * empty choice. The presentations differ because the controls differ; what
 * does not differ is that an optional select is always clearable, visibly.
 */
export function toggleSelectValue(current: string, clicked: string): string {
  return current === clicked ? '' : clicked
}

/**
 * What a CLOSED select shows while unset: the value it will render, qualified.
 *
 * A select trigger's job is to state what is in effect, so it leads with the
 * value - "Dark (default)" and not "Defaults to Dark", which reads as a
 * sentence where a value belongs. The parenthetical is what separates "unset,
 * renders dark" from "pinned to dark", a distinction that decides whether a
 * later change to the design default moves this block or leaves it behind.
 *
 * Deliberately NOT the same string as the open menu's empty option, which says
 * "Use default (Dark)": the menu sits next to a real "Dark" option and has to
 * offer an action, while the trigger stands alone and has to report a value.
 * One state, two jobs, and the wording that suits one misleads in the other.
 */
export function subFieldSelectPlaceholder(sf: DefaultBearing): string | undefined {
  const dflt = subFieldDefaultLabel(sf)
  return dflt ? `${dflt} (default)` : undefined
}

/**
 * A text-ish sub-field's placeholder: the authored one, else what empty means.
 *
 * "Defaults to Untitled" reads correctly inside an empty input, where there is
 * no value to report and the hint is a sentence. A select gets
 * `subFieldSelectPlaceholder` instead.
 *
 * The authored one lives at `config.admin.placeholder` and nowhere else -
 * `SubField.admin` carries only `helpText` and `width` - which is the same
 * single home `subFieldAdmin` reads it from.
 */
export function subFieldPlaceholder(sf: DefaultBearing): string | undefined {
  const authored = (sf.config as { admin?: { placeholder?: string } } | undefined)?.admin?.placeholder
  if (authored) return authored
  const dflt = subFieldDefaultLabel(sf)
  return dflt ? `Defaults to ${dflt}` : undefined
}

// ── Sub-field groups ─────────────────────────────────────────────────────────

/**
 * The tabs a sub-field's `group` sorts it into, in order.
 *
 * Lives here, shared, because the vocabulary has to mean the same thing
 * WHEREVER a sub-field is edited. It did not: a block card split into these
 * three while a repeater row rendered one flat grid and ignored `group`
 * entirely, so the same field declaration produced two different editors
 * depending on which container it sat in.
 *
 * These are KINDS, not arrangements. The question they answer is "what sort of
 * thing is this field" - what it says, how it looks, plumbing - which has the
 * same three answers for every block and every row anyone writes.
 * Author-declared tabs would answer "how do I want to lay out my form", which
 * drifts per block and would put a classification and an arrangement in one
 * field. Something whose Content grows long wants a fieldset WITHIN the tab,
 * not a fourth tab.
 */
export const SUBFIELD_TABS = [
  { key: 'content', label: 'Content' },
  { key: 'style', label: 'Style' },
  { key: 'advanced', label: 'Advanced' },
] as const

/**
 * A sub-field's group, with the default spelled out.
 *
 * TOTAL ON PURPOSE: anything outside the three kinds answers `content` rather
 * than itself. `SubField.group` is typed as a plain string, so `group:
 * 'gallery'` type-checks, and before this it matched no tab - which meant the
 * field rendered in NO tab and vanished from the editor completely. No error,
 * no empty tab, nothing: the value sat in the database with no way to reach
 * it. A field appearing under the wrong heading is a cosmetic problem; a field
 * nobody can edit is a data one.
 *
 * It was never repeater-specific. A block card filtered by group the same way,
 * so a typo in a block's declaration lost a field there too.
 */
export function subFieldGroup(sf: { group?: string }): string {
  const g = sf.group
  return g && (SUBFIELD_TABS as readonly { key: string }[]).some((t) => t.key === g) ? g : 'content'
}

/**
 * Which tabs this set of sub-fields actually fills, so a declaration that uses
 * none renders exactly as it did before: one group means no strip at all.
 */
export function activeSubFieldTabs<T extends { group?: string }>(
  fields: readonly T[],
): Array<{ key: string; label: string }> {
  return SUBFIELD_TABS.filter(({ key }) => fields.some((f) => subFieldGroup(f) === key))
    .map(({ key, label }) => ({ key, label }))
}

/**
 * The sub-fields a row or a block should DRAW, given that row's own values.
 *
 * The server has always skipped a sub-field its own rule hides - a field that
 * cannot be filled cannot be required, or publishing is impossible - and
 * neither container editor honoured the same rule, so the field was drawn
 * anyway, marked required, and the author was asked to fill in the branch they
 * had not chosen. A discriminator inside a block (MP4 asks for a file, YouTube
 * asks for an id) was therefore expressible in the schema, enforced correctly
 * on save, and unusable in the editor.
 *
 * `subFieldVisibility` is the one reader both sides now use, so the two can
 * no longer disagree about WHERE the rule was written. Values of a hidden
 * sub-field are kept, exactly as a hidden block's are: switching the
 * discriminator back brings the branch and its value back with it.
 */
export function visibleSubFields<T extends { name: string; admin?: { conditionalVisibility?: unknown }; config?: unknown }>(
  fields: readonly T[],
  values: Record<string, unknown>,
): T[] {
  return fields.filter((f) => {
    const cv = subFieldVisibility(f as Parameters<typeof subFieldVisibility>[0])
    return !cv || evalVisibility(cv, (fn) => values[fn])
  })
}
